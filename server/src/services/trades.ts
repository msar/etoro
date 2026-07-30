import { cached, TTL } from '../cache.js';
import { getBootstrap } from '../bootstrap.js';
import { etoroFetch } from '../etoroClient.js';
import { isSchemaMissing, markSchemaMissing } from '../schemaState.js';
import { getSupabase, isSupabaseConfigured } from '../supabase.js';
import type { TradeHistoryItem, TradeHistoryResponse, TradingEnv } from '../etoroTypes.js';
import { resolveInstruments } from './instruments.js';

export interface EnrichedTrade extends TradeHistoryItem {
  symbol: string | null;
  instrumentName: string | null;
}

const PAGE_SIZE = 200;
const MAX_PAGES = 50;

async function getTradesFromSupabase(minDate: string): Promise<EnrichedTrade[] | null> {
  if (!isSupabaseConfigured() || isSchemaMissing()) return null;
  const boot = await getBootstrap();
  if (boot.gcid === null) return null;

  const sb = getSupabase();
  const { data, error } = await sb
    .from('closed_trades')
    .select('*')
    .eq('gcid', boot.gcid)
    .gte('close_timestamp', `${minDate}T00:00:00Z`)
    .order('close_timestamp', { ascending: false });

  if (error) {
    markSchemaMissing(error.message);
    console.warn('Supabase trades read failed, falling back to eToro:', error.message);
    return null;
  }
  if (!data?.length) return null;

  const rows = data as import('../supabase.js').ClosedTradeRow[];
  const items: TradeHistoryItem[] = rows.map((t) => ({
    positionId: t.position_id,
    instrumentId: t.instrument_id,
    isBuy: t.is_buy,
    leverage: t.leverage,
    openRate: t.open_rate,
    closeRate: t.close_rate,
    investment: t.investment,
    initialInvestment: t.investment,
    fees: t.fees,
    units: t.units,
    netProfit: t.net_profit,
    openTimestamp: t.open_timestamp,
    closeTimestamp: t.close_timestamp,
  }));

  const meta = await resolveInstruments(items.map((t) => t.instrumentId));
  return items.map((t) => ({
    ...t,
    symbol: meta.get(t.instrumentId)?.symbol ?? null,
    instrumentName: meta.get(t.instrumentId)?.name ?? null,
  }));
}

export async function getTradesFromEtoro(
  env: TradingEnv,
  minDate: string,
): Promise<EnrichedTrade[]> {
  const basePath =
    env === 'real' ? '/api/v1/trading/info/trade/history' : '/api/v1/trading/info/trade/demo/history';

  const items: TradeHistoryItem[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await etoroFetch<TradeHistoryResponse | TradeHistoryItem[]>(
      `${basePath}?minDate=${minDate}&page=${page}&pageSize=${PAGE_SIZE}`,
    );
    const batch = Array.isArray(res) ? res : (res?.items ?? []);
    items.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }

  const meta = await resolveInstruments(items.map((t) => t.instrumentId));
  return items
    .map((t) => ({
      ...t,
      symbol: meta.get(t.instrumentId)?.symbol ?? null,
      instrumentName: meta.get(t.instrumentId)?.name ?? null,
    }))
    .sort((a, b) => b.closeTimestamp.localeCompare(a.closeTimestamp));
}

/**
 * Prefer Supabase-stored closed trades when available; otherwise live eToro.
 * Sync always writes via getTradesFromEtoro so the DB stays fresh.
 */
export async function getTrades(env: TradingEnv, minDate: string): Promise<EnrichedTrade[]> {
  // During sync we always want live eToro — callers that need live should use
  // getTradesFromEtoro. For API reads, prefer the DB.
  const fromDb = await getTradesFromSupabase(minDate);
  if (fromDb) return fromDb;

  return cached(`trades:${env}:${minDate}`, TTL.HISTORY, () => getTradesFromEtoro(env, minDate));
}

/** Sum of realized net profit per close date (YYYY-MM-DD). */
export function realizedPnlByDay(trades: TradeHistoryItem[]): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const t of trades) {
    const day = t.closeTimestamp.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + (t.netProfit ?? 0));
  }
  return byDay;
}
