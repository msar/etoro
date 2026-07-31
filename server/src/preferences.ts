/**
 * Lightweight preferences (enabled brokers) that can exist before full credentials.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROKER_IDS, isBrokerId, type BrokerId } from './brokers.js';
import { getEnabledBrokers, hasCredentials, setEnabledBrokers } from './credentials.js';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const PREFS_PATH = join(DATA_DIR, 'preferences.json');

interface Preferences {
  enabledBrokers?: BrokerId[];
}

function readPrefs(): Preferences {
  if (!existsSync(PREFS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(PREFS_PATH, 'utf8')) as Preferences;
  } catch {
    return {};
  }
}

function writePrefs(prefs: Preferences): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(PREFS_PATH, JSON.stringify(prefs, null, 2) + '\n', { mode: 0o600 });
}

/**
 * Resolve enabled brokers: credentials.json wins when set; else preferences.json;
 * null means "never configured" (caller should migrate from connected).
 */
export function loadEnabledBrokers(): BrokerId[] | null {
  const fromCreds = getEnabledBrokers();
  if (fromCreds !== null) return fromCreds;
  const prefs = readPrefs();
  if (prefs.enabledBrokers !== undefined) {
    return prefs.enabledBrokers.filter(isBrokerId);
  }
  return null;
}

export function persistEnabledBrokers(ids: BrokerId[]): BrokerId[] {
  const unique = ids.filter((id, i) => BROKER_IDS.includes(id) && ids.indexOf(id) === i);
  if (hasCredentials()) {
    try {
      setEnabledBrokers(unique);
    } catch {
      // fall through to prefs file
    }
  }
  writePrefs({ ...readPrefs(), enabledBrokers: unique });
  return unique;
}
