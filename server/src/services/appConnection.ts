/**
 * Sync / restore connection state (API keys + enabled brokers) via Supabase.
 * Only used when historyBackend === 'supabase'. Local SQLite history stays history-only.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isBrokerId, type BrokerId } from '../brokers.js';
import {
  getHistoryBackend,
  hasSupabaseCredentials,
  loadCredentials,
} from '../credentials.js';
import { loadEnabledBrokers } from '../preferences.js';
import { getSupabase } from '../supabase.js';

const ROW_ID = 'default';

export interface AppConnectionPayload {
  etoroApiKey?: string;
  etoroUserKey?: string;
  krakenApiKey?: string;
  krakenApiSecret?: string;
  enabledBrokers: BrokerId[];
}

interface AppConnectionRow {
  id: string;
  etoro_api_key: string | null;
  etoro_user_key: string | null;
  kraken_api_key: string | null;
  kraken_api_secret: string | null;
  enabled_brokers: string[] | null;
  updated_at?: string;
}

function isMissingTableError(message: string, code?: string): boolean {
  return (
    code === 'PGRST205' ||
    /schema cache|Could not find the table|app_connection/i.test(message)
  );
}

function parseEnabledBrokers(raw: unknown): BrokerId[] {
  if (!Array.isArray(raw)) return [];
  const out: BrokerId[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && isBrokerId(item) && !out.includes(item)) {
      out.push(item);
    }
  }
  return out;
}

function rowToPayload(row: AppConnectionRow): AppConnectionPayload {
  const etoroApiKey = row.etoro_api_key?.trim() || undefined;
  const etoroUserKey = row.etoro_user_key?.trim() || undefined;
  const krakenApiKey = row.kraken_api_key?.trim() || undefined;
  const krakenApiSecret = row.kraken_api_secret?.trim() || undefined;
  return {
    ...(etoroApiKey && etoroUserKey ? { etoroApiKey, etoroUserKey } : {}),
    ...(krakenApiKey && krakenApiSecret ? { krakenApiKey, krakenApiSecret } : {}),
    enabledBrokers: parseEnabledBrokers(row.enabled_brokers),
  };
}

function createOneOffClient(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url.trim().replace(/\/$/, ''), serviceRoleKey.trim(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function resolveEnabledBrokers(): BrokerId[] {
  const fromPrefs = loadEnabledBrokers();
  if (fromPrefs !== null) return fromPrefs;
  const c = loadCredentials();
  return c?.enabledBrokers ? [...c.enabledBrokers] : [];
}

/**
 * Upsert local connection state into app_connection.
 * No-op for local history backend or missing Supabase keys.
 * Missing table → soft warn (user has not run migration 002 yet).
 */
export async function pushAppConnection(): Promise<void> {
  if (getHistoryBackend() !== 'supabase' || !hasSupabaseCredentials()) return;

  const c = loadCredentials();
  if (!c) return;

  const enabled = resolveEnabledBrokers();
  const row = {
    id: ROW_ID,
    etoro_api_key: c.etoroApiKey ?? null,
    etoro_user_key: c.etoroUserKey ?? null,
    kraken_api_key: c.krakenApiKey ?? null,
    kraken_api_secret: c.krakenApiSecret ?? null,
    enabled_brokers: enabled,
    updated_at: new Date().toISOString(),
  };

  try {
    const sb = getSupabase();
    const { error } = await sb.from('app_connection').upsert(row, { onConflict: 'id' });
    if (error) {
      if (isMissingTableError(error.message, error.code)) {
        console.warn(
          'app_connection table missing — run server/supabase/migrations/002_app_connection.sql to enable cloud restore.',
        );
        return;
      }
      console.warn('pushAppConnection:', error.message);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('pushAppConnection:', msg);
  }
}

/**
 * Read connection backup with candidate Supabase keys (before local creds exist).
 */
export async function pullAppConnection(
  url: string,
  serviceRoleKey: string,
): Promise<AppConnectionPayload | null> {
  const client = createOneOffClient(url, serviceRoleKey);
  const { data, error } = await client
    .from('app_connection')
    .select(
      'id, etoro_api_key, etoro_user_key, kraken_api_key, kraken_api_secret, enabled_brokers, updated_at',
    )
    .eq('id', ROW_ID)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error.message, error.code)) {
      throw new Error(
        'app_connection table not found. Run server/supabase/migrations/002_app_connection.sql in the SQL editor, then save credentials once to create a backup.',
      );
    }
    throw new Error(`Could not read connection backup: ${error.message}`);
  }

  if (!data) return null;
  return rowToPayload(data as AppConnectionRow);
}

/**
 * Distinct broker ids present in broker_accounts (history-backed connections).
 * Uses a one-off client when url/key provided; otherwise the active history client.
 */
export async function listBrokersFromHistory(
  url?: string,
  serviceRoleKey?: string,
): Promise<BrokerId[]> {
  let client: SupabaseClient;
  if (url && serviceRoleKey) {
    client = createOneOffClient(url, serviceRoleKey);
  } else if (getHistoryBackend() === 'supabase' && hasSupabaseCredentials()) {
    client = getSupabase();
  } else {
    return [];
  }

  const { data, error } = await client.from('broker_accounts').select('broker');
  if (error) {
    if (isMissingTableError(error.message, error.code)) return [];
    console.warn('listBrokersFromHistory:', error.message);
    return [];
  }

  const out: BrokerId[] = [];
  for (const row of data ?? []) {
    const broker = (row as { broker?: string }).broker;
    if (typeof broker === 'string' && isBrokerId(broker) && !out.includes(broker)) {
      out.push(broker);
    }
  }
  return out;
}

/** Union of broker id lists, preserving first-seen order. */
export function unionBrokerIds(...lists: BrokerId[][]): BrokerId[] {
  const out: BrokerId[] = [];
  for (const list of lists) {
    for (const id of list) {
      if (isBrokerId(id) && !out.includes(id)) out.push(id);
    }
  }
  return out;
}
