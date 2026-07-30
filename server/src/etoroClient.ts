import { randomUUID } from 'node:crypto';
import { loadCredentials } from './credentials.js';
import {
  EtoroApiError,
  EtoroForbiddenError,
  EtoroPayloadTooLargeError,
  EtoroRateLimitError,
} from './errors.js';

const BASE_URL = 'https://public-api.etoro.com';

const RATE_LIMIT_BACKOFFS_MS = [1_000, 5_000, 30_000];
const SERVER_ERROR_BACKOFFS_MS = [200, 600, 1_500];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildHeaders(apiKey?: string, userKey?: string): Record<string, string> {
  const creds = loadCredentials();
  const key = apiKey ?? creds?.etoroApiKey;
  const user = userKey ?? creds?.etoroUserKey;
  if (!key || !user) {
    throw new EtoroApiError('credentials_required', 401);
  }
  return {
    'Content-Type': 'application/json',
    'x-api-key': key,
    'x-user-key': user,
    'x-request-id': randomUUID(),
  };
}

async function toError(res: Response): Promise<EtoroApiError> {
  const body = await res.text().catch(() => '');
  let message = `eToro API ${res.status}`;
  try {
    const parsed = JSON.parse(body);
    message =
      parsed.errorMessage || parsed.error?.message || parsed.message || parsed.error || message;
    if (typeof message !== 'string') message = `eToro API ${res.status}`;
  } catch {
    if (body) message = `${message}: ${body.slice(0, 200)}`;
  }
  if (res.status === 429) return new EtoroRateLimitError(message);
  if (res.status === 413 || res.status === 414) {
    return new EtoroPayloadTooLargeError(res.status, message);
  }
  if (res.status === 403) return new EtoroForbiddenError(message);
  return new EtoroApiError(message, res.status);
}

async function fetchOnce<T>(
  pathWithQuery: string,
  headers: Record<string, string>,
): Promise<T> {
  const url = `${BASE_URL}${pathWithQuery}`;
  let rateLimitAttempt = 0;
  let serverErrorAttempt = 0;

  for (;;) {
    let res: Response;
    try {
      res = await fetch(url, { headers });
    } catch (err) {
      if (serverErrorAttempt < SERVER_ERROR_BACKOFFS_MS.length) {
        await sleep(SERVER_ERROR_BACKOFFS_MS[serverErrorAttempt++]);
        continue;
      }
      throw err;
    }

    if (res.ok) {
      const text = await res.text();
      return (text ? JSON.parse(text) : null) as T;
    }

    if (res.status === 429 && rateLimitAttempt < RATE_LIMIT_BACKOFFS_MS.length) {
      await sleep(RATE_LIMIT_BACKOFFS_MS[rateLimitAttempt++]);
      continue;
    }
    if (res.status >= 500 && serverErrorAttempt < SERVER_ERROR_BACKOFFS_MS.length) {
      await sleep(SERVER_ERROR_BACKOFFS_MS[serverErrorAttempt++]);
      continue;
    }

    throw await toError(res);
  }
}

/**
 * GET against the eToro Public API with retry semantics per error class.
 * Uses credentials from the local store (or env override).
 */
export async function etoroFetch<T>(pathWithQuery: string): Promise<T> {
  return fetchOnce<T>(pathWithQuery, buildHeaders());
}

/** Probe with candidate keys before persisting them (login validation). */
export async function etoroFetchWithKeys<T>(
  pathWithQuery: string,
  apiKey: string,
  userKey: string,
): Promise<T> {
  return fetchOnce<T>(pathWithQuery, buildHeaders(apiKey, userKey));
}
