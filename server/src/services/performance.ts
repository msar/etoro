import { cached, TTL } from '../cache.js';
import { etoroFetch } from '../etoroClient.js';
import type { GainSeriesResponse, TradingEnv } from '../etoroTypes.js';
import { getEquityHistory } from './balances.js';

export type Granularity = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface PerformancePoint {
  date: string;
  /** Period gain as decimal fraction (0.06 = 6%) */
  gain: number;
  /** Compounded cumulative gain since the start of the series */
  cumulativeGain: number;
}

export interface PerformanceSeries {
  granularity: Granularity;
  points: PerformancePoint[];
  totalGain: number | null;
  /** 'etoro' = official gain series; 'derived' = computed from balance history */
  source: 'etoro' | 'derived';
}

/**
 * eToro's gain series follows their deposit-adjusted methodology: adding money
 * is NOT a gain, so compounding period gains gives a performance percentage
 * based on the cumulative investment over time.
 * Note: eToro only supports daily | monthly | yearly (not weekly).
 */
export async function getPerformance(
  username: string,
  granularity: Exclude<Granularity, 'weekly'>,
  minDate?: string,
  maxDate?: string,
): Promise<PerformanceSeries> {
  const key = `performance:${username}:${granularity}:${minDate ?? ''}:${maxDate ?? ''}`;
  return cached(key, TTL.HISTORY, async () => {
    const params: string[] = [];
    if (minDate) params.push(`minDate=${minDate}`);
    if (maxDate) params.push(`maxDate=${maxDate}`);
    const qs = params.length ? `?${params.join('&')}` : '';

    const res = await etoroFetch<GainSeriesResponse>(
      `/api/v2/portfolios/${encodeURIComponent(username)}/gain/${granularity}${qs}`,
    );

    const sorted = [...(res.gains ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    let compound = 1;
    const points: PerformancePoint[] = sorted.map((g) => {
      compound *= 1 + g.gain;
      return { date: g.date, gain: g.gain, cumulativeGain: compound - 1 };
    });

    return {
      granularity,
      points,
      totalGain: res.totalGain ?? (points.length ? compound - 1 : null),
      source: 'etoro' as const,
    };
  });
}

/** ISO week key (Monday-start) → Monday date YYYY-MM-DD, and Sunday week-ending date. */
function isoWeekBucket(dateStr: string): { key: string; weekEnding: string } {
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  const day = d.getUTCDay(); // 0=Sun … 6=Sat
  const offsetToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + offsetToMonday);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const key = monday.toISOString().slice(0, 10);
  return { key, weekEnding: sunday.toISOString().slice(0, 10) };
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

/**
 * Pick the best available series for the requested window.
 *
 * The official eToro gain series is authoritative but its historical depth
 * varies; the derived series covers everything stored in Supabase (which can
 * include imported statement history going back years). Prefer official only
 * when it actually covers the requested window as well as derived does.
 */
export async function getBestPerformance(
  username: string | null,
  env: TradingEnv,
  granularity: Granularity,
  minDate?: string,
  maxDate?: string,
): Promise<PerformanceSeries> {
  const derivedPromise = getDerivedPerformance(env, granularity, minDate, maxDate).catch(
    () => null,
  );

  let official: PerformanceSeries | null = null;
  if (granularity !== 'weekly' && username) {
    try {
      official = await getPerformance(username, granularity, minDate, maxDate);
    } catch (err) {
      console.warn('Official gain series unavailable:', (err as Error).message);
    }
  }

  const derived = await derivedPromise;
  if (!official?.points.length) return derived ?? official ?? emptySeries(granularity);
  if (!derived?.points.length) return official;

  // 31-day slack: monthly buckets can shift the first label by up to a month.
  const officialStart = new Date(`${official.points[0].date.slice(0, 10)}T00:00:00Z`).getTime();
  const derivedStart = new Date(`${derived.points[0].date.slice(0, 10)}T00:00:00Z`).getTime();
  const officialCoversWindow = officialStart <= derivedStart + 31 * 86_400_000;
  return officialCoversWindow ? official : derived;
}

function emptySeries(granularity: Granularity): PerformanceSeries {
  return { granularity, points: [], totalGain: null, source: 'derived' };
}

/**
 * Deposit-adjusted performance from stored/live balance history.
 * Supports daily | weekly | monthly | yearly. Weekly uses ISO weeks (Mon–Sun),
 * labeled by the week-ending Sunday.
 */
export async function getDerivedPerformance(
  env: TradingEnv,
  granularity: Granularity,
  minDate?: string,
  maxDate?: string,
): Promise<PerformanceSeries> {
  const key = `performance-derived:${env}:${granularity}:${minDate ?? ''}:${maxDate ?? ''}`;
  return cached(key, TTL.HISTORY, async () => {
    const equity = await getEquityHistory(env, minDate, maxDate);
    const snaps = equity.points;

    const daily: { date: string; gain: number }[] = [];
    for (let i = 1; i < snaps.length; i++) {
      const prev = snaps[i - 1];
      const cur = snaps[i];
      const base = prev.total + cur.netFlow;
      if (base <= 0) continue;
      daily.push({ date: cur.date, gain: (cur.total - prev.total - cur.netFlow) / base });
    }

    const buckets = new Map<string, number>();
    for (const d of daily) {
      const b = bucketOf(d.date, granularity);
      buckets.set(b, (buckets.get(b) ?? 1) * (1 + d.gain));
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
      totalGain: points.length ? compound - 1 : null,
      source: 'derived' as const,
    };
  });
}
