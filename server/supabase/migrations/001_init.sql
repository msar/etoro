-- Portfolio Evolution — full history schema for Supabase.
-- Run this once in the Supabase SQL Editor (Dashboard → SQL → New query).
-- Safe to re-run (IF NOT EXISTS). Local SQLite users can ignore this file.

-- ---------------------------------------------------------------------------
-- eToro identity
-- ---------------------------------------------------------------------------
create table if not exists accounts (
  gcid bigint primary key,
  username text,
  environment text not null default 'real',
  trading_account_id text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Broker-agnostic accounts (eToro, ABN AMRO, E*TRADE, Kraken, …)
-- ---------------------------------------------------------------------------
create table if not exists broker_accounts (
  id text primary key,
  broker text not null,
  display_name text,
  currency text not null default 'EUR',
  external_ref text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists broker_accounts_broker_idx
  on broker_accounts (broker);

-- ---------------------------------------------------------------------------
-- Daily equity / cash snapshots
-- ---------------------------------------------------------------------------
create table if not exists balance_snapshots (
  gcid bigint references accounts (gcid) on delete cascade,
  account_id text not null references broker_accounts (id) on delete cascade,
  date date not null,
  cash double precision not null default 0,
  invested double precision not null default 0,
  pnl double precision not null default 0,
  total double precision not null default 0,
  net_flow double precision not null default 0,
  primary key (account_id, date)
);

create index if not exists balance_snapshots_gcid_date_idx
  on balance_snapshots (gcid, date);

create index if not exists balance_snapshots_account_date_idx
  on balance_snapshots (account_id, date);

-- ---------------------------------------------------------------------------
-- Closed trades (eToro)
-- ---------------------------------------------------------------------------
create table if not exists closed_trades (
  gcid bigint not null references accounts (gcid) on delete cascade,
  position_id bigint not null,
  instrument_id integer not null,
  is_buy boolean not null default true,
  leverage integer not null default 1,
  open_rate double precision not null default 0,
  close_rate double precision not null default 0,
  investment double precision not null default 0,
  fees double precision not null default 0,
  units double precision not null default 0,
  net_profit double precision not null default 0,
  open_timestamp timestamptz not null,
  close_timestamp timestamptz not null,
  symbol text,
  primary key (position_id)
);

create index if not exists closed_trades_gcid_close_idx
  on closed_trades (gcid, close_timestamp desc);

create index if not exists closed_trades_gcid_symbol_idx
  on closed_trades (gcid, symbol);

-- ---------------------------------------------------------------------------
-- Point-in-time holdings (eToro sync)
-- ---------------------------------------------------------------------------
create table if not exists holding_snapshots (
  gcid bigint not null references accounts (gcid) on delete cascade,
  date date not null,
  instrument_id integer not null,
  invested double precision not null default 0,
  value double precision not null default 0,
  pnl double precision not null default 0,
  pnl_percent double precision not null default 0,
  net_units double precision not null default 0,
  via_copy boolean not null default false,
  primary key (gcid, date, instrument_id)
);

create index if not exists holding_snapshots_gcid_date_idx
  on holding_snapshots (gcid, date);

-- ---------------------------------------------------------------------------
-- Dividends (eToro statement import)
-- ---------------------------------------------------------------------------
create table if not exists dividends (
  gcid bigint not null references accounts (gcid) on delete cascade,
  position_id bigint not null,
  pay_date date not null,
  instrument_name text,
  isin text,
  net_dividend_usd double precision not null default 0,
  withholding_tax_usd double precision not null default 0,
  withholding_tax_rate double precision not null default 0,
  asset_type text,
  primary key (gcid, position_id, pay_date)
);

create index if not exists dividends_gcid_date_idx
  on dividends (gcid, pay_date desc);

-- ---------------------------------------------------------------------------
-- Statement holdings (ABN AMRO / Kraken / similar)
-- ---------------------------------------------------------------------------
create table if not exists statement_holdings (
  account_id text not null references broker_accounts (id) on delete cascade,
  date date not null,
  isin text not null default '',
  name text,
  asset_class text not null default 'Other',
  quantity double precision not null default 0,
  price double precision not null default 0,
  value double precision not null default 0,
  primary key (account_id, date, isin, asset_class)
);

create index if not exists statement_holdings_account_date_idx
  on statement_holdings (account_id, date);

-- ---------------------------------------------------------------------------
-- Import log + dedup for uploaded statements
-- ---------------------------------------------------------------------------
create table if not exists statement_imports (
  id bigserial primary key,
  account_id text not null references broker_accounts (id) on delete cascade,
  broker text not null,
  file_hash text not null,
  file_name text,
  statement_date date not null,
  total_balance double precision,
  net_flow double precision,
  service_costs double precision,
  product_costs double precision,
  realized_result double precision,
  unrealized_result double precision,
  unrealized_result_pct double precision,
  period_start date,
  period_end date,
  imported_at timestamptz not null default now(),
  unique (account_id, file_hash)
);

create index if not exists statement_imports_account_date_idx
  on statement_imports (account_id, statement_date desc);

-- ---------------------------------------------------------------------------
-- FX rate cache (ECB via frankfurter.app)
-- ---------------------------------------------------------------------------
create table if not exists fx_rates (
  date date not null,
  base text not null,
  quote text not null,
  rate double precision not null,
  primary key (date, base, quote)
);

-- ---------------------------------------------------------------------------
-- Broker closed lots (E*TRADE G&L, etc.)
-- ---------------------------------------------------------------------------
create table if not exists broker_lots (
  account_id text not null references broker_accounts (id) on delete cascade,
  lot_key text not null,
  broker text not null,
  symbol text not null,
  quantity double precision not null default 0,
  date_acquired date,
  date_sold date not null,
  adjusted_cost double precision not null default 0,
  proceeds double precision not null default 0,
  adjusted_gain double precision not null default 0,
  capital_gains_status text,
  plan_type text,
  order_number text,
  raw jsonb,
  primary key (account_id, lot_key)
);

create index if not exists broker_lots_account_sold_idx
  on broker_lots (account_id, date_sold);

create index if not exists broker_lots_account_symbol_idx
  on broker_lots (account_id, symbol);

-- ---------------------------------------------------------------------------
-- RLS: service role bypasses; anon key stays locked out of finance data
-- ---------------------------------------------------------------------------
alter table accounts enable row level security;
alter table broker_accounts enable row level security;
alter table balance_snapshots enable row level security;
alter table closed_trades enable row level security;
alter table holding_snapshots enable row level security;
alter table dividends enable row level security;
alter table statement_holdings enable row level security;
alter table statement_imports enable row level security;
alter table fx_rates enable row level security;
alter table broker_lots enable row level security;
