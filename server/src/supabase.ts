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

export interface BrokerAccountRow {
  id: string;
  broker: string;
  display_name: string | null;
  currency: string;
  external_ref: string | null;
  last_synced_at: string | null;
  created_at?: string;
}

export interface BalanceSnapshotRow {
  /** eToro gcid when broker is etoro; null for statement-based brokers */
  gcid: number | null;
  account_id: string;
  date: string;
  cash: number;
  invested: number;
  pnl: number;
  total: number;
  net_flow: number;
}

export interface StatementHoldingRow {
  account_id: string;
  date: string;
  isin: string;
  name: string | null;
  asset_class: string;
  quantity: number;
  price: number;
  value: number;
}

export interface StatementImportRow {
  id?: number;
  account_id: string;
  broker: string;
  file_hash: string;
  file_name: string | null;
  statement_date: string;
  total_balance: number | null;
  net_flow: number | null;
  service_costs: number | null;
  product_costs: number | null;
  realized_result: number | null;
  unrealized_result: number | null;
  unrealized_result_pct: number | null;
  period_start: string | null;
  period_end: string | null;
  imported_at?: string;
}

export interface FxRateRow {
  date: string;
  base: string;
  quote: string;
  rate: number;
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
  /** Ticker from statement imports; null for API-synced rows (migration 002). */
  symbol?: string | null;
}

export interface DividendRow {
  gcid: number;
  position_id: number;
  pay_date: string;
  instrument_name: string | null;
  isin: string | null;
  net_dividend_usd: number;
  withholding_tax_usd: number;
  withholding_tax_rate: number;
  asset_type: string | null;
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

const PAGE_SIZE = 1000;

/**
 * Fetch ALL rows for a query, working around PostgREST's 1000-row cap.
 * `buildQuery` must apply the same filters/ordering every call; pagination
 * is layered on top via `.range()`.
 */
export async function selectAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) return { rows, error: error.message };
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return { rows, error: null };
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
