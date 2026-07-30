import {
  type AppCredentials,
  clearCredentials,
  hasCredentials,
  hasEtoroCredentials,
  loadCredentials,
  saveCredentials,
} from './credentials.js';
import { cacheClear } from './cache.js';
import { etoroFetchWithKeys } from './etoroClient.js';
import { EtoroApiError } from './errors.js';
import { clearSchemaMissing } from './schemaState.js';
import { probeSupabase, resetSupabaseClient } from './supabase.js';

export interface CredentialsStatus {
  configured: boolean;
  etoroConfigured: boolean;
  supabaseConfigured: boolean;
}

export function getCredentialsStatus(): CredentialsStatus {
  const c = loadCredentials();
  return {
    configured: hasCredentials(),
    etoroConfigured: Boolean(c?.etoroApiKey && c?.etoroUserKey),
    supabaseConfigured: Boolean(c?.supabaseUrl && c?.supabaseServiceRoleKey),
  };
}

/**
 * Validate candidate keys against eToro + Supabase, then persist to disk.
 */
export async function configureCredentials(input: AppCredentials): Promise<CredentialsStatus> {
  const creds: AppCredentials = {
    etoroApiKey: input.etoroApiKey.trim(),
    etoroUserKey: input.etoroUserKey.trim(),
    supabaseUrl: input.supabaseUrl.trim().replace(/\/$/, ''),
    supabaseServiceRoleKey: input.supabaseServiceRoleKey.trim(),
  };

  if (!creds.etoroApiKey || !creds.etoroUserKey) {
    throw new EtoroApiError('eToro API key and user key are required.', 400);
  }
  if (!creds.supabaseUrl || !creds.supabaseServiceRoleKey) {
    throw new EtoroApiError('Supabase URL and service role key are required.', 400);
  }
  if (!/^https:\/\/.+\.supabase\.co$/i.test(creds.supabaseUrl)) {
    throw new EtoroApiError(
      'Supabase URL should look like https://YOUR_PROJECT.supabase.co',
      400,
    );
  }

  // Probe eToro: real PnL succeeds for real keys; demo keys get 403 then we try demo.
  try {
    await etoroFetchWithKeys('/api/v1/trading/info/real/pnl', creds.etoroApiKey, creds.etoroUserKey);
  } catch (err) {
    if (err instanceof EtoroApiError && (err.statusCode === 403 || err.statusCode === 401)) {
      try {
        await etoroFetchWithKeys(
          '/api/v1/trading/info/demo/pnl',
          creds.etoroApiKey,
          creds.etoroUserKey,
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
    await probeSupabase(creds.supabaseUrl, creds.supabaseServiceRoleKey);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Invalid Supabase credentials';
    throw new EtoroApiError(msg, 401);
  }

  saveCredentials(creds);
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
