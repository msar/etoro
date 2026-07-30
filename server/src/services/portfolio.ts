import { cached, TTL } from '../cache.js';
import { etoroFetch } from '../etoroClient.js';
import type { AggregatePortfolioResponse, InstrumentAggregate, TradingEnv } from '../etoroTypes.js';
import { resolveInstruments } from './instruments.js';

export interface Holding {
  instrumentId: number;
  symbol: string | null;
  name: string | null;
  imageUrl: string | null;
  invested: number;
  value: number;
  pnl: number;
  pnlPercent: number;
  netUnits: number;
  avgLeverage: number;
  avgOpenRate: number;
  /** Blended fees − dividends figure; NOT separable per eToro API */
  feesNetOfDividends: number;
  viaCopy: boolean;
}

export interface PortfolioSummary {
  accountCurrency: string;
  timestamp: string;
  availableCash: number;
  totalValue: number;
  totalUsedMargin: number;
  currentPnl: number;
  holdings: Holding[];
  mirrors: {
    mirrorId: number;
    netFunding: number;
    positionsPnl: number;
    liquidationValue: number;
    pnlPercent: number;
  }[];
}

function toHolding(
  agg: InstrumentAggregate,
  meta: Map<number, { symbol: string; name: string; imageUrl: string | null }>,
  viaCopy: boolean,
): Holding {
  const m = meta.get(agg.instrumentId);
  return {
    instrumentId: agg.instrumentId,
    symbol: m?.symbol ?? null,
    name: m?.name ?? null,
    imageUrl: m?.imageUrl ?? null,
    invested: agg.totalMarginAccountCurrency,
    value: agg.liquidationValueAccountCurrency,
    pnl: agg.accountCurrencyReturn,
    pnlPercent: agg.accountCurrencyRoePercent,
    netUnits: agg.netUnits,
    avgLeverage: agg.avgLeverage,
    avgOpenRate: agg.avgOpenRate,
    feesNetOfDividends: agg.totalFeesAcctCcy,
    viaCopy,
  };
}

export async function getPortfolio(env: TradingEnv): Promise<PortfolioSummary> {
  return cached(`portfolio:${env}`, TTL.PORTFOLIO, async () => {
    const path =
      env === 'real'
        ? '/api/v1/trading/info/aggregate-portfolio'
        : '/api/v1/trading/info/demo/aggregate-portfolio';
    const res = await etoroFetch<AggregatePortfolioResponse>(path);

    const directAggs = res.instrumentAggregates ?? [];
    const mirrorAggs = (res.mirrors ?? []).flatMap((m) => m.instrumentAggregates ?? []);
    const ids = [...directAggs, ...mirrorAggs].map((a) => a.instrumentId);
    const metaMap = await resolveInstruments(ids);
    const meta = new Map(
      [...metaMap.entries()].map(([id, info]) => [
        id,
        { symbol: info.symbol, name: info.name, imageUrl: info.imageUrl },
      ]),
    );

    const holdings = [
      ...directAggs.map((a) => toHolding(a, meta, false)),
      ...mirrorAggs.map((a) => toHolding(a, meta, true)),
    ].sort((a, b) => b.value - a.value);

    return {
      accountCurrency: res.accountCurrency,
      timestamp: res.timestamp,
      availableCash: res.accountTotals.accountAvailableCash,
      totalValue: res.accountTotals.accountTotalValue,
      totalUsedMargin: res.accountTotals.accountTotalUsedMargin,
      currentPnl: res.accountTotals.accountCurrentPnl,
      holdings,
      mirrors: (res.mirrors ?? []).map((m) => ({
        mirrorId: m.mirrorId,
        netFunding: m.mirrorTotals.mirrorNetFunding,
        positionsPnl: m.mirrorTotals.mirrorPositionsPnl,
        liquidationValue: m.mirrorTotals.mirrorLiquidationValue,
        pnlPercent: m.mirrorTotals.mirrorPositionsPnlPercent,
      })),
    };
  });
}
