-- Migration 003: multi-broker support.
-- Run once in the Supabase SQL Editor (Dashboard → SQL → New query).

-- ---------------------------------------------------------------------------
-- Broker-agnostic accounts (eToro, ABN AMRO, and future brokers)
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

-- Backfill one broker_accounts row per existing eToro account (id = gcid text).
insert into broker_accounts (id, broker, display_name, currency, external_ref, last_synced_at)
select
  gcid::text,
  'etoro',
  coalesce(username, 'eToro'),
  'USD',
  gcid::text,
  last_synced_at
from accounts
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- balance_snapshots: add account_id, allow broker-agnostic rows
-- ---------------------------------------------------------------------------
alter table balance_snapshots add column if not exists account_id text;

update balance_snapshots
set account_id = gcid::text
where account_id is null and gcid is not null;

-- Drop old PK so we can make gcid nullable and switch to (account_id, date).
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'balance_snapshots_pkey'
      and conrelid = 'balance_snapshots'::regclass
  ) then
    alter table balance_snapshots drop constraint balance_snapshots_pkey;
  end if;
end $$;

alter table balance_snapshots alter column gcid drop not null;

-- Rows without account_id cannot be part of the new PK; delete orphans if any.
delete from balance_snapshots where account_id is null;

alter table balance_snapshots alter column account_id set not null;

alter table balance_snapshots
  add constraint balance_snapshots_pkey primary key (account_id, date);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'balance_snapshots_account_id_fkey'
  ) then
    alter table balance_snapshots
      add constraint balance_snapshots_account_id_fkey
      foreign key (account_id) references broker_accounts (id) on delete cascade;
  end if;
end $$;

create index if not exists balance_snapshots_account_date_idx
  on balance_snapshots (account_id, date);

-- ---------------------------------------------------------------------------
-- Statement holdings (ABN AMRO Guided Investing and similar PDF brokers)
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
-- RLS (service role bypasses; anon key stays locked out)
-- ---------------------------------------------------------------------------
alter table broker_accounts enable row level security;
alter table statement_holdings enable row level security;
alter table statement_imports enable row level security;
alter table fx_rates enable row level security;
