import { cached, TTL } from '../cache.js';
import { getBootstrap } from '../bootstrap.js';
import { isSchemaMissing } from '../schemaState.js';
import { getSupabase, isSupabaseConfigured, selectAllRows, type DividendRow } from '../supabase.js';
import type { TradingEnv } from '../etoroTypes.js';
import { earliestStoredTradeDate, getTrades } from './trades.js';

export interface IncomeYear {
  year: string;
  dividendsNet: number;
  withholdingTax: number;
  dividendCount: number;
  fees: number;
  realizedProfit: number;
}

export interface IncomeReport {
  available: boolean;
  reason?: string;
  years: IncomeYear[];
  totals: {
    dividendsNet: number;
    withholdingTax: number;
    fees: number;
    realizedProfit: number;
  };
  topDividendPayers: { name: string; total: number }[];
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function readDividends(gcid: number): Promise<DividendRow[] | null> {
  const sb = getSupabase();
  const { rows, error } = await selectAllRows<DividendRow>((from, to) =>
    sb
      .from('dividends')
      .select('*')
      .eq('gcid', gcid)
      .order('pay_date', { ascending: true })
      .range(from, to),
  );
  if (error) {
    console.warn('Dividends read failed (run migration 002 if missing):', error);
    return null;
  }
  return rows;
}

/** Dividends, fees, and realized P&L bucketed per calendar year. */
export async function getIncomeReport(env: TradingEnv): Promise<IncomeReport> {
  return cached(`income:${env}`, TTL.HISTORY, async () => {
    const empty: IncomeReport = {
      available: false,
      years: [],
      totals: { dividendsNet: 0, withholdingTax: 0, fees: 0, realizedProfit: 0 },
      topDividendPayers: [],
    };

    if (!isSupabaseConfigured() || isSchemaMissing()) {
      return { ...empty, reason: 'Supabase history store is not configured.' };
    }
    const boot = await getBootstrap();
    if (boot.gcid === null) {
      return { ...empty, reason: 'Could not resolve the eToro account id.' };
    }

    const dividends = await readDividends(boot.gcid);

    const byYear = new Map<string, IncomeYear>();
    const yearOf = (date: string) => date.slice(0, 4);
    const bucket = (year: string): IncomeYear => {
      let b = byYear.get(year);
      if (!b) {
        b = {
          year,
          dividendsNet: 0,
          withholdingTax: 0,
          dividendCount: 0,
          fees: 0,
          realizedProfit: 0,
        };
        byYear.set(year, b);
      }
      return b;
    };

    const payers = new Map<string, number>();
    for (const d of dividends ?? []) {
      const b = bucket(yearOf(d.pay_date));
      b.dividendsNet += d.net_dividend_usd;
      b.withholdingTax += d.withholding_tax_usd;
      b.dividendCount += 1;
      const name = d.instrument_name ?? d.isin ?? 'Unknown';
      payers.set(name, (payers.get(name) ?? 0) + d.net_dividend_usd);
    }

    // Fees + realized P&L per year from stored closed trades.
    try {
      const from = (await earliestStoredTradeDate()) ?? isoDaysAgo(364);
      const trades = await getTrades(env, from);
      for (const t of trades) {
        const b = bucket(yearOf(t.closeTimestamp));
        b.fees += t.fees;
        b.realizedProfit += t.netProfit;
      }
    } catch (err) {
      console.warn('Trades unavailable for income report:', (err as Error).message);
    }

    const years = [...byYear.values()].sort((a, b) => b.year.localeCompare(a.year));
    const totals = years.reduce(
      (acc, y) => ({
        dividendsNet: acc.dividendsNet + y.dividendsNet,
        withholdingTax: acc.withholdingTax + y.withholdingTax,
        fees: acc.fees + y.fees,
        realizedProfit: acc.realizedProfit + y.realizedProfit,
      }),
      { dividendsNet: 0, withholdingTax: 0, fees: 0, realizedProfit: 0 },
    );

    return {
      available: years.length > 0,
      reason:
        years.length > 0
          ? undefined
          : dividends === null
            ? 'Dividends table missing — run migrations/002_symbols_dividends.sql, then import with the dividends CSV.'
            : 'No stored dividends or trades yet — run the statement import.',
      years,
      totals,
      topDividendPayers: [...payers.entries()]
        .map(([name, total]) => ({ name, total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10),
    };
  });
}
