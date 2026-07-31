/**
 * Verify E*TRADE G&L parser against Summary row in GL_ETRADE.xlsx.
 * Usage: npx tsx scripts/verify-etrade.ts
 *        npx tsx scripts/verify-etrade.ts --import
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEtradeGl } from '../src/import/etradeGl.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const filePath = path.join(root, 'exporteddata/GL_ETRADE.xlsx');

function approx(a: number, b: number, eps: number): boolean {
  return Math.abs(a - b) <= eps;
}

async function main() {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }
  const buf = fs.readFileSync(filePath);
  const parsed = parseEtradeGl(buf, path.basename(filePath));
  const qtySum = parsed.lots.reduce((s, l) => s + l.quantity, 0);
  const costSum = parsed.lots.reduce((s, l) => s + l.adjustedCost, 0);
  const proceedsSum = parsed.lots.reduce((s, l) => s + l.proceeds, 0);
  const gainSum = parsed.lots.reduce((s, l) => s + l.adjustedGain, 0);

  console.log(
    JSON.stringify(
      {
        sheetName: parsed.sheetName,
        lotCount: parsed.lots.length,
        qtySum,
        costSum,
        proceedsSum,
        gainSum,
        summary: parsed.summary,
        symbols: [...new Set(parsed.lots.map((l) => l.symbol))],
        sample: parsed.lots.slice(0, 2).map((l) => ({
          symbol: l.symbol,
          quantity: l.quantity,
          dateAcquired: l.dateAcquired,
          dateSold: l.dateSold,
          adjustedCost: l.adjustedCost,
          proceeds: l.proceeds,
          adjustedGain: l.adjustedGain,
          status: l.capitalGainsStatus,
        })),
      },
      null,
      2,
    ),
  );

  if (!parsed.summary) throw new Error('Missing Summary row');
  if (parsed.lots.length < 1) throw new Error('Expected sell lots');
  if (!approx(qtySum, parsed.summary.quantity, 0.02)) {
    throw new Error(`Qty sum ${qtySum} != Summary ${parsed.summary.quantity}`);
  }
  if (!approx(gainSum, parsed.summary.adjustedGainLoss, 1)) {
    throw new Error(`Adj gain sum ${gainSum} != Summary ${parsed.summary.adjustedGainLoss}`);
  }
  if (!approx(parsed.summary.quantity, 29.151, 0.01)) {
    throw new Error(`Unexpected summary qty ${parsed.summary.quantity}`);
  }
  if (!approx(parsed.summary.adjustedGainLoss, 29402.91, 1)) {
    throw new Error(`Unexpected summary adj G/L ${parsed.summary.adjustedGainLoss}`);
  }
  console.log('\nParser verification PASSED');

  if (process.argv.includes('--import')) {
    process.chdir(path.join(root, 'server'));
    const { importEtradeGl, getEtradeOverview, getEtradePerformance } = await import(
      '../src/services/etrade.js'
    );
    const { isSupabaseConfigured, getSupabase } = await import('../src/supabase.js');
    if (!isSupabaseConfigured()) throw new Error('Supabase not configured');
    const sb = getSupabase();
    const { error } = await sb.from('broker_lots').select('lot_key').limit(1);
    if (error) {
      throw new Error(
        `broker_lots missing — run migration 004_etrade_lots.sql first.\n${error.message}`,
      );
    }
    const result = await importEtradeGl([{ buffer: buf, fileName: path.basename(filePath) }]);
    console.log('\nImport:', JSON.stringify(result, null, 2));
    const overview = await getEtradeOverview();
    const perf = await getEtradePerformance('yearly');
    console.log(
      '\nOverview:',
      JSON.stringify(
        {
          available: overview.available,
          totalAdjustedGain: overview.totalAdjustedGain,
          totalAdjustedCost: overview.totalAdjustedCost,
          returnOnCost: overview.returnOnCost,
          lotCount: overview.lots.length,
          symbols: overview.bySymbol.map((s) => s.symbol),
        },
        null,
        2,
      ),
    );
    console.log(`Performance yearly points=${perf.points.length} totalGain=${perf.totalGain}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
