/**
 * Parse E*TRADE Client Statement PDFs (including multi-quarter packs).
 *
 * Supports two layouts:
 * 1. Classic E*TRADE (≈2019–mid-2023): `Statement Period : …`, Ending Portfolio/Account Value
 * 2. Morgan Stanley at Work (≈Sep 2023+): `CLIENT STATEMENT For the Period …`, Ending Total Value
 *
 * Value basis: brokerage securities + cash only. Unvested Employee Stock Plan Value excluded.
 */

import { createHash } from 'node:crypto';
import { PDFParse } from 'pdf-parse';

export interface EtradeHolding {
  symbol: string;
  name: string | null;
  quantity: number;
  price: number;
  value: number;
}

export interface EtradeStatement {
  accountNumber: string;
  /** Period start, ISO YYYY-MM-DD */
  periodStart: string;
  /** Period end / statement date, ISO YYYY-MM-DD */
  periodEnd: string;
  statementDate: string;
  beginningValue: number | null;
  endingValue: number;
  /**
   * Net deposits (positive) / withdrawals (negative) for the period.
   * Classic: `-NET WITHDRAWALS & DEPOSITS`.
   * MS: signed `Net Credits/Debits/Transfers` (This Period).
   */
  netFlow: number;
  /** Classic raw withdrawals&deposits amount (positive = net withdrawal). MS: −netFlow. */
  netWithdrawalsDeposits: number;
  netChange: number | null;
  holdings: EtradeHolding[];
  /** Optional unvested RSU estimated value — not included in endingValue. */
  unvestedValue: number | null;
  format: 'classic' | 'morgan_stanley';
}

export interface EtradeStatementParseResult {
  statements: EtradeStatement[];
  fileHash: string;
  warnings: string[];
}

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

function fileHash(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Per-statement import hash — unique under (account_id, file_hash). */
export function etradeStatementImportHash(
  pdfHash: string,
  statementDate: string,
  accountNumber?: string,
): string {
  return accountNumber
    ? `${pdfHash}:${accountNumber}:${statementDate}`
    : `${pdfHash}:${statementDate}`;
}

export function etradeAccountIdFromNumber(accountNumber: string): string {
  const cleaned = accountNumber.trim() || 'default';
  return `etrade:${cleaned}`;
}

/** Parse money; em-dash / blank / "--" → 0. Handles `$  1,234.56` and `$(1,234.56)`. */
export function parseMoney(raw: string | undefined | null): number {
  if (raw == null) return 0;
  let s = String(raw).trim();
  if (s === '' || s === '—' || s === '–' || s === '-' || s === '--' || s === '$-') return 0;
  // Parenthetical negatives: $(83,752.64) or (83,752.64)
  const paren = s.match(/^\$?\s*\(\s*\$?\s*([\d,]+\.\d{2})\s*\)$/);
  if (paren) return -parseMoney(paren[1]);
  s = s.replace(/[−–—]/g, '-');
  s = s.replace(/\$/g, '').replace(/\s/g, '').replace(/,/g, '');
  if (s === '' || s === '-') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function monthDayYear(monthName: string, day: string | number, year: number): string | null {
  const mo = MONTHS[monthName.toLowerCase()];
  if (!mo) return null;
  const d = Number(day);
  if (d < 1 || d > 31 || year < 1990) return null;
  return `${year}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** "October 1, 2019" → YYYY-MM-DD */
export function parseUsLongDate(raw: string): string | null {
  const m = raw.trim().match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
  if (!m) return null;
  return monthDayYear(m[1], m[2], Number(m[3]));
}

/** MM/DD/YY or MM/DD/YYYY → YYYY-MM-DD */
export function parseUsShortDate(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const mo = Number(m[1]);
  const d = Number(m[2]);
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Morgan Stanley period strings:
 * - "October 1- December 31, 2023"
 * - "May 1- June 30, 2026"
 * - "September 1-30, 2023"
 * - "April 1-30, 2026"
 * - "April 1- May 31, 2025"
 */
export function parseMsPeriodRange(raw: string): { start: string; end: string } | null {
  const cleaned = raw
    .replace(/\s+Page\s+\d+\s+of\s+\d+/i, '')
    .replace(/\t.*$/, '')
    .trim();

  // Month D- Month D, YYYY  (possibly different months; year only on end)
  let m = cleaned.match(
    /^([A-Za-z]+)\s+(\d{1,2})\s*-\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/,
  );
  if (m) {
    const y = Number(m[5]);
    const start = monthDayYear(m[1], m[2], y);
    const end = monthDayYear(m[3], m[4], y);
    if (start && end) return { start, end };
  }

  // Month D-D, YYYY (same month)
  m = cleaned.match(/^([A-Za-z]+)\s+(\d{1,2})\s*-\s*(\d{1,2}),\s*(\d{4})$/);
  if (m) {
    const y = Number(m[4]);
    const start = monthDayYear(m[1], m[2], y);
    const end = monthDayYear(m[1], m[3], y);
    if (start && end) return { start, end };
  }

  // Fallback: full classic dates with commas on both sides
  m = cleaned.match(
    /^([A-Za-z]+ \d{1,2}, \d{4})\s*-\s*([A-Za-z]+ \d{1,2}, \d{4})$/,
  );
  if (m) {
    const start = parseUsLongDate(m[1]);
    const end = parseUsLongDate(m[2]);
    if (start && end) return { start, end };
  }

  return null;
}

async function extractText(buf: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buf });
  try {
    const result = await parser.getText();
    return result.text ?? '';
  } finally {
    await parser.destroy?.();
  }
}

interface PeriodBoundary {
  index: number;
  periodStart: string;
  periodEnd: string;
  format: 'classic' | 'morgan_stanley';
  /** Raw key for dedup within a format */
  key: string;
}

function findClassicBoundaries(text: string): PeriodBoundary[] {
  const re =
    /Statement Period\s*:\s*([A-Za-z]+ \d{1,2}, \d{4})\s*-\s*([A-Za-z]+ \d{1,2}, \d{4})/g;
  const seen = new Set<string>();
  const out: PeriodBoundary[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = parseUsLongDate(m[1]);
    const end = parseUsLongDate(m[2]);
    if (!start || !end) continue;
    const key = `classic:${start}|${end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      index: m.index,
      periodStart: start,
      periodEnd: end,
      format: 'classic',
      key,
    });
  }
  return out;
}

function findMorganStanleyBoundaries(text: string): PeriodBoundary[] {
  const re = /CLIENT STATEMENT\s+For the Period\s+([^\n]+)/gi;
  const seen = new Set<string>();
  const out: PeriodBoundary[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const range = parseMsPeriodRange(m[1]);
    if (!range) continue;
    const key = `ms:${range.start}|${range.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      index: m.index,
      periodStart: range.start,
      periodEnd: range.end,
      format: 'morgan_stanley',
      key,
    });
  }
  return out;
}

/** Slice end = next boundary of *any* format after this index, else EOF. */
function sliceEnd(all: PeriodBoundary[], currentIndex: number, textLen: number): number {
  let end = textLen;
  for (const b of all) {
    if (b.index > currentIndex && b.index < end) end = b.index;
  }
  return end;
}

function parseDashOrMoney(raw: string): number {
  const t = raw.trim();
  if (t === '—' || t === '–' || t === '-' || t === '--' || t === '') return 0;
  return parseMoney(t);
}

/**
 * Classic: Ending/Beginning Portfolio Value OR Account Value.
 * Amounts may be split as `$  48,605.94`.
 */
function parseClassicPortfolioValue(
  slice: string,
  kind: 'Beginning' | 'Ending',
): { date: string | null; value: number | null } {
  const patterns = [
    // Ending Portfolio\nValue (On 12/31/19):\n$4,107.46
    new RegExp(
      `${kind}\\s+Portfolio\\s*\\n?\\s*Value\\s*\\(On\\s*([\\d/]+)\\)\\s*:?\\s*\\n?\\s*\\$?\\s*([\\d,]+\\.\\d{2})`,
      'i',
    ),
    // Ending Account Value (On 09/30/23):  $  0.00
    new RegExp(
      `${kind}\\s+Account\\s+Value\\s*\\(On\\s*([\\d/]+)\\)\\s*:?\\s*\\$?\\s*([\\d,]+\\.\\d{2})`,
      'i',
    ),
  ];
  for (const re of patterns) {
    const m = slice.match(re);
    if (m) {
      return { date: parseUsShortDate(m[1]), value: parseMoney(m[2]) };
    }
  }
  return { date: null, value: null };
}

function parseClassicNetWithdrawalsDeposits(slice: string): number {
  if (/NO ACTIVITY THIS PERIOD/i.test(slice) && !/NET WITHDRAWALS\s*&\s*DEPOSITS/i.test(slice)) {
    return 0;
  }
  const m = slice.match(/NET WITHDRAWALS\s*&\s*DEPOSITS\s*\$?\s*([\d,]+\.\d{2})/i);
  if (!m) return 0;
  return parseMoney(m[1]);
}

function parseClassicNetChange(slice: string): number | null {
  // Match the portfolio value summary line, not chart chrome.
  const m = slice.match(
    /Ending\s+(?:Portfolio|Account)\s*Value[\s\S]{0,200}?Net Change:\s*(\$?\s*-?\s*[\d,]+\.\d{2})/i,
  );
  return m ? parseMoney(m[1]) : null;
}

function parseClassicAccount(slice: string): string | null {
  return (
    slice.match(/Account Number:\s*([\d-]+)/i)?.[1] ??
    slice.match(/Acct:\s*([\d-]+)/i)?.[1] ??
    null
  );
}

/** Normalize `215 - 435997 - 209 - 4 - 1` → `215-435997-209`. */
export function normalizeMsAccountNumber(raw: string): string {
  const digits = raw.match(/\d+/g) ?? [];
  if (digits.length >= 3) return `${digits[0]}-${digits[1]}-${digits[2]}`;
  return raw.replace(/\s+/g, '');
}

function parseMsAccount(slice: string, fullText: string): string | null {
  const spaced = slice.match(/215\s*-\s*\d+\s*-\s*\d+(?:\s*-\s*\d+\s*-\s*\d+)?/);
  if (spaced) return normalizeMsAccountNumber(spaced[0]);
  const compact = slice.match(/\b(\d{3}-\d{6}-\d{3})\b/);
  if (compact) return compact[1];
  // Fall back to first account id in the whole PDF
  const global =
    fullText.match(/215\s*-\s*\d+\s*-\s*\d+(?:\s*-\s*\d+\s*-\s*\d+)?/) ??
    fullText.match(/\b(\d{3}-\d{6}-\d{3})\b/);
  if (global) return normalizeMsAccountNumber(global[0]);
  return null;
}

function parseMsTotalValue(
  slice: string,
  kind: 'Beginning' | 'Ending',
): { date: string | null; value: number | null } {
  // Cover page: Ending Total Value (as of 12/31/23) $63,849.96  OR  —
  const cover = slice.match(
    new RegExp(
      `${kind}\\s+Total Value\\s*\\(as of\\s*([\\d/]+)\\)\\s*(\\$[\\d,]+\\.\\d{2}|—|–|--)`,
      'i',
    ),
  );
  if (cover) {
    return {
      date: parseUsShortDate(cover[1]),
      value: parseDashOrMoney(cover[2]),
    };
  }

  // CHANGE IN VALUE table: TOTAL ENDING VALUE $63,849.96 $63,849.96
  // First amount = This Period
  const label = kind === 'Ending' ? 'TOTAL ENDING VALUE' : 'TOTAL BEGINNING VALUE';
  const table = slice.match(
    new RegExp(`${label}\\s+(\\$?[\\d,]+\\.\\d{2}|—|–|--)`, 'i'),
  );
  if (table) {
    return { date: null, value: parseDashOrMoney(table[1]) };
  }

  return { date: null, value: null };
}

/**
 * Net external flow for the period from CHANGE IN VALUE:
 * `Net Credits/Debits/Transfers $(83,752.64)` — first amount is This Period.
 * Signed already (credits positive, debits/outflows negative).
 */
function parseMsNetFlow(slice: string): number {
  const m = slice.match(
    /Net Credits\/Debits\/Transfers\s+(\$?\(?-?[\d,]+\.\d{2}\)?|—|–|--)/i,
  );
  if (!m) return 0;
  return parseDashOrMoney(m[1]);
}

function parseMsNetChange(slice: string): number | null {
  const m = slice.match(/Change in Value\s+(\(?-?\$?[\d,]+\.\d{2}\)?|—)/i);
  if (!m) return null;
  return parseDashOrMoney(m[1]);
}

function parseUnvested(slice: string): number | null {
  const m = slice.match(
    /Unvested Employee\s+Stock Plan Value\s*\n?\s*\$?([\d,]+\.\d{2})/i,
  );
  if (!m) return null;
  return parseMoney(m[1]);
}

function parseClassicHoldings(slice: string): EtradeHolding[] {
  const holdingsStart = slice.search(/PORTFOLIO HOLDINGS|ACCOUNT HOLDINGS/i);
  if (holdingsStart < 0) return [];
  let section = slice.slice(holdingsStart);
  const unvestedAt = section.search(/UNVESTED RESTRICTED STOCKS/i);
  if (unvestedAt >= 0) section = section.slice(0, unvestedAt);

  const holdings: EtradeHolding[] = [];
  const rowRe =
    /(?:^|\n)([A-Z][A-Z0-9 &.,'-]{2,80}?)\s*\n\s*COMMON STOCK\s+(\w+)\s+\w+\s+([\d,]+\.?\d*)\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(section))) {
    const name = m[1].trim().replace(/\s+/g, ' ');
    if (/DESCRIPTION|SYMBOL|PAGE|ACCOUNT/i.test(name)) continue;
    holdings.push({
      symbol: m[2].toUpperCase(),
      name,
      quantity: parseMoney(m[3]),
      price: parseMoney(m[4]),
      value: parseMoney(m[5]),
    });
  }

  if (!holdings.length) {
    const simple =
      /COMMON STOCK\s+(\w+)\s+\w+\s+([\d,]+\.?\d*)\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)/gi;
    while ((m = simple.exec(section))) {
      holdings.push({
        symbol: m[1].toUpperCase(),
        name: null,
        quantity: parseMoney(m[2]),
        price: parseMoney(m[3]),
        value: parseMoney(m[4]),
      });
    }
  }

  return holdings;
}

/** Best-effort MS holdings from equities allocation / stock lines. */
function parseMsHoldings(slice: string): EtradeHolding[] {
  if (/There Are No Holdings For This Account/i.test(slice)) return [];

  // BALANCE SHEET Stocks line is aggregate — skip as a "holding"
  // Look for symbol ticker patterns in holdings detail if present
  const holdings: EtradeHolding[] = [];
  const stockLine = slice.match(
    /BOOKING HOLDINGS INC[\s\S]{0,120}?BKNG[\s\S]{0,80}?([\d,]+\.?\d*)\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)/i,
  );
  if (stockLine) {
    holdings.push({
      symbol: 'BKNG',
      name: 'BOOKING HOLDINGS INC',
      quantity: parseMoney(stockLine[1]),
      price: parseMoney(stockLine[2]),
      value: parseMoney(stockLine[3]),
    });
  }
  return holdings;
}

function parseClassicStatement(slice: string, b: PeriodBoundary): EtradeStatement {
  const acct = parseClassicAccount(slice);
  if (!acct) {
    throw new Error(`Could not find account number for period ending ${b.periodEnd}`);
  }

  const ending = parseClassicPortfolioValue(slice, 'Ending');
  if (ending.value == null) {
    throw new Error(`Could not find Ending Portfolio/Account Value for period ending ${b.periodEnd}`);
  }

  const beginning = parseClassicPortfolioValue(slice, 'Beginning');
  const netWithdrawalsDeposits = parseClassicNetWithdrawalsDeposits(slice);
  const netFlow = -netWithdrawalsDeposits;

  return {
    accountNumber: acct,
    periodStart: b.periodStart,
    periodEnd: b.periodEnd,
    statementDate: b.periodEnd,
    beginningValue: beginning.value,
    endingValue: ending.value,
    netFlow,
    netWithdrawalsDeposits,
    netChange: parseClassicNetChange(slice),
    holdings: parseClassicHoldings(slice),
    unvestedValue: parseUnvested(slice),
    format: 'classic',
  };
}

function parseMorganStanleyStatement(
  slice: string,
  b: PeriodBoundary,
  fullText: string,
): EtradeStatement {
  const acct = parseMsAccount(slice, fullText);
  if (!acct) {
    throw new Error(`Could not find Morgan Stanley account number for period ending ${b.periodEnd}`);
  }

  const ending = parseMsTotalValue(slice, 'Ending');
  if (ending.value == null) {
    throw new Error(`Could not find Ending Total Value for period ending ${b.periodEnd}`);
  }

  const beginning = parseMsTotalValue(slice, 'Beginning');
  const netFlow = parseMsNetFlow(slice);

  return {
    accountNumber: acct,
    periodStart: b.periodStart,
    periodEnd: b.periodEnd,
    statementDate: b.periodEnd,
    beginningValue: beginning.value,
    endingValue: ending.value,
    netFlow,
    netWithdrawalsDeposits: -netFlow,
    netChange: parseMsNetChange(slice),
    holdings: parseMsHoldings(slice),
    unvestedValue: null,
    format: 'morgan_stanley',
  };
}

function softConsistencyWarnings(statements: EtradeStatement[]): string[] {
  const warnings: string[] = [];
  for (const s of statements) {
    if (s.beginningValue != null && s.netChange != null) {
      const expected = s.beginningValue + s.netChange;
      // MS Change in Value excludes net transfers; only check when classic-style
      if (s.format === 'classic' && Math.abs(expected - s.endingValue) > 0.02) {
        warnings.push(
          `${s.statementDate}: ending ${s.endingValue} ≠ beginning ${s.beginningValue} + netChange ${s.netChange}`,
        );
      }
    }
  }
  return warnings;
}

/**
 * Parse one or more statements from an E*TRADE / Morgan Stanley Client Statement PDF.
 * Hybrid packs (classic + MS after account migration) yield statements for both accounts.
 */
export async function parseEtradeStatements(
  buf: Buffer,
  _fileName?: string,
): Promise<EtradeStatementParseResult> {
  const text = await extractText(buf);
  if (!text.trim()) {
    throw new Error('PDF contained no extractable text');
  }

  const classic = findClassicBoundaries(text);
  const ms = findMorganStanleyBoundaries(text);
  const boundaries = [...classic, ...ms].sort((a, b) => a.index - b.index);

  if (!boundaries.length) {
    throw new Error('Could not find any Statement Period in PDF');
  }

  const statements: EtradeStatement[] = [];
  for (const b of boundaries) {
    const start = b.index;
    // Include a little lookbehind for MS cover values that sit above the header
    const sliceStart =
      b.format === 'morgan_stanley' ? Math.max(0, start - 400) : start;
    const end = sliceEnd(boundaries, start, text.length);
    const slice = text.slice(sliceStart, end);

    if (b.format === 'classic') {
      statements.push(parseClassicStatement(slice, b));
    } else {
      statements.push(parseMorganStanleyStatement(slice, b, text));
    }
  }

  statements.sort((a, b) => {
    const d = a.statementDate.localeCompare(b.statementDate);
    if (d !== 0) return d;
    return a.accountNumber.localeCompare(b.accountNumber);
  });

  return {
    statements,
    fileHash: fileHash(buf),
    warnings: softConsistencyWarnings(statements),
  };
}
