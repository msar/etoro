import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const CREDENTIALS_PATH = join(DATA_DIR, 'credentials.json');

export interface AppCredentials {
  etoroApiKey: string;
  etoroUserKey: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
}

let memoryCache: AppCredentials | null | undefined;

function fromEnv(): AppCredentials | null {
  const etoroApiKey = process.env.ETORO_API_KEY?.trim();
  const etoroUserKey = process.env.ETORO_USER_KEY?.trim();
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!etoroApiKey || !etoroUserKey || !supabaseUrl || !supabaseServiceRoleKey) return null;
  return { etoroApiKey, etoroUserKey, supabaseUrl, supabaseServiceRoleKey };
}

function fromFile(): AppCredentials | null {
  if (!existsSync(CREDENTIALS_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8')) as Partial<AppCredentials>;
    if (
      !raw.etoroApiKey?.trim() ||
      !raw.etoroUserKey?.trim() ||
      !raw.supabaseUrl?.trim() ||
      !raw.supabaseServiceRoleKey?.trim()
    ) {
      return null;
    }
    return {
      etoroApiKey: raw.etoroApiKey.trim(),
      etoroUserKey: raw.etoroUserKey.trim(),
      supabaseUrl: raw.supabaseUrl.trim().replace(/\/$/, ''),
      supabaseServiceRoleKey: raw.supabaseServiceRoleKey.trim(),
    };
  } catch {
    return null;
  }
}

/** File-based credentials take precedence; env vars are a power-user override fallback. */
export function loadCredentials(): AppCredentials | null {
  if (memoryCache !== undefined) return memoryCache;
  const file = fromFile();
  if (file) {
    memoryCache = file;
    return file;
  }
  const env = fromEnv();
  memoryCache = env;
  return env;
}

export function hasCredentials(): boolean {
  return loadCredentials() !== null;
}

export function hasEtoroCredentials(): boolean {
  const c = loadCredentials();
  return Boolean(c?.etoroApiKey && c?.etoroUserKey);
}

export function hasSupabaseCredentials(): boolean {
  const c = loadCredentials();
  return Boolean(c?.supabaseUrl && c?.supabaseServiceRoleKey);
}

export function saveCredentials(creds: AppCredentials): void {
  const normalized: AppCredentials = {
    etoroApiKey: creds.etoroApiKey.trim(),
    etoroUserKey: creds.etoroUserKey.trim(),
    supabaseUrl: creds.supabaseUrl.trim().replace(/\/$/, ''),
    supabaseServiceRoleKey: creds.supabaseServiceRoleKey.trim(),
  };
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CREDENTIALS_PATH, JSON.stringify(normalized, null, 2) + '\n', { mode: 0o600 });
  memoryCache = normalized;
}

export function clearCredentials(): void {
  if (existsSync(CREDENTIALS_PATH)) unlinkSync(CREDENTIALS_PATH);
  memoryCache = null;
}

/** Invalidate in-memory cache (e.g. after external file edit). */
export function invalidateCredentialsCache(): void {
  memoryCache = undefined;
}

export function credentialsPath(): string {
  return CREDENTIALS_PATH;
}
