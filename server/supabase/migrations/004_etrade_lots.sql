-- Migration 004: E*TRADE / broker closed lots from G&L exports.
-- Run once in the Supabase SQL Editor (Dashboard → SQL → New query).

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

alter table broker_lots enable row level security;
