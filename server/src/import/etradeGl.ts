/**
 * Parse E*TRADE Gains & Losses Expanded XLSX/CSV exports.
 * Prefer Adjusted Cost Basis / Adjusted Gain/Loss (RSU ordinary income in basis).
 */

import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';

export interface EtradeLot {
  lotKey: string;
  symbol: string;
  quantity: number;
  dateAcquired: string | null;
  dateSold: string;
  adjustedCost: number;
  proceeds: number;
  adjustedGain: number;
  capitalGainsStatus: string | null;
  planType: string | null;
  orderNumber: string | null;
  orderType: string | null;
  type: string | null;
  raw: Record<string, string | number | null>;
}

export interface EtradeGlSummary {
  quantity: number;
  gainLoss: number;
  adjustedGainLoss: number;
}

export interface EtradeGlParseResult {
  lots: EtradeLot[];
  summary: EtradeGlSummary | null;
  fileHash: string;
  sheetName: string;
}

function fileHash(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function lotKey(parts: (string | number | null | undefined)[]): string {
  const material = parts.map((p) => (p == null ? '' : String(p))).join('|');
  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}

function isBlank(v: unknown): boolean {
  if (v == null) return true;
  const s = String(v).trim();
  return s === '' || s === '--' || s === '—';
}

function parseNum(v: unknown): number {
  if (isBlank(v)) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v).trim().replace(/,/g, '');
  s = s.replace(/[−–]/g, '-');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Excel serial date or MM/DD/YYYY → YYYY-MM-DD */
export function parseEtradeDate(v: unknown): string | null {
  if (isBlank(v)) return null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    // Excel serial (days since 1899-12-30 under xlsx's default)
    const epoch = Date.UTC(1899, 11, 30);
    const ms = epoch + Math.round(v) * 86_400_000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const mo = Number(mdy[1]);
    const d = Number(mdy[2]);
    const y = Number(mdy[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

function cell(row: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    if (name in row && !isBlank(row[name])) return row[name];
    // case-insensitive fallback
    const found = Object.keys(row).find((k) => k.toLowerCase() === name.toLowerCase());
    if (found && !isBlank(row[found])) return row[found];
  }
  return null;
}

function normalizeHeader(h: unknown): string {
  return String(h ?? '')
    .replace(/^\uFEFF/, '')
    .trim();
}

function sheetToObjects(sheet: XLSX.WorkSheet): Record<string, unknown>[] {
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
  });
  if (!rows.length) return [];
  const headers = (rows[0] ?? []).map(normalizeHeader);
  const out: Record<string, unknown>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const line = rows[i] ?? [];
    if (!line.some((c) => !isBlank(c))) continue;
    const obj: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      if (!h) return;
      obj[h] = line[idx] ?? null;
    });
    out.push(obj);
  }
  return out;
}

function pickSheet(wb: XLSX.WorkBook): { name: string; sheet: XLSX.WorkSheet } {
  const preferred = wb.SheetNames.find((n) => /g\s*&\s*l|gl.?expanded|gain/i.test(n));
  const name = preferred ?? wb.SheetNames[0];
  if (!name) throw new Error('Workbook has no sheets');
  const sheet = wb.Sheets[name];
  if (!sheet) throw new Error(`Missing sheet: ${name}`);
  return { name, sheet };
}

function rowToLot(row: Record<string, unknown>): EtradeLot | null {
  const recordType = String(cell(row, 'Record Type') ?? '').trim();
  if (!recordType || /^summary$/i.test(recordType)) return null;
  // Keep sell-like disposition rows
  if (!/sell|buy|cover|close/i.test(recordType) && recordType.toLowerCase() !== 'sell') {
    // Still allow if Date Sold present
    if (isBlank(cell(row, 'Date Sold'))) return null;
  }

  const symbol = String(cell(row, 'Symbol') ?? '').trim().toUpperCase();
  const dateSold = parseEtradeDate(cell(row, 'Date Sold'));
  if (!symbol || !dateSold) return null;

  const quantity = parseNum(cell(row, 'Quantity'));
  const dateAcquired = parseEtradeDate(cell(row, 'Date Acquired'));
  const adjustedCost = parseNum(cell(row, 'Adjusted Cost Basis'));
  const proceeds = parseNum(cell(row, 'Total Proceeds'));
  const adjustedGain = parseNum(cell(row, 'Adjusted Gain/Loss'));
  const capitalGainsStatus = isBlank(cell(row, 'Capital Gains Status'))
    ? null
    : String(cell(row, 'Capital Gains Status')).trim();
  const planType = isBlank(cell(row, 'Plan Type')) ? null : String(cell(row, 'Plan Type')).trim();
  const orderNumber = isBlank(cell(row, 'Order Number'))
    ? null
    : String(cell(row, 'Order Number')).trim();
  const orderType = isBlank(cell(row, 'Order Type')) ? null : String(cell(row, 'Order Type')).trim();
  const type = isBlank(cell(row, 'Type')) ? null : String(cell(row, 'Type')).trim();
  const grantNumber = isBlank(cell(row, 'Grant Number'))
    ? null
    : String(cell(row, 'Grant Number')).trim();
  const vestDate = parseEtradeDate(cell(row, 'Vest Date'));

  const key = lotKey([
    orderNumber,
    symbol,
    dateAcquired,
    dateSold,
    quantity,
    adjustedCost,
    proceeds,
    adjustedGain,
    planType,
    grantNumber,
    vestDate,
    capitalGainsStatus,
  ]);

  const raw: Record<string, string | number | null> = {};
  for (const [k, val] of Object.entries(row)) {
    if (isBlank(val)) raw[k] = null;
    else if (typeof val === 'number') raw[k] = val;
    else raw[k] = String(val);
  }

  return {
    lotKey: key,
    symbol,
    quantity,
    dateAcquired,
    dateSold,
    adjustedCost,
    proceeds,
    adjustedGain,
    capitalGainsStatus,
    planType,
    orderNumber,
    orderType,
    type,
    raw,
  };
}

function parseSummaryRow(row: Record<string, unknown>): EtradeGlSummary {
  return {
    quantity: parseNum(cell(row, 'Quantity')),
    gainLoss: parseNum(cell(row, 'Gain/Loss')),
    adjustedGainLoss: parseNum(cell(row, 'Adjusted Gain/Loss')),
  };
}

/**
 * Parse an E*TRADE G&L Expanded workbook (xlsx/xls) or CSV buffer.
 */
export function parseEtradeGl(buf: Buffer, fileName?: string): EtradeGlParseResult {
  const nameLower = (fileName ?? '').toLowerCase();
  let wb: XLSX.WorkBook;
  if (nameLower.endsWith('.csv')) {
    const text = buf.toString('utf8');
    wb = XLSX.read(text, { type: 'string', raw: true });
  } else {
    wb = XLSX.read(buf, { type: 'buffer', raw: true, cellDates: false });
  }

  const { name: sheetName, sheet } = pickSheet(wb);
  const rows = sheetToObjects(sheet);
  if (!rows.length) throw new Error('G&L file has no data rows');

  let summary: EtradeGlSummary | null = null;
  const lots: EtradeLot[] = [];

  for (const row of rows) {
    const recordType = String(cell(row, 'Record Type') ?? '').trim();
    if (/^summary$/i.test(recordType)) {
      summary = parseSummaryRow(row);
      continue;
    }
    const lot = rowToLot(row);
    if (lot) lots.push(lot);
  }

  if (!lots.length) {
    throw new Error('No sell lots found in E*TRADE G&L export');
  }

  // Soft-validate against Summary when present
  if (summary) {
    const qtySum = lots.reduce((s, l) => s + l.quantity, 0);
    const gainSum = lots.reduce((s, l) => s + l.adjustedGain, 0);
    if (Math.abs(qtySum - summary.quantity) > 0.02) {
      console.warn(
        `E*TRADE G&L quantity sum ${qtySum} differs from Summary ${summary.quantity}`,
      );
    }
    if (Math.abs(gainSum - summary.adjustedGainLoss) > 1) {
      console.warn(
        `E*TRADE G&L adjusted gain sum ${gainSum} differs from Summary ${summary.adjustedGainLoss}`,
      );
    }
  }

  return {
    lots,
    summary,
    fileHash: fileHash(buf),
    sheetName,
  };
}

export function etradeAccountId(): string {
  return 'etrade:default';
}
