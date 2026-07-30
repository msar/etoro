/**
 * Prints migration instructions. DDL cannot be applied via the service role REST API —
 * run the SQL once in the Supabase Dashboard → SQL Editor.
 *
 * Usage: npx tsx scripts/print-migration.ts            (all migrations)
 *        npx tsx scripts/print-migration.ts 002        (a specific one)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(root, 'supabase/migrations');
const filter = process.argv[2];

const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .filter((f) => !filter || f.startsWith(filter))
  .sort();

console.log(`
============================================================
Apply this SQL once in the Supabase SQL Editor:
  https://supabase.com/dashboard → your project → SQL → New query
============================================================
`);
for (const f of files) {
  console.log(`-- ─────────── ${f} ───────────\n`);
  console.log(readFileSync(resolve(dir, f), 'utf8'));
}
console.log(`
============================================================
Already-applied statements are safe to re-run (IF NOT EXISTS).
After it succeeds, restart the server and open the dashboard
(or POST http://localhost:4000/api/sync) to seed history.
============================================================
`);
