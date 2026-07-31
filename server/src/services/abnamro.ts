/**
 * ABN AMRO Guided Investing — import PDFs, overview, and performance.
 */

import {
  abnAccountId,
  parseAbnAmroStatement,
  type AbnStatement,
} from '../import/abnamroStatement.js';
import { EtoroApiError } from '../errors.js';
import {
  getSupabase,
  isSupabaseConfigured,
  selectAllRows,
  type StatementImportRow,
} from '../supabase.js';
import type { Granularity, PerformancePoint, PerformanceSeries } from './performance.js';

export interface AbnImportFileResult {
  fileName: string;
  status: 'imported' | 'duplicate' | 'replaced' | 'error';
  statementDate?: string;
  totalBalance?: number;
  netFlow?: number;
  holdings?: number;
  error?: string;
}

export interface AbnImportResult {
  accountId: string;
  portfolioNumber: string;
  results: AbnImportFileResult[];
  imported: number;
  duplicates: number;
  errors: number;
}

export interface AbnOverview {
  available: boolean;
  reason?: string;
  accountId: string | null;
  portfolioNumber: string | null;
  currency: 'EUR';
  currentValue: number | null;
  statementDate: string | null;
  totalDeposits: number;
  totalWithdrawals: number;
  allTimeGain: number | null;
  allTimeGainPct: number | null;
  totalServiceCosts: number;
  totalProductCosts: number;
  snapshots: {
    date: string;
    total: number;
    netFlow: number;
    cumulativeNetDeposits: number;
  }[];
  latestHoldings: {
    isin: string;
    name: string | null;
    assetClass: string;
    quantity: number;
    price: number;
    value: number;
  }[];
  allocation: { assetClass: string; value: number; pct: number }[];
  costs: {
    statementDate: string;
    serviceCosts: number;
    productCosts: number;
    periodStart: string | null;
    periodEnd: string | null;
  }[];
  imports: {
    fileName: string | null;
    statementDate: string;
    totalBalance: number | null;
    importedAt: string;
    fileHash: string;
  }[];
}

async function ensureAbnAccount(portfolioNumber: string): Promise<string> {
  const id = abnAccountId(portfolioNumber);
  const sb = getSupabase();
  const { error } = await sb.from('broker_accounts').upsert(
    {
      id,
      broker: 'abnamro',
      display_name: 'ABN AMRO Guided Investing',
      currency: 'EUR',
      external_ref: portfolioNumber,
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );
  if (error) throw new EtoroApiError(`Failed to upsert broker account: ${error.message}`, 500);
  return id;
}

/** Find the existing ABN AMRO account id, if any. */
export async function findAbnAccountId(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const sb = getSupabase();
  const { data, error } = await sb
    .from('broker_accounts')
    .select('id')
    .eq('broker', 'abnamro')
    .limit(1)
    .maybeSingle();
  if (error) {
    if (/schema cache|Could not find the table/i.test(error.message)) return null;
    console.warn('findAbnAccountId:', error.message);
    return null;
  }
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Given sorted imports (by statement_date), compute incremental net_flow per date.
 * ABN statements often report YTD Investments/withdrawals — difference within a year.
 */
function incrementalNetFlows(
  rows: { statement_date: string; net_flow: number | null; period_start: string | null }[],
): Map<string, number> {
  const sorted = [...rows].sort((a, b) => a.statement_date.localeCompare(b.statement_date));
  const out = new Map<string, number>();

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    const reported = cur.net_flow ?? 0;
    if (i === 0) {
      out.set(cur.statement_date, reported);
      continue;
    }
    const prev = sorted[i - 1];
    const periodStart = cur.period_start;

    // Period starts near previous statement → already incremental
    if (periodStart) {
      const startMs = Date.parse(`${periodStart}T00:00:00Z`);
      const prevMs = Date.parse(`${prev.statement_date}T00:00:00Z`);
      if (Number.isFinite(startMs) && Math.abs(startMs - prevMs) <= 7 * 86_400_000) {
        out.set(cur.statement_date, reported);
        continue;
      }
    }

    // YTD-style within the same calendar year
    if (prev.statement_date.slice(0, 4) === cur.statement_date.slice(0, 4)) {
      out.set(cur.statement_date, reported - (prev.net_flow ?? 0));
      continue;
    }

    out.set(cur.statement_date, reported);
  }

  return out;
}

async function rebuildSnapshots(accountId: string): Promise<void> {
  const sb = getSupabase();
  const { data: imports, error } = await sb
    .from('statement_imports')
    .select(
      'statement_date, net_flow, period_start, total_balance, realized_result, unrealized_result',
    )
    .eq('account_id', accountId)
    .order('statement_date', { ascending: true });
  if (error) throw new EtoroApiError(`Failed to read imports: ${error.message}`, 500);

  type Imp = {
    statement_date: string;
    net_flow: number | null;
    period_start: string | null;
    total_balance: number | null;
    realized_result: number | null;
    unrealized_result: number | null;
  };

  // Deduplicate by statement_date — keep last imported (highest id via order)
  const byDate = new Map<string, Imp>();
  for (const row of (imports ?? []) as Imp[]) {
    byDate.set(row.statement_date, row);
  }
  const unique = [...byDate.values()].sort((a, b) =>
    a.statement_date.localeCompare(b.statement_date),
  );
  const flows = incrementalNetFlows(unique);

  const snapshots = unique.map((row) => {
    const total = row.total_balance ?? 0;
    const pnl = (row.realized_result ?? 0) + (row.unrealized_result ?? 0);
    return {
      account_id: accountId,
      gcid: null,
      date: row.statement_date,
      cash: 0,
      invested: total,
      pnl,
      total,
      net_flow: flows.get(row.statement_date) ?? 0,
    };
  });

  // Replace all snapshots for this account
  await sb.from('balance_snapshots').delete().eq('account_id', accountId);
  if (snapshots.length) {
    const { error: upErr } = await sb.from('balance_snapshots').upsert(snapshots, {
      onConflict: 'account_id,date',
    });
    if (upErr) throw new EtoroApiError(`Failed to upsert snapshots: ${upErr.message}`, 500);
  }
}

async function upsertHoldings(accountId: string, statement: AbnStatement): Promise<void> {
  const sb = getSupabase();
  await sb
    .from('statement_holdings')
    .delete()
    .eq('account_id', accountId)
    .eq('date', statement.statementDate);

  if (!statement.holdings.length) return;
  const rows = statement.holdings.map((h) => ({
    account_id: accountId,
    date: statement.statementDate,
    isin: h.isin,
    name: h.name,
    asset_class: h.assetClass,
    quantity: h.quantity,
    price: h.price,
    value: h.value,
  }));
  const { error } = await sb.from('statement_holdings').upsert(rows, {
    onConflict: 'account_id,date,isin,asset_class',
  });
  if (error) throw new EtoroApiError(`Failed to upsert holdings: ${error.message}`, 500);
}

export async function importAbnStatements(
  files: { buffer: Buffer; fileName: string }[],
): Promise<AbnImportResult> {
  if (!isSupabaseConfigured()) {
    throw new EtoroApiError('Supabase is required to import ABN AMRO statements', 400);
  }

  const results: AbnImportFileResult[] = [];
  let accountId = '';
  let portfolioNumber = '';
  let imported = 0;
  let duplicates = 0;
  let errors = 0;

  const sb = getSupabase();

  for (const file of files) {
    try {
      const statement = await parseAbnAmroStatement(file.buffer, file.fileName);
      portfolioNumber = statement.portfolioNumber;
      accountId = await ensureAbnAccount(portfolioNumber);

      // Dedup by file hash
      const { data: existing } = await sb
        .from('statement_imports')
        .select('id, statement_date')
        .eq('account_id', accountId)
        .eq('file_hash', statement.fileHash)
        .maybeSingle();

      if (existing) {
        results.push({
          fileName: file.fileName,
          status: 'duplicate',
          statementDate: statement.statementDate,
          totalBalance: statement.totalBalance,
        });
        duplicates++;
        continue;
      }

      // Same statement date from a different file → replace
      const { data: sameDate } = await sb
        .from('statement_imports')
        .select('id, file_hash')
        .eq('account_id', accountId)
        .eq('statement_date', statement.statementDate);

      let status: AbnImportFileResult['status'] = 'imported';
      if (sameDate?.length) {
        await sb
          .from('statement_imports')
          .delete()
          .eq('account_id', accountId)
          .eq('statement_date', statement.statementDate);
        status = 'replaced';
      }

      const importRow: StatementImportRow = {
        account_id: accountId,
        broker: 'abnamro',
        file_hash: statement.fileHash,
        file_name: file.fileName,
        statement_date: statement.statementDate,
        total_balance: statement.totalBalance,
        net_flow: statement.netFlow,
        service_costs: statement.serviceCosts,
        product_costs: statement.productCosts,
        realized_result: statement.realizedResult,
        unrealized_result: statement.unrealizedResult,
        unrealized_result_pct: statement.unrealizedResultPct,
        period_start: statement.periodStart,
        period_end: statement.periodEnd,
      };

      const { error: insErr } = await sb.from('statement_imports').insert(importRow);
      if (insErr) throw new Error(insErr.message);

      await upsertHoldings(accountId, statement);

      results.push({
        fileName: file.fileName,
        status,
        statementDate: statement.statementDate,
        totalBalance: statement.totalBalance,
        netFlow: statement.netFlow,
        holdings: statement.holdings.length,
      });
      imported++;
    } catch (err) {
      errors++;
      results.push({
        fileName: file.fileName,
        status: 'error',
        error: err instanceof Error ? err.message : 'Parse failed',
      });
    }
  }

  if (accountId) {
    await rebuildSnapshots(accountId);
    await sb
      .from('broker_accounts')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('id', accountId);
  }

  return {
    accountId: accountId || (await findAbnAccountId()) || '',
    portfolioNumber,
    results,
    imported,
    duplicates,
    errors,
  };
}

export async function getAbnOverview(): Promise<AbnOverview> {
  const empty: AbnOverview = {
    available: false,
    reason: 'No ABN AMRO statements imported yet. Upload portfolio summary PDFs to get started.',
    accountId: null,
    portfolioNumber: null,
    currency: 'EUR',
    currentValue: null,
    statementDate: null,
    totalDeposits: 0,
    totalWithdrawals: 0,
    allTimeGain: null,
    allTimeGainPct: null,
    totalServiceCosts: 0,
    totalProductCosts: 0,
    snapshots: [],
    latestHoldings: [],
    allocation: [],
    costs: [],
    imports: [],
  };

  if (!isSupabaseConfigured()) {
    return { ...empty, reason: 'Supabase is not configured.' };
  }

  const accountId = await findAbnAccountId();
  if (!accountId) return empty;

  const sb = getSupabase();
  const account = await sb
    .from('broker_accounts')
    .select('id, external_ref, currency')
    .eq('id', accountId)
    .maybeSingle();

  const { rows: snaps } = await selectAllRows<{
    date: string;
    total: number;
    net_flow: number;
  }>((from, to) =>
    sb
      .from('balance_snapshots')
      .select('date, total, net_flow')
      .eq('account_id', accountId)
      .order('date', { ascending: true })
      .range(from, to),
  );

  let deposits = 0;
  let withdrawals = 0;
  let cumulative = 0;
  const snapshots = snaps.map((s, idx) => {
    if (idx === 0) {
      cumulative = s.total; // opening ≈ first total when flow is opening deposit
      // Prefer treating first net_flow as opening deposit
      if (s.net_flow > 0) {
        deposits += s.net_flow;
        cumulative = s.net_flow;
      } else {
        deposits += s.total;
        cumulative = s.total;
      }
    } else {
      if (s.net_flow > 0) deposits += s.net_flow;
      else withdrawals += -s.net_flow;
      cumulative += s.net_flow;
    }
    return {
      date: s.date,
      total: s.total,
      netFlow: s.net_flow,
      cumulativeNetDeposits: cumulative,
    };
  });

  const latest = snapshots[snapshots.length - 1] ?? null;
  const netDeposits = deposits - withdrawals;
  const allTimeGain =
    latest && netDeposits > 0 ? latest.total - netDeposits : latest ? latest.total - deposits : null;
  const allTimeGainPct =
    allTimeGain != null && netDeposits > 0 ? allTimeGain / netDeposits : null;

  // Latest holdings
  const latestDate = latest?.date;
  let latestHoldings: AbnOverview['latestHoldings'] = [];
  if (latestDate) {
    const { data } = await sb
      .from('statement_holdings')
      .select('isin, name, asset_class, quantity, price, value')
      .eq('account_id', accountId)
      .eq('date', latestDate);
    latestHoldings = (data ?? []).map((h) => ({
      isin: h.isin,
      name: h.name,
      assetClass: h.asset_class,
      quantity: h.quantity,
      price: h.price,
      value: h.value,
    }));
  }

  const byClass = new Map<string, number>();
  for (const h of latestHoldings) {
    byClass.set(h.assetClass, (byClass.get(h.assetClass) ?? 0) + h.value);
  }
  const allocTotal = [...byClass.values()].reduce((a, b) => a + b, 0) || 1;
  const allocation = [...byClass.entries()].map(([assetClass, value]) => ({
    assetClass,
    value,
    pct: value / allocTotal,
  }));

  const { data: importRows } = await sb
    .from('statement_imports')
    .select(
      'file_name, statement_date, total_balance, imported_at, file_hash, service_costs, product_costs, period_start, period_end, net_flow',
    )
    .eq('account_id', accountId)
    .order('statement_date', { ascending: false });

  // Costs: prefer latest statement per year for YTD totals display,
  // but list each statement's reported costs for the costs chart.
  const costs = (importRows ?? [])
    .map((r) => ({
      statementDate: r.statement_date as string,
      serviceCosts: (r.service_costs as number) ?? 0,
      productCosts: (r.product_costs as number) ?? 0,
      periodStart: (r.period_start as string | null) ?? null,
      periodEnd: (r.period_end as string | null) ?? null,
    }))
    .sort((a, b) => a.statementDate.localeCompare(b.statementDate));

  // Approximate total costs: sum incremental YTD costs per year (latest of each year)
  const latestByYear = new Map<string, (typeof costs)[0]>();
  for (const c of costs) {
    const year = c.statementDate.slice(0, 4);
    latestByYear.set(year, c);
  }
  let totalServiceCosts = 0;
  let totalProductCosts = 0;
  for (const c of latestByYear.values()) {
    totalServiceCosts += c.serviceCosts;
    totalProductCosts += c.productCosts;
  }

  return {
    available: snapshots.length > 0,
    accountId,
    portfolioNumber:
      (account.data as { external_ref: string | null } | null)?.external_ref ?? null,
    currency: 'EUR',
    currentValue: latest?.total ?? null,
    statementDate: latest?.date ?? null,
    totalDeposits: deposits,
    totalWithdrawals: withdrawals,
    allTimeGain,
    allTimeGainPct,
    totalServiceCosts,
    totalProductCosts,
    snapshots,
    latestHoldings,
    allocation,
    costs,
    imports: (importRows ?? []).map((r) => ({
      fileName: r.file_name as string | null,
      statementDate: r.statement_date as string,
      totalBalance: r.total_balance as number | null,
      importedAt: r.imported_at as string,
      fileHash: r.file_hash as string,
    })),
  };
}

function isoWeekBucket(dateStr: string): { key: string; weekEnding: string } {
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  const day = d.getUTCDay();
  const offsetToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + offsetToMonday);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    key: monday.toISOString().slice(0, 10),
    weekEnding: sunday.toISOString().slice(0, 10),
  };
}

function bucketOf(date: string, granularity: Granularity): string {
  if (granularity === 'yearly') return date.slice(0, 4);
  if (granularity === 'monthly') return date.slice(0, 7);
  if (granularity === 'weekly') return isoWeekBucket(date).key;
  return date;
}

function bucketDate(bucket: string, granularity: Granularity): string {
  if (granularity === 'daily') return bucket;
  if (granularity === 'weekly') return isoWeekBucket(bucket).weekEnding;
  if (granularity === 'monthly') return `${bucket}-01`;
  return `${bucket}-01-01`;
}

/**
 * Deposit-adjusted performance from ABN AMRO quarterly snapshots.
 * Same response shape as eToro `/api/performance`.
 */
export async function getAbnPerformance(
  granularity: Granularity = 'monthly',
  minDate?: string,
  maxDate?: string,
): Promise<PerformanceSeries> {
  const overview = await getAbnOverview();
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
