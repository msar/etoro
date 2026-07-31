/**
 * Verify ABN AMRO parser against known statement values, then optionally
 * import all sample PDFs into Supabase via the service layer.
 *
 * Usage: npx tsx scripts/verify-abnamro.ts
 *        npx tsx scripts/verify-abnamro.ts --import
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAbnAmroStatement } from '../src/import/abnamroStatement.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = path.join(root, 'exporteddata/ABNAMRO_documents');

/** Expected totals / dates from the PDF corpus (spot-checked). */
const EXPECTED: Record<string, { date: string; total: number; netFlow: number }> = {
  '1_Portfolio Summary_2026-07-01.pdf': { date: '2026-06-30', total: 22423.65, netFlow: 10000 },
  '7_Portfolio Summary_2025-01-28.pdf': { date: '2024-12-31', total: 10466.46, netFlow: 4500 },
  '17_Portefeuille overzicht_2022-10-03.pdf': { date: '2022-09-30', total: 197.57, netFlow: 200 },
  '10_Portefeuille Overzicht_2024-03-29.pdf': { date: '2024-03-28', total: 7040.71, netFlow: 1500 },
};

function approx(a: number, b: number, eps = 0.02): boolean {
  return Math.abs(a - b) <= eps;
}

async function verifyParse(): Promise<boolean> {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.pdf')).sort();
  console.log(`Parsing ${files.length} PDFs…`);
  let ok = true;
  const summaries: { file: string; date: string; total: number; holdings: number }[] = [];

  for (const f of files) {
    const buf = fs.readFileSync(path.join(dir, f));
    const s = await parseAbnAmroStatement(buf, f);
    summaries.push({ file: f, date: s.statementDate, total: s.totalBalance, holdings: s.holdings.length });

    if (s.holdings.length === 0) {
      console.error(`FAIL ${f}: no holdings parsed`);
      ok = false;
    }
    if (s.portfolioNumber !== '47.23.94.371') {
      console.error(`FAIL ${f}: unexpected portfolio ${s.portfolioNumber}`);
      ok = false;
    }
    const exp = EXPECTED[f];
    if (exp) {
      if (s.statementDate !== exp.date) {
        console.error(`FAIL ${f}: date ${s.statementDate} != ${exp.date}`);
        ok = false;
      }
      if (!approx(s.totalBalance, exp.total)) {
        console.error(`FAIL ${f}: total ${s.totalBalance} != ${exp.total}`);
        ok = false;
      }
      if (!approx(s.netFlow, exp.netFlow)) {
        console.error(`FAIL ${f}: netFlow ${s.netFlow} != ${exp.netFlow}`);
        ok = false;
      }
    }
  }

  // Unique statement dates (11+12 are duplicates of same date)
  const dates = new Set(summaries.map((s) => s.date));
  console.log(`Parsed ${summaries.length} files → ${dates.size} unique statement dates`);
  console.log(
    [...summaries]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((s) => `  ${s.date}  ${s.total.toFixed(2).padStart(10)}  holdings=${s.holdings}  ${s.file}`)
      .join('\n'),
  );

  if (ok) console.log('\nParser verification PASSED');
  else console.error('\nParser verification FAILED');
  return ok;
}

async function runImport(): Promise<void> {
  // Load credentials from server/data before importing services that need them
  process.chdir(path.join(root, 'server'));
  const { importAbnStatements } = await import('../src/services/abnamro.js');
  const { isSupabaseConfigured, getSupabase } = await import('../src/supabase.js');

  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured — cannot import');
  }

  // Probe migration 003
  const sb = getSupabase();
  const { error } = await sb.from('broker_accounts').select('id').limit(1);
  if (error) {
    throw new Error(
      `broker_accounts missing — run migration 003_multi_broker.sql in the Supabase SQL editor first.\n${error.message}`,
    );
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.pdf'))
    .sort()
    .map((f) => ({
      fileName: f,
      buffer: fs.readFileSync(path.join(dir, f)),
    }));

  console.log(`\nImporting ${files.length} PDFs…`);
  const result = await importAbnStatements(files);
  console.log(
    JSON.stringify(
      {
        accountId: result.accountId,
        portfolioNumber: result.portfolioNumber,
        imported: result.imported,
        duplicates: result.duplicates,
        errors: result.errors,
        results: result.results,
      },
      null,
      2,
    ),
  );

  const { getAbnOverview, getAbnPerformance } = await import('../src/services/abnamro.js');
  const overview = await getAbnOverview();
  const perf = await getAbnPerformance('yearly');
  console.log('\nOverview:');
  console.log(
    JSON.stringify(
      {
        available: overview.available,
        currentValue: overview.currentValue,
        statementDate: overview.statementDate,
        totalDeposits: overview.totalDeposits,
        allTimeGain: overview.allTimeGain,
        allTimeGainPct: overview.allTimeGainPct,
        snapshots: overview.snapshots.length,
        holdings: overview.latestHoldings.length,
      },
      null,
      2,
    ),
  );
  console.log(
    `Performance yearly points=${perf.points.length} totalGain=${perf.totalGain}`,
  );
}

async function main() {
  const doImport = process.argv.includes('--import');
  const ok = await verifyParse();
  if (!ok) process.exit(1);
  if (doImport) await runImport();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
