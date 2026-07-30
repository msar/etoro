import { cached, TTL } from '../cache.js';
import type { TradingEnv } from '../etoroTypes.js';
import { earliestStoredTradeDate, getTrades } from './trades.js';

export interface InstrumentPerformance {
  key: string; // symbol, or `#instrumentId` when unresolved
  symbol: string | null;
  name: string | null;
  instrumentId: number; // 0 when unknown
  trades: number;
  realizedProfit: number;
  totalInvested: number;
  totalFees: number;
  winRate: number; // 0..1
  avgHoldingDays: number;
  returnOnInvested: number; // realizedProfit / totalInvested
  firstClose: string;
  lastClose: string;
}

export interface InstrumentPerformanceReport {
  since: string | null;
  totalTrades: number;
  totalRealizedProfit: number;
  items: InstrumentPerformance[];
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** All-time realized performance per instrument, from stored closed trades. */
export async function getInstrumentPerformance(
  env: TradingEnv,
): Promise<InstrumentPerformanceReport> {
  return cached(`instrument-performance:${env}`, TTL.HISTORY, async () => {
    const from = (await earliestStoredTradeDate()) ?? isoDaysAgo(364);
    const trades = await getTrades(env, from);

    interface Acc {
      symbol: string | null;
      name: string | null;
      instrumentId: number;
      trades: number;
      wins: number;
      realizedProfit: number;
      totalInvested: number;
      totalFees: number;
      holdingDaysSum: number;
      firstClose: string;
      lastClose: string;
    }

    const byKey = new Map<string, Acc>();
    for (const t of trades) {
      const key = t.symbol ?? (t.instrumentId > 0 ? `#${t.instrumentId}` : 'unknown');
      let acc = byKey.get(key);
      if (!acc) {
        acc = {
          symbol: t.symbol,
          name: t.instrumentName,
          instrumentId: t.instrumentId,
          trades: 0,
          wins: 0,
          realizedProfit: 0,
          totalInvested: 0,
          totalFees: 0,
          holdingDaysSum: 0,
          firstClose: t.closeTimestamp,
          lastClose: t.closeTimestamp,
        };
        byKey.set(key, acc);
      }
      acc.trades += 1;
      if (t.netProfit > 0) acc.wins += 1;
      acc.realizedProfit += t.netProfit;
      acc.totalInvested += t.investment;
      acc.totalFees += t.fees;
      acc.holdingDaysSum += Math.max(
        0,
        (Date.parse(t.closeTimestamp) - Date.parse(t.openTimestamp)) / 86_400_000,
      );
      if (t.closeTimestamp < acc.firstClose) acc.firstClose = t.closeTimestamp;
      if (t.closeTimestamp > acc.lastClose) acc.lastClose = t.closeTimestamp;
      if (!acc.name && t.instrumentName) acc.name = t.instrumentName;
      if (acc.instrumentId === 0 && t.instrumentId > 0) acc.instrumentId = t.instrumentId;
    }

    const items: InstrumentPerformance[] = [...byKey.entries()]
      .map(([key, a]) => ({
        key,
        symbol: a.symbol,
        name: a.name,
        instrumentId: a.instrumentId,
        trades: a.trades,
        realizedProfit: a.realizedProfit,
        totalInvested: a.totalInvested,
        totalFees: a.totalFees,
        winRate: a.trades ? a.wins / a.trades : 0,
        avgHoldingDays: a.trades ? a.holdingDaysSum / a.trades : 0,
        returnOnInvested: a.totalInvested > 0 ? a.realizedProfit / a.totalInvested : 0,
        firstClose: a.firstClose.slice(0, 10),
        lastClose: a.lastClose.slice(0, 10),
      }))
      .sort((x, y) => y.realizedProfit - x.realizedProfit);

    return {
      since: trades.length ? trades[trades.length - 1].closeTimestamp.slice(0, 10) : null,
      totalTrades: trades.length,
      totalRealizedProfit: items.reduce((s, i) => s + i.realizedProfit, 0),
      items,
    };
  });
}
