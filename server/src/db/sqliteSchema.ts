/**
 * Final SQLite schema for Portfolio Evolution history (local backend).
 * Mirrors server/supabase/migrations/001_init.sql without Postgres-only features (RLS, jsonb).
 */
export const SQLITE_SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
  gcid INTEGER PRIMARY KEY,
  username TEXT,
  environment TEXT NOT NULL DEFAULT 'real',
  trading_account_id TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS broker_accounts (
  id TEXT PRIMARY KEY,
  broker TEXT NOT NULL,
  display_name TEXT,
  currency TEXT NOT NULL DEFAULT 'EUR',
  external_ref TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS broker_accounts_broker_idx ON broker_accounts (broker);

CREATE TABLE IF NOT EXISTS balance_snapshots (
  gcid INTEGER,
  account_id TEXT NOT NULL REFERENCES broker_accounts (id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  cash REAL NOT NULL DEFAULT 0,
  invested REAL NOT NULL DEFAULT 0,
  pnl REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  net_flow REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, date)
);

CREATE INDEX IF NOT EXISTS balance_snapshots_gcid_date_idx ON balance_snapshots (gcid, date);
CREATE INDEX IF NOT EXISTS balance_snapshots_account_date_idx ON balance_snapshots (account_id, date);

CREATE TABLE IF NOT EXISTS closed_trades (
  gcid INTEGER NOT NULL REFERENCES accounts (gcid) ON DELETE CASCADE,
  position_id INTEGER NOT NULL PRIMARY KEY,
  instrument_id INTEGER NOT NULL,
  is_buy INTEGER NOT NULL DEFAULT 1,
  leverage INTEGER NOT NULL DEFAULT 1,
  open_rate REAL NOT NULL DEFAULT 0,
  close_rate REAL NOT NULL DEFAULT 0,
  investment REAL NOT NULL DEFAULT 0,
  fees REAL NOT NULL DEFAULT 0,
  units REAL NOT NULL DEFAULT 0,
  net_profit REAL NOT NULL DEFAULT 0,
  open_timestamp TEXT NOT NULL,
  close_timestamp TEXT NOT NULL,
  symbol TEXT
);

CREATE INDEX IF NOT EXISTS closed_trades_gcid_close_idx ON closed_trades (gcid, close_timestamp DESC);
CREATE INDEX IF NOT EXISTS closed_trades_gcid_symbol_idx ON closed_trades (gcid, symbol);

CREATE TABLE IF NOT EXISTS holding_snapshots (
  gcid INTEGER NOT NULL REFERENCES accounts (gcid) ON DELETE CASCADE,
  date TEXT NOT NULL,
  instrument_id INTEGER NOT NULL,
  invested REAL NOT NULL DEFAULT 0,
  value REAL NOT NULL DEFAULT 0,
  pnl REAL NOT NULL DEFAULT 0,
  pnl_percent REAL NOT NULL DEFAULT 0,
  net_units REAL NOT NULL DEFAULT 0,
  via_copy INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (gcid, date, instrument_id)
);

CREATE INDEX IF NOT EXISTS holding_snapshots_gcid_date_idx ON holding_snapshots (gcid, date);

CREATE TABLE IF NOT EXISTS dividends (
  gcid INTEGER NOT NULL REFERENCES accounts (gcid) ON DELETE CASCADE,
  position_id INTEGER NOT NULL,
  pay_date TEXT NOT NULL,
  instrument_name TEXT,
  isin TEXT,
  net_dividend_usd REAL NOT NULL DEFAULT 0,
  withholding_tax_usd REAL NOT NULL DEFAULT 0,
  withholding_tax_rate REAL NOT NULL DEFAULT 0,
  asset_type TEXT,
  PRIMARY KEY (gcid, position_id, pay_date)
);

CREATE INDEX IF NOT EXISTS dividends_gcid_date_idx ON dividends (gcid, pay_date DESC);

CREATE TABLE IF NOT EXISTS statement_holdings (
  account_id TEXT NOT NULL REFERENCES broker_accounts (id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  isin TEXT NOT NULL DEFAULT '',
  name TEXT,
  asset_class TEXT NOT NULL DEFAULT 'Other',
  quantity REAL NOT NULL DEFAULT 0,
  price REAL NOT NULL DEFAULT 0,
  value REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, date, isin, asset_class)
);

CREATE INDEX IF NOT EXISTS statement_holdings_account_date_idx ON statement_holdings (account_id, date);

CREATE TABLE IF NOT EXISTS statement_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES broker_accounts (id) ON DELETE CASCADE,
  broker TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  file_name TEXT,
  statement_date TEXT NOT NULL,
  total_balance REAL,
  net_flow REAL,
  service_costs REAL,
  product_costs REAL,
  realized_result REAL,
  unrealized_result REAL,
  unrealized_result_pct REAL,
  period_start TEXT,
  period_end TEXT,
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (account_id, file_hash)
);

CREATE INDEX IF NOT EXISTS statement_imports_account_date_idx
  ON statement_imports (account_id, statement_date DESC);

CREATE TABLE IF NOT EXISTS fx_rates (
  date TEXT NOT NULL,
  base TEXT NOT NULL,
  quote TEXT NOT NULL,
  rate REAL NOT NULL,
  PRIMARY KEY (date, base, quote)
);

CREATE TABLE IF NOT EXISTS broker_lots (
  account_id TEXT NOT NULL REFERENCES broker_accounts (id) ON DELETE CASCADE,
  lot_key TEXT NOT NULL,
  broker TEXT NOT NULL,
  symbol TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,
  date_acquired TEXT,
  date_sold TEXT NOT NULL,
  adjusted_cost REAL NOT NULL DEFAULT 0,
  proceeds REAL NOT NULL DEFAULT 0,
  adjusted_gain REAL NOT NULL DEFAULT 0,
  capital_gains_status TEXT,
  plan_type TEXT,
  order_number TEXT,
  raw TEXT,
  PRIMARY KEY (account_id, lot_key)
);

CREATE INDEX IF NOT EXISTS broker_lots_account_sold_idx ON broker_lots (account_id, date_sold);
CREATE INDEX IF NOT EXISTS broker_lots_account_symbol_idx ON broker_lots (account_id, symbol);
`;

export const SQLITE_SCHEMA_VERSION = 'local-v1';
