// Wire types modeled per-endpoint, matching each endpoint's exact field casing
// (see etoro-api-conventions: casing varies by endpoint; do NOT normalize here).

export type TradingEnv = 'real' | 'demo';

// GET /api/v1/trading/info/{env}/pnl — capital-suffix casing
export interface PnlPosition {
  positionID: number;
  instrumentID: number;
  mirrorID: number;
  amount: number;
  units: number;
  leverage: number;
  openRate: number;
  unrealizedPnL?: { pnL: number };
}

export interface PnlMirror {
  mirrorID: number;
  parentCID?: number;
  availableAmount: number;
  closedPositionsNetProfit: number;
  positions?: PnlPosition[];
}

export interface PnlOrder {
  orderID: number;
  instrumentID: number;
  mirrorID: number;
  amount: number;
  totalExternalCosts?: number;
}

export interface PnlResponse {
  clientPortfolio: {
    credit: number;
    positions?: PnlPosition[];
    mirrors?: PnlMirror[];
    orders?: PnlOrder[];
    ordersForOpen?: PnlOrder[];
  };
}

// GET /api/v1/balances — lowerCamel
export interface BalancesResponse {
  gcid: number;
  totalBalance: number;
  displayCurrency: string | null;
  balances:
    | {
        accountId: string | null;
        // String enum per the docs, but observed as a numeric enum on the wire
        accountType: string | number;
        balance: number;
        currency: string | null;
        displayBalance: number;
      }[]
    | null;
}

// GET /api/v1/balances/{accountType}/{accountId}/history
export interface BalanceSnapshot {
  date: string;
  totalCash: number;
  totalInvestedAmount: number;
  totalPnl: number;
  totalBalance: number;
  displayTotalCash: number;
  displayTotalInvestedAmount: number;
  displayTotalPnl: number;
  displayTotalBalance: number;
}

export interface BalanceHistoryResponse {
  gcid: number;
  displayCurrency: string | null;
  fromDate: string;
  toDate: string;
  snapshots: BalanceSnapshot[] | null;
}

// GET /api/v2/portfolios/{username}/gain/{granularity}
export interface GainSeriesResponse {
  username: string;
  granularity: 'daily' | 'monthly' | 'yearly';
  gains: { date: string; gain: number }[];
  totalGain: number | null;
}

// GET /api/v2/portfolios/{username}/assets/history
export interface AllocationHistoryResponse {
  userName: string;
  results: {
    date: string;
    cashPct: number;
    cashOfTotalEquityPct: number;
    assets: {
      instrumentId: number;
      symbol: string;
      investedPct: number;
      valuePct: number;
    }[];
  }[];
}

// GET /api/v1/trading/info/trade/history — lowerCamel
export interface TradeHistoryItem {
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
  initialInvestment: number;
  fees: number;
  units: number;
  mirrorId?: number;
}

export interface TradeHistoryResponse {
  items: TradeHistoryItem[];
}

// GET /api/v1/trading/info/aggregate-portfolio
export interface InstrumentAggregate {
  instrumentId: number;
  assetCurrency: string;
  totalMarginAccountCurrency: number;
  totalFeesAcctCcy: number;
  pnlAssetCurrency: number | null;
  accountCurrencyRoePercent: number;
  netUnits: number;
  accountCurrencyReturn: number;
  liquidationValueAccountCurrency: number;
  avgLeverage: number;
  avgOpenRate: number;
}

export interface AggregatePortfolioResponse {
  cid: number;
  timestamp: string;
  accountCurrency: string;
  accountTotals: {
    accountAvailableCash: number;
    accountFrozenCash: number;
    accountCurrentPnl: number;
    accountTotalValue: number;
    accountTotalUsedMargin: number;
    accountBalance: number;
  };
  instrumentAggregates: InstrumentAggregate[];
  mirrors: {
    mirrorId: number;
    mirrorTotals: {
      mirrorNetFunding: number;
      mirrorPositionsPnl: number;
      mirrorLiquidationValue: number;
      mirrorPositionsPnlPercent: number;
      mirrorActiveMargin: number;
    };
    instrumentAggregates: InstrumentAggregate[];
  }[];
}

// GET /api/v1/market-data/instruments — capital-D instrumentID
export interface EtoroInstrumentImage {
  uri: string;
  format?: string;
  width?: number;
  backgroundColor?: string;
  textColor?: string;
}

export interface InstrumentMeta {
  instrumentID: number;
  instrumentDisplayName: string;
  symbolFull: string;
  instrumentTypeID?: number;
  exchangeID?: number;
  images?: EtoroInstrumentImage[];
}

export interface InstrumentsResponse {
  instrumentDisplayDatas: InstrumentMeta[];
}

// GET /api/v1/agent-portfolios
export interface AgentPortfolioItem {
  agentPortfolioId: string;
  agentPortfolioName: string;
  agentPortfolioGcid: number;
  agentPortfolioVirtualBalance: number;
  mirrorId: number;
  createdAt: string;
}

export interface GetAgentPortfoliosResponse {
  agentPortfolios: AgentPortfolioItem[];
}

// GET /api/v1/user-info/people?cidList= — lowerCamel; shape is defensive
export interface PeopleUser {
  gcid?: number;
  cid?: number;
  customerId?: number;
  realCID?: number;
  username?: string;
  userName?: string;
  fullName?: string;
  avatars?: unknown;
}
