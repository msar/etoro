/**
 * Verify E*TRADE Client Statement parser against sample PDFs.
 *
 * Usage: npx tsx scripts/verify-etrade-statements.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEtradeStatements } from '../src/import/etradeStatement.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const samplesDir = path.resolve(__dirname, '../../exporteddata/etrade');

const EXPECTED: Record<string, { dates: string[]; minCount: number; spotChecks: Record<string, number> }> = {
  'ClientStatements_073126.pdf': {
    minCount: 2,
    dates: ['2019-09-30', '2019-12-31'],
    spotChecks: { '2019-12-31': 4107.46, '2019-09-30': 3925.22 },
  },
  'ClientStatements_2020.pdf': {
    minCount: 3,
    dates: ['2020-03-31', '2020-06-30', '2020-09-30'],
    spotChecks: { '2020-09-30': 0, '2020-06-30': 19108.08 },
  },
  'ClientStatements_2021.pdf': {
    minCount: 4,
    dates: ['2021-03-31', '2021-06-30', '2021-09-30', '2021-12-31'],
    spotChecks: { '2021-12-31': 19193.84 },
  },
  'ClientStatements_5997_093020.pdf': {
    minCount: 1,
    dates: ['2020-09-30'],
    spotChecks: { '2020-09-30': 0 },
  },
  'ClientStatements_2023.pdf': {
    minCount: 4,
    dates: ['2023-03-31', '2023-06-30', '2023-09-30', '2023-12-31'],
    spotChecks: { '2023-12-31': 63849.96 },
  },
  'ClientStatements_2024.pdf': {
    minCount: 4,
    dates: ['2024-03-31', '2024-06-30', '2024-09-30', '2024-12-31'],
    spotChecks: { '2024-03-31': 79976.98, '2024-06-30': 0, '2024-12-31': 0.34 },
  },
  'ClientStatements_2025.pdf': {
    minCount: 4,
    dates: ['2025-03-31', '2025-12-31'],
    spotChecks: { '2025-03-31': 18460.23, '2025-12-31': 38.01 },
  },
  'ClientStatements_2026.pdf': {
    minCount: 3,
    dates: ['2026-03-31', '2026-04-30', '2026-06-30'],
    spotChecks: { '2026-06-30': 29.72 },
  },
};

async function main() {
  let failed = 0;
  const allDates = new Map<string, { ending: number; netFlow: number; file: string }>();

  for (const [fileName, exp] of Object.entries(EXPECTED)) {
    const filePath = path.join(samplesDir, fileName);
    if (!fs.existsSync(filePath)) {
      console.error(`MISSING ${fileName}`);
      failed++;
      continue;
    }
    const buf = fs.readFileSync(filePath);
    const parsed = await parseEtradeStatements(buf, fileName);
    console.log(`\n${fileName}: ${parsed.statements.length} statement(s)`);
    if (parsed.warnings.length) {
      console.log('  warnings:', parsed.warnings);
    }

    if (parsed.statements.length < exp.minCount) {
      console.error(`  FAIL: expected >= ${exp.minCount} statements, got ${parsed.statements.length}`);
      failed++;
    }

    const dates = parsed.statements.map((s) => s.statementDate);
    const uniqueKeys = new Set(
      parsed.statements.map((s) => `${s.accountNumber}:${s.statementDate}`),
    );
    if (uniqueKeys.size !== parsed.statements.length) {
      console.error(
        `  FAIL: duplicate account+date in file: ${[...uniqueKeys].join(', ')}`,
      );
      failed++;
    }

    for (const d of exp.dates) {
      if (!dates.includes(d)) {
        console.error(`  FAIL: missing expected date ${d}`);
        failed++;
      }
    }

    for (const s of parsed.statements) {
      console.log(
        `  ${s.statementDate}  ${s.accountNumber}  ending=${s.endingValue}  netFlow=${s.netFlow}  holdings=${s.holdings.length}`,
      );
      const expectedVal = exp.spotChecks[s.statementDate];
      // Spot-check against the MS/primary account when hybrid packs have two rows for one date
      if (
        expectedVal != null &&
        Math.abs(s.endingValue - expectedVal) > 0.01 &&
        !(
          s.statementDate in exp.spotChecks &&
          parsed.statements.filter((x) => x.statementDate === s.statementDate).length > 1 &&
          s.endingValue === 0
        )
      ) {
        // Allow emptied legacy account on migration date when another row matches spot check
        const siblings = parsed.statements.filter((x) => x.statementDate === s.statementDate);
        const anyMatch = siblings.some((x) => Math.abs(x.endingValue - expectedVal) <= 0.01);
        if (!anyMatch) {
          console.error(`  FAIL: ${s.statementDate} ending ${s.endingValue} ≠ ${expectedVal}`);
          failed++;
        }
      }

      const key = `${s.accountNumber}:${s.statementDate}`;
      const prev = allDates.get(key);
      if (prev && Math.abs(prev.ending - s.endingValue) > 0.01) {
        console.error(
          `  FAIL: ${key} ending differs across files (${prev.file}=${prev.ending} vs ${fileName}=${s.endingValue})`,
        );
        failed++;
      }
      allDates.set(key, {
        ending: s.endingValue,
        netFlow: s.netFlow,
        file: fileName,
      });
    }

    // Q3 2020 net flow check when present
    const q3 = parsed.statements.find((s) => s.statementDate === '2020-09-30');
    if (q3 && Math.abs(q3.netFlow - -21895.4) > 0.01) {
      console.error(`  FAIL: 2020-09-30 netFlow ${q3.netFlow} ≠ -21895.40`);
      failed++;
    }
  }

  // Dedup simulation: 2020.pdf + 5997 should share the same account:date key
  if ([...allDates.keys()].some((k) => k.endsWith(':2020-09-30'))) {
    console.log('\nDedup key *:2020-09-30 present across files (by account+date) ✓');
  }

  // 2024 Q2 withdrawal flow
  const q2_24 = [...allDates.entries()].find(([k]) => k.endsWith(':2024-06-30'));
  if (q2_24 && Math.abs(q2_24[1].netFlow - -83752.64) > 0.01) {
    console.error(`FAIL: 2024-06-30 netFlow ${q2_24[1].netFlow} ≠ -83752.64`);
    failed++;
  }

  if (failed) {
    console.error(`\n${failed} assertion(s) failed`);
    process.exit(1);
  }
  console.log('\nAll E*TRADE statement parser checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
