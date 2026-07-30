-- Portfolio history storage for eToro Portfolio Evolution.
-- Run once in the Supabase SQL Editor (Dashboard → SQL → New query).

create table if not exists accounts (
  gcid bigint primary key,
  username text,
  environment text not null default 'real',
  trading_account_id text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists balance_snapshots (
  gcid bigint not null references accounts (gcid) on delete cascade,
  date date not null,
  cash double precision not null default 0,
  invested double precision not null default 0,
  pnl double precision not null default 0,
  total double precision not null default 0,
  net_flow double precision not null default 0,
  primary key (gcid, date)
);

create index if not exists balance_snapshots_gcid_date_idx
  on balance_snapshots (gcid, date);

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
  primary key (position_id)
);

create index if not exists closed_trades_gcid_close_idx
  on closed_trades (gcid, close_timestamp desc);

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

-- Service role bypasses RLS; keep RLS on so the anon key cannot read finance data.
alter table accounts enable row level security;
alter table balance_snapshots enable row level security;
alter table closed_trades enable row level security;
alter table holding_snapshots enable row level security;
