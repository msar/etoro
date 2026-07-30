/**
 * Import eToro Account Statement CSVs into Supabase.
 *
 * Usage (from repo root):
 *   npm run import:etoro-history
 *   npm run import:etoro-history -- --dir ./exporteddata --dry-run
 *   npm run import:etoro-history -- --resolve-instruments
 *   npm run import:etoro-history -- --api-cutoff-days 360
 *
 * Expects Spanish/English statement CSVs:
 *   actividaddelacuenta.csv  → balance_snapshots (realized equity + cash)
 *   posicionescerradas.csv   → closed_trades
 *
 * Personal export data must stay out of git (see exporteddata/ in .gitignore).
 */
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getBootstrap } from '../src/bootstrap.js';
import { hasCredentials } from '../src/credentials.js';
import { buildBalancesFromActivity } from '../src/import/activityBalances.js';
import {
  parseClosedPositions,
  toClosedTradeRows,
} from '../src/import/closedPositions.js';
import { chunk } from '../src/import/csvUtil.js';
import { parseDividends } from '../src/import/dividends.js';
import { resolveSymbols } from '../src/import/instrumentLookup.js';
import { getSupabase, isSupabaseConfigured } from '../src/supabase.js';

interface Args {
  dir: string;
  dryRun: boolean;
  resolveInstruments: boolean;
  resolveLimit: number | null;
  apiCutoffDays: number;
  skipBalances: boolean;
  skipTrades: boolean;
  skipDividends: boolean;
}

function parseArgs(argv: string[]): Args {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const args: Args = {
    dir: join(repoRoot, 'exporteddata'),
    dryRun: false,
    resolveInstruments: false,
    resolveLimit: null,
    apiCutoffDays: 360,
    skipBalances: false,
    skipTrades: false,
    skipDividends: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') args.dir = resolve(argv[++i] ?? args.dir);
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--resolve-instruments') args.resolveInstruments = true;
    else if (a === '--resolve-limit') args.resolveLimit = Number(argv[++i]);
    else if (a === '--api-cutoff-days') args.apiCutoffDays = Number(argv[++i]);
    else if (a === '--skip-balances') args.skipBalances = true;
    else if (a === '--skip-trades') args.skipTrades = true;
    else if (a === '--skip-dividends') args.skipDividends = true;
    else if (a === '--help' || a === '-h') {
      console.log(`Import eToro statement CSVs into Supabase.

Options:
  --dir PATH              Folder with CSVs (default: ./exporteddata)
  --api-cutoff-days N     Only import balances older than N days (default: 360)
                          so the live API sync keeps the recent mark-to-market window
  --resolve-instruments   Search eToro for ticker → instrumentId (slow, cached)
  --resolve-limit N       Cap how many new tickers to search this run
  --skip-balances         Skip Account Activity → balance_snapshots
  --skip-trades           Skip Closed Positions → closed_trades
  --skip-dividends        Skip Dividends → dividends table
  --dry-run               Parse and report counts without writing
`);
      process.exit(0);
    }
  }
  return args;
}

function cutoffDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
      const msg = err instanceof Error ? err.message : String(err);
      const wait = Math.min(30_000, 1000 * 2 ** i);
      console.warn(`  ${label} failed (attempt ${i + 1}/${attempts}): ${msg}; retry in ${wait}ms`);
      await sleep(wait);
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!hasCredentials() || !isSupabaseConfigured()) {
    throw new Error(
      'Missing credentials. Launch the app once, paste eToro + Supabase keys, then re-run.',
    );
  }

  const activityPath = join(args.dir, 'actividaddelacuenta.csv');
  const closedPath = join(args.dir, 'posicionescerradas.csv');

  if (!args.skipBalances && !existsSync(activityPath)) {
    throw new Error(`Missing ${activityPath}`);
  }
  if (!args.skipTrades && !existsSync(closedPath)) {
    throw new Error(`Missing ${closedPath}`);
  }

  console.log('Resolving account (eToro bootstrap)…');
  const boot = await getBootstrap();
  if (boot.gcid == null) {
    throw new Error('Could not resolve gcid from eToro balances.');
  }
  const gcid = boot.gcid;
  console.log(`  gcid=${gcid} username=${boot.username ?? '?'} env=${boot.environment}`);

  const before = cutoffDate(args.apiCutoffDays);
  console.log(`  balance import cutoff: dates < ${before} (keeping last ${args.apiCutoffDays}d for API sync)`);

  // Ensure account row exists
  if (!args.dryRun) {
    const sb = getSupabase();
    const { error } = await sb.from('accounts').upsert(
      {
        gcid,
        username: boot.username,
        environment: boot.environment,
        trading_account_id: boot.tradingAccountId,
      },
      { onConflict: 'gcid' },
    );
    if (error) throw new Error(`accounts upsert failed: ${error.message}`);
  }

  // ── Balances ──────────────────────────────────────────────────────────
  if (!args.skipBalances) {
    console.log(`\nParsing Account Activity: ${activityPath}`);
    const balances = await buildBalancesFromActivity(activityPath, {
      beforeDate: before,
    });
    const deposits = balances.reduce((s, b) => s + (b.net_flow > 0 ? b.net_flow : 0), 0);
    const withdrawals = balances.reduce(
      (s, b) => s + (b.net_flow < 0 ? -b.net_flow : 0),
      0,
    );
    console.log(
      `  ${balances.length} daily snapshots` +
        (balances.length
          ? ` (${balances[0].date} → ${balances[balances.length - 1].date})`
          : ''),
    );
    console.log(
      `  external flows in window: deposits≈${deposits.toFixed(2)} withdrawals≈${withdrawals.toFixed(2)}`,
    );

    if (!args.dryRun && balances.length) {
      const sb = getSupabase();
      let n = 0;
      for (const batch of chunk(balances, 200)) {
        const rows = batch.map((b) => ({ gcid, ...b }));
        await withRetry(`balance upsert@${n}`, async () => {
          const { error } = await sb.from('balance_snapshots').upsert(rows, {
            onConflict: 'gcid,date',
          });
          if (error) throw new Error(error.message);
        });
        n += rows.length;
        if (n % 1000 === 0 || n === balances.length) {
          console.log(`  upserted ${n}/${balances.length} balances`);
        }
      }
    }
  }

  // ── Closed trades ─────────────────────────────────────────────────────
  if (!args.skipTrades) {
    console.log(`\nParsing Closed Positions: ${closedPath}`);
    const parsed = await parseClosedPositions(closedPath);
    console.log(`  ${parsed.length} closed positions`);

    const existingIds = args.dryRun
      ? new Map<number, number>()
      : await loadExistingInstrumentIds(gcid);
    console.log(`  ${existingIds.size} positions already have instrument_id in DB`);

    let bySymbol = new Map<string, number>();
    if (args.resolveInstruments) {
      const symbols = [...new Set(parsed.map((p) => p.symbol).filter(Boolean))];
      bySymbol = await resolveSymbols(symbols, {
        limit: args.resolveLimit ?? undefined,
      });
    }

    const rows = toClosedTradeRows(gcid, parsed, existingIds, bySymbol);
    const withId = rows.filter((r) => r.instrument_id > 0).length;
    console.log(`  instrument_id resolved for ${withId}/${rows.length} trades`);

    if (!args.dryRun && rows.length) {
      const sb = getSupabase();
      // The symbol column requires migration 002; degrade gracefully without it.
      let includeSymbol = true;
      let n = 0;
      for (const batch of chunk(rows, 100)) {
        await withRetry(`trade upsert@${n}`, async () => {
          const payload = includeSymbol
            ? batch
            : batch.map(({ symbol: _symbol, ...rest }) => rest);
          const { error } = await sb.from('closed_trades').upsert(payload, {
            onConflict: 'position_id',
          });
          if (error) {
            if (includeSymbol && /symbol/i.test(error.message)) {
              includeSymbol = false;
              console.warn(
                '  closed_trades.symbol column missing — run migrations/002_symbols_dividends.sql to store tickers; importing without symbols.',
              );
              const { error: retryErr } = await sb
                .from('closed_trades')
                .upsert(batch.map(({ symbol: _symbol, ...rest }) => rest), {
                  onConflict: 'position_id',
                });
              if (retryErr) throw new Error(retryErr.message);
              return;
            }
            throw new Error(error.message);
          }
        });
        n += batch.length;
        if (n % 5000 === 0 || n === rows.length) {
          console.log(`  upserted ${n}/${rows.length} trades`);
        }
      }
    }
  }

  // ── Dividends ─────────────────────────────────────────────────────────
  const dividendsPath = join(args.dir, 'dividendos.csv');
  if (!args.skipDividends && existsSync(dividendsPath)) {
    console.log(`\nParsing Dividends: ${dividendsPath}`);
    const dividends = await parseDividends(dividendsPath, gcid);
    const total = dividends.reduce((s, d) => s + d.net_dividend_usd, 0);
    console.log(`  ${dividends.length} dividend entries, net total ≈ $${total.toFixed(2)}`);

    if (!args.dryRun && dividends.length) {
      const sb = getSupabase();
      let n = 0;
      let tableMissing = false;
      for (const batch of chunk(dividends, 200)) {
        try {
          await withRetry(`dividend upsert@${n}`, async () => {
            const { error } = await sb.from('dividends').upsert(batch, {
              onConflict: 'gcid,position_id,pay_date',
            });
            if (error) throw new Error(error.message);
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/dividends|schema cache|Could not find the table/i.test(msg)) {
            console.warn(
              '  dividends table missing — run migrations/002_symbols_dividends.sql in the Supabase SQL Editor, then re-run with --skip-balances --skip-trades.',
            );
            tableMissing = true;
            break;
          }
          throw err;
        }
        n += batch.length;
        if (n % 5000 === 0 || n === dividends.length) {
          console.log(`  upserted ${n}/${dividends.length} dividends`);
        }
      }
      if (!tableMissing && n === dividends.length) {
        console.log('  dividends import complete');
      }
    }
  } else if (!args.skipDividends) {
    console.log(`\nDividends CSV not found at ${dividendsPath} — skipping.`);
  }

  console.log(
    args.dryRun
      ? '\nDry run complete — no writes.'
      : '\nImport complete. Open the dashboard (or POST /api/sync) to refresh the recent API window.',
  );
}

main().catch((err) => {
  console.error('\nImport failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
