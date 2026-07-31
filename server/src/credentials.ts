import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROKER_IDS, isBrokerId, type BrokerId } from './brokers.js';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const CREDENTIALS_PATH = join(DATA_DIR, 'credentials.json');

export interface AppCredentials {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  etoroApiKey?: string;
  etoroUserKey?: string;
  krakenApiKey?: string;
  krakenApiSecret?: string;
  /** Brokers shown on Overview / nav. Undefined = legacy (infer on first read). */
  enabledBrokers?: BrokerId[];
}

let memoryCache: AppCredentials | null | undefined;

function trimOrEmpty(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function parseEnabledBrokers(raw: unknown): BrokerId[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: BrokerId[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && isBrokerId(item) && !out.includes(item)) {
      out.push(item);
    }
  }
  return out;
}

function normalize(raw: Partial<AppCredentials> & Record<string, unknown>): AppCredentials | null {
  const supabaseUrl = trimOrEmpty(raw.supabaseUrl).replace(/\/$/, '');
  const supabaseServiceRoleKey = trimOrEmpty(raw.supabaseServiceRoleKey);
  if (!supabaseUrl || !supabaseServiceRoleKey) return null;

  const etoroApiKey = trimOrEmpty(raw.etoroApiKey) || undefined;
  const etoroUserKey = trimOrEmpty(raw.etoroUserKey) || undefined;
  const krakenApiKey = trimOrEmpty(raw.krakenApiKey) || undefined;
  const krakenApiSecret = trimOrEmpty(raw.krakenApiSecret) || undefined;
  const enabledBrokers = parseEnabledBrokers(raw.enabledBrokers);

  return {
    supabaseUrl,
    supabaseServiceRoleKey,
    ...(etoroApiKey && etoroUserKey ? { etoroApiKey, etoroUserKey } : {}),
    ...(krakenApiKey && krakenApiSecret ? { krakenApiKey, krakenApiSecret } : {}),
    ...(enabledBrokers !== undefined ? { enabledBrokers } : {}),
  };
}

function fromEnv(): AppCredentials | null {
  return normalize({
    etoroApiKey: process.env.ETORO_API_KEY,
    etoroUserKey: process.env.ETORO_USER_KEY,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    krakenApiKey: process.env.KRAKEN_API_KEY,
    krakenApiSecret: process.env.KRAKEN_API_SECRET,
  });
}

function fromFile(): AppCredentials | null {
  if (!existsSync(CREDENTIALS_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8')) as Record<string, unknown>;
    return normalize(raw);
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

export function hasKrakenCredentials(): boolean {
  const c = loadCredentials();
  return Boolean(c?.krakenApiKey && c?.krakenApiSecret);
}

export function hasSupabaseCredentials(): boolean {
  const c = loadCredentials();
  return Boolean(c?.supabaseUrl && c?.supabaseServiceRoleKey);
}

/** Full replace (used by eToro login). Preserves Kraken keys / enabledBrokers when omitted. */
export function saveCredentials(creds: AppCredentials): void {
  const existing = fromFile();
  const merged = normalize({
    ...existing,
    ...creds,
    // Explicit empty strings from callers clear optional broker keys only when provided as ''.
    etoroApiKey: creds.etoroApiKey ?? existing?.etoroApiKey,
    etoroUserKey: creds.etoroUserKey ?? existing?.etoroUserKey,
    krakenApiKey:
      creds.krakenApiKey !== undefined ? creds.krakenApiKey : existing?.krakenApiKey,
    krakenApiSecret:
      creds.krakenApiSecret !== undefined ? creds.krakenApiSecret : existing?.krakenApiSecret,
    enabledBrokers:
      creds.enabledBrokers !== undefined ? creds.enabledBrokers : existing?.enabledBrokers,
  });
  if (!merged) {
    throw new Error('Supabase URL and service role key are required to save credentials');
  }
  persist(merged);
}

/** Merge partial fields into the credentials file (creates file if supabase provided). */
export function updateCredentials(patch: Partial<AppCredentials>): AppCredentials {
  const existing = loadCredentials();
  const merged = normalize({
    supabaseUrl: patch.supabaseUrl ?? existing?.supabaseUrl,
    supabaseServiceRoleKey: patch.supabaseServiceRoleKey ?? existing?.supabaseServiceRoleKey,
    etoroApiKey:
      patch.etoroApiKey !== undefined ? patch.etoroApiKey : existing?.etoroApiKey,
    etoroUserKey:
      patch.etoroUserKey !== undefined ? patch.etoroUserKey : existing?.etoroUserKey,
    krakenApiKey:
      patch.krakenApiKey !== undefined ? patch.krakenApiKey : existing?.krakenApiKey,
    krakenApiSecret:
      patch.krakenApiSecret !== undefined ? patch.krakenApiSecret : existing?.krakenApiSecret,
    enabledBrokers:
      patch.enabledBrokers !== undefined ? patch.enabledBrokers : existing?.enabledBrokers,
  });
  if (!merged) {
    throw new Error('Supabase URL and service role key are required');
  }
  persist(merged);
  return merged;
}

function persist(creds: AppCredentials): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2) + '\n', { mode: 0o600 });
  memoryCache = creds;
}

export function clearCredentials(): void {
  if (existsSync(CREDENTIALS_PATH)) unlinkSync(CREDENTIALS_PATH);
  memoryCache = null;
}

export function clearKrakenCredentials(): void {
  const c = loadCredentials();
  if (!c) return;
  const { krakenApiKey: _k, krakenApiSecret: _s, ...rest } = c;
  persist(rest);
}

export function getEnabledBrokers(): BrokerId[] | null {
  const c = loadCredentials();
  if (!c) return null;
  if (c.enabledBrokers !== undefined) return [...c.enabledBrokers];
  return null;
}

export function setEnabledBrokers(ids: BrokerId[]): BrokerId[] {
  const unique = ids.filter((id, i) => BROKER_IDS.includes(id) && ids.indexOf(id) === i);
  updateCredentials({ enabledBrokers: unique });
  return unique;
}

/** Invalidate in-memory cache (e.g. after external file edit). */
export function invalidateCredentialsCache(): void {
  memoryCache = undefined;
}

export function credentialsPath(): string {
  return CREDENTIALS_PATH;
}
