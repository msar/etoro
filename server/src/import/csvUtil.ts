import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

/** Parse a single RFC4180-ish CSV line (quoted fields, commas, escaped quotes). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** Parse eToro statement numbers: `1,234.56`, `(12.50)`, spaces, `-`. */
export function parseNum(raw: string | undefined | null): number {
  if (raw == null) return 0;
  let s = String(raw).trim();
  if (!s || s === '-') return 0;
  const neg = s.startsWith('(') && s.endsWith(')');
  if (neg) s = s.slice(1, -1);
  s = s.replace(/,/g, '').replace(/\s/g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return neg ? -n : n;
}

/** Parse `dd/mm/yyyy[ hh:mm:ss]` → Date (local components as UTC date parts). */
export function parseEtoroDateTime(raw: string | undefined | null): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  const m = s.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/,
  );
  if (!m) return null;
  const [, dd, mm, yyyy, hh = '00', mi = '00', ss = '00'] = m;
  return new Date(
    Date.UTC(
      Number(yyyy),
      Number(mm) - 1,
      Number(dd),
      Number(hh),
      Number(mi),
      Number(ss),
    ),
  );
}

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function toIsoTimestamp(d: Date): string {
  return d.toISOString();
}

/** Stream a CSV file; yields objects keyed by header. Skips empty trailing lines. */
export async function* iterateCsv(
  path: string,
): AsyncGenerator<Record<string, string>> {
  const rl = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let headers: string[] | null = null;
  for await (const rawLine of rl) {
    const line = headers ? rawLine : stripBom(rawLine);
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    if (!headers) {
      headers = cols.map((h) => h.trim());
      continue;
    }
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = cols[i] ?? '';
    }
    yield row;
  }
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Extract ticker from `Name (TICKER)` or return trimmed name. */
export function extractSymbol(accion: string): string {
  const s = (accion || '').trim();
  const m = s.match(/\(([^)]+)\)\s*$/);
  return (m ? m[1] : s).trim();
}
