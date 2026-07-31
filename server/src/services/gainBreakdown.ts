import { cached, TTL } from '../cache.js';
import type { TradingEnv } from '../etoroTypes.js';
import { getEquityHistory } from './balances.js';
import { getAccountStats } from './stats.js';
import { getBestPerformance } from './performance.js';

export interface GainYearRow {
  year: string;
  /** Deposit-adjusted gain for this calendar year */
  gain: number;
  /** Compounded gain from the start of history through the end of this year */
  cumulativeGain: number;
  /** Net external flow (deposits − withdrawals) during this year */
  netFlow: number;
  /** Equity at the last stored snapshot of this year */
  endEquity: number | null;
}

export interface GainBreakdown {
  available: boolean;
  reason?: string;
  since: string | null;
  /** Compounded, deposit-adjusted total (same figure as the All-time gain card) */
  totalGain: number | null;
  cagr: number | null;
  source: 'etoro' | 'derived';
  years: GainYearRow[];
  bestYear: { date: string; gain: number } | null;
  worstYear: { date: string; gain: number } | null;
}

/**
 * Explain how the all-time gain % is built: the yearly deposit-adjusted gains
 * and how they compound multiplicatively into the headline figure, with
 * deposit/equity context per year.
 */
export async function getGainBreakdown(
  username: string | null,
  env: TradingEnv,
): Promise<GainBreakdown> {
  return cached(`gain-breakdown:${env}:${username ?? ''}`, TTL.HISTORY, async () => {
    const [series, stats, equity] = await Promise.all([
      getBestPerformance(username, env, 'yearly'),
      getAccountStats(env).catch(() => null),
      getEquityHistory(env).catch(() => null),
    ]);

    if (!series.points.length) {
      return {
        available: false,
        reason: 'No performance history yet — run a sync first.',
        since: null,
        totalGain: null,
        cagr: null,
        source: series.source,
        years: [],
        bestYear: null,
        worstYear: null,
      } satisfies GainBreakdown;
    }

    // Per-year deposit context from the stored equity history.
    const flowByYear = new Map<string, number>();
    const endEquityByYear = new Map<string, number>();
    for (const p of equity?.points ?? []) {
      const y = p.date.slice(0, 4);
      flowByYear.set(y, (flowByYear.get(y) ?? 0) + p.netFlow);
      endEquityByYear.set(y, p.total); // points are date-ordered; last write wins
    }

    const years: GainYearRow[] = series.points.map((p) => {
      const year = p.date.slice(0, 4);
      return {
        year,
        gain: p.gain,
        cumulativeGain: p.cumulativeGain,
        netFlow: flowByYear.get(year) ?? 0,
        endEquity: endEquityByYear.get(year) ?? null,
      };
    });

    return {
      available: true,
      since: stats?.since ?? series.points[0].date,
      totalGain: series.totalGain,
      cagr: stats?.cagr ?? null,
      source: series.source,
      years,
      bestYear: stats?.bestYear ?? null,
      worstYear: stats?.worstYear ?? null,
    } satisfies GainBreakdown;
  });
}
