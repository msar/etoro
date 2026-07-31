/**
 * Parse ABN AMRO Guided Investing portfolio summary PDFs.
 * Handles both layout generations (2022–2024 and 2025+ English templates).
 */

import { createHash } from 'node:crypto';
import { PDFParse } from 'pdf-parse';

export interface AbnHolding {
  isin: string;
  name: string;
  assetClass: string;
  quantity: number;
  price: number;
  value: number;
}

export interface AbnStatement {
  portfolioNumber: string;
  /** Balance date (end of reporting period), ISO YYYY-MM-DD */
  statementDate: string;
  /** Previous balance date when present */
  previousBalanceDate: string | null;
  totalBalance: number;
  previousBalance: number | null;
  currency: 'EUR';
  holdings: AbnHolding[];
  /** Period covered by the costs / result section */
  periodStart: string | null;
  periodEnd: string | null;
  serviceCosts: number;
  productCosts: number;
  /** Investments − withdrawals during the result period */
  netFlow: number;
  periodStartValue: number | null;
  periodEndValue: number | null;
  realizedResult: number;
  unrealizedResult: number;
  unrealizedResultPct: number | null;
  fileHash: string;
}

const ASSET_CLASSES = [
  'Equities',
  'Fixed income',
  'Alternatives',
  'Liquidities',
  'Other',
] as const;

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

/** Parse amounts like `20,358.79`, `- 2`, `198`, `0.00`. */
export function parseMoney(raw: string | undefined | null): number {
  if (raw == null) return 0;
  let s = String(raw).trim();
  // Handle "−" / en-dash and spaced minus: "- 2"
  s = s.replace(/[−–]/g, '-').replace(/^\-\s+/, '-');
  s = s.replace(/EUR/gi, '').replace(/\s/g, '').replace(/,/g, '');
  if (s === '' || s === '-') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** DD-MM-YYYY or D-M-YYYY → YYYY-MM-DD */
export function parseDutchDate(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** "1 January 2026" / "30 September 2022" → YYYY-MM-DD */
export function parseEnglishDate(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return null;
  const mo = MONTHS[m[2].toLowerCase()];
  if (!mo) return null;
  const d = Number(m[1]);
  const y = Number(m[3]);
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function fileHash(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
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

function extractPortfolioNumber(text: string): string {
  const m = text.match(/Portfolio number[\s\S]*?(\d{2}\.\d{2}\.\d{2}\.\d{3})/i)
    ?? text.match(/(\d{2}\.\d{2}\.\d{2}\.\d{3})/);
  return m?.[1] ?? 'unknown';
}

function extractBalanceDate(text: string): {
  statementDate: string;
  previousBalanceDate: string | null;
  totalBalance: number;
  previousBalance: number | null;
} {
  // "Previous balance on 31-03-2026 Balance on 30-06-2026" then amounts line
  const header = text.match(
    /Previous balance on\s+(\d{1,2}-\d{1,2}-\d{4})\s+Balance on\s+(\d{1,2}-\d{1,2}-\d{4})/i,
  );
  const balanceOnly = text.match(/Balance on\s+(\d{1,2}-\d{1,2}-\d{4})/i);

  let statementDate: string | null = null;
  let previousBalanceDate: string | null = null;
  if (header) {
    previousBalanceDate = parseDutchDate(header[1]);
    statementDate = parseDutchDate(header[2]);
  } else if (balanceOnly) {
    statementDate = parseDutchDate(balanceOnly[1]);
  }

  // Fallback: "Concerning YOUR CUSTODY ACCOUNT 30-06-2026"
  if (!statementDate) {
    const pageDate = text.match(
      /CUSTODY ACCOUNT\s+(\d{1,2}-\d{1,2}-\d{4})/i,
    );
    if (pageDate) statementDate = parseDutchDate(pageDate[1]);
  }

  if (!statementDate) {
    throw new Error('Could not find statement balance date in PDF');
  }

  // Amounts after GUIDED INVESTING line: "… 20,358.79 EUR 22,423.65 EUR"
  // or single: "GUIDED INVESTING … 197.57 EUR"
  const guided = text.match(
    /GUIDED\s*INVESTING[\s\S]{0,80}?([\d,.\-]+)\s*EUR(?:\s+([\d,.\-]+)\s*EUR)?/i,
  );

  let previousBalance: number | null = null;
  let totalBalance = 0;
  if (guided) {
    if (guided[2]) {
      previousBalance = parseMoney(guided[1]);
      totalBalance = parseMoney(guided[2]);
    } else {
      totalBalance = parseMoney(guided[1]);
    }
  }

  // Prefer explicit Total Balance line
  const totalLine =
    text.match(/Total\s+[Bb]alance\s*:?\s*([\d,.\-]+)/) ??
    text.match(/Total balance\s*:?\s*([\d,.\-]+)/i);
  if (totalLine) totalBalance = parseMoney(totalLine[1]);

  if (!totalBalance && totalBalance !== 0) {
    throw new Error('Could not find total balance in PDF');
  }

  return { statementDate, previousBalanceDate, totalBalance, previousBalance };
}

function extractHoldings(text: string): AbnHolding[] {
  const holdings: AbnHolding[] = [];
  // Cut before costs / result sections to avoid false matches
  const cut =
    text.split(/Statement of costs|Investment account result|Indicative product costs/i)[0] ??
    text;

  let currentClass = 'Other';
  const lines = cut.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    for (const cls of ASSET_CLASSES) {
      if (trimmed === cls || trimmed.toLowerCase() === cls.toLowerCase()) {
        currentClass = cls;
      }
    }

    // LU0121970809 AA PR FONDS M OFF (2) PART 44.6590 276.16 EUR 12,333.01
    const m = trimmed.match(
      /^(LU[0-9A-Z]{10})\s+(.+?)\s+(\d+(?:\.\d+)?)\s+([\d,.]+)\s*EUR\s+([\d,.]+)\s*$/i,
    );
    if (!m) continue;

    let name = m[2].replace(/\(\d\)\s*/g, '').replace(/\s+PART\s*$/i, '').trim();
    name = name.replace(/\s+/g, ' ');

    holdings.push({
      isin: m[1].toUpperCase(),
      name,
      assetClass: currentClass,
      quantity: parseMoney(m[3]),
      price: parseMoney(m[4]),
      value: parseMoney(m[5]),
    });
  }

  return holdings;
}

function extractCosts(text: string): {
  periodStart: string | null;
  periodEnd: string | null;
  serviceCosts: number;
  productCosts: number;
} {
  let periodStart: string | null = null;
  let periodEnd: string | null = null;

  const period = text.match(
    /Statement of costs for period\s+(\d{1,2}-\d{1,2}-\d{4})\s+t\/m\s+(\d{1,2}-\d{1,2}-\d{4})/i,
  );
  if (period) {
    periodStart = parseDutchDate(period[1]);
    periodEnd = parseDutchDate(period[2]);
  }

  const serviceMatch =
    text.match(/Total costs for investment services\s+([\d,.]+)/i) ??
    text.match(/Service cost\s+([\d,.]+)/i);
  const productMatch =
    text.match(/Total product costs this period\s+([\d,.]+)/i) ??
    text.match(/Total indicative product costs this period\s+([\d,.]+)/i);

  return {
    periodStart,
    periodEnd,
    serviceCosts: parseMoney(serviceMatch?.[1]),
    productCosts: parseMoney(productMatch?.[1]),
  };
}

function extractResult(text: string): {
  periodStartValue: number | null;
  periodEndValue: number | null;
  netFlow: number;
  realizedResult: number;
  unrealizedResult: number;
  unrealizedResultPct: number | null;
} {
  const section = text.split(/Investment account result/i)[1] ?? '';

  // "Investment account 1 January 2026 11,052"
  const accountLines = [
    ...section.matchAll(
      /Investment account\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s+([\d,.\-]+)/gi,
    ),
  ];

  let periodStartValue: number | null = null;
  let periodEndValue: number | null = null;
  if (accountLines.length >= 1) {
    periodStartValue = parseMoney(accountLines[0][2]);
  }
  if (accountLines.length >= 2) {
    periodEndValue = parseMoney(accountLines[1][2]);
  }

  const flowMatch = section.match(/Investments\/withdrawals\s+([\d,.\-\s]+)/i);
  const realizedMatch = section.match(
    /Realized result\s+(-?\s*[\d,.]+)/i,
  );
  // "Unrealized result 1,372 6.51%" or "Unrealized result - 2 - 1.22%"
  const unrealizedMatch = section.match(
    /Unrealized result\s+(-?\s*[\d,.]+)\s+(-?\s*[\d,.]+)\s*%/i,
  );

  let unrealizedResult = 0;
  let unrealizedResultPct: number | null = null;
  if (unrealizedMatch) {
    unrealizedResult = parseMoney(unrealizedMatch[1]);
    unrealizedResultPct = parseMoney(unrealizedMatch[2]) / 100;
  }

  return {
    periodStartValue,
    periodEndValue,
    netFlow: parseMoney(flowMatch?.[1]),
    realizedResult: parseMoney(realizedMatch?.[1]),
    unrealizedResult,
    unrealizedResultPct,
  };
}

/**
 * Parse a PDF buffer into a structured ABN AMRO Guided Investing statement.
 */
export async function parseAbnAmroStatement(
  buf: Buffer,
  _fileName?: string,
): Promise<AbnStatement> {
  const text = await extractText(buf);
  if (!/GUIDED\s*INVESTING/i.test(text) && !/Portfolio summary/i.test(text)) {
    throw new Error('PDF does not look like an ABN AMRO portfolio summary');
  }

  const portfolioNumber = extractPortfolioNumber(text);
  const balances = extractBalanceDate(text);
  const holdings = extractHoldings(text);
  const costs = extractCosts(text);
  const result = extractResult(text);

  return {
    portfolioNumber,
    statementDate: balances.statementDate,
    previousBalanceDate: balances.previousBalanceDate,
    totalBalance: balances.totalBalance,
    previousBalance: balances.previousBalance,
    currency: 'EUR',
    holdings,
    periodStart: costs.periodStart,
    periodEnd: costs.periodEnd,
    serviceCosts: costs.serviceCosts,
    productCosts: costs.productCosts,
    netFlow: result.netFlow,
    periodStartValue: result.periodStartValue,
    periodEndValue: result.periodEndValue,
    realizedResult: result.realizedResult,
    unrealizedResult: result.unrealizedResult,
    unrealizedResultPct: result.unrealizedResultPct,
    fileHash: fileHash(buf),
  };
}

export function abnAccountId(portfolioNumber: string): string {
  return `abnamro:${portfolioNumber}`;
}
