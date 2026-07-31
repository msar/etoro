/**
 * SQLite-backed client with a PostgREST/supabase-js-like chainable API
 * covering the subset used by Portfolio Evolution services.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SQLITE_SCHEMA_SQL, SQLITE_SCHEMA_VERSION } from './sqliteSchema.js';

export type DbError = { message: string; code?: string };
export type DbResult<T> = { data: T; error: DbError | null; count?: number | null };

type Filter =
  | { op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'; col: string; value: unknown }
  | { op: 'is'; col: string; value: null };

type OrderBy = { col: string; ascending: boolean };

const BOOL_COLS = new Set(['is_buy', 'via_copy']);
const JSON_COLS = new Set(['raw']);

function quoteIdent(id: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id)) {
    throw new Error(`Invalid identifier: ${id}`);
  }
  return `"${id}"`;
}

function parseSelectList(select: string): string[] | '*' {
  const s = select.trim();
  if (!s || s === '*') return '*';
  return s.split(',').map((p) => p.trim()).filter(Boolean);
}

function encodeValue(col: string, value: unknown): unknown {
  if (value === undefined) return null;
  if (BOOL_COLS.has(col)) {
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value ? 1 : 0;
  }
  if (JSON_COLS.has(col) && value !== null && typeof value === 'object') {
    return JSON.stringify(value);
  }
  return value;
}

function decodeRow(row: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!row) return null;
  const out: Record<string, unknown> = { ...row };
  for (const col of BOOL_COLS) {
    if (col in out && out[col] !== null && out[col] !== undefined) {
      out[col] = Boolean(out[col]);
    }
  }
  for (const col of JSON_COLS) {
    if (col in out && typeof out[col] === 'string') {
      try {
        out[col] = JSON.parse(out[col] as string);
      } catch {
        // leave as string
      }
    }
  }
  return out;
}

function decodeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((r) => decodeRow(r)!);
}

export class SqliteQueryBuilder implements PromiseLike<DbResult<unknown>> {
  private table: string;
  private db: Database.Database;
  private mode: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
  private selectCols: string | '*' = '*';
  private countExact = false;
  private headOnly = false;
  private filters: Filter[] = [];
  private orders: OrderBy[] = [];
  private limitN: number | null = null;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private wantSingle = false;
  private maybe = false;
  private payload: Record<string, unknown> | Record<string, unknown>[] | null = null;
  private onConflict: string | null = null;
  private updatePatch: Record<string, unknown> | null = null;

  constructor(db: Database.Database, table: string) {
    this.db = db;
    this.table = table;
  }

  select(
    columns: string = '*',
    opts?: { count?: 'exact'; head?: boolean },
  ): this {
    this.mode = 'select';
    this.selectCols = columns.trim() || '*';
    this.countExact = opts?.count === 'exact';
    this.headOnly = opts?.head === true;
    return this;
  }

  insert(row: Record<string, unknown> | Record<string, unknown>[]): this {
    this.mode = 'insert';
    this.payload = row;
    return this;
  }

  upsert(
    row: Record<string, unknown> | Record<string, unknown>[],
    opts?: { onConflict?: string },
  ): this {
    this.mode = 'upsert';
    this.payload = row;
    this.onConflict = opts?.onConflict ?? null;
    return this;
  }

  update(patch: Record<string, unknown>): this {
    this.mode = 'update';
    this.updatePatch = patch;
    return this;
  }

  delete(): this {
    this.mode = 'delete';
    return this;
  }

  eq(col: string, value: unknown): this {
    this.filters.push({ op: 'eq', col, value });
    return this;
  }

  neq(col: string, value: unknown): this {
    this.filters.push({ op: 'neq', col, value });
    return this;
  }

  gt(col: string, value: unknown): this {
    this.filters.push({ op: 'gt', col, value });
    return this;
  }

  gte(col: string, value: unknown): this {
    this.filters.push({ op: 'gte', col, value });
    return this;
  }

  lt(col: string, value: unknown): this {
    this.filters.push({ op: 'lt', col, value });
    return this;
  }

  lte(col: string, value: unknown): this {
    this.filters.push({ op: 'lte', col, value });
    return this;
  }

  is(col: string, value: null): this {
    this.filters.push({ op: 'is', col, value: null });
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.orders.push({ col, ascending: opts?.ascending !== false });
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  range(from: number, to: number): this {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }

  maybeSingle(): this {
    this.maybe = true;
    this.wantSingle = true;
    this.limitN = 1;
    return this;
  }

  single(): this {
    this.wantSingle = true;
    this.maybe = false;
    this.limitN = 1;
    return this;
  }

  then<TResult1 = DbResult<unknown>, TResult2 = never>(
    onfulfilled?: ((value: DbResult<unknown>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve().then(() => this.execute()).then(onfulfilled, onrejected);
  }

  private whereClause(): { sql: string; params: unknown[] } {
    const parts: string[] = [];
    const params: unknown[] = [];
    for (const f of this.filters) {
      const col = quoteIdent(f.col);
      if (f.op === 'is') {
        parts.push(`${col} IS NULL`);
      } else {
        const op =
          f.op === 'eq'
            ? '='
            : f.op === 'neq'
              ? '!='
              : f.op === 'gt'
                ? '>'
                : f.op === 'gte'
                  ? '>='
                  : f.op === 'lt'
                    ? '<'
                    : '<=';
        parts.push(`${col} ${op} ?`);
        params.push(encodeValue(f.col, f.value));
      }
    }
    return {
      sql: parts.length ? ` WHERE ${parts.join(' AND ')}` : '',
      params,
    };
  }

  private orderClause(): string {
    if (!this.orders.length) return '';
    return (
      ' ORDER BY ' +
      this.orders
        .map((o) => `${quoteIdent(o.col)} ${o.ascending ? 'ASC' : 'DESC'}`)
        .join(', ')
    );
  }

  private limitClause(): { sql: string; params: unknown[] } {
    if (this.rangeFrom != null && this.rangeTo != null) {
      const count = this.rangeTo - this.rangeFrom + 1;
      return { sql: ' LIMIT ? OFFSET ?', params: [count, this.rangeFrom] };
    }
    if (this.limitN != null) {
      return { sql: ' LIMIT ?', params: [this.limitN] };
    }
    return { sql: '', params: [] };
  }

  private execute(): DbResult<unknown> {
    try {
      switch (this.mode) {
        case 'select':
          return this.execSelect();
        case 'insert':
          return this.execInsert(false);
        case 'upsert':
          return this.execInsert(true);
        case 'update':
          return this.execUpdate();
        case 'delete':
          return this.execDelete();
        default:
          return { data: null, error: { message: `Unknown mode ${this.mode}` } };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { data: null, error: { message } };
    }
  }

  private execSelect(): DbResult<unknown> {
    const table = quoteIdent(this.table);
    const where = this.whereClause();

    if (this.countExact && this.headOnly) {
      const sql = `SELECT COUNT(*) AS cnt FROM ${table}${where.sql}`;
      const row = this.db.prepare(sql).get(...where.params) as { cnt: number };
      return { data: null, error: null, count: row?.cnt ?? 0 };
    }

    const cols = parseSelectList(this.selectCols);
    const selectSql =
      cols === '*'
        ? '*'
        : cols.map((c) => quoteIdent(c)).join(', ');
    const lim = this.limitClause();
    const sql = `SELECT ${selectSql} FROM ${table}${where.sql}${this.orderClause()}${lim.sql}`;
    const rows = decodeRows(
      this.db.prepare(sql).all(...where.params, ...lim.params) as Record<string, unknown>[],
    );

    if (this.wantSingle) {
      if (!rows.length) {
        if (this.maybe) return { data: null, error: null };
        return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } };
      }
      return { data: rows[0], error: null };
    }

    let count: number | null = null;
    if (this.countExact) {
      const csql = `SELECT COUNT(*) AS cnt FROM ${table}${where.sql}`;
      const crow = this.db.prepare(csql).get(...where.params) as { cnt: number };
      count = crow?.cnt ?? 0;
    }

    return { data: rows, error: null, count };
  }

  private execInsert(upsert: boolean): DbResult<unknown> {
    const rows = Array.isArray(this.payload) ? this.payload : this.payload ? [this.payload] : [];
    if (!rows.length) return { data: null, error: null };

    const table = quoteIdent(this.table);
    const conflictCols = (this.onConflict ?? '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);

    const runOne = this.db.transaction((batch: Record<string, unknown>[]) => {
      for (const row of batch) {
        const cols = Object.keys(row);
        if (!cols.length) continue;
        const placeholders = cols.map(() => '?').join(', ');
        const colSql = cols.map(quoteIdent).join(', ');
        const values = cols.map((c) => encodeValue(c, row[c]));

        let sql = `INSERT INTO ${table} (${colSql}) VALUES (${placeholders})`;
        if (upsert && conflictCols.length) {
          const updates = cols
            .filter((c) => !conflictCols.includes(c))
            .map((c) => `${quoteIdent(c)}=excluded.${quoteIdent(c)}`);
          sql += ` ON CONFLICT(${conflictCols.map(quoteIdent).join(', ')}) DO UPDATE SET ${
            updates.length ? updates.join(', ') : `${quoteIdent(cols[0])}=excluded.${quoteIdent(cols[0])}`
          }`;
        } else if (upsert) {
          // Fallback: replace entire row
          sql = `INSERT OR REPLACE INTO ${table} (${colSql}) VALUES (${placeholders})`;
        }
        this.db.prepare(sql).run(...values);
      }
    });

    runOne(rows);
    return { data: null, error: null };
  }

  private execUpdate(): DbResult<unknown> {
    if (!this.updatePatch || !Object.keys(this.updatePatch).length) {
      return { data: null, error: null };
    }
    const table = quoteIdent(this.table);
    const cols = Object.keys(this.updatePatch);
    const sets = cols.map((c) => `${quoteIdent(c)}=?`).join(', ');
    const values = cols.map((c) => encodeValue(c, this.updatePatch![c]));
    const where = this.whereClause();
    this.db.prepare(`UPDATE ${table} SET ${sets}${where.sql}`).run(...values, ...where.params);
    return { data: null, error: null };
  }

  private execDelete(): DbResult<unknown> {
    const table = quoteIdent(this.table);
    const where = this.whereClause();
    this.db.prepare(`DELETE FROM ${table}${where.sql}`).run(...where.params);
    return { data: null, error: null };
  }
}

export class SqliteClient {
  readonly path: string;
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.path = dbPath;
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(SQLITE_SCHEMA_SQL);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO schema_migrations (id) VALUES (?)`,
      )
      .run(SQLITE_SCHEMA_VERSION);
  }

  from(table: string): SqliteQueryBuilder {
    return new SqliteQueryBuilder(this.db, table);
  }

  close(): void {
    this.db.close();
  }
}
