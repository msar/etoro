import { getBootstrap, type BootstrapInfo } from '../bootstrap.js';
import { etoroFetch } from '../etoroClient.js';
import {
  clearSchemaMissing,
  isSchemaMissing,
  markSchemaMissing,
  schemaMissingHint,
} from '../schemaState.js';
import { getSupabase, isSupabaseConfigured } from '../supabase.js';
import type { BalanceHistoryResponse, TradingEnv } from '../etoroTypes.js';
import { getPortfolio } from './portfolio.js';
import { getTradesFromEtoro, realizedPnlByDay } from './trades.js';

export interface SyncResult {
  gcid: number;
  seeded: boolean;
  balanceRowsUpserted: number;
  tradeRowsUpserted: number;
  holdingRowsUpserted: number;
  earliestSnapshot: string | null;
  latestSnapshot: string | null;
  lastSyncedAt: string;
}

export interface SyncStatus {
  configured: boolean;
  schemaReady: boolean;
  schemaHint?: string;
  gcid: number | null;
  lastSyncedAt: string | null;
  balanceSnapshotCount: number;
  tradeCount: number;
  holdingSnapshotCount: number;
  earliestSnapshot: string | null;
  latestSnapshot: string | null;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchBalanceWindow(
  from: string,
  to: string,
): Promise<NonNullable<BalanceHistoryResponse['snapshots']>> {
  const res = await etoroFetch<BalanceHistoryResponse>(
    `/api/v1/balances/history?fromDate=${from}&toDate=${to}&displayCurrency=USD`,
  );
  return [...(res.snapshots ?? [])].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Compute net_flow for each snapshot day using realized P&L from closed trades.
 * For the first day in a contiguous window, net_flow is 0 (baseline).
 * When merging into an existing DB series, pass the previous stored row so the
 * first fetched day can still get a correct net_flow.
 */
function withNetFlows(
  snapshots: NonNullable<BalanceHistoryResponse['snapshots']>,
  realized: Map<string, number>,
  previous?: { date: string; total: number; pnl: number } | null,
): {
  date: string;
  cash: number;
  invested: number;
  pnl: number;
  total: number;
  netFlow: number;
}[] {
  const points: {
    date: string;
    cash: number;
    invested: number;
    pnl: number;
    total: number;
    netFlow: number;
  }[] = [];

  snapshots.forEach((s, idx) => {
    const cash = s.displayTotalCash;
    const invested = s.displayTotalInvestedAmount;
    const pnl = s.displayTotalPnl;
    const total = s.displayTotalBalance;
    let netFlow = 0;

    if (idx === 0 && previous && previous.date < s.date) {
      const dBalance = total - previous.total;
      const dPnl = pnl - previous.pnl;
      const realizedToday = realized.get(s.date) ?? 0;
      netFlow = dBalance - dPnl - realizedToday;
      if (Math.abs(netFlow) < 0.01) netFlow = 0;
    } else if (idx > 0) {
      const prev = snapshots[idx - 1];
      const dBalance = total - prev.displayTotalBalance;
      const dPnl = pnl - prev.displayTotalPnl;
      const realizedToday = realized.get(s.date) ?? 0;
      netFlow = dBalance - dPnl - realizedToday;
      if (Math.abs(netFlow) < 0.01) netFlow = 0;
    }

    points.push({ date: s.date, cash, invested, pnl, total, netFlow });
  });

  return points;
}

async function upsertAccount(boot: BootstrapInfo): Promise<number> {
  if (boot.gcid === null) {
    throw new Error('Cannot sync: eToro gcid could not be resolved from balances.');
  }
  const sb = getSupabase();
  const { error } = await sb.from('accounts').upsert(
    {
      gcid: boot.gcid,
      username: boot.username,
      environment: boot.environment,
      trading_account_id: boot.tradingAccountId,
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: 'gcid' },
  );
  if (error) {
    if (markSchemaMissing(error.message)) throw new Error(schemaMissingHint());
    throw new Error(`accounts upsert failed: ${error.message}`);
  }
  return boot.gcid;
}

async function latestStoredBalance(
  gcid: number,
): Promise<{ date: string; total: number; pnl: number; net_flow: number } | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('balance_snapshots')
    .select('date, total, pnl, net_flow')
    .eq('gcid', gcid)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`balance_snapshots read failed: ${error.message}`);
  return data as { date: string; total: number; pnl: number; net_flow: number } | null;
}

async function countBalances(gcid: number): Promise<number> {
  const sb = getSupabase();
  const { count, error } = await sb
    .from('balance_snapshots')
    .select('*', { count: 'exact', head: true })
    .eq('gcid', gcid);
  if (error) throw new Error(`balance_snapshots count failed: ${error.message}`);
  return count ?? 0;
}

let syncInFlight: Promise<SyncResult> | null = null;

/**
 * Seed (empty DB) or incremental upsert of eToro history into Supabase.
 * Concurrent callers share one in-flight promise.
 */
export async function runSync(): Promise<SyncResult> {
  if (!isSupabaseConfigured()) {
    throw new Error('History store is not configured.');
  }
  if (isSchemaMissing()) {
    clearSchemaMissing(); // allow one re-probe after the user applies the migration
  }
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    try {
      const boot = await getBootstrap();
      const gcid = await upsertAccount(boot);
      const env = boot.environment as TradingEnv;
      const existingCount = await countBalances(gcid);
      const seeded = existingCount === 0;
      const previous = seeded ? null : await latestStoredBalance(gcid);

      // Full ~12 months on first sync; otherwise re-fetch from last stored date through today.
      const balanceFrom = seeded ? isoDaysAgo(364) : (previous?.date ?? isoDaysAgo(14));
      const to = today();

      const snapshots = await fetchBalanceWindow(balanceFrom, to);

      let realized = new Map<string, number>();
      try {
        const trades = await getTradesFromEtoro(env, balanceFrom);
        realized = realizedPnlByDay(trades);
      } catch (err) {
        console.warn('Trade history unavailable during sync:', (err as Error).message);
      }

      // Keep previous stored row only as a baseline for net_flow of newer days.
      const prevForFlow =
        previous && snapshots[0] && previous.date < snapshots[0].date ? previous : null;
      const points = withNetFlows(snapshots, realized, prevForFlow);
      // Preserve stored net_flow when re-upserting the same latest day.
      if (previous && points[0]?.date === previous.date) {
        points[0].netFlow = previous.net_flow;
      }

      const sb = getSupabase();
      const accountId = String(gcid);
      // Ensure broker_accounts row exists (migration 003); ignore if table missing.
      {
        const { error: baErr } = await sb.from('broker_accounts').upsert(
          {
            id: accountId,
            broker: 'etoro',
            display_name: boot.username ?? 'eToro',
            currency: boot.displayCurrency || 'USD',
            external_ref: accountId,
            last_synced_at: new Date().toISOString(),
          },
          { onConflict: 'id' },
        );
        if (baErr && !/schema cache|Could not find the table/i.test(baErr.message)) {
          console.warn('broker_accounts upsert skipped:', baErr.message);
        }
      }

      let balanceRowsUpserted = 0;
      let useAccountId = true;
      for (const batch of chunk(points, 200)) {
        const withAccount = batch.map((p) => ({
          gcid,
          account_id: accountId,
          date: p.date,
          cash: p.cash,
          invested: p.invested,
          pnl: p.pnl,
          total: p.total,
          net_flow: p.netFlow,
        }));
        if (useAccountId) {
          const { error } = await sb.from('balance_snapshots').upsert(withAccount, {
            onConflict: 'account_id,date',
          });
          if (error) {
            if (/account_id|schema cache|Could not find/i.test(error.message)) {
              useAccountId = false;
              console.warn(
                'balance_snapshots.account_id unavailable — run migration 003. Falling back to gcid PK.',
              );
            } else {
              throw new Error(`balance_snapshots upsert failed: ${error.message}`);
            }
          } else {
            balanceRowsUpserted += withAccount.length;
            continue;
          }
        }
        const legacy = batch.map((p) => ({
          gcid,
          date: p.date,
          cash: p.cash,
          invested: p.invested,
          pnl: p.pnl,
          total: p.total,
          net_flow: p.netFlow,
        }));
        const { error } = await sb.from('balance_snapshots').upsert(legacy, {
          onConflict: 'gcid,date',
        });
        if (error) throw new Error(`balance_snapshots upsert failed: ${error.message}`);
        balanceRowsUpserted += legacy.length;
      }

      // Trades: pull from earliest stored close or a wide window on seed.
      let tradeFrom = balanceFrom;
      if (seeded) tradeFrom = isoDaysAgo(364);
      const trades = await getTradesFromEtoro(env, tradeFrom);
      let tradeRowsUpserted = 0;
      for (const batch of chunk(trades, 200)) {
        const rows = batch.map((t) => ({
          gcid,
          position_id: t.positionId,
          instrument_id: t.instrumentId,
          is_buy: t.isBuy,
          leverage: t.leverage,
          open_rate: t.openRate,
          close_rate: t.closeRate,
          investment: t.investment,
          fees: t.fees,
          units: t.units,
          net_profit: t.netProfit,
          open_timestamp: t.openTimestamp,
          close_timestamp: t.closeTimestamp,
        }));
        const { error } = await sb.from('closed_trades').upsert(rows, {
          onConflict: 'position_id',
        });
        if (error) throw new Error(`closed_trades upsert failed: ${error.message}`);
        tradeRowsUpserted += rows.length;
      }

      // Today's holdings snapshot
      let holdingRowsUpserted = 0;
      try {
        const portfolio = await getPortfolio(env);
        const date = today();
        const rows = portfolio.holdings.map((h) => ({
          gcid,
          date,
          instrument_id: h.instrumentId,
          invested: h.invested,
          value: h.value,
          pnl: h.pnl,
          pnl_percent: h.pnlPercent,
          net_units: h.netUnits,
          via_copy: h.viaCopy,
        }));
        for (const batch of chunk(rows, 200)) {
          const { error } = await sb.from('holding_snapshots').upsert(batch, {
            onConflict: 'gcid,date,instrument_id',
          });
          if (error) throw new Error(`holding_snapshots upsert failed: ${error.message}`);
          holdingRowsUpserted += batch.length;
        }
      } catch (err) {
        console.warn('Holdings snapshot skipped:', (err as Error).message);
      }

      const lastSyncedAt = new Date().toISOString();
      await sb.from('accounts').update({ last_synced_at: lastSyncedAt }).eq('gcid', gcid);

      const range = await snapshotRange(gcid);
      return {
        gcid,
        seeded,
        balanceRowsUpserted,
        tradeRowsUpserted,
        holdingRowsUpserted,
        earliestSnapshot: range.earliest,
        latestSnapshot: range.latest,
        lastSyncedAt,
      };
    } finally {
      syncInFlight = null;
    }
  })();

  return syncInFlight;
}

async function snapshotRange(
  gcid: number,
): Promise<{ earliest: string | null; latest: string | null }> {
  const sb = getSupabase();
  const earliest = await sb
    .from('balance_snapshots')
    .select('date')
    .eq('gcid', gcid)
    .order('date', { ascending: true })
    .limit(1)
    .maybeSingle();
  const latest = await sb
    .from('balance_snapshots')
    .select('date')
    .eq('gcid', gcid)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    earliest: (earliest.data as { date: string } | null)?.date ?? null,
    latest: (latest.data as { date: string } | null)?.date ?? null,
  };
}

export async function getSyncStatus(): Promise<SyncStatus> {
  if (!isSupabaseConfigured()) {
    return {
      configured: false,
      schemaReady: false,
      gcid: null,
      lastSyncedAt: null,
      balanceSnapshotCount: 0,
      tradeCount: 0,
      holdingSnapshotCount: 0,
      earliestSnapshot: null,
      latestSnapshot: null,
    };
  }

  if (isSchemaMissing()) {
    // Re-probe once in case the user just applied the migration without restarting.
    clearSchemaMissing();
  }

  const boot = await getBootstrap();
  const gcid = boot.gcid;
  if (gcid === null) {
    return {
      configured: true,
      schemaReady: true,
      gcid: null,
      lastSyncedAt: null,
      balanceSnapshotCount: 0,
      tradeCount: 0,
      holdingSnapshotCount: 0,
      earliestSnapshot: null,
      latestSnapshot: null,
    };
  }

  const sb = getSupabase();
  const account = await sb.from('accounts').select('last_synced_at').eq('gcid', gcid).maybeSingle();
  if (account.error && markSchemaMissing(account.error.message)) {
    return {
      configured: true,
      schemaReady: false,
      schemaHint: schemaMissingHint(),
      gcid,
      lastSyncedAt: null,
      balanceSnapshotCount: 0,
      tradeCount: 0,
      holdingSnapshotCount: 0,
      earliestSnapshot: null,
      latestSnapshot: null,
    };
  }

  const balances = await sb
    .from('balance_snapshots')
    .select('*', { count: 'exact', head: true })
    .eq('gcid', gcid);
  const trades = await sb
    .from('closed_trades')
    .select('*', { count: 'exact', head: true })
    .eq('gcid', gcid);
  const holdings = await sb
    .from('holding_snapshots')
    .select('*', { count: 'exact', head: true })
    .eq('gcid', gcid);
  const range = await snapshotRange(gcid);

  return {
    configured: true,
    schemaReady: true,
    gcid,
    lastSyncedAt: (account.data as { last_synced_at: string | null } | null)?.last_synced_at ?? null,
    balanceSnapshotCount: balances.count ?? 0,
    tradeCount: trades.count ?? 0,
    holdingSnapshotCount: holdings.count ?? 0,
    earliestSnapshot: range.earliest,
    latestSnapshot: range.latest,
  };
}
