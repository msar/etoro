import { cached, TTL } from '../cache.js';
import { etoroFetch } from '../etoroClient.js';
import { getBootstrap } from '../bootstrap.js';
import { isSchemaMissing, markSchemaMissing } from '../schemaState.js';
import { getSupabase, isSupabaseConfigured, selectAllRows } from '../supabase.js';
import type { BalanceHistoryResponse, TradingEnv } from '../etoroTypes.js';
import { getTrades, realizedPnlByDay } from './trades.js';

export interface EquityPoint {
  date: string;
  cash: number;
  invested: number;
  pnl: number;
  total: number;
  /** Estimated net external flow (deposit − withdrawal) on this date */
  netFlow: number;
  /** Running cost basis: first-snapshot basis + subsequent net flows */
  cumulativeNetDeposits: number;
}

export interface EquityHistory {
  displayCurrency: string;
  points: EquityPoint[];
  totalDepositsInWindow: number;
  totalWithdrawalsInWindow: number;
  /** Earliest stored snapshot date when reading from Supabase */
  storedSince?: string | null;
  lastSyncedAt?: string | null;
  source: 'supabase' | 'etoro';
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function buildPointsFromRows(
  rows: {
    date: string;
    cash: number;
    invested: number;
    pnl: number;
    total: number;
    net_flow: number;
  }[],
): { points: EquityPoint[]; deposits: number; withdrawals: number } {
  const points: EquityPoint[] = [];
  let deposits = 0;
  let withdrawals = 0;
  let cumulative = 0;

  rows.forEach((s, idx) => {
    if (idx === 0) {
      cumulative = s.total - s.pnl;
    } else {
      const netFlow = s.net_flow;
      if (netFlow > 0) deposits += netFlow;
      else withdrawals += -netFlow;
      cumulative += netFlow;
    }
    points.push({
      date: s.date,
      cash: s.cash,
      invested: s.invested,
      pnl: s.pnl,
      total: s.total,
      netFlow: idx === 0 ? 0 : s.net_flow,
      cumulativeNetDeposits: cumulative,
    });
  });

  return { points, deposits, withdrawals };
}

async function getEquityHistoryFromSupabase(
  fromDate?: string,
  toDate?: string,
): Promise<EquityHistory | null> {
  if (!isSupabaseConfigured() || isSchemaMissing()) return null;
  const boot = await getBootstrap();
  if (boot.gcid === null) return null;

  const sb = getSupabase();
  const gcid = boot.gcid;
  // PostgREST caps selects at 1000 rows — paginate to get the full series.
  const { rows: data, error } = await selectAllRows<{
    date: string;
    cash: number;
    invested: number;
    pnl: number;
    total: number;
    net_flow: number;
  }>((from, to) => {
    let query = sb
      .from('balance_snapshots')
      .select('date, cash, invested, pnl, total, net_flow')
      .eq('gcid', gcid)
      .order('date', { ascending: true });
    if (fromDate) query = query.gte('date', fromDate);
    if (toDate) query = query.lte('date', toDate);
    return query.range(from, to);
  });
  if (error) {
    markSchemaMissing(error);
    console.warn('Supabase balance read failed, falling back to eToro:', error);
    return null;
  }
  if (!data.length) return null;

  const rows = data;
  const { points, deposits, withdrawals } = buildPointsFromRows(rows);
  const account = await sb
    .from('accounts')
    .select('last_synced_at')
    .eq('gcid', boot.gcid)
    .maybeSingle();

  return {
    displayCurrency: boot.displayCurrency || 'USD',
    points,
    totalDepositsInWindow: deposits,
    totalWithdrawalsInWindow: withdrawals,
    storedSince: points[0]?.date ?? null,
    lastSyncedAt: (account.data as { last_synced_at: string | null } | null)?.last_synced_at ?? null,
    source: 'supabase',
  };
}

/**
 * Balance history + derived net-deposit series.
 * Prefers Supabase (accumulated beyond eToro's 12-month window) when configured
 * and populated; otherwise falls back to live eToro `/balances/history`.
 */
export async function getEquityHistory(
  env: TradingEnv,
  fromDate?: string,
  toDate?: string,
): Promise<EquityHistory> {
  const from = fromDate;
  const to = toDate ?? new Date().toISOString().slice(0, 10);

  const fromSupabase = await getEquityHistoryFromSupabase(from, to);
  if (fromSupabase) return fromSupabase;

  const etoroFrom = from ?? isoDaysAgo(364);
  return cached(`equity:${env}:${etoroFrom}:${to}`, TTL.HISTORY, async () => {
    const res = await etoroFetch<BalanceHistoryResponse>(
      `/api/v1/balances/history?fromDate=${etoroFrom}&toDate=${to}&displayCurrency=USD`,
    );
    const snapshots = [...(res.snapshots ?? [])].sort((a, b) => a.date.localeCompare(b.date));

    let realized = new Map<string, number>();
    try {
      const trades = await getTrades(env, etoroFrom);
      realized = realizedPnlByDay(trades);
    } catch (err) {
      console.warn('Trade history unavailable for flow derivation:', (err as Error).message);
    }

    const rows = snapshots.map((s, idx) => {
      let net_flow = 0;
      if (idx > 0) {
        const prev = snapshots[idx - 1];
        const dBalance = s.displayTotalBalance - prev.displayTotalBalance;
        const dPnl = s.displayTotalPnl - prev.displayTotalPnl;
        const realizedToday = realized.get(s.date) ?? 0;
        net_flow = dBalance - dPnl - realizedToday;
        if (Math.abs(net_flow) < 0.01) net_flow = 0;
      }
      return {
        date: s.date,
        cash: s.displayTotalCash,
        invested: s.displayTotalInvestedAmount,
        pnl: s.displayTotalPnl,
        total: s.displayTotalBalance,
        net_flow,
      };
    });

    const { points, deposits, withdrawals } = buildPointsFromRows(rows);
    return {
      displayCurrency: res.displayCurrency ?? 'USD',
      points,
      totalDepositsInWindow: deposits,
      totalWithdrawalsInWindow: withdrawals,
      source: 'etoro' as const,
    };
  });
}
