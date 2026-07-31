/**
 * E*TRADE — Client Statement equity snapshots + Gains & Losses closed lots.
 */

import {
  etradeAccountId,
  parseEtradeGl,
  type EtradeLot,
} from '../import/etradeGl.js';
import {
  etradeAccountIdFromNumber,
  etradeStatementImportHash,
  parseEtradeStatements,
  type EtradeStatement,
} from '../import/etradeStatement.js';
import { EtoroApiError } from '../errors.js';
import {
  getSupabase,
  isSupabaseConfigured,
  selectAllRows,
  type StatementImportRow,
} from '../supabase.js';
import { convertAmount } from './fx.js';
import type { Granularity, PerformancePoint, PerformanceSeries } from './performance.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EtradeImportFileResult {
  fileName: string;
  status: 'imported' | 'duplicate' | 'replaced' | 'error';
  lotCount?: number;
  totalAdjustedGain?: number;
  statementDate?: string;
  totalBalance?: number;
  netFlow?: number;
  holdings?: number;
  statementsImported?: number;
  error?: string;
}

export interface EtradeImportResult {
  accountId: string;
  results: EtradeImportFileResult[];
  imported: number;
  duplicates: number;
  errors: number;
}

export interface EtradeLotView {
  lotKey: string;
  symbol: string;
  quantity: number;
  dateAcquired: string | null;
  dateSold: string;
  adjustedCost: number;
  proceeds: number;
  adjustedGain: number;
  capitalGainsStatus: string | null;
  planType: string | null;
  orderNumber: string | null;
}

export interface EtradeSymbolRollup {
  symbol: string;
  quantity: number;
  adjustedCost: number;
  proceeds: number;
  adjustedGain: number;
  returnOnCost: number | null;
  lotCount: number;
}

export interface EtradeOverview {
  available: boolean;
  reason?: string;
  hasEquity: boolean;
  hasRealized: boolean;
  accountId: string | null;
  accountNumber: string | null;
  currency: 'USD';
  /** Mark-to-market brokerage equity from statements (excludes unvested RSU). */
  currentValue: number | null;
  valueNative: number | null;
  valueEur: number | null;
  statementDate: string | null;
  totalDeposits: number;
  totalWithdrawals: number;
  /** Remaining equity + withdrawals (stock-plan total value). */
  totalPlanValue: number | null;
  /** Equity + withdrawals − compensation inflows (stock evolution). */
  allTimeGain: number | null;
  /** Investment gain / gross compensation inflows (withdrawals are takeout, not losses). */
  allTimeGainPct: number | null;
  snapshots: {
    date: string;
    total: number;
    netFlow: number;
    cumulativeNetDeposits: number;
  }[];
  latestHoldings: {
    symbol: string;
    name: string | null;
    quantity: number;
    price: number;
    value: number;
  }[];
  statementImports: {
    fileName: string | null;
    statementDate: string;
    totalBalance: number | null;
    importedAt: string;
    fileHash: string;
  }[];
  /** Realized G&L from closed lots */
  totalQuantity: number;
  totalAdjustedCost: number;
  totalProceeds: number;
  totalAdjustedGain: number;
  returnOnCost: number | null;
  longGain: number;
  shortGain: number;
  longQuantity: number;
  shortQuantity: number;
  cumulativeBySellDate: {
    date: string;
    periodGain: number;
    periodCost: number;
    periodProceeds: number;
    cumulativeGain: number;
  }[];
  bySymbol: EtradeSymbolRollup[];
  lots: EtradeLotView[];
  imports: {
    fileName: string | null;
    statementDate: string;
    totalBalance: number | null;
    importedAt: string;
    fileHash: string;
  }[];
}

// ---------------------------------------------------------------------------
// Account helpers
// ---------------------------------------------------------------------------

async function ensureEtradeGlAccount(): Promise<string> {
  const id = etradeAccountId();
  const sb = getSupabase();
  const { error } = await sb.from('broker_accounts').upsert(
    {
      id,
      broker: 'etrade',
      display_name: 'E*TRADE',
      currency: 'USD',
      external_ref: 'default',
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );
  if (error) throw new EtoroApiError(`Failed to upsert E*TRADE account: ${error.message}`, 500);
  return id;
}

async function ensureEtradeStatementAccount(accountNumber: string): Promise<string> {
  const id = etradeAccountIdFromNumber(accountNumber);
  const sb = getSupabase();
  const { error } = await sb.from('broker_accounts').upsert(
    {
      id,
      broker: 'etrade',
      display_name: 'E*TRADE',
      currency: 'USD',
      external_ref: accountNumber,
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );
  if (error) throw new EtoroApiError(`Failed to upsert E*TRADE account: ${error.message}`, 500);
  return id;
}

/** Prefer equity (statement) account; fall back to any etrade account. */
export async function findEtradeAccountId(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const equity = await findEtradeEquityAccountId();
  if (equity) return equity;
  return findEtradeGlAccountId();
}

export async function findEtradeGlAccountId(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const sb = getSupabase();
  // Prefer account that actually has lots
  const { data: lotRow } = await sb
    .from('broker_lots')
    .select('account_id')
    .eq('broker', 'etrade')
    .limit(1)
    .maybeSingle();
  if (lotRow?.account_id) return lotRow.account_id as string;

  const { data, error } = await sb
    .from('broker_accounts')
    .select('id')
    .eq('broker', 'etrade')
    .eq('external_ref', 'default')
    .limit(1)
    .maybeSingle();
  if (error) {
    if (/schema cache|Could not find the table/i.test(error.message)) return null;
    console.warn('findEtradeGlAccountId:', error.message);
    return null;
  }
  return (data as { id: string } | null)?.id ?? null;
}

async function listEtradeEquityAccountIds(): Promise<string[]> {
  if (!isSupabaseConfigured()) return [];
  const sb = getSupabase();
  const { data: accounts, error } = await sb
    .from('broker_accounts')
    .select('id')
    .eq('broker', 'etrade');
  if (error) {
    if (/schema cache|Could not find the table/i.test(error.message)) return [];
    console.warn('listEtradeEquityAccountIds:', error.message);
    return [];
  }
  const ids = (accounts ?? [])
    .map((a) => (a as { id: string }).id)
    .filter((id) => id !== etradeAccountId());

  const withSnaps: string[] = [];
  for (const id of ids) {
    const { count } = await sb
      .from('balance_snapshots')
      .select('date', { count: 'exact', head: true })
      .eq('account_id', id);
    if ((count ?? 0) > 0) withSnaps.push(id);
  }
  return withSnaps.length ? withSnaps : ids;
}

export async function findEtradeEquityAccountId(): Promise<string | null> {
  const ids = await listEtradeEquityAccountIds();
  if (!ids.length) return null;

  const sb = getSupabase();
  let best: { id: string; date: string; total: number } | null = null;
  for (const id of ids) {
    const { data: snap } = await sb
      .from('balance_snapshots')
      .select('date, total')
      .eq('account_id', id)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!snap) continue;
    const row = snap as { date: string; total: number };
    if (
      !best ||
      row.date > best.date ||
      (row.date === best.date && row.total > best.total)
    ) {
      best = { id, date: row.date, total: row.total };
    }
  }
  return best?.id ?? ids[0] ?? null;
}

// ---------------------------------------------------------------------------
// Statement import → snapshots
// ---------------------------------------------------------------------------

/**
 * E*TRADE period flows are already period-scoped (not YTD) — use stored net_flow as-is.
 */
async function rebuildSnapshots(accountId: string): Promise<void> {
  const sb = getSupabase();
  const { data: imports, error } = await sb
    .from('statement_imports')
    .select('statement_date, net_flow, total_balance, realized_result, unrealized_result')
    .eq('account_id', accountId)
    .order('statement_date', { ascending: true });
  if (error) throw new EtoroApiError(`Failed to read imports: ${error.message}`, 500);

  type Imp = {
    statement_date: string;
    net_flow: number | null;
    total_balance: number | null;
    realized_result: number | null;
    unrealized_result: number | null;
  };

  const byDate = new Map<string, Imp>();
  for (const row of (imports ?? []) as Imp[]) {
    byDate.set(row.statement_date, row);
  }
  const unique = [...byDate.values()].sort((a, b) =>
    a.statement_date.localeCompare(b.statement_date),
  );

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
      net_flow: row.net_flow ?? 0,
    };
  });

  await sb.from('balance_snapshots').delete().eq('account_id', accountId);
  if (snapshots.length) {
    const { error: upErr } = await sb.from('balance_snapshots').upsert(snapshots, {
      onConflict: 'account_id,date',
    });
    if (upErr) throw new EtoroApiError(`Failed to upsert snapshots: ${upErr.message}`, 500);
  }
}

async function upsertHoldings(accountId: string, statement: EtradeStatement): Promise<void> {
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
    isin: h.symbol,
    name: h.name,
    asset_class: 'Equities',
    quantity: h.quantity,
    price: h.price,
    value: h.value,
  }));
  const { error } = await sb.from('statement_holdings').upsert(rows, {
    onConflict: 'account_id,date,isin,asset_class',
  });
  if (error) throw new EtoroApiError(`Failed to upsert holdings: ${error.message}`, 500);
}

export async function importEtradeStatements(
  files: { buffer: Buffer; fileName: string }[],
): Promise<EtradeImportResult> {
  if (!isSupabaseConfigured()) {
    throw new EtoroApiError('Supabase is required to import E*TRADE statements', 400);
  }

  const results: EtradeImportFileResult[] = [];
  let accountId = '';
  let imported = 0;
  let duplicates = 0;
  let errors = 0;
  const touchedAccounts = new Set<string>();
  const sb = getSupabase();

  for (const file of files) {
    try {
      const parsed = await parseEtradeStatements(file.buffer, file.fileName);
      if (!parsed.statements.length) {
        throw new Error('No statements found in PDF');
      }

      // Same PDF already imported → delete prior rows and re-import (force refresh).
      const { data: existingRows } = await sb
        .from('statement_imports')
        .select('id, account_id, statement_date')
        .eq('broker', 'etrade')
        .like('file_hash', `${parsed.fileHash}:%`);

      let fileStatus: EtradeImportFileResult['status'] = 'imported';
      if (existingRows?.length) {
        for (const row of existingRows) {
          const acct = row.account_id as string;
          const date = row.statement_date as string;
          await sb
            .from('statement_holdings')
            .delete()
            .eq('account_id', acct)
            .eq('date', date);
          touchedAccounts.add(acct);
        }
        await sb
          .from('statement_imports')
          .delete()
          .eq('broker', 'etrade')
          .like('file_hash', `${parsed.fileHash}:%`);
        fileStatus = 'replaced';
      }

      let statementsImported = 0;

      for (const statement of parsed.statements) {
        const stmtAccountId = await ensureEtradeStatementAccount(statement.accountNumber);
        accountId = stmtAccountId;
        touchedAccounts.add(stmtAccountId);

        const importHash = etradeStatementImportHash(
          parsed.fileHash,
          statement.statementDate,
          statement.accountNumber,
        );

        // Same statement date from a different file → replace that row too
        const { data: sameDate } = await sb
          .from('statement_imports')
          .select('id')
          .eq('account_id', stmtAccountId)
          .eq('statement_date', statement.statementDate);

        if (sameDate?.length) {
          await sb
            .from('statement_imports')
            .delete()
            .eq('account_id', stmtAccountId)
            .eq('statement_date', statement.statementDate);
          fileStatus = 'replaced';
        }

        const importRow: StatementImportRow = {
          account_id: stmtAccountId,
          broker: 'etrade',
          file_hash: importHash,
          file_name: file.fileName,
          statement_date: statement.statementDate,
          total_balance: statement.endingValue,
          net_flow: statement.netFlow,
          service_costs: null,
          product_costs: null,
          realized_result: statement.netChange,
          unrealized_result: null,
          unrealized_result_pct: null,
          period_start: statement.periodStart,
          period_end: statement.periodEnd,
        };
        const { error: insErr } = await sb.from('statement_imports').insert(importRow);
        if (insErr) throw new Error(insErr.message);

        await upsertHoldings(stmtAccountId, statement);
        statementsImported++;
      }

      const last = parsed.statements[parsed.statements.length - 1];
      results.push({
        fileName: file.fileName,
        status: fileStatus,
        statementsImported,
        statementDate: last.statementDate,
        totalBalance: last.endingValue,
        netFlow: last.netFlow,
        holdings: last.holdings.length,
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

  for (const id of touchedAccounts) {
    await rebuildSnapshots(id);
    await sb
      .from('broker_accounts')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('id', id);
  }

  return {
    accountId: accountId || (await findEtradeEquityAccountId()) || '',
    results,
    imported,
    duplicates,
    errors,
  };
}

// ---------------------------------------------------------------------------
// G&L import
// ---------------------------------------------------------------------------

function lotRows(accountId: string, lots: EtradeLot[]) {
  return lots.map((l) => ({
    account_id: accountId,
    lot_key: l.lotKey,
    broker: 'etrade',
    symbol: l.symbol,
    quantity: l.quantity,
    date_acquired: l.dateAcquired,
    date_sold: l.dateSold,
    adjusted_cost: l.adjustedCost,
    proceeds: l.proceeds,
    adjusted_gain: l.adjustedGain,
    capital_gains_status: l.capitalGainsStatus,
    plan_type: l.planType,
    order_number: l.orderNumber,
    raw: l.raw,
  }));
}

export async function importEtradeGl(
  files: { buffer: Buffer; fileName: string }[],
): Promise<EtradeImportResult> {
  if (!isSupabaseConfigured()) {
    throw new EtoroApiError('Supabase is required to import E*TRADE G&L files', 400);
  }

  const results: EtradeImportFileResult[] = [];
  let accountId = '';
  let imported = 0;
  let duplicates = 0;
  let errors = 0;
  const sb = getSupabase();

  for (const file of files) {
    try {
      const parsed = parseEtradeGl(file.buffer, file.fileName);
      accountId = await ensureEtradeGlAccount();

      const { data: existing } = await sb
        .from('statement_imports')
        .select('id')
        .eq('account_id', accountId)
        .eq('file_hash', parsed.fileHash)
        .maybeSingle();

      if (existing) {
        results.push({
          fileName: file.fileName,
          status: 'duplicate',
          lotCount: parsed.lots.length,
          totalAdjustedGain: parsed.lots.reduce((s, l) => s + l.adjustedGain, 0),
        });
        duplicates++;
        continue;
      }

      const { count } = await sb
        .from('broker_lots')
        .select('lot_key', { count: 'exact', head: true })
        .eq('account_id', accountId);

      let status: EtradeImportFileResult['status'] = 'imported';
      if ((count ?? 0) > 0) {
        await sb.from('broker_lots').delete().eq('account_id', accountId);
        // Only clear G&L import log rows on this account (not equity PDF hashes)
        await sb
          .from('statement_imports')
          .delete()
          .eq('account_id', accountId)
          .not('file_hash', 'like', '%:%');
        status = 'replaced';
      }

      const rows = lotRows(accountId, parsed.lots);
      const byKey = new Map<string, (typeof rows)[number]>();
      for (const row of rows) byKey.set(row.lot_key, row);
      const uniqueRows = [...byKey.values()];
      for (let i = 0; i < uniqueRows.length; i += 200) {
        const batch = uniqueRows.slice(i, i + 200);
        const { error } = await sb.from('broker_lots').upsert(batch, {
          onConflict: 'account_id,lot_key',
        });
        if (error) throw new Error(error.message);
      }

      const totalGain = parsed.lots.reduce((s, l) => s + l.adjustedGain, 0);
      const sellDates = parsed.lots.map((l) => l.dateSold).sort();
      const statementDate = sellDates[sellDates.length - 1] ?? new Date().toISOString().slice(0, 10);

      const importRow: StatementImportRow = {
        account_id: accountId,
        broker: 'etrade',
        file_hash: parsed.fileHash,
        file_name: file.fileName,
        statement_date: statementDate,
        total_balance: totalGain,
        net_flow: 0,
        service_costs: null,
        product_costs: null,
        realized_result: totalGain,
        unrealized_result: 0,
        unrealized_result_pct: null,
        period_start: sellDates[0] ?? null,
        period_end: statementDate,
      };
      const { error: insErr } = await sb.from('statement_imports').insert(importRow);
      if (insErr) throw new Error(insErr.message);

      results.push({
        fileName: file.fileName,
        status,
        lotCount: parsed.lots.length,
        totalAdjustedGain: totalGain,
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
    await sb
      .from('broker_accounts')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('id', accountId);
  }

  return {
    accountId: accountId || (await findEtradeGlAccountId()) || '',
    results,
    imported,
    duplicates,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function emptyOverview(reason: string): EtradeOverview {
  return {
    available: false,
    reason,
    hasEquity: false,
    hasRealized: false,
    accountId: null,
    accountNumber: null,
    currency: 'USD',
    currentValue: null,
    valueNative: null,
    valueEur: null,
    statementDate: null,
    totalDeposits: 0,
    totalWithdrawals: 0,
    totalPlanValue: null,
    allTimeGain: null,
    allTimeGainPct: null,
    snapshots: [],
    latestHoldings: [],
    statementImports: [],
    totalQuantity: 0,
    totalAdjustedCost: 0,
    totalProceeds: 0,
    totalAdjustedGain: 0,
    returnOnCost: null,
    longGain: 0,
    shortGain: 0,
    longQuantity: 0,
    shortQuantity: 0,
    cumulativeBySellDate: [],
    bySymbol: [],
    lots: [],
    imports: [],
  };
}

/**
 * Merge snapshots across E*TRADE brokerage accounts (classic 3807 → MS 215 migration).
 * Same-date rows: if one account is emptied (0) and another has value, treat as
 * internal transfer (use non-zero total, netFlow 0). Otherwise sum totals/flows.
 */
function mergeEtradeSnapshots(
  perAccount: { date: string; total: number; net_flow: number }[][],
): { date: string; total: number; netFlow: number }[] {
  const byDate = new Map<string, { total: number; netFlow: number }[]>();
  for (const snaps of perAccount) {
    for (const s of snaps) {
      const arr = byDate.get(s.date) ?? [];
      arr.push({ total: s.total, netFlow: s.net_flow });
      byDate.set(s.date, arr);
    }
  }

  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, rows]) => {
      if (rows.length === 1) {
        return { date, total: rows[0].total, netFlow: rows[0].netFlow };
      }
      const nonZero = rows.filter((r) => r.total > 0.005);
      const hasZero = rows.some((r) => r.total <= 0.005);
      // Account migration day: emptied legacy + funded new account
      if (hasZero && nonZero.length === 1) {
        return { date, total: nonZero[0].total, netFlow: 0 };
      }
      return {
        date,
        total: rows.reduce((s, r) => s + r.total, 0),
        netFlow: rows.reduce((s, r) => s + r.netFlow, 0),
      };
    });
}

async function loadEquitySection(accountIds: string[]): Promise<{
  accountId: string | null;
  accountNumber: string | null;
  currentValue: number | null;
  valueEur: number | null;
  statementDate: string | null;
  totalDeposits: number;
  totalWithdrawals: number;
  totalPlanValue: number | null;
  allTimeGain: number | null;
  allTimeGainPct: number | null;
  snapshots: EtradeOverview['snapshots'];
  latestHoldings: EtradeOverview['latestHoldings'];
  statementImports: EtradeOverview['statementImports'];
} | null> {
  if (!accountIds.length) return null;
  const sb = getSupabase();

  const perAccountSnaps: { date: string; total: number; net_flow: number }[][] = [];
  for (const accountId of accountIds) {
    const { rows } = await selectAllRows<{
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
    if (rows.length) perAccountSnaps.push(rows);
  }
  if (!perAccountSnaps.length) return null;

  const merged = mergeEtradeSnapshots(perAccountSnaps);

  let deposits = 0;
  let withdrawals = 0;
  let cumulative = 0;
  const snapshots = merged.map((s, idx) => {
    if (idx === 0) {
      if (s.netFlow > 0) {
        deposits += s.netFlow;
        cumulative = s.netFlow;
      } else if (s.netFlow < 0) {
        withdrawals += -s.netFlow;
        cumulative = s.total - s.netFlow;
      } else {
        deposits += s.total;
        cumulative = s.total;
      }
    } else {
      if (s.netFlow > 0) deposits += s.netFlow;
      else if (s.netFlow < 0) withdrawals += -s.netFlow;
      cumulative += s.netFlow;
    }
    return {
      date: s.date,
      total: s.total,
      netFlow: s.netFlow,
      cumulativeNetDeposits: cumulative,
    };
  });

  const latest = snapshots[snapshots.length - 1] ?? null;
  // Stock-plan semantics: inflows = compensation; withdrawals = realized takeout (not losses).
  const allTimeGain = latest != null ? latest.total + withdrawals - deposits : null;
  const allTimeGainPct =
    allTimeGain != null && deposits > 1e-9 ? allTimeGain / deposits : null;
  const totalPlanValue = latest != null ? latest.total + withdrawals : null;

  // Prefer the account that holds the latest non-zero (or latest) snapshot for holdings/label
  const primaryId = (await findEtradeEquityAccountId()) ?? accountIds[0];
  const account = await sb
    .from('broker_accounts')
    .select('external_ref')
    .eq('id', primaryId)
    .maybeSingle();

  let latestHoldings: EtradeOverview['latestHoldings'] = [];
  if (latest?.date) {
    // Try primary account first, then any equity account
    for (const accountId of [primaryId, ...accountIds.filter((id) => id !== primaryId)]) {
      const { data } = await sb
        .from('statement_holdings')
        .select('isin, name, quantity, price, value')
        .eq('account_id', accountId)
        .eq('date', latest.date);
      if (data?.length) {
        latestHoldings = data.map((h) => ({
          symbol: h.isin as string,
          name: h.name as string | null,
          quantity: h.quantity as number,
          price: h.price as number,
          value: h.value as number,
        }));
        break;
      }
    }
  }

  const { data: importRows } = await sb
    .from('statement_imports')
    .select('file_name, statement_date, total_balance, imported_at, file_hash')
    .in('account_id', accountIds)
    .order('statement_date', { ascending: false });

  let valueEur: number | null = null;
  if (latest) {
    try {
      valueEur = await convertAmount(latest.total, 'USD', 'EUR', latest.date);
    } catch (err) {
      console.warn('E*TRADE equity FX convert failed:', (err as Error).message);
    }
  }

  return {
    accountId: primaryId,
    accountNumber:
      (account.data as { external_ref: string | null } | null)?.external_ref ?? null,
    currentValue: latest?.total ?? null,
    valueEur,
    statementDate: latest?.date ?? null,
    totalDeposits: deposits,
    totalWithdrawals: withdrawals,
    totalPlanValue,
    allTimeGain,
    allTimeGainPct,
    snapshots,
    latestHoldings,
    statementImports: (importRows ?? []).map((r) => ({
      fileName: r.file_name as string | null,
      statementDate: r.statement_date as string,
      totalBalance: r.total_balance as number | null,
      importedAt: r.imported_at as string,
      fileHash: r.file_hash as string,
    })),
  };
}

async function loadRealizedSection(accountId: string): Promise<{
  lots: EtradeLotView[];
  totalQuantity: number;
  totalAdjustedCost: number;
  totalProceeds: number;
  totalAdjustedGain: number;
  returnOnCost: number | null;
  longGain: number;
  shortGain: number;
  longQuantity: number;
  shortQuantity: number;
  cumulativeBySellDate: EtradeOverview['cumulativeBySellDate'];
  bySymbol: EtradeSymbolRollup[];
  imports: EtradeOverview['imports'];
} | null> {
  const sb = getSupabase();
  const { rows, error } = await selectAllRows<{
    lot_key: string;
    symbol: string;
    quantity: number;
    date_acquired: string | null;
    date_sold: string;
    adjusted_cost: number;
    proceeds: number;
    adjusted_gain: number;
    capital_gains_status: string | null;
    plan_type: string | null;
    order_number: string | null;
  }>((from, to) =>
    sb
      .from('broker_lots')
      .select(
        'lot_key, symbol, quantity, date_acquired, date_sold, adjusted_cost, proceeds, adjusted_gain, capital_gains_status, plan_type, order_number',
      )
      .eq('account_id', accountId)
      .order('date_sold', { ascending: true })
      .range(from, to),
  );

  if (error) {
    if (/schema cache|Could not find the table/i.test(error)) return null;
    throw new EtoroApiError(error, 500);
  }
  if (!rows.length) return null;

  const lots: EtradeLotView[] = rows.map((r) => ({
    lotKey: r.lot_key,
    symbol: r.symbol,
    quantity: r.quantity,
    dateAcquired: r.date_acquired,
    dateSold: r.date_sold,
    adjustedCost: r.adjusted_cost,
    proceeds: r.proceeds,
    adjustedGain: r.adjusted_gain,
    capitalGainsStatus: r.capital_gains_status,
    planType: r.plan_type,
    orderNumber: r.order_number,
  }));

  const totalQuantity = lots.reduce((s, l) => s + l.quantity, 0);
  const totalAdjustedCost = lots.reduce((s, l) => s + l.adjustedCost, 0);
  const totalProceeds = lots.reduce((s, l) => s + l.proceeds, 0);
  const totalAdjustedGain = lots.reduce((s, l) => s + l.adjustedGain, 0);
  const returnOnCost = totalAdjustedCost > 0 ? totalAdjustedGain / totalAdjustedCost : null;

  let longGain = 0;
  let shortGain = 0;
  let longQuantity = 0;
  let shortQuantity = 0;
  for (const l of lots) {
    const status = (l.capitalGainsStatus ?? '').toLowerCase();
    if (status === 'long') {
      longGain += l.adjustedGain;
      longQuantity += l.quantity;
    } else {
      shortGain += l.adjustedGain;
      shortQuantity += l.quantity;
    }
  }

  const byDate = new Map<string, { gain: number; cost: number; proceeds: number }>();
  for (const l of lots) {
    const cur = byDate.get(l.dateSold) ?? { gain: 0, cost: 0, proceeds: 0 };
    cur.gain += l.adjustedGain;
    cur.cost += l.adjustedCost;
    cur.proceeds += l.proceeds;
    byDate.set(l.dateSold, cur);
  }
  let cum = 0;
  const cumulativeBySellDate = [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => {
      cum += v.gain;
      return {
        date,
        periodGain: v.gain,
        periodCost: v.cost,
        periodProceeds: v.proceeds,
        cumulativeGain: cum,
      };
    });

  const symbolMap = new Map<string, EtradeSymbolRollup>();
  for (const l of lots) {
    const cur = symbolMap.get(l.symbol) ?? {
      symbol: l.symbol,
      quantity: 0,
      adjustedCost: 0,
      proceeds: 0,
      adjustedGain: 0,
      returnOnCost: null,
      lotCount: 0,
    };
    cur.quantity += l.quantity;
    cur.adjustedCost += l.adjustedCost;
    cur.proceeds += l.proceeds;
    cur.adjustedGain += l.adjustedGain;
    cur.lotCount += 1;
    symbolMap.set(l.symbol, cur);
  }
  const bySymbol = [...symbolMap.values()]
    .map((s) => ({
      ...s,
      returnOnCost: s.adjustedCost > 0 ? s.adjustedGain / s.adjustedCost : null,
    }))
    .sort((a, b) => b.adjustedGain - a.adjustedGain);

  const { data: importRows } = await sb
    .from('statement_imports')
    .select('file_name, statement_date, total_balance, imported_at, file_hash')
    .eq('account_id', accountId)
    .order('statement_date', { ascending: false });

  return {
    lots: [...lots].sort((a, b) => b.dateSold.localeCompare(a.dateSold)),
    totalQuantity,
    totalAdjustedCost,
    totalProceeds,
    totalAdjustedGain,
    returnOnCost,
    longGain,
    shortGain,
    longQuantity,
    shortQuantity,
    cumulativeBySellDate,
    bySymbol,
    imports: (importRows ?? []).map((r) => ({
      fileName: r.file_name as string | null,
      statementDate: r.statement_date as string,
      totalBalance: r.total_balance as number | null,
      importedAt: r.imported_at as string,
      fileHash: r.file_hash as string,
    })),
  };
}

export async function getEtradeOverview(): Promise<EtradeOverview> {
  if (!isSupabaseConfigured()) {
    return emptyOverview('Supabase is not configured.');
  }

  const equityAccountIds = await listEtradeEquityAccountIds();
  const glAccountId = await findEtradeGlAccountId();

  let equity = await loadEquitySection(equityAccountIds);
  if (equity && equity.snapshots.length === 0) equity = null;

  let realized: Awaited<ReturnType<typeof loadRealizedSection>> = null;
  if (glAccountId) {
    try {
      realized = await loadRealizedSection(glAccountId);
    } catch (err) {
      if (err instanceof EtoroApiError) throw err;
      console.warn('E*TRADE lots load failed:', (err as Error).message);
    }
  }

  const hasEquity = Boolean(equity?.snapshots.length);
  const hasRealized = Boolean(realized?.lots.length);

  if (!hasEquity && !hasRealized) {
    return emptyOverview(
      'No E*TRADE data yet. Upload Client Statement PDFs for account equity and/or a Gains & Losses Expanded (.xlsx) for realized analytics.',
    );
  }

  const accountId = equity?.accountId ?? glAccountId;

  return {
    available: true,
    hasEquity,
    hasRealized,
    accountId,
    accountNumber: equity?.accountNumber ?? null,
    currency: 'USD',
    currentValue: equity?.currentValue ?? null,
    valueNative: equity?.currentValue ?? null,
    valueEur: equity?.valueEur ?? null,
    statementDate: equity?.statementDate ?? null,
    totalDeposits: equity?.totalDeposits ?? 0,
    totalWithdrawals: equity?.totalWithdrawals ?? 0,
    totalPlanValue: equity?.totalPlanValue ?? null,
    allTimeGain: equity?.allTimeGain ?? null,
    allTimeGainPct: equity?.allTimeGainPct ?? null,
    snapshots: equity?.snapshots ?? [],
    latestHoldings: equity?.latestHoldings ?? [],
    statementImports: equity?.statementImports ?? [],
    totalQuantity: realized?.totalQuantity ?? 0,
    totalAdjustedCost: realized?.totalAdjustedCost ?? 0,
    totalProceeds: realized?.totalProceeds ?? 0,
    totalAdjustedGain: realized?.totalAdjustedGain ?? 0,
    returnOnCost: realized?.returnOnCost ?? null,
    longGain: realized?.longGain ?? 0,
    shortGain: realized?.shortGain ?? 0,
    longQuantity: realized?.longQuantity ?? 0,
    shortQuantity: realized?.shortQuantity ?? 0,
    cumulativeBySellDate: realized?.cumulativeBySellDate ?? [],
    bySymbol: realized?.bySymbol ?? [],
    lots: realized?.lots ?? [],
    imports: realized?.imports ?? [],
  };
}

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

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

/** Deposit-adjusted TWR from Client Statement snapshots. */
export async function getEtradeEquityPerformance(
  granularity: Granularity = 'monthly',
  minDate?: string,
  maxDate?: string,
): Promise<PerformanceSeries> {
  const overview = await getEtradeOverview();
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
    totalGain: points.length ? compound - 1 : overview.allTimeGainPct,
    source: 'derived',
  };
}

/** Realized G/L period returns from closed lots. */
export async function getEtradePerformance(
  granularity: Granularity = 'monthly',
  minDate?: string,
  maxDate?: string,
): Promise<PerformanceSeries> {
  const overview = await getEtradeOverview();
  let lots = overview.lots;
  if (minDate) lots = lots.filter((l) => l.dateSold >= minDate);
  if (maxDate) lots = lots.filter((l) => l.dateSold <= maxDate);

  const buckets = new Map<string, { gain: number; cost: number }>();
  for (const l of lots) {
    const b = bucketOf(l.dateSold, granularity);
    const cur = buckets.get(b) ?? { gain: 0, cost: 0 };
    cur.gain += l.adjustedGain;
    cur.cost += l.adjustedCost;
    buckets.set(b, cur);
  }

  let compound = 1;
  const points: PerformancePoint[] = [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([bucket, v]) => {
      const periodGain = v.cost > 0 ? v.gain / v.cost : 0;
      compound *= 1 + periodGain;
      return {
        date: bucketDate(bucket, granularity),
        gain: periodGain,
        cumulativeGain: compound - 1,
      };
    });

  return {
    granularity,
    points,
    totalGain: points.length ? compound - 1 : overview.returnOnCost,
    source: 'derived',
  };
}

/** Stats for Overview broker card — prefer equity when snapshots exist. */
export async function getEtradeBrokerCardStats(): Promise<{
  available: boolean;
  kind: 'equity' | 'realized';
  accountId: string | null;
  currency: 'USD';
  valueNative: number | null;
  valueEur: number | null;
  gainPct: number | null;
  totalAdjustedGainUsd: number;
  returnOnCost: number | null;
  totalAdjustedGainEur: number | null;
  snapshots: { date: string; total: number; netFlow: number }[];
}> {
  const overview = await getEtradeOverview();
  if (!overview.available) {
    return {
      available: false,
      kind: 'realized',
      accountId: null,
      currency: 'USD',
      valueNative: null,
      valueEur: null,
      gainPct: null,
      totalAdjustedGainUsd: 0,
      returnOnCost: null,
      totalAdjustedGainEur: null,
      snapshots: [],
    };
  }

  if (overview.hasEquity) {
    return {
      available: true,
      kind: 'equity',
      accountId: overview.accountId,
      currency: 'USD',
      valueNative: overview.currentValue,
      valueEur: overview.valueEur,
      gainPct: overview.allTimeGainPct,
      totalAdjustedGainUsd: overview.totalAdjustedGain,
      returnOnCost: overview.returnOnCost,
      totalAdjustedGainEur: null,
      snapshots: overview.snapshots.map((s) => ({
        date: s.date,
        total: s.total,
        netFlow: s.netFlow,
      })),
    };
  }

  const lastSold = overview.lots[0]?.dateSold ?? new Date().toISOString().slice(0, 10);
  let totalAdjustedGainEur: number | null = null;
  try {
    totalAdjustedGainEur = await convertAmount(
      overview.totalAdjustedGain,
      'USD',
      'EUR',
      lastSold,
    );
  } catch (err) {
    console.warn('E*TRADE FX convert failed:', (err as Error).message);
  }
  return {
    available: true,
    kind: 'realized',
    accountId: overview.accountId,
    currency: 'USD',
    valueNative: null,
    valueEur: null,
    gainPct: overview.returnOnCost,
    totalAdjustedGainUsd: overview.totalAdjustedGain,
    returnOnCost: overview.returnOnCost,
    totalAdjustedGainEur,
    snapshots: [],
  };
}
