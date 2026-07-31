/**
 * Kraken — sync spot balances via REST API, store equity snapshots, overview.
 */

import { EtoroApiError } from '../errors.js';
import {
  getKrakenBalances,
  getKrakenLedgers,
  getKrakenTickers,
  getKrakenTradeBalance,
  isFiatAsset,
  isKrakenConfigured,
  normalizeKrakenAsset,
  type KrakenLedgerEntry,
} from '../krakenClient.js';
import {
  getSupabase,
  isSupabaseConfigured,
  selectAllRows,
} from '../supabase.js';
import type { Granularity, PerformancePoint, PerformanceSeries } from './performance.js';

export const KRAKEN_ACCOUNT_ID = 'kraken:default';

export interface KrakenHolding {
  asset: string;
  displayAsset: string;
  quantity: number;
  priceUsd: number;
  valueUsd: number;
}

export interface KrakenSyncResult {
  accountId: string;
  date: string;
  equityUsd: number;
  cashUsd: number;
  investedUsd: number;
  holdingsCount: number;
  netFlow: number;
}

export interface KrakenOverview {
  available: boolean;
  reason?: string;
  configured: boolean;
  accountId: string | null;
  currency: 'USD';
  currentValue: number | null;
  statementDate: string | null;
  totalDeposits: number;
  totalWithdrawals: number;
  allTimeGain: number | null;
  allTimeGainPct: number | null;
  lastSyncedAt: string | null;
  snapshots: {
    date: string;
    total: number;
    netFlow: number;
    cumulativeNetDeposits: number;
  }[];
  holdings: KrakenHolding[];
  allocation: { asset: string; value: number; pct: number }[];
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function findKrakenAccountId(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const sb = getSupabase();
  const { data, error } = await sb
    .from('broker_accounts')
    .select('id')
    .eq('broker', 'kraken')
    .limit(1)
    .maybeSingle();
  if (error) {
    if (/schema cache|Could not find the table/i.test(error.message)) return null;
    console.warn('findKrakenAccountId:', error.message);
    return null;
  }
  return (data as { id: string } | null)?.id ?? null;
}

async function ensureKrakenAccount(): Promise<string> {
  const sb = getSupabase();
  const { error } = await sb.from('broker_accounts').upsert(
    {
      id: KRAKEN_ACCOUNT_ID,
      broker: 'kraken',
      display_name: 'Kraken',
      currency: 'USD',
      external_ref: 'default',
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );
  if (error) throw new EtoroApiError(`Failed to upsert Kraken account: ${error.message}`, 500);
  return KRAKEN_ACCOUNT_ID;
}

/** Candidate USD pairs for a normalized asset (XBT, ETH, …). */
function usdPairCandidates(asset: string): string[] {
  const a = asset.toUpperCase();
  if (a === 'USD' || a === 'ZUSD') return [];
  if (a === 'XBT' || a === 'BTC') return ['XXBTZUSD', 'XBTUSD', 'BTCUSD'];
  if (a === 'ETH') return ['XETHZUSD', 'ETHUSD'];
  if (a === 'ETH2') return ['XETHZUSD', 'ETHUSD'];
  return [`${a}USD`, `X${a}ZUSD`, `${a}ZUSD`];
}

async function priceHoldingsUsd(
  balances: Record<string, string>,
): Promise<{ holdings: KrakenHolding[]; cashUsd: number; investedUsd: number }> {
  const holdings: KrakenHolding[] = [];
  let cashUsd = 0;
  let investedUsd = 0;

  const nonZero = Object.entries(balances)
    .map(([asset, qty]) => ({ asset, qty: Number(qty) }))
    .filter((r) => Number.isFinite(r.qty) && Math.abs(r.qty) > 1e-12);

  const pairHints: string[] = [];
  for (const row of nonZero) {
    const display = normalizeKrakenAsset(row.asset);
    if (isFiatAsset(row.asset)) continue;
    for (const p of usdPairCandidates(display)) pairHints.push(p);
  }

  let tickers: Record<string, { c: string[] }> = {};
  if (pairHints.length) {
    try {
      tickers = await getKrakenTickers([...new Set(pairHints)]);
    } catch (err) {
      console.warn('Kraken ticker fetch failed:', (err as Error).message);
    }
  }

  function priceFor(display: string): number | null {
    for (const pair of usdPairCandidates(display)) {
      const t = tickers[pair];
      if (t?.c?.[0]) {
        const px = Number(t.c[0]);
        if (Number.isFinite(px) && px > 0) return px;
      }
    }
    // Match any returned key that ends with the pair altname
    for (const [key, t] of Object.entries(tickers)) {
      if (
        key.includes(`${display}USD`) ||
        key.includes(`${display}ZUSD`) ||
        (display === 'XBT' && key.includes('XBT') && key.includes('USD'))
      ) {
        const px = Number(t.c?.[0]);
        if (Number.isFinite(px) && px > 0) return px;
      }
    }
    return null;
  }

  for (const row of nonZero) {
    const display = normalizeKrakenAsset(row.asset);
    if (display.toUpperCase() === 'USD') {
      cashUsd += row.qty;
      holdings.push({
        asset: row.asset,
        displayAsset: 'USD',
        quantity: row.qty,
        priceUsd: 1,
        valueUsd: row.qty,
      });
      continue;
    }
    if (display.toUpperCase() === 'EUR') {
      // Leave EUR as separate; value via TradeBalance for totals. Still list with price 0 if no FX.
      holdings.push({
        asset: row.asset,
        displayAsset: 'EUR',
        quantity: row.qty,
        priceUsd: 0,
        valueUsd: 0,
      });
      continue;
    }

    const price = priceFor(display) ?? 0;
    const value = row.qty * price;
    investedUsd += value;
    holdings.push({
      asset: row.asset,
      displayAsset: display,
      quantity: row.qty,
      priceUsd: price,
      valueUsd: value,
    });
  }

  holdings.sort((a, b) => b.valueUsd - a.valueUsd);
  return { holdings, cashUsd, investedUsd };
}

async function sumUsdFlowsSince(
  sinceUnix: number,
): Promise<{ deposits: number; withdrawals: number }> {
  let deposits = 0;
  let withdrawals = 0;
  let ofs = 0;

  for (let page = 0; page < 20; page++) {
    let result;
    try {
      result = await getKrakenLedgers({ start: sinceUnix, ofs });
    } catch (err) {
      console.warn('Kraken ledgers fetch failed:', (err as Error).message);
      break;
    }
    const entries = Object.values(result.ledger ?? {}) as KrakenLedgerEntry[];
    if (!entries.length) break;

    for (const e of entries) {
      if (e.time < sinceUnix) continue;
      const amount = Number(e.amount);
      if (!Number.isFinite(amount)) continue;
      // Convert fiat-ish ledger amounts; crypto deposits need pricing — use TradeBalance delta fallback
      const asset = normalizeKrakenAsset(e.asset).toUpperCase();
      if (asset !== 'USD') continue;
      if (e.type === 'deposit' || (e.type === 'transfer' && amount > 0)) {
        deposits += Math.abs(amount);
      } else if (e.type === 'withdrawal' || (e.type === 'transfer' && amount < 0)) {
        withdrawals += Math.abs(amount);
      }
    }

    ofs += entries.length;
    if (ofs >= (result.count ?? 0) || entries.length < 50) break;
  }

  return { deposits, withdrawals };
}

/**
 * Pull live balances from Kraken, price in USD, upsert today's snapshot + holdings.
 */
export async function runKrakenSync(): Promise<KrakenSyncResult> {
  if (!isKrakenConfigured()) {
    throw new EtoroApiError('kraken_credentials_required', 401);
  }
  if (!isSupabaseConfigured()) {
    throw new EtoroApiError('supabase_credentials_required', 401);
  }

  const accountId = await ensureKrakenAccount();
  const date = todayUtc();

  const [balances, tradeBal] = await Promise.all([
    getKrakenBalances(),
    getKrakenTradeBalance('ZUSD').catch((err) => {
      console.warn('TradeBalance failed, falling back to priced holdings:', (err as Error).message);
      return null;
    }),
  ]);

  const { holdings, cashUsd, investedUsd } = await priceHoldingsUsd(balances);

  const equityFromTrade = Number(tradeBal?.eb ?? tradeBal?.e ?? tradeBal?.tb);
  const equityUsd =
    Number.isFinite(equityFromTrade) && equityFromTrade > 0
      ? equityFromTrade
      : cashUsd + investedUsd;

  const sb = getSupabase();

  // Previous snapshot for net flow
  const { data: prevRow } = await sb
    .from('balance_snapshots')
    .select('date, total')
    .eq('account_id', accountId)
    .lt('date', date)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();

  let netFlow = 0;
  if (prevRow) {
    const prev = prevRow as { date: string; total: number };
    const since = Math.floor(Date.parse(`${prev.date}T00:00:00Z`) / 1000);
    const flows = await sumUsdFlowsSince(since);
    netFlow = flows.deposits - flows.withdrawals;
    // If ledgers gave nothing, infer residual as unmarked flow only when large gap
    if (netFlow === 0) {
      // Prefer 0 over inventing gain-as-deposit
      netFlow = 0;
    }
  } else {
    // First snapshot: treat starting equity as deposit so TWR starts cleanly
    netFlow = equityUsd;
  }

  const snapshot = {
    account_id: accountId,
    gcid: null,
    date,
    cash: cashUsd,
    invested: Math.max(0, equityUsd - cashUsd),
    pnl: 0,
    total: equityUsd,
    net_flow: netFlow,
  };

  const { error: snapErr } = await sb.from('balance_snapshots').upsert(snapshot, {
    onConflict: 'account_id,date',
  });
  if (snapErr) throw new EtoroApiError(`Failed to upsert Kraken snapshot: ${snapErr.message}`, 500);

  // Replace holdings for today
  await sb.from('statement_holdings').delete().eq('account_id', accountId).eq('date', date);
  if (holdings.length) {
    const rows = holdings.map((h) => ({
      account_id: accountId,
      date,
      isin: h.asset,
      name: h.displayAsset,
      asset_class: isFiatAsset(h.asset) ? 'Cash' : 'Crypto',
      quantity: h.quantity,
      price: h.priceUsd,
      value: h.valueUsd,
    }));
    const { error: hErr } = await sb.from('statement_holdings').upsert(rows, {
      onConflict: 'account_id,date,isin,asset_class',
    });
    if (hErr) console.warn('Kraken holdings upsert failed:', hErr.message);
  }

  await sb
    .from('broker_accounts')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('id', accountId);

  return {
    accountId,
    date,
    equityUsd,
    cashUsd,
    investedUsd: Math.max(0, equityUsd - cashUsd),
    holdingsCount: holdings.length,
    netFlow,
  };
}

export async function getKrakenOverview(): Promise<KrakenOverview> {
  const configured = isKrakenConfigured();
  const empty: KrakenOverview = {
    available: false,
    configured,
    reason: configured
      ? isSupabaseConfigured()
        ? 'No Kraken snapshots yet — sync to pull balances.'
        : 'Configure Supabase to store Kraken history.'
      : 'Connect your Kraken API key and private key.',
    accountId: null,
    currency: 'USD',
    currentValue: null,
    statementDate: null,
    totalDeposits: 0,
    totalWithdrawals: 0,
    allTimeGain: null,
    allTimeGainPct: null,
    lastSyncedAt: null,
    snapshots: [],
    holdings: [],
    allocation: [],
  };

  if (!isSupabaseConfigured()) return empty;

  const accountId = (await findKrakenAccountId()) ?? KRAKEN_ACCOUNT_ID;
  const sb = getSupabase();

  const { data: account } = await sb
    .from('broker_accounts')
    .select('id, last_synced_at')
    .eq('id', accountId)
    .maybeSingle();

  const { rows: snaps } = await selectAllRows<{
    date: string;
    total: number;
    net_flow: number;
    cash: number;
    invested: number;
  }>((from, to) =>
    sb
      .from('balance_snapshots')
      .select('date, total, net_flow, cash, invested')
      .eq('account_id', accountId)
      .order('date', { ascending: true })
      .range(from, to),
  );

  if (!snaps.length) {
    return {
      ...empty,
      accountId: account ? accountId : null,
      lastSyncedAt: (account as { last_synced_at?: string } | null)?.last_synced_at ?? null,
    };
  }

  let cum = 0;
  const snapshots = snaps.map((s) => {
    cum += s.net_flow ?? 0;
    return {
      date: s.date,
      total: s.total,
      netFlow: s.net_flow ?? 0,
      cumulativeNetDeposits: cum,
    };
  });

  const latest = snapshots[snapshots.length - 1];
  const totalDeposits = snapshots.filter((s) => s.netFlow > 0).reduce((a, s) => a + s.netFlow, 0);
  const totalWithdrawals = snapshots
    .filter((s) => s.netFlow < 0)
    .reduce((a, s) => a + Math.abs(s.netFlow), 0);
  const allTimeGain = latest.total - latest.cumulativeNetDeposits;
  const allTimeGainPct =
    latest.cumulativeNetDeposits > 0 ? allTimeGain / latest.cumulativeNetDeposits : null;

  const { data: holdingRows } = await sb
    .from('statement_holdings')
    .select('isin, name, asset_class, quantity, price, value')
    .eq('account_id', accountId)
    .eq('date', latest.date)
    .order('value', { ascending: false });

  const holdings: KrakenHolding[] = ((holdingRows ?? []) as {
    isin: string;
    name: string | null;
    quantity: number;
    price: number;
    value: number;
  }[]).map((h) => ({
    asset: h.isin,
    displayAsset: h.name ?? normalizeKrakenAsset(h.isin),
    quantity: h.quantity,
    priceUsd: h.price,
    valueUsd: h.value,
  }));

  const valued = holdings.filter((h) => h.valueUsd > 0);
  const sumVal = valued.reduce((a, h) => a + h.valueUsd, 0) || latest.total || 1;
  const allocation = valued.map((h) => ({
    asset: h.displayAsset,
    value: h.valueUsd,
    pct: h.valueUsd / sumVal,
  }));

  return {
    available: true,
    configured,
    accountId,
    currency: 'USD',
    currentValue: latest.total,
    statementDate: latest.date,
    totalDeposits,
    totalWithdrawals,
    allTimeGain,
    allTimeGainPct,
    lastSyncedAt: (account as { last_synced_at?: string } | null)?.last_synced_at ?? null,
    snapshots,
    holdings,
    allocation,
  };
}

function bucketOf(date: string, granularity: Granularity): string {
  if (granularity === 'yearly') return date.slice(0, 4);
  if (granularity === 'monthly') return date.slice(0, 7);
  if (granularity === 'weekly') {
    const d = new Date(`${date}T00:00:00Z`);
    const day = d.getUTCDay();
    const offset = day === 0 ? -6 : 1 - day;
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() + offset);
    return monday.toISOString().slice(0, 10);
  }
  return date;
}

function bucketDate(bucket: string, granularity: Granularity): string {
  if (granularity === 'daily') return bucket;
  if (granularity === 'weekly') {
    const monday = new Date(`${bucket}T00:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() + 6);
    return monday.toISOString().slice(0, 10);
  }
  if (granularity === 'monthly') return `${bucket}-01`;
  return `${bucket}-01-01`;
}

export async function getKrakenPerformance(
  granularity: Granularity = 'monthly',
  minDate?: string,
  maxDate?: string,
): Promise<PerformanceSeries> {
  const overview = await getKrakenOverview();
  let snaps = overview.snapshots;
  if (minDate) snaps = snaps.filter((s) => s.date >= minDate);
  if (maxDate) snaps = snaps.filter((s) => s.date <= maxDate);

  const periodGains: { date: string; gain: number }[] = [];
  for (let i = 1; i < snaps.length; i++) {
    const prev = snaps[i - 1];
    const cur = snaps[i];
    const base = prev.total + cur.netFlow;
    if (base <= 0) continue;
    periodGains.push({
      date: cur.date,
      gain: (cur.total - prev.total - cur.netFlow) / base,
    });
  }

  const buckets = new Map<string, number>();
  for (const g of periodGains) {
    const b = bucketOf(g.date, granularity);
    buckets.set(b, (buckets.get(b) ?? 1) * (1 + g.gain));
  }

  let compound = 1;
  const points: PerformancePoint[] = [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([bucket, factor]) => {
      compound *= factor;
      return {
        date: bucketDate(bucket, granularity),
        gain: factor - 1,
        cumulativeGain: compound - 1,
      };
    });

  return {
    granularity,
    points,
    totalGain: points.length ? compound - 1 : null,
    source: 'derived',
  };
}

export async function getKrakenBrokerCardStats(): Promise<{
  available: boolean;
  accountId: string | null;
  currency: 'USD';
  valueNative: number | null;
  valueEur: number | null;
  gainPct: number | null;
  snapshots: { date: string; total: number; netFlow: number }[];
}> {
  const overview = await getKrakenOverview();
  if (!overview.available || overview.currentValue == null) {
    return {
      available: false,
      accountId: null,
      currency: 'USD',
      valueNative: null,
      valueEur: null,
      gainPct: null,
      snapshots: [],
    };
  }

  const { convertSeries } = await import('./fx.js');
  let valueEur: number | null = overview.currentValue;
  try {
    const converted = await convertSeries(
      overview.snapshots.map((s) => ({ date: s.date, value: s.total })),
      'USD',
      'EUR',
    );
    valueEur = converted[converted.length - 1]?.value ?? overview.currentValue;
  } catch {
    // keep USD as eur fallback
  }

  return {
    available: true,
    accountId: overview.accountId,
    currency: 'USD',
    valueNative: overview.currentValue,
    valueEur,
    gainPct: overview.allTimeGainPct,
    snapshots: overview.snapshots.map((s) => ({
      date: s.date,
      total: s.total,
      netFlow: s.netFlow,
    })),
  };
}
