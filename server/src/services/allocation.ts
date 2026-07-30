import { cached, TTL } from '../cache.js';
import { EtoroForbiddenError } from '../errors.js';
import { etoroFetch } from '../etoroClient.js';
import type { AllocationHistoryResponse } from '../etoroTypes.js';

export interface AllocationDay {
  date: string;
  cashPct: number;
  assets: { symbol: string; investedPct: number; valuePct: number }[];
}

export interface AllocationHistory {
  available: boolean;
  reason?: string;
  days: AllocationDay[];
  symbols: string[];
}

export async function getAllocationHistory(
  username: string,
  minDate: string,
  maxDate: string,
): Promise<AllocationHistory> {
  return cached(`allocation:${username}:${minDate}:${maxDate}`, TTL.HISTORY, async () => {
    try {
      const res = await etoroFetch<AllocationHistoryResponse>(
        `/api/v2/portfolios/${encodeURIComponent(username)}/assets/history?minDate=${minDate}&maxDate=${maxDate}&count=200`,
      );
      const days: AllocationDay[] = (res.results ?? []).map((r) => ({
        date: r.date,
        cashPct: r.cashOfTotalEquityPct,
        assets: r.assets.map((a) => ({
          symbol: a.symbol,
          investedPct: a.investedPct,
          valuePct: a.valuePct,
        })),
      }));
      const symbols = [...new Set(days.flatMap((d) => d.assets.map((a) => a.symbol)))].sort();
      return { available: true, days, symbols };
    } catch (err) {
      if (err instanceof EtoroForbiddenError) {
        return {
          available: false,
          reason: 'Portfolio is not publicly visible (opted out of portfolio exposure).',
          days: [],
          symbols: [],
        };
      }
      throw err;
    }
  });
}
