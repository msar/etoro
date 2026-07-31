import {
  clearCredentials,
  clearKrakenCredentials,
  hasCredentials,
  hasEtoroCredentials,
  hasKrakenCredentials,
  hasSupabaseCredentials,
  loadCredentials,
  saveCredentials,
  updateCredentials,
} from './credentials.js';
import { BROKER_CATALOG, isBrokerId, type BrokerId } from './brokers.js';
import { cacheClear } from './cache.js';
import { etoroFetchWithKeys } from './etoroClient.js';
import { EtoroApiError } from './errors.js';
import { loadEnabledBrokers, persistEnabledBrokers } from './preferences.js';
import { clearSchemaMissing } from './schemaState.js';
import { probeSupabase, resetSupabaseClient } from './supabase.js';
import { findAbnAccountId } from './services/abnamro.js';
import { findEtradeAccountId } from './services/etrade.js';
import { findKrakenAccountId } from './services/kraken.js';

export interface CredentialsStatus {
  configured: boolean;
  etoroConfigured: boolean;
  supabaseConfigured: boolean;
  krakenConfigured: boolean;
}

export function getCredentialsStatus(): CredentialsStatus {
  return {
    configured: hasCredentials(),
    etoroConfigured: hasEtoroCredentials(),
    supabaseConfigured: hasSupabaseCredentials(),
    krakenConfigured: hasKrakenCredentials(),
  };
}

/**
 * Validate candidate keys against eToro + Supabase, then persist to disk.
 * Preserves existing Kraken keys and enabledBrokers.
 */
export async function configureCredentials(input: {
  etoroApiKey: string;
  etoroUserKey: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
}): Promise<CredentialsStatus> {
  const etoroApiKey = input.etoroApiKey.trim();
  const etoroUserKey = input.etoroUserKey.trim();
  const supabaseUrl = input.supabaseUrl.trim().replace(/\/$/, '');
  const supabaseServiceRoleKey = input.supabaseServiceRoleKey.trim();

  if (!etoroApiKey || !etoroUserKey) {
    throw new EtoroApiError('eToro API key and user key are required.', 400);
  }
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new EtoroApiError('Supabase URL and service role key are required.', 400);
  }
  if (!/^https:\/\/.+\.supabase\.co$/i.test(supabaseUrl)) {
    throw new EtoroApiError(
      'Supabase URL should look like https://YOUR_PROJECT.supabase.co',
      400,
    );
  }

  try {
    await etoroFetchWithKeys('/api/v1/trading/info/real/pnl', etoroApiKey, etoroUserKey);
  } catch (err) {
    if (err instanceof EtoroApiError && (err.statusCode === 403 || err.statusCode === 401)) {
      try {
        await etoroFetchWithKeys(
          '/api/v1/trading/info/demo/pnl',
          etoroApiKey,
          etoroUserKey,
        );
      } catch (demoErr) {
        const msg = demoErr instanceof Error ? demoErr.message : 'Invalid eToro credentials';
        throw new EtoroApiError(`eToro credentials failed: ${msg}`, 401);
      }
    } else {
      const msg = err instanceof Error ? err.message : 'Invalid eToro credentials';
      throw new EtoroApiError(`eToro credentials failed: ${msg}`, 401);
    }
  }

  try {
    await probeSupabase(supabaseUrl, supabaseServiceRoleKey);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Invalid Supabase credentials';
    throw new EtoroApiError(msg, 401);
  }

  const existing = loadCredentials();
  const prevEnabled = loadEnabledBrokers() ?? [];
  const enabled = prevEnabled.includes('etoro')
    ? prevEnabled
    : [...prevEnabled, 'etoro' as BrokerId];

  saveCredentials({
    etoroApiKey,
    etoroUserKey,
    supabaseUrl,
    supabaseServiceRoleKey,
    krakenApiKey: existing?.krakenApiKey,
    krakenApiSecret: existing?.krakenApiSecret,
    enabledBrokers: enabled,
  });
  persistEnabledBrokers(enabled);
  resetSupabaseClient();
  clearSchemaMissing();
  cacheClear();

  return getCredentialsStatus();
}

export function logoutCredentials(): CredentialsStatus {
  clearCredentials();
  resetSupabaseClient();
  clearSchemaMissing();
  cacheClear();
  return getCredentialsStatus();
}

export function requireEtoroCredentials(): void {
  if (!hasEtoroCredentials()) {
    throw new EtoroApiError('credentials_required', 401);
  }
}

export function requireKrakenCredentials(): void {
  if (!hasKrakenCredentials()) {
    throw new EtoroApiError('kraken_credentials_required', 401);
  }
}

export function requireSupabaseCredentials(): void {
  if (!hasSupabaseCredentials()) {
    throw new EtoroApiError('supabase_credentials_required', 401);
  }
}

export interface BrokersStatus {
  catalog: typeof BROKER_CATALOG;
  enabled: BrokerId[];
  /** Brokers with live credentials or imported data */
  connected: BrokerId[];
}

async function detectConnectedBrokers(): Promise<BrokerId[]> {
  const connected: BrokerId[] = [];
  if (hasEtoroCredentials()) connected.push('etoro');
  if (hasKrakenCredentials()) connected.push('kraken');
  try {
    if (await findAbnAccountId()) connected.push('abnamro');
  } catch {
    // ignore
  }
  try {
    if (await findEtradeAccountId()) connected.push('etrade');
  } catch {
    // ignore
  }
  try {
    if (!hasKrakenCredentials() && (await findKrakenAccountId())) {
      // Historical data without keys still counts as connected for display
      if (!connected.includes('kraken')) connected.push('kraken');
    }
  } catch {
    // ignore
  }
  return connected;
}

/**
 * Resolve which brokers appear on Overview/nav.
 * Legacy credentials without enabledBrokers → auto-enable currently connected ones.
 */
export async function getBrokersStatus(): Promise<BrokersStatus> {
  const connected = await detectConnectedBrokers();
  let enabled = loadEnabledBrokers();

  if (enabled === null) {
    // Legacy migration: only show brokers that are already connected (not the full catalog).
    enabled = connected.length ? [...connected] : [];
    persistEnabledBrokers(enabled);
  }

  return {
    catalog: BROKER_CATALOG,
    enabled,
    connected,
  };
}

export async function enableBroker(id: string): Promise<BrokersStatus> {
  if (!isBrokerId(id)) throw new EtoroApiError(`Unknown broker: ${id}`, 400);
  const status = await getBrokersStatus();
  if (!status.enabled.includes(id)) {
    persistEnabledBrokers([...status.enabled, id]);
  }
  return getBrokersStatus();
}

export async function disableBroker(id: string): Promise<BrokersStatus> {
  if (!isBrokerId(id)) throw new EtoroApiError(`Unknown broker: ${id}`, 400);
  const status = await getBrokersStatus();
  persistEnabledBrokers(status.enabled.filter((b) => b !== id));
  if (id === 'kraken') {
    clearKrakenCredentials();
    cacheClear();
  }
  return getBrokersStatus();
}

export async function configureKrakenCredentials(input: {
  apiKey: string;
  apiSecret: string;
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
}): Promise<CredentialsStatus> {
  const apiKey = input.apiKey.trim();
  const apiSecret = input.apiSecret.trim();
  if (!apiKey || !apiSecret) {
    throw new EtoroApiError('Kraken API key and private key are required.', 400);
  }

  let supabaseUrl = (input.supabaseUrl ?? '').trim().replace(/\/$/, '');
  let supabaseServiceRoleKey = (input.supabaseServiceRoleKey ?? '').trim();
  const existing = loadCredentials();

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    if (!existing?.supabaseUrl || !existing.supabaseServiceRoleKey) {
      throw new EtoroApiError(
        'Supabase URL and service role key are required (first-time setup).',
        400,
      );
    }
    supabaseUrl = existing.supabaseUrl;
    supabaseServiceRoleKey = existing.supabaseServiceRoleKey;
  } else {
    if (!/^https:\/\/.+\.supabase\.co$/i.test(supabaseUrl)) {
      throw new EtoroApiError(
        'Supabase URL should look like https://YOUR_PROJECT.supabase.co',
        400,
      );
    }
    try {
      await probeSupabase(supabaseUrl, supabaseServiceRoleKey);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid Supabase credentials';
      throw new EtoroApiError(msg, 401);
    }
  }

  // Validate Kraken keys with a Balance call (lazy import avoids circular init issues)
  const { probeKrakenCredentials } = await import('./krakenClient.js');
  await probeKrakenCredentials(apiKey, apiSecret);

  const prevEnabled = loadEnabledBrokers() ?? [];
  const enabled = prevEnabled.includes('kraken')
    ? prevEnabled
    : [...prevEnabled, 'kraken' as BrokerId];

  updateCredentials({
    supabaseUrl,
    supabaseServiceRoleKey,
    krakenApiKey: apiKey,
    krakenApiSecret: apiSecret,
    enabledBrokers: enabled,
  });
  persistEnabledBrokers(enabled);
  resetSupabaseClient();
  clearSchemaMissing();
  cacheClear();

  return getCredentialsStatus();
}

export function disconnectKraken(): CredentialsStatus {
  clearKrakenCredentials();
  const enabled = loadEnabledBrokers();
  if (enabled) persistEnabledBrokers(enabled.filter((b) => b !== 'kraken'));
  cacheClear();
  return getCredentialsStatus();
}
