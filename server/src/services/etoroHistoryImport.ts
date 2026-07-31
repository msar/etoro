/**
 * Import eToro Account Statement CSVs (Account Activity, Closed Positions,
 * Dividends) into Supabase. Used by the CLI script and the web upload API.
 *
 * The live API only retains ~12 months of mark-to-market history; older
 * balances come from Account Activity (realized equity + cash).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getBootstrap } from '../bootstrap.js';
import { EtoroApiError } from '../errors.js';
import { buildBalancesFromActivity } from '../import/activityBalances.js';
import {
  parseClosedPositions,
  toClosedTradeRows,
} from '../import/closedPositions.js';
import { chunk } from '../import/csvUtil.js';
import { parseDividends } from '../import/dividends.js';
import { getSupabase, isSupabaseConfigured } from '../supabase.js';

export interface EtoroHistoryImportPaths {
  activityPath?: string | null;
  closedPath?: string | null;
  dividendsPath?: string | null;
}

export interface EtoroHistoryImportOptions {
  apiCutoffDays?: number;
  resolveInstruments?: boolean;
}

export interface EtoroHistoryImportResult {
  gcid: number;
  username: string | null;
  balanceCutoff: string;
  balancesImported: number;
  balanceDateRange: { from: string; to: string } | null;
  tradesImported: number;
  dividendsImported: number;
  warnings: string[];
}

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 5,
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const wait = Math.min(30_000, 1000 * 2 ** i);
      await new Promise((r) => setTimeout(r, wait));
      void label;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

function cutoffDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function loadExistingInstrumentIds(
  gcid: number,
): Promise<Map<number, number>> {
  const sb = getSupabase();
  const map = new Map<number, number>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await withRetry(`closed_trades read@${from}`, async () => {
      const res = await sb
        .from('closed_trades')
        .select('position_id, instrument_id')
        .eq('gcid', gcid)
        .gt('instrument_id', 0)
        .range(from, from + pageSize - 1);
      if (res.error) throw new Error(res.error.message);
      return res;
    });
    if (!data?.length) break;
    for (const row of data as { position_id: number; instrument_id: number }[]) {
      map.set(row.position_id, row.instrument_id);
    }
    if (data.length < pageSize) break;
  }
  return map;
}

/** Classify an Account Statement CSV by filename (Spanish or English exports). */
export function classifyEtoroHistoryCsv(
  fileName: string,
): 'activity' | 'closed' | 'dividends' | null {
  const n = fileName.toLowerCase().replace(/[\s_\-.]+/g, '');
  if (n.includes('actividaddelacuenta') || n.includes('accountactivity')) {
    return 'activity';
  }
  if (n.includes('posicionescerradas') || n.includes('closedpositions')) {
    return 'closed';
  }
  if (n.includes('dividendos') || (n.includes('dividend') && !n.includes('closed'))) {
    return 'dividends';
  }
  return null;
}

/**
 * Import from local CSV paths (CLI / temp upload dir).
 * At least one of activity or closed positions should be present.
 */
export async function importEtoroHistoryFromPaths(
  paths: EtoroHistoryImportPaths,
  options: EtoroHistoryImportOptions = {},
): Promise<EtoroHistoryImportResult> {
  if (!isSupabaseConfigured()) {
    throw new EtoroApiError(
      'Supabase is required to import eToro Account Statement history.',
      400,
    );
  }

  const activityPath = paths.activityPath ?? null;
  const closedPath = paths.closedPath ?? null;
  const dividendsPath = paths.dividendsPath ?? null;

  if (!activityPath && !closedPath && !dividendsPath) {
    throw new EtoroApiError(
      'Upload at least one Account Statement CSV: Account Activity, Closed Positions, or Dividends.',
      400,
    );
  }

  const apiCutoffDays = options.apiCutoffDays ?? 360;
  const boot = await getBootstrap();
  if (boot.gcid == null) {
    throw new EtoroApiError('Could not resolve gcid from eToro balances.', 500);
  }
  const gcid = boot.gcid;
  const before = cutoffDate(apiCutoffDays);
  const warnings: string[] = [];

  const sb = getSupabase();
  {
    const { error } = await sb.from('accounts').upsert(
      {
        gcid,
        username: boot.username,
        environment: boot.environment,
        trading_account_id: boot.tradingAccountId,
      },
      { onConflict: 'gcid' },
    );
    if (error) throw new EtoroApiError(`accounts upsert failed: ${error.message}`, 500);
  }

  let balancesImported = 0;
  let balanceDateRange: { from: string; to: string } | null = null;
  let tradesImported = 0;
  let dividendsImported = 0;

  if (activityPath) {
    const balances = await buildBalancesFromActivity(activityPath, {
      beforeDate: before,
    });
    balancesImported = balances.length;
    if (balances.length) {
      balanceDateRange = {
        from: balances[0].date,
        to: balances[balances.length - 1].date,
      };
      const accountId = String(gcid);
      await sb.from('broker_accounts').upsert(
        {
          id: accountId,
          broker: 'etoro',
          display_name: 'eToro',
          currency: 'USD',
          external_ref: accountId,
        },
        { onConflict: 'id' },
      );
      for (const batch of chunk(balances, 200)) {
        const rows = batch.map((b) => ({ gcid, account_id: accountId, ...b }));
        await withRetry('balance upsert', async () => {
          const { error } = await sb.from('balance_snapshots').upsert(rows, {
            onConflict: 'account_id,date',
          });
          if (error) throw new Error(error.message);
        });
      }
    } else {
      warnings.push(
        `Account Activity produced no balance rows older than ${before} (API keeps the recent ~${apiCutoffDays} days).`,
      );
    }
  }

  if (closedPath) {
    const parsed = await parseClosedPositions(closedPath);
    const existingIds = await loadExistingInstrumentIds(gcid);
    const rows = toClosedTradeRows(gcid, parsed, existingIds, new Map());
    tradesImported = rows.length;
    if (rows.length) {
      let includeSymbol = true;
      for (const batch of chunk(rows, 100)) {
        await withRetry('trade upsert', async () => {
          const payload = includeSymbol
            ? batch
            : batch.map(({ symbol: _symbol, ...rest }) => rest);
          const { error } = await sb.from('closed_trades').upsert(payload, {
            onConflict: 'position_id',
          });
          if (error) {
            if (includeSymbol && /symbol/i.test(error.message)) {
              includeSymbol = false;
              warnings.push(
                'closed_trades.symbol column missing — run migrations/002; importing without symbols.',
              );
              const { error: retryErr } = await sb
                .from('closed_trades')
                .upsert(
                  batch.map(({ symbol: _symbol, ...rest }) => rest),
                  { onConflict: 'position_id' },
                );
              if (retryErr) throw new Error(retryErr.message);
              return;
            }
            throw new Error(error.message);
          }
        });
      }
    }
  }

  if (dividendsPath) {
    const dividends = await parseDividends(dividendsPath, gcid);
    dividendsImported = dividends.length;
    if (dividends.length) {
      try {
        for (const batch of chunk(dividends, 200)) {
          await withRetry('dividend upsert', async () => {
            const { error } = await sb.from('dividends').upsert(batch, {
              onConflict: 'gcid,position_id,pay_date',
            });
            if (error) throw new Error(error.message);
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/dividends|schema cache|Could not find the table/i.test(msg)) {
          dividendsImported = 0;
          warnings.push(
            'dividends table missing — run migrations/002_symbols_dividends.sql, then re-upload Dividends.',
          );
        } else {
          throw err;
        }
      }
    }
  }

  return {
    gcid,
    username: boot.username,
    balanceCutoff: before,
    balancesImported,
    balanceDateRange,
    tradesImported,
    dividendsImported,
    warnings,
  };
}

export interface UploadedEtoroCsv {
  originalName: string;
  buffer: Buffer;
}

/**
 * Accept uploaded Account Statement CSVs, classify by filename, import, clean up.
 */
export async function importEtoroHistoryUploads(
  files: UploadedEtoroCsv[],
  options: EtoroHistoryImportOptions = {},
): Promise<EtoroHistoryImportResult & { classified: Record<string, string> }> {
  if (!files.length) {
    throw new EtoroApiError('Upload one or more eToro Account Statement CSV files.', 400);
  }

  const classified: Record<string, string> = {};
  const paths: EtoroHistoryImportPaths = {};
  const tmpRoot = await mkdtemp(join(tmpdir(), 'etoro-history-'));

  try {
    for (const file of files) {
      const kind = classifyEtoroHistoryCsv(file.originalName);
      if (!kind) {
        throw new EtoroApiError(
          `Unrecognized file "${file.originalName}". Expected names containing Account Activity / actividaddelacuenta, Closed Positions / posicionescerradas, or Dividends / dividendos.`,
          400,
        );
      }
      const dest = join(tmpRoot, `${kind}.csv`);
      await writeFile(dest, file.buffer);
      classified[file.originalName] = kind;
      if (kind === 'activity') paths.activityPath = dest;
      else if (kind === 'closed') paths.closedPath = dest;
      else paths.dividendsPath = dest;
    }

    const result = await importEtoroHistoryFromPaths(paths, options);
    return { ...result, classified };
  } finally {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
