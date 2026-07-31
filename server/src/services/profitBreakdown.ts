import { cached, TTL } from '../cache.js';
import type { TradingEnv } from '../etoroTypes.js';
import { getEquityHistory } from './balances.js';
import { getIncomeReport } from './income.js';
import { getInstrumentPerformance } from './instrumentPerformance.js';
import { getPortfolio, type PortfolioSummary } from './portfolio.js';

export interface ProfitComponent {
  key: 'realized' | 'dividends' | 'unrealized' | 'residual';
  label: string;
  amount: number;
  description: string;
}

export interface ProfitContributor {
  key: string;
  symbol: string | null;
  name: string | null;
  imageUrl: string | null;
  instrumentId: number;
  realized: number;
  unrealized: number;
  total: number;
  /** Still an open position right now */
  open: boolean;
}

export interface ProfitYearRow {
  year: string;
  realizedProfit: number;
  dividendsNet: number;
  fees: number;
}

export interface ProfitBreakdown {
  available: boolean;
  reason?: string;
  currency: string;
  since: string | null;
  currentEquity: number | null;
  totalDeposits: number;
  totalWithdrawals: number;
  netDeposits: number;
  /** equity − cumulative net deposits (same figure as the All-time profit stat) */
  allTimeProfit: number | null;
  /** Components sum exactly to allTimeProfit (residual absorbs the gap) */
  components: ProfitComponent[];
  /** Informational: fees already reflected inside realized P&L, not additive */
  feesTotal: number;
  winners: ProfitContributor[];
  losers: ProfitContributor[];
  years: ProfitYearRow[];
}

/**
 * Decompose "All-time profit" (equity − net deposits) into where the money
 * actually came from: realized closed-trade P&L, dividends, unrealized P&L on
 * open positions, and a residual that absorbs whatever the stored history
 * cannot attribute (FX drift, pre-import gaps, non-imported dividends).
 */
export async function getProfitBreakdown(env: TradingEnv): Promise<ProfitBreakdown> {
  return cached(`profit-breakdown:${env}`, TTL.HISTORY, async () => {
    const equity = await getEquityHistory(env);
    const last = equity.points.at(-1);

    const empty: ProfitBreakdown = {
      available: false,
      currency: equity.displayCurrency || 'USD',
      since: null,
      currentEquity: null,
      totalDeposits: equity.totalDepositsInWindow,
      totalWithdrawals: equity.totalWithdrawalsInWindow,
      netDeposits: equity.totalDepositsInWindow - equity.totalWithdrawalsInWindow,
      allTimeProfit: null,
      components: [],
      feesTotal: 0,
      winners: [],
      losers: [],
      years: [],
    };
    if (!last) return { ...empty, reason: 'No balance history stored yet — run a sync first.' };

    const allTimeProfit = last.total - last.cumulativeNetDeposits;

    let portfolio: PortfolioSummary | null = null;
    try {
      portfolio = await getPortfolio(env);
    } catch (err) {
      console.warn('Portfolio unavailable for profit breakdown:', (err as Error).message);
    }

    const [income, instrPerf] = await Promise.all([
      getIncomeReport(env).catch(() => null),
      getInstrumentPerformance(env).catch(() => null),
    ]);

    const realized = income?.totals.realizedProfit ?? instrPerf?.totalRealizedProfit ?? 0;
    const dividends = income?.totals.dividendsNet ?? 0;
    const feesTotal = income?.totals.fees ?? 0;
    const unrealized = portfolio?.currentPnl ?? 0;
    const residual = allTimeProfit - realized - dividends - unrealized;

    const components: ProfitComponent[] = [
      {
        key: 'realized',
        label: 'Realized P&L',
        amount: realized,
        description: 'Net profit from every closed trade in the stored history (fees already deducted).',
      },
      {
        key: 'dividends',
        label: 'Dividends (net)',
        amount: dividends,
        description: 'Cash dividends received, net of withholding tax (from the imported dividends statement).',
      },
      {
        key: 'unrealized',
        label: 'Unrealized P&L',
        amount: unrealized,
        description: 'Paper profit on positions currently open — moves with the market until you close them.',
      },
      {
        key: 'residual',
        label: 'Unattributed',
        amount: residual,
        description:
          'The remainder: FX conversion drift, trades or dividends outside the stored history, and rounding. A large value usually means older statements have not been imported.',
      },
    ];

    // Merge realized (per instrument, closed trades) with unrealized (open holdings).
    interface Acc {
      symbol: string | null;
      name: string | null;
      imageUrl: string | null;
      instrumentId: number;
      realized: number;
      unrealized: number;
      open: boolean;
    }
    const byKey = new Map<string, Acc>();
    const keyFor = (instrumentId: number, symbol: string | null) =>
      symbol ?? (instrumentId > 0 ? `#${instrumentId}` : 'unknown');

    for (const item of instrPerf?.items ?? []) {
      byKey.set(item.key, {
        symbol: item.symbol,
        name: item.name,
        imageUrl: null,
        instrumentId: item.instrumentId,
        realized: item.realizedProfit,
        unrealized: 0,
        open: false,
      });
    }
    for (const h of portfolio?.holdings ?? []) {
      const key = keyFor(h.instrumentId, h.symbol);
      const acc = byKey.get(key);
      if (acc) {
        acc.unrealized += h.pnl;
        acc.open = true;
        if (!acc.imageUrl) acc.imageUrl = h.imageUrl;
        if (!acc.name) acc.name = h.name;
      } else {
        byKey.set(key, {
          symbol: h.symbol,
          name: h.name,
          imageUrl: h.imageUrl,
          instrumentId: h.instrumentId,
          realized: 0,
          unrealized: h.pnl,
          open: true,
        });
      }
    }

    const contributors: ProfitContributor[] = [...byKey.entries()].map(([key, a]) => ({
      key,
      symbol: a.symbol,
      name: a.name,
      imageUrl: a.imageUrl,
      instrumentId: a.instrumentId,
      realized: a.realized,
      unrealized: a.unrealized,
      total: a.realized + a.unrealized,
      open: a.open,
    }));

    const winners = contributors
      .filter((c) => c.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
    const losers = contributors
      .filter((c) => c.total < 0)
      .sort((a, b) => a.total - b.total)
      .slice(0, 8);

    const years: ProfitYearRow[] = (income?.years ?? [])
      .map((y) => ({
        year: y.year,
        realizedProfit: y.realizedProfit,
        dividendsNet: y.dividendsNet,
        fees: y.fees,
      }))
      .sort((a, b) => b.year.localeCompare(a.year));

    return {
      available: true,
      currency: portfolio?.accountCurrency ?? equity.displayCurrency ?? 'USD',
      since: equity.points[0]?.date ?? null,
      currentEquity: last.total,
      totalDeposits: equity.totalDepositsInWindow,
      totalWithdrawals: equity.totalWithdrawalsInWindow,
      netDeposits: equity.totalDepositsInWindow - equity.totalWithdrawalsInWindow,
      allTimeProfit,
      components,
      feesTotal,
      winners,
      losers,
      years,
    };
  });
}
