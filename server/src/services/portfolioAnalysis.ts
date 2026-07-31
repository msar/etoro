import { cached, TTL } from '../cache.js';
import type { TradingEnv } from '../etoroTypes.js';
import { getIncomeReport } from './income.js';
import { getPortfolio, type PortfolioSummary } from './portfolio.js';
import { resolveInstruments } from './instruments.js';
import { getAccountStats, type AccountStats } from './stats.js';

export type CheckStatus = 'ok' | 'watch' | 'action';

export interface AnalysisCheck {
  id: string;
  title: string;
  status: CheckStatus;
  /** What we found, with the numbers */
  detail: string;
  /** What to do about it, in plain language */
  recommendation: string;
}

export interface AssetMixSlice {
  bucket: string;
  value: number;
  pct: number; // 0..1 of total equity
}

export interface PortfolioAnalysis {
  available: boolean;
  reason?: string;
  generatedAt: string;
  currency: string;
  equity: number | null;
  holdingsCount: number;
  cashPct: number | null;
  /** 0–100; simple average of check scores (ok=100, watch=50, action=0) */
  score: number | null;
  checks: AnalysisCheck[];
  assetMix: AssetMixSlice[];
  disclaimer: string;
}

// eToro instrumentTypeID → human bucket. Unknown ids fall into 'Other'.
const TYPE_BUCKETS: Record<number, string> = {
  1: 'Currencies',
  2: 'Commodities',
  4: 'Indices',
  5: 'Stocks',
  6: 'ETFs',
  10: 'Crypto',
};

const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;

function statusScore(s: CheckStatus): number {
  return s === 'ok' ? 100 : s === 'watch' ? 50 : 0;
}

interface Weighted {
  symbol: string | null;
  instrumentId: number;
  value: number;
  weight: number; // fraction of total equity
  pnlPercent: number;
  avgLeverage: number;
  viaCopy: boolean;
}

function label(h: { symbol: string | null; instrumentId: number }): string {
  return h.symbol ?? `#${h.instrumentId}`;
}

function concentrationCheck(weighted: Weighted[]): AnalysisCheck {
  if (!weighted.length) {
    return {
      id: 'concentration',
      title: 'Concentration',
      status: 'ok',
      detail: 'No open positions.',
      recommendation: 'Nothing to check while the portfolio holds no positions.',
    };
  }
  const sorted = [...weighted].sort((a, b) => b.weight - a.weight);
  const top = sorted[0];
  const top3 = sorted.slice(0, 3).reduce((s, w) => s + w.weight, 0);
  const investedTotal = weighted.reduce((s, w) => s + w.weight, 0);
  const hhi = investedTotal > 0
    ? weighted.reduce((s, w) => s + (w.weight / investedTotal) ** 2, 0)
    : 0;

  const status: CheckStatus = top.weight > 0.25 ? 'action' : top.weight > 0.15 ? 'watch' : 'ok';
  const detail = `Largest position ${label(top)} is ${pct(top.weight)} of equity; top 3 hold ${pct(top3)}. Concentration index (HHI) ${hhi.toFixed(2)} — ${hhi > 0.2 ? 'concentrated' : hhi > 0.1 ? 'moderately concentrated' : 'well spread'}.`;
  const recommendation =
    status === 'action'
      ? `${label(top)} alone can move your whole portfolio. Consider trimming it below ~15% of equity and redistributing into positions you have less exposure to.`
      : status === 'watch'
        ? `Keep an eye on ${label(top)} — above ~15% a single earnings miss dominates your results. Avoid adding to it before other positions catch up.`
        : 'No single position dominates the portfolio. Keep new buys sized consistently to preserve this.';
  return { id: 'concentration', title: 'Concentration', status, detail, recommendation };
}

function cashCheck(cash: number, equity: number): AnalysisCheck {
  const cashPct = equity > 0 ? cash / equity : 0;
  const status: CheckStatus = cashPct > 0.2 ? 'watch' : cashPct < 0.02 ? 'watch' : 'ok';
  const detail = `Available cash is ${pct(cashPct)} of equity.`;
  const recommendation =
    cashPct > 0.2
      ? 'A fifth or more of the account sits idle and earns nothing (cash drag). If it is not deliberately reserved, consider deploying it gradually — e.g. into broad ETFs.'
      : cashPct < 0.02
        ? 'Almost no cash buffer. Keeping ~2–5% in cash lets you buy dips and absorb fees without being forced to close positions.'
        : 'Healthy cash buffer — enough flexibility without meaningful drag on returns.';
  return { id: 'cash', title: 'Cash allocation', status, detail, recommendation };
}

function diversificationCheck(weighted: Weighted[], mix: AssetMixSlice[]): AnalysisCheck {
  const n = weighted.length;
  const investedMix = mix.filter((m) => m.bucket !== 'Cash');
  const dominant = [...investedMix].sort((a, b) => b.pct - a.pct)[0];
  const classes = investedMix.filter((m) => m.pct > 0.01).length;

  let status: CheckStatus = 'ok';
  if (n < 3) status = 'action';
  else if (n < 5 || classes <= 1) status = 'watch';

  const mixText = investedMix.length
    ? investedMix.map((m) => `${m.bucket} ${pct(m.pct)}`).join(', ')
    : 'no invested assets';
  const detail = `${n} open position${n === 1 ? '' : 's'} across ${classes || 0} asset class${classes === 1 ? '' : 'es'} (${mixText}).`;
  const recommendation =
    status === 'action'
      ? 'Fewer than 3 positions means idiosyncratic risk dominates. Add positions in unrelated assets or use a broad ETF as the portfolio core.'
      : status === 'watch'
        ? dominant && classes <= 1
          ? `Everything invested sits in ${dominant.bucket.toLowerCase()}. Mixing in another asset class (e.g. ETFs or commodities) smooths drawdowns.`
          : 'A handful of positions carries the account. Consider broadening to 8–15 holdings so one thesis going wrong hurts less.'
        : 'Position count and asset mix look reasonably diversified.';
  return { id: 'diversification', title: 'Diversification', status, detail, recommendation };
}

function losersCheck(weighted: Weighted[], currency: string): AnalysisCheck {
  const losers = weighted
    .filter((w) => w.pnlPercent <= -15)
    .sort((a, b) => a.pnlPercent - b.pnlPercent);
  const bigLoser = losers.find((l) => l.weight > 0.05);
  const status: CheckStatus = bigLoser ? 'action' : losers.length ? 'watch' : 'ok';
  const detail = losers.length
    ? `${losers.length} position${losers.length === 1 ? '' : 's'} down more than 15%: ${losers
        .slice(0, 4)
        .map((l) => `${label(l)} (${l.pnlPercent.toFixed(0)}%, ${pct(l.weight)} of equity)`)
        .join(', ')}${losers.length > 4 ? ', …' : ''}.`
    : 'No open position is down more than 15%.';
  const recommendation = bigLoser
    ? `${label(bigLoser)} is both deeply underwater and a meaningful slice of the account. Re-examine the original thesis: if it no longer holds, cutting frees ${currency} capital for better ideas; averaging down without a thesis is the classic mistake.`
    : losers.length
      ? 'Review whether the reason you bought each of these still applies. Holding a loser is only justified by the thesis, not by the entry price.'
      : 'No deep losers to review right now.';
  return { id: 'losers', title: 'Losing positions', status, detail, recommendation };
}

function leverageCheck(weighted: Weighted[]): AnalysisCheck {
  const levered = weighted.filter((w) => w.avgLeverage > 1);
  const exposure = levered.reduce((s, w) => s + w.weight, 0);
  const status: CheckStatus = exposure > 0.15 ? 'action' : levered.length ? 'watch' : 'ok';
  const detail = levered.length
    ? `${levered.length} position${levered.length === 1 ? '' : 's'} use leverage (${levered
        .slice(0, 4)
        .map((l) => `${label(l)} ×${l.avgLeverage.toFixed(1)}`)
        .join(', ')}), ${pct(exposure)} of equity.`
    : 'No leveraged positions.';
  const recommendation =
    status === 'action'
      ? 'A significant share of the account is leveraged — losses (and overnight fees) are multiplied. Consider deleveraging to ×1 unless these are deliberate short-term trades.'
      : status === 'watch'
        ? 'Leverage multiplies both direction and holding costs. Fine for tactical trades; avoid it on long-term core holdings.'
        : 'Everything is held unleveraged — no margin-call or overnight-fee risk.';
  return { id: 'leverage', title: 'Leverage', status, detail, recommendation };
}

function feeCheck(fees: number, allTimeProfit: number | null, currency: string): AnalysisCheck {
  if (allTimeProfit === null || fees <= 0) {
    return {
      id: 'fees',
      title: 'Fee drag',
      status: 'ok',
      detail: fees > 0 ? `Fees paid to date: ${fees.toFixed(0)} ${currency}.` : 'No fees recorded in the stored history.',
      recommendation: 'Not enough data to relate fees to profit.',
    };
  }
  const base = Math.max(Math.abs(allTimeProfit), 1);
  const ratio = fees / base;
  const status: CheckStatus = ratio > 0.25 ? 'action' : ratio > 0.1 ? 'watch' : 'ok';
  const detail = `Lifetime fees ${fees.toFixed(0)} ${currency} vs all-time profit ${allTimeProfit.toFixed(0)} ${currency} — fees equal ${pct(ratio)} of profit.`;
  const recommendation =
    status === 'action'
      ? 'Fees are eating a quarter or more of what you earn. Main culprits are usually leveraged overnight fees and frequent trading — reduce both and returns improve immediately.'
      : status === 'watch'
        ? 'Fee load is noticeable. Check whether leveraged positions held overnight or high trade frequency drive it.'
        : 'Fees are a small share of profit — cost discipline is fine.';
  return { id: 'fees', title: 'Fee drag', status, detail, recommendation };
}

function riskCheck(stats: AccountStats | null): AnalysisCheck {
  if (!stats || stats.volatilityAnnualized === null) {
    return {
      id: 'risk',
      title: 'Risk profile',
      status: 'ok',
      detail: 'Not enough return history to estimate volatility.',
      recommendation: 'Keep syncing — risk metrics need at least ~20 active trading days.',
    };
  }
  const vol = stats.volatilityAnnualized;
  const sharpe = stats.sharpe;
  const dd = stats.currentDrawdown ?? 0;
  const status: CheckStatus =
    vol > 0.35 || dd < -0.25 ? 'action' : vol > 0.2 || (sharpe !== null && sharpe < 0.5) || dd < -0.1 ? 'watch' : 'ok';
  const detail = `Annualized volatility ${pct(vol)}, Sharpe ${sharpe !== null ? sharpe.toFixed(2) : '—'}, currently ${pct(Math.abs(dd))} below the performance peak.`;
  const recommendation =
    status === 'action'
      ? 'Portfolio swings are large relative to what it returns. Reducing concentration, leverage, or crypto weight are the usual levers to bring volatility down.'
      : status === 'watch'
        ? 'Returns are somewhat volatile for what they deliver. If drawdowns feel uncomfortable, shift part of the book into broad, lower-volatility assets.'
        : 'Risk-adjusted returns look healthy for a self-directed portfolio.';
  return { id: 'risk', title: 'Risk profile', status, detail, recommendation };
}

async function buildAssetMix(
  portfolio: PortfolioSummary,
): Promise<AssetMixSlice[]> {
  const equity = portfolio.totalValue;
  if (equity <= 0) return [];

  const ids = [...new Set(portfolio.holdings.map((h) => h.instrumentId))];
  const meta = await resolveInstruments(ids).catch(() => new Map());

  const byBucket = new Map<string, number>();
  for (const h of portfolio.holdings) {
    const typeId = meta.get(h.instrumentId)?.instrumentTypeId ?? null;
    const bucket = (typeId !== null && TYPE_BUCKETS[typeId]) || 'Other';
    byBucket.set(bucket, (byBucket.get(bucket) ?? 0) + h.value);
  }
  if (portfolio.availableCash > 0) {
    byBucket.set('Cash', portfolio.availableCash);
  }

  return [...byBucket.entries()]
    .map(([bucket, value]) => ({ bucket, value, pct: value / equity }))
    .sort((a, b) => b.value - a.value);
}

export async function getPortfolioAnalysis(env: TradingEnv): Promise<PortfolioAnalysis> {
  return cached(`portfolio-analysis:${env}`, TTL.PORTFOLIO, async () => {
    const disclaimer =
      'Automated, rule-based observations for information only — not financial advice.';
    const generatedAt = new Date().toISOString();

    let portfolio: PortfolioSummary;
    try {
      portfolio = await getPortfolio(env);
    } catch (err) {
      return {
        available: false,
        reason: `Could not load the live portfolio: ${(err as Error).message}`,
        generatedAt,
        currency: 'USD',
        equity: null,
        holdingsCount: 0,
        cashPct: null,
        score: null,
        checks: [],
        assetMix: [],
        disclaimer,
      } satisfies PortfolioAnalysis;
    }

    const [stats, income, assetMix] = await Promise.all([
      getAccountStats(env).catch(() => null),
      getIncomeReport(env).catch(() => null),
      buildAssetMix(portfolio),
    ]);

    const equity = portfolio.totalValue;
    const weighted: Weighted[] = portfolio.holdings.map((h) => ({
      symbol: h.symbol,
      instrumentId: h.instrumentId,
      value: h.value,
      weight: equity > 0 ? h.value / equity : 0,
      pnlPercent: h.pnlPercent,
      avgLeverage: h.avgLeverage,
      viaCopy: h.viaCopy,
    }));

    const checks: AnalysisCheck[] = [
      concentrationCheck(weighted),
      diversificationCheck(weighted, assetMix),
      cashCheck(portfolio.availableCash, equity),
      losersCheck(weighted, portfolio.accountCurrency),
      leverageCheck(weighted),
      feeCheck(income?.totals.fees ?? 0, stats?.allTimeProfit ?? null, portfolio.accountCurrency),
      riskCheck(stats),
    ];

    const score = checks.length
      ? Math.round(checks.reduce((s, c) => s + statusScore(c.status), 0) / checks.length)
      : null;

    return {
      available: true,
      generatedAt,
      currency: portfolio.accountCurrency,
      equity,
      holdingsCount: portfolio.holdings.length,
      cashPct: equity > 0 ? portfolio.availableCash / equity : null,
      score,
      checks,
      assetMix,
      disclaimer,
    } satisfies PortfolioAnalysis;
  });
}
