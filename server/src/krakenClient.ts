/**
 * Minimal Kraken Spot REST client — HMAC-SHA512 private auth + public ticker.
 * Docs: https://docs.kraken.com/api/docs/guides/spot-rest-auth
 */

import { createHash, createHmac } from 'node:crypto';
import { EtoroApiError } from './errors.js';
import { hasKrakenCredentials, loadCredentials } from './credentials.js';

const KRAKEN_BASE = 'https://api.kraken.com';

export class KrakenApiError extends EtoroApiError {
  constructor(message: string, statusCode = 400) {
    super(message, statusCode);
    this.name = 'KrakenApiError';
  }
}

function sign(path: string, nonce: string, postData: string, secretB64: string): string {
  const secret = Buffer.from(secretB64, 'base64');
  const hash = createHash('sha256').update(nonce + postData).digest();
  return createHmac('sha512', secret)
    .update(Buffer.concat([Buffer.from(path), hash]))
    .digest('base64');
}

function formEncode(data: Record<string, string>): string {
  return Object.entries(data)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

let lastNonce = 0;

function nextNonce(): string {
  const n = Math.max(Date.now(), lastNonce + 1);
  lastNonce = n;
  return String(n);
}

interface KrakenEnvelope<T> {
  error: string[];
  result?: T;
}

async function privateRequest<T>(
  path: string,
  apiKey: string,
  apiSecret: string,
  params: Record<string, string> = {},
): Promise<T> {
  const nonce = nextNonce();
  const body = formEncode({ nonce, ...params });
  const urlPath = path.startsWith('/0/') ? path : `/0${path}`;
  const signature = sign(urlPath, nonce, body, apiSecret);

  const res = await fetch(`${KRAKEN_BASE}${urlPath}`, {
    method: 'POST',
    headers: {
      'API-Key': apiKey,
      'API-Sign': signature,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!res.ok) {
    throw new KrakenApiError(`Kraken HTTP ${res.status}`, res.status >= 500 ? 502 : res.status);
  }

  const json = (await res.json()) as KrakenEnvelope<T>;
  if (json.error?.length) {
    const msg = json.error.join('; ');
    const auth =
      /invalid key|invalid signature|permission denied|EAPI:Invalid key/i.test(msg);
    throw new KrakenApiError(`Kraken: ${msg}`, auth ? 401 : 400);
  }
  if (json.result === undefined) {
    throw new KrakenApiError('Kraken returned an empty result', 502);
  }
  return json.result;
}

async function publicRequest<T>(path: string, query?: Record<string, string>): Promise<T> {
  const qs = query
    ? '?' +
      Object.entries(query)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&')
    : '';
  const res = await fetch(`${KRAKEN_BASE}${path}${qs}`);
  if (!res.ok) {
    throw new KrakenApiError(`Kraken HTTP ${res.status}`, res.status >= 500 ? 502 : res.status);
  }
  const json = (await res.json()) as KrakenEnvelope<T>;
  if (json.error?.length) {
    throw new KrakenApiError(`Kraken: ${json.error.join('; ')}`, 400);
  }
  if (json.result === undefined) {
    throw new KrakenApiError('Kraken returned an empty result', 502);
  }
  return json.result;
}

function requireKeys(): { apiKey: string; apiSecret: string } {
  const c = loadCredentials();
  if (!c?.krakenApiKey || !c.krakenApiSecret) {
    throw new KrakenApiError('kraken_credentials_required', 401);
  }
  return { apiKey: c.krakenApiKey, apiSecret: c.krakenApiSecret };
}

/** Validate API key + secret by calling Balance. */
export async function probeKrakenCredentials(apiKey: string, apiSecret: string): Promise<void> {
  await privateRequest<Record<string, string>>('/0/private/Balance', apiKey, apiSecret);
}

export type KrakenBalances = Record<string, string>;

export async function getKrakenBalances(): Promise<KrakenBalances> {
  const { apiKey, apiSecret } = requireKeys();
  return privateRequest<KrakenBalances>('/0/private/Balance', apiKey, apiSecret);
}

export interface KrakenTradeBalance {
  /** Equivalent balance (all currencies converted to the requested asset) */
  eb?: string;
  /** Trade balance */
  tb?: string;
  /** Margin amount of open positions */
  m?: string;
  /** Unrealized net profit/loss */
  n?: string;
  /** Cost basis of open positions */
  c?: string;
  /** Current floating valuation of open positions */
  v?: string;
  /** Equity = trade balance + unrealized net P/L */
  e?: string;
  /** Free margin */
  mf?: string;
}

export async function getKrakenTradeBalance(asset = 'ZUSD'): Promise<KrakenTradeBalance> {
  const { apiKey, apiSecret } = requireKeys();
  return privateRequest<KrakenTradeBalance>('/0/private/TradeBalance', apiKey, apiSecret, {
    asset,
  });
}

export interface KrakenLedgerEntry {
  refid: string;
  time: number;
  type: string;
  subtype?: string;
  aclass?: string;
  asset: string;
  amount: string;
  fee: string;
  balance: string;
}

export interface KrakenLedgersResult {
  ledger: Record<string, KrakenLedgerEntry>;
  count: number;
}

export async function getKrakenLedgers(opts: {
  type?: string;
  start?: number;
  end?: number;
  ofs?: number;
}): Promise<KrakenLedgersResult> {
  const { apiKey, apiSecret } = requireKeys();
  const params: Record<string, string> = {};
  if (opts.type) params.type = opts.type;
  if (opts.start != null) params.start = String(opts.start);
  if (opts.end != null) params.end = String(opts.end);
  if (opts.ofs != null) params.ofs = String(opts.ofs);
  return privateRequest<KrakenLedgersResult>('/0/private/Ledgers', apiKey, apiSecret, params);
}

export interface KrakenTickerInfo {
  a: string[];
  b: string[];
  c: string[];
  v: string[];
  p: string[];
  t: number[];
  l: string[];
  h: string[];
  o: string;
}

/** Last trade price from ticker `c[0]`. */
export async function getKrakenTickers(
  pairs: string[],
): Promise<Record<string, KrakenTickerInfo>> {
  if (!pairs.length) return {};
  return publicRequest<Record<string, KrakenTickerInfo>>('/0/public/Ticker', {
    pair: pairs.join(','),
  });
}

export async function getKrakenAssetPairs(): Promise<
  Record<string, { altname: string; wsname?: string; base: string; quote: string }>
> {
  return publicRequest('/0/public/AssetPairs');
}

export function isKrakenConfigured(): boolean {
  return hasKrakenCredentials();
}

/**
 * Strip Kraken balance suffixes (.S, .M, .F, .B, .T) and X/Z prefixes for pricing.
 * XXBT → XBT, ZUSD → USD, ETH2.S → ETH2
 */
export function normalizeKrakenAsset(asset: string): string {
  const base = asset.replace(/\.(S|M|F|B|T)$/i, '');
  if (base.length >= 4 && (base.startsWith('X') || base.startsWith('Z'))) {
    const rest = base.slice(1);
    // Keep XXBT → XBT, ZUSD → USD, but leave assets like XRP alone (3 letters after strip of nothing)
    if (
      ['XBT', 'ETH', 'LTC', 'XRP', 'XDG', 'XLM', 'ZEC', 'XMR'].includes(rest) ||
      ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'].includes(rest)
    ) {
      return rest;
    }
  }
  return base;
}

export function isFiatAsset(asset: string): boolean {
  const n = normalizeKrakenAsset(asset).toUpperCase();
  return ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF'].includes(n);
}
