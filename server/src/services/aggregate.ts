/**
 * Cross-broker aggregation in a selectable display currency (EUR or USD).
 */

import { getBootstrap } from '../bootstrap.js';
import { getBrokersStatus, getCredentialsStatus } from '../credentialsService.js';
import { getSupabase, isSupabaseConfigured, selectAllRows } from '../supabase.js';
import { getAbnOverview, getAbnPerformance } from './abnamro.js';
import { getEquityHistory } from './balances.js';
import { getEtradeBrokerCardStats } from './etrade.js';
import { getKrakenBrokerCardStats, getKrakenPerformance } from './kraken.js';
import { convertSeries, ensureFxRates } from './fx.js';
import {
  getBestPerformance,
  type Granularity,
  type PerformanceSeries,
} from './performance.js';
import type { BrokerId } from '../brokers.js';

export type DisplayCurrency = 'EUR' | 'USD';

export const DISPLAY_CURRENCIES: DisplayCurrency[] = ['EUR', 'USD'];

export function isDisplayCurrency(v: string): v is DisplayCurrency {
  return DISPLAY_CURRENCIES.includes(v as DisplayCurrency);
}

export interface BrokerCard {
  broker: string;
  displayName: string;
  currency: string;
  accountId: string | null;
  valueNative: number | null;
  /** Value in the aggregate display currency */
  value: number | null;
  gainPct: number | null;
  available: boolean;
  href: string;
  placeholder?: boolean;
  /** equity = portfolio MV; realized = closed G&L only (no MV) */
  kind?: 'equity' | 'realized';
  realizedGainNative?: number | null;
  /** Realized G/L in the aggregate display currency */
  realizedGain?: number | null;
}

export interface AggregateOverview {
  currency: DisplayCurrency;
  totalValue: number;
  brokers: BrokerCard[];
  enabledBrokers: BrokerId[];
  equity: {
    date: string;
    total: number;
    byBroker: Record<string, number>;
  }[];
  performance: PerformanceSeries;
}

function forwardFill(
  sparse: { date: string; value: number }[],
  allDates: string[],
): Map<string, number> {
  const out = new Map<string, number>();
  let last = 0;
  let i = 0;
  const sorted = [...sparse].sort((a, b) => a.date.localeCompare(b.date));
  for (const d of allDates) {
    while (i < sorted.length && sorted[i].date <= d) {
      last = sorted[i].value;
      i++;
    }
    if (i > 0 || (sorted.length && sorted[0].date <= d)) {
      out.set(d, last);
    } else {
      out.set(d, 0);
    }
  }
  return out;
}

async function seriesToDisplay(
  points: { date: string; value: number }[],
  fromCurrency: string,
  display: DisplayCurrency,
): Promise<{ date: string; value: number }[]> {
  if (!points.length) return [];
  const converted = await convertSeries(points, fromCurrency, display);
  return converted.map((p) => ({ date: p.date, value: p.value }));
}

async function etoroSeries(
  display: DisplayCurrency,
): Promise<{
  card: BrokerCard;
  points: { date: string; value: number }[];
  performance: PerformanceSeries | null;
}> {
  const status = getCredentialsStatus();
  const emptyCard: BrokerCard = {
    broker: 'etoro',
    displayName: 'eToro',
    currency: 'USD',
    accountId: null,
    valueNative: null,
    value: null,
    gainPct: null,
    available: false,
    href: '/etoro',
  };

  if (!status.etoroConfigured) {
    return { card: emptyCard, points: [], performance: null };
  }

  try {
    const boot = await getBootstrap();
    const equity = await getEquityHistory(boot.environment);
    const nativeCcy = equity.displayCurrency || 'USD';
    const nativePoints = equity.points.map((p) => ({ date: p.date, value: p.total }));
    const converted = await seriesToDisplay(nativePoints, nativeCcy, display);
    const latestNative = nativePoints[nativePoints.length - 1]?.value ?? null;
    const latest = converted[converted.length - 1]?.value ?? null;

    let gainPct: number | null = null;
    let performance: PerformanceSeries | null = null;
    try {
      performance = await getBestPerformance(
        boot.username,
        boot.environment,
        'monthly',
      );
      gainPct = performance.totalGain;
    } catch {
      // ignore
    }

    return {
      card: {
        broker: 'etoro',
        displayName: boot.username ? `eToro (@${boot.username})` : 'eToro',
        currency: nativeCcy,
        accountId: boot.gcid != null ? String(boot.gcid) : null,
        valueNative: latestNative,
        value: latest,
        gainPct,
        available: nativePoints.length > 0,
        href: '/etoro',
        kind: 'equity',
      },
      points: converted,
      performance,
    };
  } catch (err) {
    console.warn('eToro aggregate unavailable:', (err as Error).message);
    return { card: emptyCard, points: [], performance: null };
  }
}

async function abnSeries(
  display: DisplayCurrency,
): Promise<{
  card: BrokerCard;
  points: { date: string; value: number }[];
  performance: PerformanceSeries | null;
}> {
  const emptyCard: BrokerCard = {
    broker: 'abnamro',
    displayName: 'ABN AMRO Guided Investing',
    currency: 'EUR',
    accountId: null,
    valueNative: null,
    value: null,
    gainPct: null,
    available: false,
    href: '/abnamro',
  };

  try {
    const overview = await getAbnOverview();
    if (!overview.available) {
      return { card: emptyCard, points: [], performance: null };
    }
    const nativePoints = overview.snapshots.map((s) => ({ date: s.date, value: s.total }));
    const points = await seriesToDisplay(nativePoints, 'EUR', display);
    const latestNative = overview.currentValue;
    const latest = points[points.length - 1]?.value ?? null;

    let performance: PerformanceSeries | null = null;
    try {
      performance = await getAbnPerformance('monthly');
    } catch {
      // ignore
    }
    return {
      card: {
        broker: 'abnamro',
        displayName: 'ABN AMRO Guided Investing',
        currency: 'EUR',
        accountId: overview.accountId,
        valueNative: latestNative,
        value: latest,
        gainPct: overview.allTimeGainPct,
        available: true,
        href: '/abnamro',
        kind: 'equity',
      },
      points,
      performance,
    };
  } catch (err) {
    console.warn('ABN AMRO aggregate unavailable:', (err as Error).message);
    return { card: emptyCard, points: [], performance: null };
  }
}

async function krakenSeries(
  display: DisplayCurrency,
): Promise<{
  card: BrokerCard;
  points: { date: string; value: number }[];
  performance: PerformanceSeries | null;
  snapshots: { date: string; total: number; netFlow: number }[];
}> {
  const emptyCard: BrokerCard = {
    broker: 'kraken',
    displayName: 'Kraken',
    currency: 'USD',
    accountId: null,
    valueNative: null,
    value: null,
    gainPct: null,
    available: false,
    href: '/kraken',
  };

  try {
    const stats = await getKrakenBrokerCardStats();
    if (!stats.available) {
      return { card: emptyCard, points: [], performance: null, snapshots: [] };
    }

    let points: { date: string; value: number }[] = [];
    if (stats.snapshots.length) {
      points = await seriesToDisplay(
        stats.snapshots.map((s) => ({ date: s.date, value: s.total })),
        'USD',
        display,
      );
    }

    let value: number | null = display === 'EUR' ? stats.valueEur : stats.valueNative;

    let performance: PerformanceSeries | null = null;
    try {
      performance = await getKrakenPerformance('monthly');
    } catch {
      // ignore
    }

    return {
      card: {
        broker: 'kraken',
        displayName: 'Kraken',
        currency: 'USD',
        accountId: stats.accountId,
        valueNative: stats.valueNative,
        value,
        gainPct: stats.gainPct,
        available: true,
        href: '/kraken',
        kind: 'equity',
      },
      points,
      performance,
      snapshots: stats.snapshots,
    };
  } catch (err) {
    console.warn('Kraken aggregate unavailable:', (err as Error).message);
    return { card: emptyCard, points: [], performance: null, snapshots: [] };
  }
}

/**
 * Combined TWR across brokers using equity + net flows in the display currency.
 * For sparse brokers we forward-fill value; net flows only on statement/snapshot days.
 */
async function combinedPerformance(
  brokerSeries: { broker: string; currency: string; points: { date: string; total: number; netFlow: number }[] }[],
  granularity: Granularity,
  display: DisplayCurrency,
): Promise<PerformanceSeries> {
  const convertedSeries: { date: string; total: number; netFlow: number }[][] = [];

  for (const series of brokerSeries) {
    if (!series.points.length) continue;
    const dates = series.points.map((p) => p.date);
    const from = dates[0];
    const to = dates[dates.length - 1];
    const rates =
      series.currency.toUpperCase() === display
        ? null
        : await ensureFxRates(series.currency, display, from, to);

    convertedSeries.push(
      series.points.map((p) => {
        const rate =
          series.currency.toUpperCase() === display ? 1 : (rates?.get(p.date) ?? 1);
        return {
          date: p.date,
          total: p.total * rate,
          netFlow: p.netFlow * rate,
        };
      }),
    );
  }

  if (!convertedSeries.length) {
    return { granularity, points: [], totalGain: null, source: 'derived' };
  }

  const allDates = [
    ...new Set(convertedSeries.flatMap((s) => s.map((p) => p.date))),
  ].sort();

  const filled = convertedSeries.map((s) => {
    const totalMap = forwardFill(
      s.map((p) => ({ date: p.date, value: p.total })),
      allDates,
    );
    const flowMap = new Map(s.map((p) => [p.date, p.netFlow]));
    return allDates.map((d) => ({
      date: d,
      total: totalMap.get(d) ?? 0,
      netFlow: flowMap.get(d) ?? 0,
    }));
  });

  const combined = allDates.map((d, idx) => {
    let total = 0;
    let netFlow = 0;
    for (const s of filled) {
      total += s[idx].total;
      netFlow += s[idx].netFlow;
    }
    return { date: d, total, netFlow };
  });

  const daily: { date: string; gain: number }[] = [];
  for (let i = 1; i < combined.length; i++) {
    const prev = combined[i - 1];
    const cur = combined[i];
    const base = prev.total + cur.netFlow;
    if (base <= 0) continue;
    const gain = (cur.total - prev.total - cur.netFlow) / base;
    if (Math.abs(gain) < 1e-12 && cur.netFlow === 0) continue;
    daily.push({ date: cur.date, gain });
  }

  const bucketOf = (date: string): string => {
    if (granularity === 'yearly') return date.slice(0, 4);
    if (granularity === 'monthly') return date.slice(0, 7);
    if (granularity === 'weekly') {
      const d = new Date(`${date}T00:00:00Z`);
      const day = d.getUTCDay();
      const offset = day === 0 ? -6 : 1 - day;
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() + offset);
      return monday.toISOString().slice(0, 10);
    }
    return date;
  };
  const bucketDate = (bucket: string): string => {
    if (granularity === 'daily') return bucket;
    if (granularity === 'weekly') {
      const monday = new Date(`${bucket}T00:00:00Z`);
      monday.setUTCDate(monday.getUTCDate() + 6);
      return monday.toISOString().slice(0, 10);
    }
    if (granularity === 'monthly') return `${bucket}-01`;
    return `${bucket}-01-01`;
  };

  const buckets = new Map<string, number>();
  for (const d of daily) {
    const b = bucketOf(d.date);
    buckets.set(b, (buckets.get(b) ?? 1) * (1 + d.gain));
  }

  let compound = 1;
  const points = [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([bucket, factor]) => {
      compound *= factor;
      return {
        date: bucketDate(bucket),
        gain: factor - 1,
        cumulativeGain: compound - 1,
      };
    });

  return {
    granularity,
    points,
    totalGain: points.length ? compound - 1 : null,
    source: 'derived',
  };
}

export async function getAggregateOverview(
  granularity: Granularity = 'monthly',
  display: DisplayCurrency = 'EUR',
): Promise<AggregateOverview> {
  const brokersStatus = await getBrokersStatus();
  const enabled = new Set(brokersStatus.enabled);

  const needEtoro = enabled.has('etoro');
  const needAbn = enabled.has('abnamro');
  const needEtrade = enabled.has('etrade');
  const needKraken = enabled.has('kraken');

  const [etoro, abn, etradeStats, kraken] = await Promise.all([
    needEtoro
      ? etoroSeries(display)
      : Promise.resolve({
          card: null as BrokerCard | null,
          points: [] as { date: string; value: number }[],
          performance: null as PerformanceSeries | null,
        }),
    needAbn
      ? abnSeries(display)
      : Promise.resolve({
          card: null as BrokerCard | null,
          points: [] as { date: string; value: number }[],
          performance: null as PerformanceSeries | null,
        }),
    needEtrade
      ? getEtradeBrokerCardStats().catch((err) => {
          console.warn('E*TRADE aggregate card unavailable:', (err as Error).message);
          return {
            available: false,
            kind: 'realized' as const,
            accountId: null,
            currency: 'USD' as const,
            valueNative: null,
            valueEur: null,
            gainPct: null,
            totalAdjustedGainUsd: 0,
            returnOnCost: null,
            totalAdjustedGainEur: null,
            snapshots: [] as { date: string; total: number; netFlow: number }[],
          };
        })
      : Promise.resolve(null),
    needKraken
      ? krakenSeries(display)
      : Promise.resolve({
          card: null as BrokerCard | null,
          points: [] as { date: string; value: number }[],
          performance: null as PerformanceSeries | null,
          snapshots: [] as { date: string; total: number; netFlow: number }[],
        }),
  ]);

  const brokers: BrokerCard[] = [];

  if (needEtoro && etoro.card) brokers.push(etoro.card);

  if (needAbn && abn.card) brokers.push(abn.card);

  if (needEtrade && etradeStats) {
    const etradeCard: BrokerCard =
      etradeStats.available && etradeStats.kind === 'equity'
        ? {
            broker: 'etrade',
            displayName: 'E*TRADE',
            currency: 'USD',
            accountId: etradeStats.accountId,
            valueNative: etradeStats.valueNative,
            value:
              display === 'EUR'
                ? etradeStats.valueEur
                : etradeStats.valueNative,
            gainPct: etradeStats.gainPct,
            available: true,
            href: '/etrade',
            kind: 'equity',
          }
        : {
            broker: 'etrade',
            displayName: 'E*TRADE',
            currency: 'USD',
            accountId: etradeStats.accountId,
            valueNative: null,
            value: null,
            gainPct: etradeStats.returnOnCost,
            available: etradeStats.available,
            href: '/etrade',
            kind: 'realized',
            realizedGainNative: etradeStats.available
              ? etradeStats.totalAdjustedGainUsd
              : null,
            realizedGain: etradeStats.available
              ? display === 'EUR'
                ? etradeStats.totalAdjustedGainEur
                : etradeStats.totalAdjustedGainUsd
              : null,
          };
    brokers.push(etradeCard);
  }

  if (needKraken && kraken.card) brokers.push(kraken.card);

  const etradeCard = brokers.find((b) => b.broker === 'etrade');
  const etradeEquityPoints =
    etradeStats && etradeStats.kind === 'equity' && etradeStats.snapshots.length
      ? await seriesToDisplay(
          etradeStats.snapshots.map((s) => ({ date: s.date, value: s.total })),
          'USD',
          display,
        ).catch((err) => {
          console.warn('E*TRADE equity FX series failed:', (err as Error).message);
          return etradeStats.snapshots.map((s) => ({ date: s.date, value: s.total }));
        })
      : [];

  const totalValue = brokers.reduce((sum, b) => {
    if (!b.available) return sum;
    if (b.kind === 'realized') return sum;
    return sum + (b.value ?? 0);
  }, 0);

  const allDates = [
    ...new Set([
      ...etoro.points.map((p) => p.date),
      ...abn.points.map((p) => p.date),
      ...etradeEquityPoints.map((p) => p.date),
      ...kraken.points.map((p) => p.date),
    ]),
  ].sort();

  const etoroFilled = forwardFill(etoro.points, allDates);
  const abnFilled = forwardFill(abn.points, allDates);
  const etradeFilled = forwardFill(etradeEquityPoints, allDates);
  const krakenFilled = forwardFill(kraken.points, allDates);

  const equity = allDates.map((date) => {
    const byBroker: Record<string, number> = {};
    if (etoro.card?.available) byBroker.etoro = etoroFilled.get(date) ?? 0;
    if (abn.card?.available) byBroker.abnamro = abnFilled.get(date) ?? 0;
    if (etradeCard?.kind === 'equity' && etradeCard.available) {
      byBroker.etrade = etradeFilled.get(date) ?? 0;
    }
    if (kraken.card?.available) byBroker.kraken = krakenFilled.get(date) ?? 0;
    const total = Object.values(byBroker).reduce((a, b) => a + b, 0);
    return { date, total, byBroker };
  });

  const brokerNative: {
    broker: string;
    currency: string;
    points: { date: string; total: number; netFlow: number }[];
  }[] = [];

  if (etoro.card?.available) {
    try {
      const boot = await getBootstrap();
      const eq = await getEquityHistory(boot.environment);
      brokerNative.push({
        broker: 'etoro',
        currency: eq.displayCurrency || 'USD',
        points: eq.points.map((p) => ({
          date: p.date,
          total: p.total,
          netFlow: p.netFlow,
        })),
      });
    } catch {
      // skip
    }
  }

  if (abn.card?.available) {
    const overview = await getAbnOverview();
    brokerNative.push({
      broker: 'abnamro',
      currency: 'EUR',
      points: overview.snapshots.map((s) => ({
        date: s.date,
        total: s.total,
        netFlow: s.netFlow,
      })),
    });
  }

  if (etradeCard?.kind === 'equity' && etradeStats?.snapshots.length) {
    brokerNative.push({
      broker: 'etrade',
      currency: 'USD',
      points: etradeStats.snapshots.map((s) => ({
        date: s.date,
        total: s.total,
        netFlow: s.netFlow,
      })),
    });
  }

  if (kraken.card?.available && kraken.snapshots.length) {
    brokerNative.push({
      broker: 'kraken',
      currency: 'USD',
      points: kraken.snapshots.map((s) => ({
        date: s.date,
        total: s.total,
        netFlow: s.netFlow,
      })),
    });
  }

  const performance = await combinedPerformance(brokerNative, granularity, display);

  return {
    currency: display,
    totalValue,
    brokers,
    enabledBrokers: brokersStatus.enabled,
    equity,
    performance,
  };
}

/** List broker_accounts for diagnostics. */
export async function listBrokerAccounts(): Promise<
  { id: string; broker: string; displayName: string | null; currency: string }[]
> {
  if (!isSupabaseConfigured()) return [];
  const sb = getSupabase();
  const { rows } = await selectAllRows<{
    id: string;
    broker: string;
    display_name: string | null;
    currency: string;
  }>((from, to) =>
    sb
      .from('broker_accounts')
      .select('id, broker, display_name, currency')
      .order('broker')
      .range(from, to),
  );
  return rows.map((r) => ({
    id: r.id,
    broker: r.broker,
    displayName: r.display_name,
    currency: r.currency,
  }));
}
