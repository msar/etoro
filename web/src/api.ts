export interface SyncStatus {
  configured: boolean;
  schemaReady: boolean;
  schemaHint?: string;
  gcid: number | null;
  lastSyncedAt: string | null;
  balanceSnapshotCount: number;
  tradeCount: number;
  holdingSnapshotCount: number;
  earliestSnapshot: string | null;
  latestSnapshot: string | null;
}

export interface SyncResult {
  gcid: number;
  seeded: boolean;
  balanceRowsUpserted: number;
  tradeRowsUpserted: number;
  holdingRowsUpserted: number;
  earliestSnapshot: string | null;
  latestSnapshot: string | null;
  lastSyncedAt: string;
}

export interface Bootstrap {
  environment: 'real' | 'demo';
  gcid: number | null;
  username: string | null;
  fullName: string | null;
  displayCurrency: string;
  tradingAccountId: string | null;
  agentPortfolios: { agentPortfolioId: string; agentPortfolioName: string }[];
  sync: SyncStatus | null;
}

export type Granularity = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface PerformancePoint {
  date: string;
  gain: number;
  cumulativeGain: number;
}

export interface PerformanceSeries {
  granularity: Granularity;
  points: PerformancePoint[];
  totalGain: number | null;
  source: 'etoro' | 'derived';
}

export interface EquityPoint {
  date: string;
  cash: number;
  invested: number;
  pnl: number;
  total: number;
  netFlow: number;
  cumulativeNetDeposits: number;
}

export interface EquityHistory {
  displayCurrency: string;
  points: EquityPoint[];
  totalDepositsInWindow: number;
  totalWithdrawalsInWindow: number;
  storedSince?: string | null;
  lastSyncedAt?: string | null;
  source: 'supabase' | 'etoro';
}

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

export interface Holding {
  instrumentId: number;
  symbol: string | null;
  name: string | null;
  imageUrl: string | null;
  invested: number;
  value: number;
  pnl: number;
  pnlPercent: number;
  netUnits: number;
  avgLeverage: number;
  avgOpenRate: number;
  feesNetOfDividends: number;
  viaCopy: boolean;
}

export interface PortfolioSummary {
  accountCurrency: string;
  timestamp: string;
  availableCash: number;
  totalValue: number;
  totalUsedMargin: number;
  currentPnl: number;
  holdings: Holding[];
  mirrors: {
    mirrorId: number;
    netFunding: number;
    positionsPnl: number;
    liquidationValue: number;
    pnlPercent: number;
  }[];
}

export interface Trade {
  netProfit: number;
  closeRate: number;
  closeTimestamp: string;
  positionId: number;
  instrumentId: number;
  isBuy: boolean;
  leverage: number;
  openRate: number;
  openTimestamp: string;
  investment: number;
  fees: number;
  units: number;
  symbol: string | null;
  instrumentName: string | null;
}

export interface DrawdownInfo {
  depth: number;
  peakDate: string | null;
  troughDate: string | null;
  recoveryDate: string | null;
  lengthDays: number | null;
}

export interface AccountStats {
  since: string | null;
  days: number;
  totalGain: number | null;
  cagr: number | null;
  volatilityAnnualized: number | null;
  sharpe: number | null;
  maxDrawdown: DrawdownInfo | null;
  currentDrawdown: number | null;
  bestMonth: { date: string; gain: number } | null;
  worstMonth: { date: string; gain: number } | null;
  bestYear: { date: string; gain: number } | null;
  worstYear: { date: string; gain: number } | null;
  totalDeposits: number;
  totalWithdrawals: number;
  netDeposits: number;
  currentEquity: number | null;
  allTimeProfit: number | null;
  positiveDaysPct: number | null;
}

export interface InstrumentPerformance {
  key: string;
  symbol: string | null;
  name: string | null;
  instrumentId: number;
  trades: number;
  realizedProfit: number;
  totalInvested: number;
  totalFees: number;
  winRate: number;
  avgHoldingDays: number;
  returnOnInvested: number;
  firstClose: string;
  lastClose: string;
}

export interface InstrumentPerformanceReport {
  since: string | null;
  totalTrades: number;
  totalRealizedProfit: number;
  items: InstrumentPerformance[];
}

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

export interface CredentialsInput {
  etoroApiKey: string;
  etoroUserKey: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
}

export interface CredentialsStatus {
  configured: boolean;
  etoroConfigured: boolean;
  supabaseConfigured: boolean;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // keep default message
    }
    throw new Error(message);
  }
  return res.json();
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const bodyJson = await res.json();
      if (bodyJson?.error) message = bodyJson.error;
    } catch {
      // keep default
    }
    throw new Error(message);
  }
  return res.json();
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(path, { method: 'DELETE' });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // keep default
    }
    throw new Error(message);
  }
  return res.json();
}

export const api = {
  credentialsStatus: () => get<CredentialsStatus>('/api/credentials/status'),
  saveCredentials: (creds: CredentialsInput) =>
    postJson<CredentialsStatus & { ok: boolean }>('/api/credentials', creds),
  clearCredentials: () => del<CredentialsStatus & { ok: boolean }>('/api/credentials'),
  bootstrap: () => get<Bootstrap>('/api/bootstrap'),
  sync: () => postJson<SyncResult>('/api/sync'),
  syncStatus: () => get<SyncStatus>('/api/sync/status'),
  performance: (granularity: Granularity, from?: string, to?: string) =>
    get<PerformanceSeries>(
      `/api/performance?granularity=${granularity}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`,
    ),
  balanceHistory: () => get<EquityHistory>('/api/balance-history'),
  allocationHistory: () => get<AllocationHistory>('/api/allocation-history'),
  portfolio: () => get<PortfolioSummary>('/api/portfolio'),
  trades: (from?: string) => get<{ items: Trade[] }>(`/api/trades${from ? `?from=${from}` : ''}`),
  stats: () => get<AccountStats>('/api/stats'),
  instrumentPerformance: () => get<InstrumentPerformanceReport>('/api/instrument-performance'),
  income: () => get<IncomeReport>('/api/income'),
};

export const fmtMoney = (v: number, currency = 'USD'): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2,
  }).format(v);

export const fmtPct = (fraction: number, digits = 2): string =>
  `${fraction >= 0 ? '+' : ''}${(fraction * 100).toFixed(digits)}%`;
