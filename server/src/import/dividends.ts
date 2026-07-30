import type { DividendRow } from '../supabase.js';
import { iterateCsv, parseEtoroDateTime, parseNum, toIsoDate } from './csvUtil.js';

/**
 * Parse the Dividends sheet. Multiple payouts for the same position on the
 * same pay date are summed (matches the (gcid, position_id, pay_date) PK).
 */
export async function parseDividends(csvPath: string, gcid: number): Promise<DividendRow[]> {
  const byKey = new Map<string, DividendRow>();

  for await (const row of iterateCsv(csvPath)) {
    const payDt = parseEtoroDateTime(row['Fecha de pago']);
    const positionId = Math.trunc(parseNum(row['ID de posición']));
    if (!payDt || !positionId) continue;

    const payDate = toIsoDate(payDt);
    const isinRaw = (row['ISIN'] || '').trim();
    const rateRaw = (row['Tasa de retención fiscal (%)'] || '').replace('%', '');

    const entry: DividendRow = {
      gcid,
      position_id: positionId,
      pay_date: payDate,
      instrument_name: (row['Nombre del instrumento'] || '').trim() || null,
      isin: isinRaw && isinRaw !== '-' ? isinRaw : null,
      net_dividend_usd: parseNum(row['Dividendo neto recibido (USD)']),
      withholding_tax_usd: parseNum(row['Importe de la retención tributaria (USD)']),
      withholding_tax_rate: parseNum(rateRaw) / 100,
      asset_type: (row['Tipo'] || '').trim() || null,
    };

    const key = `${positionId}|${payDate}`;
    const prev = byKey.get(key);
    if (prev) {
      prev.net_dividend_usd += entry.net_dividend_usd;
      prev.withholding_tax_usd += entry.withholding_tax_usd;
    } else {
      byKey.set(key, entry);
    }
  }

  return [...byKey.values()];
}
