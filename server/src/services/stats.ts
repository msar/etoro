import { cached, TTL } from '../cache.js';
import type { TradingEnv } from '../etoroTypes.js';
import { getEquityHistory, type EquityPoint } from './balances.js';

export interface DrawdownInfo {
  depth: number; // negative fraction, e.g. -0.32
  peakDate: string | null;
  troughDate: string | null;
  recoveryDate: string | null; // null = not yet recovered
  lengthDays: number | null; // peak → recovery (or null)
}

export interface AccountStats {
  since: string | null;
  days: number;
  totalGain: number | null; // compounded time-weighted, whole series
  cagr: number | null;
  volatilityAnnualized: number | null;
  sharpe: number | null; // rf = 0
  maxDrawdown: DrawdownInfo | null;
  currentDrawdown: number | null;
  bestMonth: { date: string; gain: number } | null;
  worstMonth: { date: string; gain: number } | null;
  bestYear: { date: string; gain: number } | null;
  worstYear: { date: string; gain: number } | null;
  totalDeposits: number;
  totalWithdrawals: number;
  netDeposits: number;
  currentEquity: number | null;
  allTimeProfit: number | null; // equity − cumulative net deposits
  positiveDaysPct: number | null;
}

interface DailyReturn {
  date: string;
  gain: number;
}

function dailyReturns(points: EquityPoint[]): DailyReturn[] {
  const out: DailyReturn[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const base = prev.total + cur.netFlow;
    if (base <= 0) continue;
    out.push({ date: cur.date, gain: (cur.total - prev.total - cur.netFlow) / base });
  }
  return out;
}

function drawdownFromIndex(index: { date: string; value: number }[]): {
  max: DrawdownInfo | null;
  current: number | null;
} {
  if (index.length === 0) return { max: null, current: null };

  let peakValue = index[0].value;
  let peakDate = index[0].date;

  let maxDepth = 0;
  let maxPeakDate: string | null = null;
  let maxTroughDate: string | null = null;
  let maxRecoveryDate: string | null = null;

  // Track the running worst drawdown; find recovery by scanning forward once.
  let curPeakForMax = peakValue;
  for (const p of index) {
    if (p.value > peakValue) {
      peakValue = p.value;
      peakDate = p.date;
    }
    const depth = p.value / peakValue - 1;
    if (depth < maxDepth) {
      maxDepth = depth;
      maxPeakDate = peakDate;
      maxTroughDate = p.date;
      curPeakForMax = peakValue;
      maxRecoveryDate = null;
    } else if (maxRecoveryDate === null && maxTroughDate !== null && p.value >= curPeakForMax) {
      maxRecoveryDate = p.date;
    }
  }

  const last = index[index.length - 1];
  const current = last.value / peakValue - 1;

  let lengthDays: number | null = null;
  if (maxPeakDate && maxRecoveryDate) {
    lengthDays = Math.round(
      (Date.parse(maxRecoveryDate) - Date.parse(maxPeakDate)) / 86_400_000,
    );
  }

  return {
    max:
      maxTroughDate === null
        ? null
        : {
            depth: maxDepth,
            peakDate: maxPeakDate,
            troughDate: maxTroughDate,
            recoveryDate: maxRecoveryDate,
            lengthDays,
          },
    current: Math.min(0, current),
  };
}

function extremeBucket(
  returns: DailyReturn[],
  keyLen: number,
): { best: { date: string; gain: number } | null; worst: { date: string; gain: number } | null } {
  const buckets = new Map<string, number>();
  for (const r of returns) {
    const key = r.date.slice(0, keyLen);
    buckets.set(key, (buckets.get(key) ?? 1) * (1 + r.gain));
  }
  let best: { date: string; gain: number } | null = null;
  let worst: { date: string; gain: number } | null = null;
  for (const [date, factor] of buckets) {
    const gain = factor - 1;
    if (!best || gain > best.gain) best = { date, gain };
    if (!worst || gain < worst.gain) worst = { date, gain };
  }
  return { best, worst };
}

export async function getAccountStats(env: TradingEnv): Promise<AccountStats> {
  return cached(`stats:${env}`, TTL.HISTORY, async () => {
    const equity = await getEquityHistory(env);
    const points = equity.points;

    const empty: AccountStats = {
      since: null,
      days: 0,
      totalGain: null,
      cagr: null,
      volatilityAnnualized: null,
      sharpe: null,
      maxDrawdown: null,
      currentDrawdown: null,
      bestMonth: null,
      worstMonth: null,
      bestYear: null,
      worstYear: null,
      totalDeposits: equity.totalDepositsInWindow,
      totalWithdrawals: equity.totalWithdrawalsInWindow,
      netDeposits: equity.totalDepositsInWindow - equity.totalWithdrawalsInWindow,
      currentEquity: null,
      allTimeProfit: null,
      positiveDaysPct: null,
    };
    if (points.length < 2) return empty;

    const returns = dailyReturns(points);
    if (returns.length === 0) return empty;

    // Deposit-adjusted performance index (starts at 1.0)
    let compound = 1;
    const index = returns.map((r) => {
      compound *= 1 + r.gain;
      return { date: r.date, value: compound };
    });
    const totalGain = compound - 1;

    const first = points[0];
    const last = points[points.length - 1];
    const spanDays = Math.max(
      1,
      Math.round((Date.parse(last.date) - Date.parse(first.date)) / 86_400_000),
    );
    const years = spanDays / 365.25;
    const cagr = years > 0.25 ? Math.pow(1 + totalGain, 1 / years) - 1 : null;

    // Volatility from non-zero trading-day returns, annualized (~252 sessions).
    const active = returns.filter((r) => r.gain !== 0);
    let volatilityAnnualized: number | null = null;
    let sharpe: number | null = null;
    if (active.length >= 20) {
      const mean = active.reduce((s, r) => s + r.gain, 0) / active.length;
      const variance =
        active.reduce((s, r) => s + (r.gain - mean) ** 2, 0) / (active.length - 1);
      volatilityAnnualized = Math.sqrt(variance) * Math.sqrt(252);
      if (volatilityAnnualized > 0 && cagr !== null) {
        sharpe = cagr / volatilityAnnualized;
      }
    }

    const { max: maxDrawdown, current: currentDrawdown } = drawdownFromIndex(index);
    const months = extremeBucket(returns, 7);
    const yearsBuckets = extremeBucket(returns, 4);

    const positiveDays = active.filter((r) => r.gain > 0).length;

    return {
      since: first.date,
      days: spanDays,
      totalGain,
      cagr,
      volatilityAnnualized,
      sharpe,
      maxDrawdown,
      currentDrawdown,
      bestMonth: months.best,
      worstMonth: months.worst,
      bestYear: yearsBuckets.best,
      worstYear: yearsBuckets.worst,
      totalDeposits: equity.totalDepositsInWindow,
      totalWithdrawals: equity.totalWithdrawalsInWindow,
      netDeposits: equity.totalDepositsInWindow - equity.totalWithdrawalsInWindow,
      currentEquity: last.total,
      allTimeProfit: last.total - last.cumulativeNetDeposits,
      positiveDaysPct: active.length ? positiveDays / active.length : null,
    };
  });
}
