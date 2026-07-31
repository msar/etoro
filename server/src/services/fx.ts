/**
 * FX rates via frankfurter.app (ECB), cached in Supabase `fx_rates`.
 */

import { getSupabase, isSupabaseConfigured, selectAllRows } from '../supabase.js';

const FRANKFURTER = 'https://api.frankfurter.app';

/** In-memory fallback when Supabase is unavailable. */
const memoryCache = new Map<string, number>();

function cacheKey(date: string, base: string, quote: string): string {
  return `${date}|${base}|${quote}`;
}

async function loadCachedRange(
  base: string,
  quote: string,
  from: string,
  to: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!isSupabaseConfigured()) {
    for (const [k, rate] of memoryCache) {
      const [d, b, q] = k.split('|');
      if (b === base && q === quote && d >= from && d <= to) out.set(d, rate);
    }
    return out;
  }

  const sb = getSupabase();
  const { rows } = await selectAllRows<{ date: string; rate: number }>((fromIdx, toIdx) =>
    sb
      .from('fx_rates')
      .select('date, rate')
      .eq('base', base)
      .eq('quote', quote)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true })
      .range(fromIdx, toIdx),
  );
  for (const r of rows) {
    out.set(r.date, r.rate);
    memoryCache.set(cacheKey(r.date, base, quote), r.rate);
  }
  return out;
}

async function persistRates(
  base: string,
  quote: string,
  rates: { date: string; rate: number }[],
): Promise<void> {
  for (const r of rates) {
    memoryCache.set(cacheKey(r.date, base, quote), r.rate);
  }
  if (!isSupabaseConfigured() || rates.length === 0) return;
  const sb = getSupabase();
  const rows = rates.map((r) => ({
    date: r.date,
    base,
    quote,
    rate: r.rate,
  }));
  const { error } = await sb.from('fx_rates').upsert(rows, {
    onConflict: 'date,base,quote',
  });
  if (error) console.warn('fx_rates upsert failed:', error.message);
}

/**
 * Fetch daily rates from frankfurter for [from, to] (inclusive).
 * Frankfurter returns sparse weekend/holiday gaps — we forward-fill.
 */
async function fetchFrankfurterRange(
  base: string,
  quote: string,
  from: string,
  to: string,
): Promise<Map<string, number>> {
  if (base === quote) {
    const out = new Map<string, number>();
    for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
      out.set(new Date(t).toISOString().slice(0, 10), 1);
    }
    return out;
  }

  const url = `${FRANKFURTER}/${from}..${to}?from=${encodeURIComponent(base)}&to=${encodeURIComponent(quote)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Frankfurter FX request failed (${res.status})`);
  }
  const body = (await res.json()) as {
    rates?: Record<string, Record<string, number>>;
  };
  const sparse = new Map<string, number>();
  for (const [date, quotes] of Object.entries(body.rates ?? {})) {
    const rate = quotes[quote];
    if (typeof rate === 'number') sparse.set(date, rate);
  }

  // Forward-fill calendar days
  const out = new Map<string, number>();
  let last: number | null = sparse.get(from) ?? null;
  // Seed last from any rate on or before from
  if (last == null) {
    const first = [...sparse.entries()].sort((a, b) => a[0].localeCompare(b[0]))[0];
    if (first) last = first[1];
  }
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (sparse.has(d)) last = sparse.get(d)!;
    if (last != null) out.set(d, last);
  }
  return out;
}

/**
 * Ensure FX rates for base→quote covering [from, to] are available.
 * Returns a map date → rate (forward-filled).
 */
export async function ensureFxRates(
  base: string,
  quote: string,
  from: string,
  to: string,
): Promise<Map<string, number>> {
  const b = base.toUpperCase();
  const q = quote.toUpperCase();
  if (b === q) {
    const ones = new Map<string, number>();
    for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
      ones.set(new Date(t).toISOString().slice(0, 10), 1);
    }
    return ones;
  }

  const cached = await loadCachedRange(b, q, from, to);
  const missing: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (!cached.has(d)) missing.push(d);
  }

  if (missing.length === 0) return cached;

  const fetchFrom = missing[0];
  const fetchTo = missing[missing.length - 1];
  try {
    const fetched = await fetchFrankfurterRange(b, q, fetchFrom, fetchTo);
    const toPersist: { date: string; rate: number }[] = [];
    for (const [date, rate] of fetched) {
      cached.set(date, rate);
      toPersist.push({ date, rate });
    }
    await persistRates(b, q, toPersist);
  } catch (err) {
    console.warn('FX fetch failed, using cache/fallback:', (err as Error).message);
  }

  // Last-known fallback for any remaining gaps
  let last: number | null = null;
  const sortedCached = [...cached.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (sortedCached.length) last = sortedCached[0][1];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (cached.has(d)) last = cached.get(d)!;
    else if (last != null) cached.set(d, last);
  }

  return cached;
}

/** Convert an amount on a given date from `fromCurrency` to `toCurrency`. */
export async function convertAmount(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  date: string,
): Promise<number> {
  if (fromCurrency.toUpperCase() === toCurrency.toUpperCase()) return amount;
  const rates = await ensureFxRates(fromCurrency, toCurrency, date, date);
  const rate = rates.get(date);
  if (rate == null) {
    // Try a nearby lookback of 7 days
    const from = new Date(`${date}T00:00:00Z`);
    from.setUTCDate(from.getUTCDate() - 7);
    const lookback = await ensureFxRates(
      fromCurrency,
      toCurrency,
      from.toISOString().slice(0, 10),
      date,
    );
    const fallback = [...lookback.entries()].sort((a, b) => b[0].localeCompare(a[0]))[0];
    if (!fallback) throw new Error(`No FX rate for ${fromCurrency}/${toCurrency} on ${date}`);
    return amount * fallback[1];
  }
  return amount * rate;
}

/**
 * Convert a time series of { date, value } from one currency to another.
 * Rates are fetched once for the full span.
 */
export async function convertSeries(
  points: { date: string; value: number }[],
  fromCurrency: string,
  toCurrency: string,
): Promise<{ date: string; value: number; rate: number }[]> {
  if (points.length === 0) return [];
  if (fromCurrency.toUpperCase() === toCurrency.toUpperCase()) {
    return points.map((p) => ({ date: p.date, value: p.value, rate: 1 }));
  }
  const dates = points.map((p) => p.date).sort();
  const rates = await ensureFxRates(fromCurrency, toCurrency, dates[0], dates[dates.length - 1]);
  let lastRate = 1;
  return points.map((p) => {
    const rate = rates.get(p.date) ?? lastRate;
    lastRate = rate;
    return { date: p.date, value: p.value * rate, rate };
  });
}
