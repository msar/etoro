/**
 * History storage factory — local SQLite (default) or remote Supabase.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getHistoryBackend,
  hasSupabaseCredentials,
  loadCredentials,
  type HistoryBackend,
} from '../credentials.js';
import { SqliteClient } from './sqliteClient.js';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
export const LOCAL_DB_PATH = join(DATA_DIR, 'history.sqlite');

/** Minimal client surface shared by SQLite shim and supabase-js. */
export type HistoryClient = {
  from: (table: string) => unknown;
};

let sqlite: SqliteClient | null = null;
let supabase: SupabaseClient | null = null;
let supabaseKey: string | null = null;

export function getHistoryBackendName(): HistoryBackend {
  return getHistoryBackend();
}

/** True when the active history backend is ready to use. */
export function isHistoryConfigured(): boolean {
  const backend = getHistoryBackend();
  if (backend === 'local') return true;
  return hasSupabaseCredentials();
}

export function resetHistoryClient(): void {
  if (sqlite) {
    try {
      sqlite.close();
    } catch {
      // ignore
    }
    sqlite = null;
  }
  supabase = null;
  supabaseKey = null;
}

export function getLocalDbPath(): string {
  return LOCAL_DB_PATH;
}

function getSqlite(): SqliteClient {
  if (!sqlite) {
    sqlite = new SqliteClient(LOCAL_DB_PATH);
  }
  return sqlite;
}

function getSupabaseClient(): SupabaseClient {
  const c = loadCredentials();
  if (!c?.supabaseUrl || !c.supabaseServiceRoleKey) {
    throw new Error(
      'Supabase credentials are not configured. Switch history storage to Local or paste Supabase keys.',
    );
  }
  const key = `${c.supabaseUrl}|${c.supabaseServiceRoleKey}`;
  if (!supabase || supabaseKey !== key) {
    supabase = createClient(c.supabaseUrl, c.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    supabaseKey = key;
  }
  return supabase;
}

/**
 * Active history client (SQLite or Supabase). Call sites keep using
 * `.from(...).select/upsert/...` against this object.
 */
export function getDb(): HistoryClient {
  if (getHistoryBackend() === 'supabase') {
    return getSupabaseClient() as unknown as HistoryClient;
  }
  return getSqlite();
}

/** Ensure local DB file/schema exists (safe to call on startup). */
export function ensureLocalDb(): string {
  getSqlite();
  return LOCAL_DB_PATH;
}
