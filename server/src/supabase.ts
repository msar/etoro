import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadCredentials } from './credentials.js';

export interface AccountRow {
  gcid: number;
  username: string | null;
  environment: string;
  trading_account_id: string | null;
  last_synced_at: string | null;
  created_at?: string;
}

export interface BalanceSnapshotRow {
  gcid: number;
  date: string;
  cash: number;
  invested: number;
  pnl: number;
  total: number;
  net_flow: number;
}

export interface ClosedTradeRow {
  gcid: number;
  position_id: number;
  instrument_id: number;
  is_buy: boolean;
  leverage: number;
  open_rate: number;
  close_rate: number;
  investment: number;
  fees: number;
  units: number;
  net_profit: number;
  open_timestamp: string;
  close_timestamp: string;
}

export interface HoldingSnapshotRow {
  gcid: number;
  date: string;
  instrument_id: number;
  invested: number;
  value: number;
  pnl: number;
  pnl_percent: number;
  net_units: number;
  via_copy: boolean;
}

let client: SupabaseClient | null = null;
let clientKey: string | null = null;

/** True when Supabase credentials are present (file or env). */
export function isSupabaseConfigured(): boolean {
  const c = loadCredentials();
  return Boolean(c?.supabaseUrl && c?.supabaseServiceRoleKey);
}

/** Drop the cached client so the next call picks up new credentials. */
export function resetSupabaseClient(): void {
  client = null;
  clientKey = null;
}

/**
 * Server-only Supabase client using the service role key (bypasses RLS).
 * Never import this into the Vite frontend.
 */
export function getSupabase(): SupabaseClient {
  const c = loadCredentials();
  if (!c?.supabaseUrl || !c.supabaseServiceRoleKey) {
    throw new Error('Supabase credentials are not configured. Use the login screen to save them.');
  }
  const key = `${c.supabaseUrl}|${c.supabaseServiceRoleKey}`;
  if (!client || clientKey !== key) {
    client = createClient(c.supabaseUrl, c.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    clientKey = key;
  }
  return client;
}

/** Lightweight connectivity check with candidate keys (before save). */
export async function probeSupabase(url: string, serviceRoleKey: string): Promise<void> {
  const normalized = url.trim().replace(/\/$/, '');
  const probe = createClient(normalized, serviceRoleKey.trim(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Any authenticated REST call that reaches PostgREST proves the URL + key work.
  // Missing tables still return a structured error with HTTP 200/404 from PostgREST —
  // network/auth failures throw or return 401.
  const { error } = await probe.from('accounts').select('gcid').limit(1);
  if (error) {
    // PGRST205 = table missing in schema cache — credentials are fine, migration pending.
    if (error.code === 'PGRST205' || /schema cache|Could not find the table/i.test(error.message)) {
      return;
    }
    if (/JWT|Invalid API key|401|403|Unauthorized/i.test(error.message)) {
      throw new Error(`Supabase rejected the service role key: ${error.message}`);
    }
    // Other errors (e.g. empty project) still mean we could authenticate.
    if (/Failed to fetch|ENOTFOUND|network/i.test(error.message)) {
      throw new Error(`Could not reach Supabase URL: ${error.message}`);
    }
  }
}
