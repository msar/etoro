import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { etoroFetch } from '../etoroClient.js';

const CACHE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'data',
  'instrument-cache.json',
);

interface SearchItem {
  instrumentId?: number;
  InstrumentID?: number;
  symbolFull?: string;
  internalSymbolFull?: string;
  SymbolFull?: string;
}

interface SearchResponse {
  items?: SearchItem[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function loadCache(): Record<string, number> {
  if (!existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as Record<string, number>;
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, number>): void {
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2) + '\n');
}

function pickId(item: SearchItem): number | null {
  const id = item.instrumentId ?? item.InstrumentID;
  return typeof id === 'number' && id > 0 ? id : null;
}

function pickSymbol(item: SearchItem): string {
  return (item.symbolFull ?? item.internalSymbolFull ?? item.SymbolFull ?? '').toUpperCase();
}

/**
 * Resolve unique tickers via /market-data/search.
 * Caches results under server/data/instrument-cache.json (gitignored).
 * Rate-limits to stay under the shared 120/min market-data quota.
 */
export async function resolveSymbols(
  symbols: string[],
  options: { delayMs?: number; limit?: number } = {},
): Promise<Map<string, number>> {
  const delayMs = options.delayMs ?? 600;
  const cache = loadCache();
  const out = new Map<string, number>();
  const pending: string[] = [];

  for (const raw of symbols) {
    const sym = raw.trim().toUpperCase();
    if (!sym) continue;
    if (cache[sym] != null) {
      out.set(sym, cache[sym]);
    } else if (!pending.includes(sym)) {
      pending.push(sym);
    }
  }

  const toResolve = options.limit ? pending.slice(0, options.limit) : pending;
  console.log(
    `Instrument resolve: ${out.size} cached, ${toResolve.length} to search` +
      (pending.length > toResolve.length ? ` (${pending.length - toResolve.length} deferred)` : ''),
  );

  let resolved = 0;
  let failed = 0;
  for (let i = 0; i < toResolve.length; i++) {
    const sym = toResolve[i];
    try {
      const res = await etoroFetch<SearchResponse>(
        `/api/v1/market-data/search?internalSymbolFull=${encodeURIComponent(sym)}`,
      );
      const items = res.items ?? [];
      const exact =
        items.find((it) => pickSymbol(it) === sym) ??
        items.find((it) => pickSymbol(it).startsWith(sym)) ??
        items[0];
      const id = exact ? pickId(exact) : null;
      cache[sym] = id ?? 0;
      out.set(sym, id ?? 0);
      if (id) resolved++;
      else failed++;
    } catch (err) {
      console.warn(`  search failed for ${sym}:`, (err as Error).message);
      cache[sym] = 0;
      out.set(sym, 0);
      failed++;
    }

    if ((i + 1) % 25 === 0 || i === toResolve.length - 1) {
      saveCache(cache);
      console.log(`  … ${i + 1}/${toResolve.length} searched (ok=${resolved}, miss=${failed})`);
    }
    if (i + 1 < toResolve.length) await sleep(delayMs);
  }

  saveCache(cache);
  return out;
}
