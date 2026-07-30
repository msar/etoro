-- Migration 002: instrument symbols on closed trades + dividends table.
-- Run once in the Supabase SQL Editor (Dashboard → SQL → New query).

-- Statement imports know the ticker even when the numeric eToro instrument id
-- has not been resolved yet; store it so analytics can group by instrument.
alter table closed_trades add column if not exists symbol text;

create index if not exists closed_trades_gcid_symbol_idx
  on closed_trades (gcid, symbol);

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

alter table dividends enable row level security;
