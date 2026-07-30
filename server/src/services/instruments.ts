import { cacheGet, cacheSet, TTL } from '../cache.js';
import { EtoroForbiddenError, EtoroPayloadTooLargeError } from '../errors.js';
import { etoroFetch } from '../etoroClient.js';
import type { EtoroInstrumentImage, InstrumentMeta, InstrumentsResponse } from '../etoroTypes.js';

const BATCH_SIZE_LADDER = [50, 25] as const;

export interface InstrumentInfo {
  instrumentId: number;
  name: string;
  symbol: string;
  imageUrl: string | null;
}

function selectImageUrl(images: EtoroInstrumentImage[] | undefined): string | null {
  if (!images?.length) return null;
  const card = images.find((i) => i.format === 'svg' && i.backgroundColor);
  if (card) return card.uri;
  const pngs = images.filter((i) => i.format === 'png' && typeof i.width === 'number');
  if (pngs.length) {
    return pngs.sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0].uri;
  }
  return images[0].uri;
}

function toInfo(meta: InstrumentMeta): InstrumentInfo {
  return {
    instrumentId: meta.instrumentID,
    name: meta.instrumentDisplayName,
    symbol: meta.symbolFull,
    imageUrl: selectImageUrl(meta.images),
  };
}

const metaKey = (id: number) => `instrument:${id}`;

/**
 * Resolve instrument metadata for a set of IDs. Cached per-instrument for 24h.
 * Batches of 25–50 IDs; shrinks the batch ONLY on 413/414 (adaptive batching),
 * other errors bubble up to the retry layer in etoroFetch.
 */
const DENIED_KEY = 'instruments:denied';
const DENIED_TTL_MS = 60 * 60 * 1000;

export async function resolveInstruments(ids: number[]): Promise<Map<number, InstrumentInfo>> {
  const out = new Map<number, InstrumentInfo>();
  const missing: number[] = [];

  // If the token lacks the market-data scope, don't hammer the API on every
  // request — remember the denial for an hour and degrade gracefully.
  if (cacheGet<boolean>(DENIED_KEY)) return out;

  for (const id of [...new Set(ids)]) {
    const hit = cacheGet<InstrumentInfo>(metaKey(id));
    if (hit) out.set(id, hit);
    else missing.push(id);
  }
  if (missing.length === 0) return out;

  let batchSize: number = BATCH_SIZE_LADDER[0];
  let i = 0;
  while (i < missing.length) {
    const chunk = missing.slice(i, i + batchSize);
    try {
      // Literal ',' separator required — never URLSearchParams-encode this.
      const data = await etoroFetch<InstrumentsResponse>(
        `/api/v1/market-data/instruments?instrumentIds=${chunk.join(',')}`,
      );
      for (const item of data.instrumentDisplayDatas ?? []) {
        const info = toInfo(item);
        cacheSet(metaKey(info.instrumentId), info, TTL.INSTRUMENT_META);
        out.set(info.instrumentId, info);
      }
      i += batchSize;
    } catch (err) {
      if (err instanceof EtoroPayloadTooLargeError) {
        const idx = BATCH_SIZE_LADDER.indexOf(batchSize as 50 | 25);
        const next = BATCH_SIZE_LADDER[idx + 1];
        if (next) {
          batchSize = next;
          continue;
        }
        console.warn('Instrument batch failed at minimum size, skipping:', chunk);
        i += batchSize;
      } else if (err instanceof EtoroForbiddenError) {
        console.warn('Instrument metadata denied by token scopes; disabling enrichment for 1h.');
        cacheSet(DENIED_KEY, true, DENIED_TTL_MS);
        break;
      } else {
        console.warn('Instrument metadata fetch failed:', (err as Error).message);
        break; // enrichment is non-critical; return what we have
      }
    }
  }
  return out;
}
