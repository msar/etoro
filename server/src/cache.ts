interface Entry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, Entry<unknown>>();

export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/**
 * Memoize an async producer under a cache key. Concurrent callers while the
 * producer is in flight share the same promise, avoiding duplicate upstream
 * calls that would burn the shared eToro rate-limit quota.
 */
const inflight = new Map<string, Promise<unknown>>();

export async function cached<T>(
  key: string,
  ttlMs: number,
  producer: () => Promise<T>,
): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return hit;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = (async () => {
    try {
      const value = await producer();
      cacheSet(key, value, ttlMs);
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  return promise;
}

export function cacheClear(): void {
  store.clear();
  inflight.clear();
}

export const TTL = {
  BOOTSTRAP: 24 * 60 * 60 * 1000,
  INSTRUMENT_META: 24 * 60 * 60 * 1000,
  HISTORY: 15 * 60 * 1000,
  PORTFOLIO: 30 * 1000,
} as const;
