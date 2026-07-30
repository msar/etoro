/**
 * Prints migration instructions. DDL cannot be applied via the service role REST API —
 * run the SQL once in the Supabase Dashboard → SQL Editor.
 *
 * Usage: npx tsx scripts/print-migration.ts
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(resolve(root, 'supabase/migrations/001_init.sql'), 'utf8');

console.log(`
============================================================
Apply this SQL once in the Supabase SQL Editor:
  https://supabase.com/dashboard/project/rqcfghthqtrtzmngocme/sql/new
============================================================
`);
console.log(sql);
console.log(`
============================================================
After it succeeds, restart the server and open the dashboard
(or POST http://localhost:4000/api/sync) to seed history.
============================================================
`);
