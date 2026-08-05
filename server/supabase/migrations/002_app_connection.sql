-- Portfolio Evolution — connection backup for wipe/reinstall restore.
-- Run once in the Supabase SQL Editor after 001_init.sql.
-- Safe to re-run (IF NOT EXISTS). Stores API keys in YOUR project only
-- (service_role bypasses RLS; anon key stays locked out).

create table if not exists app_connection (
  id text primary key default 'default',
  etoro_api_key text,
  etoro_user_key text,
  kraken_api_key text,
  kraken_api_secret text,
  enabled_brokers text[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table app_connection enable row level security;
