import { isPrivacyMasked } from './privacy';

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

export interface EtoroHistoryImportResult {
  gcid: number;
  username: string | null;
  balanceCutoff: string;
  balancesImported: number;
  balanceDateRange: { from: string; to: string } | null;
  tradesImported: number;
  dividendsImported: number;
  warnings: string[];
  classified: Record<string, string>;
}

export interface ProfitComponent {
  key: 'realized' | 'dividends' | 'unrealized' | 'residual';
  label: string;
  amount: number;
  description: string;
}

export interface ProfitContributor {
  key: string;
  symbol: string | null;
  name: string | null;
  imageUrl: string | null;
  instrumentId: number;
  realized: number;
  unrealized: number;
  total: number;
  open: boolean;
}

export interface ProfitYearRow {
  year: string;
  realizedProfit: number;
  dividendsNet: number;
  fees: number;
}

export interface ProfitBreakdown {
  available: boolean;
  reason?: string;
  currency: string;
  since: string | null;
  currentEquity: number | null;
  totalDeposits: number;
  totalWithdrawals: number;
  netDeposits: number;
  allTimeProfit: number | null;
  components: ProfitComponent[];
  feesTotal: number;
  winners: ProfitContributor[];
  losers: ProfitContributor[];
  years: ProfitYearRow[];
}

export interface GainYearRow {
  year: string;
  gain: number;
  cumulativeGain: number;
  netFlow: number;
  endEquity: number | null;
}

export interface GainBreakdown {
  available: boolean;
  reason?: string;
  since: string | null;
  totalGain: number | null;
  cagr: number | null;
  source: 'etoro' | 'derived';
  years: GainYearRow[];
  bestYear: { date: string; gain: number } | null;
  worstYear: { date: string; gain: number } | null;
}

export type CheckStatus = 'ok' | 'watch' | 'action';

export interface AnalysisCheck {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  recommendation: string;
}

export interface AssetMixSlice {
  bucket: string;
  value: number;
  pct: number;
}

export interface PortfolioAnalysis {
  available: boolean;
  reason?: string;
  generatedAt: string;
  currency: string;
  equity: number | null;
  holdingsCount: number;
  cashPct: number | null;
  score: number | null;
  checks: AnalysisCheck[];
  assetMix: AssetMixSlice[];
  disclaimer: string;
}

// ---------------------------------------------------------------------------
// ABN AMRO
// ---------------------------------------------------------------------------

export interface AbnImportFileResult {
  fileName: string;
  status: 'imported' | 'duplicate' | 'replaced' | 'error';
  statementDate?: string;
  totalBalance?: number;
  netFlow?: number;
  holdings?: number;
  error?: string;
}

export interface AbnImportResult {
  accountId: string;
  portfolioNumber: string;
  results: AbnImportFileResult[];
  imported: number;
  duplicates: number;
  errors: number;
}

export interface AbnOverview {
  available: boolean;
  reason?: string;
  accountId: string | null;
  portfolioNumber: string | null;
  currency: 'EUR';
  currentValue: number | null;
  statementDate: string | null;
  totalDeposits: number;
  totalWithdrawals: number;
  allTimeGain: number | null;
  allTimeGainPct: number | null;
  totalServiceCosts: number;
  totalProductCosts: number;
  snapshots: {
    date: string;
    total: number;
    netFlow: number;
    cumulativeNetDeposits: number;
  }[];
  latestHoldings: {
    isin: string;
    name: string | null;
    assetClass: string;
    quantity: number;
    price: number;
    value: number;
  }[];
  allocation: { assetClass: string; value: number; pct: number }[];
  costs: {
    statementDate: string;
    serviceCosts: number;
    productCosts: number;
    periodStart: string | null;
    periodEnd: string | null;
  }[];
  imports: {
    fileName: string | null;
    statementDate: string;
    totalBalance: number | null;
    importedAt: string;
    fileHash: string;
  }[];
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

export type DisplayCurrency = 'EUR' | 'USD';

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

export type BrokerId = 'etoro' | 'abnamro' | 'etrade' | 'kraken';

export interface BrokerMeta {
  id: BrokerId;
  displayName: string;
  href: string;
  currency: string;
  connectMode: 'api' | 'upload';
  description: string;
}

export interface BrokersStatus {
  catalog: BrokerMeta[];
  enabled: BrokerId[];
  connected: BrokerId[];
}

export interface KrakenHolding {
  asset: string;
  displayAsset: string;
  quantity: number;
  priceUsd: number;
  valueUsd: number;
}

export interface KrakenSyncResult {
  accountId: string;
  date: string;
  equityUsd: number;
  cashUsd: number;
  investedUsd: number;
  holdingsCount: number;
  netFlow: number;
}

export interface KrakenOverview {
  available: boolean;
  reason?: string;
  configured: boolean;
  accountId: string | null;
  currency: 'USD';
  currentValue: number | null;
  statementDate: string | null;
  totalDeposits: number;
  totalWithdrawals: number;
  allTimeGain: number | null;
  allTimeGainPct: number | null;
  lastSyncedAt: string | null;
  snapshots: {
    date: string;
    total: number;
    netFlow: number;
    cumulativeNetDeposits: number;
  }[];
  holdings: KrakenHolding[];
  allocation: { asset: string; value: number; pct: number }[];
}

export type HistoryBackend = 'local' | 'supabase';

export interface KrakenCredentialsInput {
  apiKey: string;
  apiSecret: string;
  historyBackend?: HistoryBackend;
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
}

// ---------------------------------------------------------------------------
// E*TRADE
// ---------------------------------------------------------------------------

export interface EtradeImportFileResult {
  fileName: string;
  status: 'imported' | 'duplicate' | 'replaced' | 'error';
  lotCount?: number;
  totalAdjustedGain?: number;
  statementDate?: string;
  totalBalance?: number;
  netFlow?: number;
  holdings?: number;
  statementsImported?: number;
  error?: string;
}

export interface EtradeImportResult {
  accountId: string;
  results: EtradeImportFileResult[];
  imported: number;
  duplicates: number;
  errors: number;
}

export interface EtradeLotView {
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
}

export interface EtradeSymbolRollup {
  symbol: string;
  quantity: number;
  adjustedCost: number;
  proceeds: number;
  adjustedGain: number;
  returnOnCost: number | null;
  lotCount: number;
}

export interface EtradeOverview {
  available: boolean;
  reason?: string;
  hasEquity: boolean;
  hasRealized: boolean;
  accountId: string | null;
  accountNumber: string | null;
  currency: 'USD';
  currentValue: number | null;
  valueNative: number | null;
  valueEur: number | null;
  statementDate: string | null;
  totalDeposits: number;
  totalWithdrawals: number;
  /** Remaining equity + withdrawals (stock-plan total value). */
  totalPlanValue: number | null;
  /** Equity + withdrawals − compensation inflows (stock evolution). */
  allTimeGain: number | null;
  /** Investment gain / gross compensation inflows. */
  allTimeGainPct: number | null;
  snapshots: {
    date: string;
    total: number;
    netFlow: number;
    cumulativeNetDeposits: number;
  }[];
  latestHoldings: {
    symbol: string;
    name: string | null;
    quantity: number;
    price: number;
    value: number;
  }[];
  statementImports: {
    fileName: string | null;
    statementDate: string;
    totalBalance: number | null;
    importedAt: string;
    fileHash: string;
  }[];
  totalQuantity: number;
  totalAdjustedCost: number;
  totalProceeds: number;
  totalAdjustedGain: number;
  returnOnCost: number | null;
  longGain: number;
  shortGain: number;
  longQuantity: number;
  shortQuantity: number;
  cumulativeBySellDate: {
    date: string;
    periodGain: number;
    periodCost: number;
    periodProceeds: number;
    cumulativeGain: number;
  }[];
  bySymbol: EtradeSymbolRollup[];
  lots: EtradeLotView[];
  imports: {
    fileName: string | null;
    statementDate: string;
    totalBalance: number | null;
    importedAt: string;
    fileHash: string;
  }[];
}

export interface CredentialsInput {
  etoroApiKey: string;
  etoroUserKey: string;
  historyBackend?: HistoryBackend;
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
}

export interface CredentialsStatus {
  configured: boolean;
  etoroConfigured: boolean;
  supabaseConfigured: boolean;
  krakenConfigured: boolean;
  historyBackend?: HistoryBackend;
  historyConfigured?: boolean;
  localDbPath?: string | null;
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

async function postForm<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(path, { method: 'POST', body: form });
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
  etoroImportHistory: (files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    return postForm<EtoroHistoryImportResult>('/api/etoro/history/import', form);
  },
  performance: (granularity: Granularity, from?: string, to?: string) =>
    get<PerformanceSeries>(
      `/api/performance?granularity=${granularity}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`,
    ),
  balanceHistory: () => get<EquityHistory>('/api/balance-history'),
  allocationHistory: () => get<AllocationHistory>('/api/allocation-history'),
  portfolio: () => get<PortfolioSummary>('/api/portfolio'),
  trades: (from?: string) => get<{ items: Trade[] }>(`/api/trades${from ? `?from=${from}` : ''}`),
  stats: () => get<AccountStats>('/api/stats'),
  profitBreakdown: () => get<ProfitBreakdown>('/api/profit-breakdown'),
  gainBreakdown: () => get<GainBreakdown>('/api/gain-breakdown'),
  portfolioAnalysis: () => get<PortfolioAnalysis>('/api/portfolio-analysis'),
  instrumentPerformance: () => get<InstrumentPerformanceReport>('/api/instrument-performance'),
  income: () => get<IncomeReport>('/api/income'),
  abnOverview: () => get<AbnOverview>('/api/abnamro/overview'),
  abnPerformance: (granularity: Granularity, from?: string, to?: string) =>
    get<PerformanceSeries>(
      `/api/abnamro/performance?granularity=${granularity}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`,
    ),
  abnImport: (files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    return postForm<AbnImportResult>('/api/abnamro/import', form);
  },
  etradeOverview: () => get<EtradeOverview>('/api/etrade/overview'),
  etradePerformance: (granularity: Granularity, from?: string, to?: string) =>
    get<PerformanceSeries>(
      `/api/etrade/performance?granularity=${granularity}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`,
    ),
  etradeEquityPerformance: (granularity: Granularity, from?: string, to?: string) =>
    get<PerformanceSeries>(
      `/api/etrade/equity-performance?granularity=${granularity}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`,
    ),
  etradeImport: (files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    return postForm<EtradeImportResult>('/api/etrade/import', form);
  },
  etradeImportStatements: (files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    return postForm<EtradeImportResult>('/api/etrade/statements/import', form);
  },
  brokers: () => get<BrokersStatus>('/api/brokers'),
  enableBroker: (id: BrokerId) => postJson<BrokersStatus>(`/api/brokers/${id}/enable`),
  disableBroker: (id: BrokerId) => del<BrokersStatus>(`/api/brokers/${id}/enable`),
  krakenOverview: () => get<KrakenOverview>('/api/kraken/overview'),
  krakenPerformance: (granularity: Granularity, from?: string, to?: string) =>
    get<PerformanceSeries>(
      `/api/kraken/performance?granularity=${granularity}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`,
    ),
  krakenSync: () => postJson<KrakenSyncResult>('/api/kraken/sync'),
  saveKrakenCredentials: (creds: KrakenCredentialsInput) =>
    postJson<CredentialsStatus & { ok: boolean }>('/api/kraken/credentials', creds),
  clearKrakenCredentials: () =>
    del<CredentialsStatus & { ok: boolean }>('/api/kraken/credentials'),
  aggregate: (granularity: Granularity = 'monthly', currency: DisplayCurrency = 'EUR') =>
    get<AggregateOverview>(
      `/api/aggregate?granularity=${granularity}&currency=${currency}`,
    ),
};

export const fmtMoney = (v: number, currency = 'USD'): string => {
  if (isPrivacyMasked()) return '••••';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2,
  }).format(v);
};

/** Absolute non-currency figures (units, quantities, prices as plain numbers). */
export const fmtAbs = (v: number, digits = 2): string => {
  if (isPrivacyMasked()) return '••••';
  return v.toFixed(digits);
};

export const fmtPct = (fraction: number, digits = 2): string =>
  `${fraction >= 0 ? '+' : ''}${(fraction * 100).toFixed(digits)}%`;
