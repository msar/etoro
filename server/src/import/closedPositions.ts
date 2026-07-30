import type { ClosedTradeRow } from '../supabase.js';
import {
  extractSymbol,
  iterateCsv,
  parseEtoroDateTime,
  parseNum,
  toIsoTimestamp,
} from './csvUtil.js';

export interface ParsedClosedPosition {
  positionId: number;
  symbol: string;
  isin: string | null;
  isBuy: boolean;
  leverage: number;
  openRate: number;
  closeRate: number;
  investment: number;
  fees: number;
  units: number;
  netProfit: number;
  openTimestamp: string;
  closeTimestamp: string;
}

/**
 * Parse Closed Positions sheet into trade rows (without instrument_id yet).
 */
export async function parseClosedPositions(
  csvPath: string,
): Promise<ParsedClosedPosition[]> {
  const out: ParsedClosedPosition[] = [];

  for await (const row of iterateCsv(csvPath)) {
    const positionId = Math.trunc(parseNum(row['ID de posición']));
    if (!positionId) continue;

    const openDt = parseEtoroDateTime(row['Fecha de apertura']);
    const closeDt = parseEtoroDateTime(row['Fecha de cierre']);
    if (!openDt || !closeDt) continue;

    const side = (row['Long / Short'] || '').trim().toLowerCase();
    const isBuy = side !== 'short';

    const spreadFee = parseNum(row['Comisiones de diferencial (USD)']);
    const overnightDiv = parseNum(row['Comisiones nocturnas y dividendos']);
    // Fees column in our schema is a single number; blend spread + overnight.
    // Overnight/dividends in the statement can be net of dividend credits.
    const fees = spreadFee + Math.abs(Math.min(0, overnightDiv));

    const isinRaw = (row['ISIN'] || '').trim();
    const isin = isinRaw && isinRaw !== '-' ? isinRaw : null;

    out.push({
      positionId,
      symbol: extractSymbol(row['Acción'] || ''),
      isin,
      isBuy,
      leverage: Math.max(1, Math.trunc(parseNum(row['Apalancamiento'])) || 1),
      openRate: parseNum(row['Tasa de apertura']),
      closeRate: parseNum(row['Tasa de cierre']),
      investment: parseNum(row['Importe']),
      fees,
      units: parseNum(row['Unidades']),
      netProfit: parseNum(row['Ganancias (USD)']),
      openTimestamp: toIsoTimestamp(openDt),
      closeTimestamp: toIsoTimestamp(closeDt),
    });
  }

  return out;
}

export function toClosedTradeRows(
  gcid: number,
  parsed: ParsedClosedPosition[],
  instrumentByPosition: Map<number, number>,
  instrumentBySymbol: Map<string, number>,
): ClosedTradeRow[] {
  return parsed.map((t) => {
    const fromPos = instrumentByPosition.get(t.positionId);
    const fromSym = instrumentBySymbol.get(t.symbol.toUpperCase());
    return {
      gcid,
      position_id: t.positionId,
      instrument_id: fromPos && fromPos > 0 ? fromPos : fromSym && fromSym > 0 ? fromSym : 0,
      is_buy: t.isBuy,
      leverage: t.leverage,
      open_rate: t.openRate,
      close_rate: t.closeRate,
      investment: t.investment,
      fees: t.fees,
      units: t.units,
      net_profit: t.netProfit,
      open_timestamp: t.openTimestamp,
      close_timestamp: t.closeTimestamp,
      symbol: t.symbol || null,
    };
  });
}
