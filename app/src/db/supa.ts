// A small Supabase-compatible client over SQLite. The web app's data code is written against
// supabase-js (from().select().eq()...); this speaks enough of that API, on the schema in
// schema.ts, that the same loaders and writers run locally on the desktop. It covers what the web
// code uses: column lists with one level of embedded tables, eq/neq/gt/gte/lt/lte/in/is/not/
// match/filter/contains on JSON, order, limit, range, single, maybeSingle, count, insert, upsert
// (onConflict, ignoreDuplicates), update, delete, rpc and the local auth user.

import { LOCAL_USER, TABLES, type Column, type Table } from "./schema";
import { sql, type Row, type SqlValue } from "./sql";

export interface PgError {
  message: string;
  code: string;
  details?: string;
  hint?: string;
}

export interface Result<T = unknown> {
  data: T;
  error: PgError | null;
  count: number | null;
  status: number;
  statusText: string;
}

type Rpc = (args: Record<string, unknown>) => Promise<unknown> | unknown;
const rpcs = new Map<string, Rpc>();

/** Registers a database function for supabase.rpc(name, args). */
export function registerRpc(name: string, fn: Rpc) {
  rpcs.set(name, fn);
}

export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const nowIso = () => new Date().toISOString();

function table(name: string): Table {
  const t = TABLES[name];
  if (!t) throw pgError(`relation "${name}" does not exist`, "42P01");
  return t;
}

class PgException extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

const pgError = (message: string, code: string) => new PgException(message, code);

function toPgError(e: unknown): PgError {
  if (e instanceof PgException) return { message: e.message, code: e.code };
  const message = e instanceof Error ? e.message : String(e);
  if (/UNIQUE constraint failed/i.test(message)) return { message, code: "23505" };
  if (/FOREIGN KEY constraint failed/i.test(message)) return { message, code: "23503" };
  if (/NOT NULL constraint failed/i.test(message)) return { message, code: "23502" };
  if (/no such column/i.test(message)) return { message, code: "42703" };
  return { message, code: "XX000" };
}

/** A value as it's stored in SQLite, for a column of this type. */
export function encode(c: Column | undefined, v: unknown): SqlValue {
  if (v === undefined || v === null) return null;
  if (!c) return typeof v === "object" ? JSON.stringify(v) : (v as SqlValue);
  switch (c.type) {
    case "json":
    case "array":
      return typeof v === "string" && c.type === "json" && looksJson(v) ? v : JSON.stringify(v);
    case "bool":
      return v ? 1 : 0;
    case "ts": {
      if (v instanceof Date) return v.toISOString();
      const t = Date.parse(String(v));
      return Number.isFinite(t) ? new Date(t).toISOString() : String(v);
    }
    case "time": {
      const s = String(v);
      return /^\d{2}:\d{2}$/.test(s) ? `${s}:00` : s;
    }
    case "int":
    case "num":
      return typeof v === "number" ? v : Number(v);
    default:
      return v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : (v as SqlValue);
  }
}

function looksJson(s: string) {
  const t = s.trim();
  return (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
}

/** A stored value as supabase-js would hand it back. */
export function decode(c: Column | undefined, v: SqlValue): unknown {
  if (v === null || v === undefined) return null;
  if (!c) return v;
  switch (c.type) {
    case "json":
    case "array":
      try {
        return JSON.parse(String(v));
      } catch {
        return null;
      }
    case "bool":
      return v === 1 || v === true || v === "1";
    case "int":
    case "num":
      return typeof v === "number" ? v : Number(v);
    default:
      return v;
  }
}

function decodeRow(t: Table, row: Row): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = decode(t.columns[k], v);
  return out;
}

const q = (name: string) => `"${name.replace(/"/g, "")}"`;

// --- select lists -----------------------------------------------------------------------------

interface Embed {
  name: string;
  columns: SelectItem[];
}
type SelectItem = { column: string; alias?: string } | { star: true } | { embed: Embed };

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((p) => p.trim()).filter(Boolean);
}

function parseSelect(s: string): SelectItem[] {
  return splitTop(s.replace(/\s+/g, " ")).map((part): SelectItem => {
    if (part === "*") return { star: true };
    const m = part.match(/^(?:(\w+):)?(\w+)(?:!\w+)?\s*\((.*)\)$/);
    if (m) return { embed: { name: m[2], columns: parseSelect(m[3]) } };
    const a = part.match(/^(\w+):(\w+)$/);
    if (a) return { column: a[2], alias: a[1] };
    return { column: part };
  });
}

function project(items: SelectItem[], row: Record<string, unknown>): Record<string, unknown> {
  if (items.some((i) => "star" in i)) {
    const out = { ...row };
    for (const i of items) if ("column" in i && i.alias) out[i.alias] = row[i.column];
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const i of items) {
    if ("column" in i) out[i.alias ?? i.column] = row[i.column];
    if ("embed" in i) out[i.embed.name] = row[i.embed.name];
  }
  return out;
}

/** Attaches embedded tables: a many-to-one link (this row's foreign key) as an object, a one-to-many as a list. */
async function embed(name: string, rows: Record<string, unknown>[], items: SelectItem[]) {
  const t = table(name);
  for (const item of items) {
    if (!("embed" in item)) continue;
    const other = item.embed.name;
    const ot = table(other);
    const own = Object.entries(t.foreignKeys ?? {}).find(([, fk]) => fk.table === other);
    const theirs = Object.entries(ot.foreignKeys ?? {}).find(([, fk]) => fk.table === name);
    const cols = item.embed.columns;
    if (own) {
      const [fkCol, fk] = own;
      const keys = [...new Set(rows.map((r) => r[fkCol]).filter((v) => v !== null && v !== undefined))] as SqlValue[];
      const found = keys.length
        ? (await sql().select(`SELECT * FROM ${q(other)} WHERE ${q(fk.column)} IN (${keys.map(() => "?").join(", ")})`, keys)).map((r) => decodeRow(ot, r))
        : [];
      await embed(other, found, cols);
      const byKey = new Map(found.map((r) => [r[fk.column], project(cols, r)]));
      for (const r of rows) r[other] = byKey.get(r[fkCol]) ?? null;
    } else if (theirs) {
      const [fkCol, fk] = theirs;
      const keys = [...new Set(rows.map((r) => r[fk.column]))] as SqlValue[];
      const found = keys.length
        ? (await sql().select(`SELECT * FROM ${q(other)} WHERE ${q(fkCol)} IN (${keys.map(() => "?").join(", ")})`, keys)).map((r) => decodeRow(ot, r))
        : [];
      await embed(other, found, cols);
      for (const r of rows) r[other] = found.filter((f) => f[fkCol] === r[fk.column]).map((f) => project(cols, f));
    } else {
      throw pgError(`Could not find a relationship between '${name}' and '${other}'`, "PGRST200");
    }
  }
}

// --- the query builder ------------------------------------------------------------------------

type Op = "select" | "insert" | "upsert" | "update" | "delete";

const COMPARE: Record<string, string> = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "LIKE", ilike: "LIKE" };

export class Query<T = unknown> implements PromiseLike<Result<T>> {
  private op: Op = "select";
  private columns: string | null = null;
  private returning = false;
  private where: { sql: string; params: SqlValue[] }[] = [];
  private orders: string[] = [];
  private limitN?: number;
  private offsetN?: number;
  private mode: "many" | "single" | "maybe" = "many";
  private countMode = false;
  private head = false;
  private rows: Record<string, unknown>[] = [];
  private patch: Record<string, unknown> = {};
  private conflict?: string[];
  private ignoreDuplicates = false;
  private failure?: PgError;

  constructor(private readonly name: string) {}

  private get t() {
    return table(this.name);
  }

  select(columns = "*", opts: { count?: "exact" | "planned" | "estimated"; head?: boolean } = {}): this {
    if (this.op === "select") {
      this.columns = columns;
      this.countMode = Boolean(opts.count);
      this.head = Boolean(opts.head);
    } else {
      this.returning = true;
      this.columns = columns;
    }
    return this;
  }

  insert(values: Record<string, unknown> | Record<string, unknown>[], opts: { count?: string } = {}): this {
    void opts;
    this.op = "insert";
    this.rows = Array.isArray(values) ? values : [values];
    return this;
  }

  upsert(values: Record<string, unknown> | Record<string, unknown>[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}): this {
    this.op = "upsert";
    this.rows = Array.isArray(values) ? values : [values];
    this.conflict = opts.onConflict?.split(",").map((s) => s.trim());
    this.ignoreDuplicates = Boolean(opts.ignoreDuplicates);
    return this;
  }

  update(patch: Record<string, unknown>): this {
    this.op = "update";
    this.patch = patch;
    return this;
  }

  delete(): this {
    this.op = "delete";
    return this;
  }

  private col(name: string): Column | undefined {
    return this.t.columns[name];
  }

  private add(sqlText: string, params: SqlValue[] = []) {
    this.where.push({ sql: sqlText, params });
    return this;
  }

  private compare(column: string, op: string, value: unknown) {
    const c = this.col(column);
    if (op === "is") return this.isClause(column, value);
    if (op === "in") return this.add(...this.inClause(column, value));
    const s = COMPARE[op];
    if (!s) {
      this.failure = { message: `operator ${op} is not supported`, code: "PGRST100" };
      return this;
    }
    if (op === "ilike") return this.add(`LOWER(${q(column)}) LIKE LOWER(?)`, [String(value).replace(/\*/g, "%")]);
    if (op === "like") return this.add(`${q(column)} LIKE ?`, [String(value).replace(/\*/g, "%")]);
    return this.add(`${q(column)} ${s} ?`, [encode(c, value)]);
  }

  private isClause(column: string, value: unknown) {
    if (value === null || value === "null") return this.add(`${q(column)} IS NULL`);
    return this.add(`${q(column)} = ?`, [value === true || value === "true" ? 1 : 0]);
  }

  private inClause(column: string, value: unknown): [string, SqlValue[]] {
    const list = Array.isArray(value)
      ? value
      : String(value)
          .replace(/^\(|\)$/g, "")
          .split(",")
          .map((s) => s.trim().replace(/^"|"$/g, ""));
    if (list.length === 0) return ["0", []];
    const c = this.col(column);
    return [`${q(column)} IN (${list.map(() => "?").join(", ")})`, list.map((v) => encode(c, v))];
  }

  eq(column: string, value: unknown) {
    return this.compare(column, "eq", value);
  }
  neq(column: string, value: unknown) {
    return this.compare(column, "neq", value);
  }
  gt(column: string, value: unknown) {
    return this.compare(column, "gt", value);
  }
  gte(column: string, value: unknown) {
    return this.compare(column, "gte", value);
  }
  lt(column: string, value: unknown) {
    return this.compare(column, "lt", value);
  }
  lte(column: string, value: unknown) {
    return this.compare(column, "lte", value);
  }
  like(column: string, value: string) {
    return this.compare(column, "like", value);
  }
  ilike(column: string, value: string) {
    return this.compare(column, "ilike", value);
  }
  in(column: string, values: unknown[]) {
    return this.compare(column, "in", values);
  }
  is(column: string, value: unknown) {
    return this.isClause(column, value);
  }
  match(values: Record<string, unknown>) {
    for (const [k, v] of Object.entries(values)) this.eq(k, v);
    return this;
  }
  filter(column: string, op: string, value: unknown) {
    return this.compare(column, op, value);
  }
  not(column: string, op: string, value: unknown) {
    if (op === "is") {
      if (value === null || value === "null") return this.add(`${q(column)} IS NOT NULL`);
      return this.add(`${q(column)} <> ?`, [value === true || value === "true" ? 1 : 0]);
    }
    if (op === "in") {
      const [s, p] = this.inClause(column, value);
      return this.add(`NOT (${s})`, p);
    }
    const s = COMPARE[op];
    if (!s) return this;
    return this.add(`NOT (${q(column)} ${s} ?)`, [encode(this.col(column), value)]);
  }
  /** JSON containment for objects of plain values: meta @> { reviewOf: "2026-11-02" }. */
  contains(column: string, value: Record<string, unknown> | unknown[]) {
    if (Array.isArray(value)) {
      for (const v of value) this.add(`EXISTS (SELECT 1 FROM json_each(${q(column)}) WHERE value = ?)`, [v as SqlValue]);
      return this;
    }
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === "boolean") this.add(`json_extract(${q(column)}, ?) = ?`, [`$.${k}`, v ? 1 : 0]);
      else if (v === null) this.add(`json_type(${q(column)}, ?) = 'null'`, [`$.${k}`]);
      else if (typeof v === "object") this.add(`json_extract(${q(column)}, ?) = json(?)`, [`$.${k}`, JSON.stringify(v)]);
      else this.add(`json_extract(${q(column)}, ?) = ?`, [`$.${k}`, v as SqlValue]);
    }
    return this;
  }

  order(column: string, opts: { ascending?: boolean; nullsFirst?: boolean; referencedTable?: string; foreignTable?: string } = {}) {
    if (opts.referencedTable || opts.foreignTable) return this;
    const asc = opts.ascending !== false;
    const nullsFirst = opts.nullsFirst ?? !asc;
    this.orders.push(`${q(column)} ${asc ? "ASC" : "DESC"} NULLS ${nullsFirst ? "FIRST" : "LAST"}`);
    return this;
  }

  limit(n: number) {
    this.limitN = n;
    return this;
  }

  range(from: number, to: number) {
    this.offsetN = from;
    this.limitN = to - from + 1;
    return this;
  }

  single(): PromiseLike<Result<T>> & this {
    this.mode = "single";
    return this;
  }

  maybeSingle(): PromiseLike<Result<T>> & this {
    this.mode = "maybe";
    return this;
  }

  returns<U>(): Query<U> {
    return this as unknown as Query<U>;
  }

  abortSignal(signal: AbortSignal) {
    void signal;
    return this;
  }

  throwOnError() {
    return this;
  }

  private whereSql(): [string, SqlValue[]] {
    if (!this.where.length) return ["", []];
    return [` WHERE ${this.where.map((w) => `(${w.sql})`).join(" AND ")}`, this.where.flatMap((w) => w.params)];
  }

  private tail(): string {
    let s = "";
    if (this.orders.length) s += ` ORDER BY ${this.orders.join(", ")}`;
    if (this.limitN !== undefined) s += ` LIMIT ${Math.max(0, Math.floor(this.limitN))}`;
    if (this.offsetN !== undefined) s += `${this.limitN === undefined ? " LIMIT -1" : ""} OFFSET ${Math.floor(this.offsetN)}`;
    return s;
  }

  /** A row ready to write: known columns only, encoded, with its UUID and owner filled in. */
  private prepareRow(row: Record<string, unknown>, fill: boolean): Record<string, SqlValue> {
    const out: Record<string, SqlValue> = {};
    for (const [k, v] of Object.entries(row)) {
      if (v === undefined) continue;
      const c = this.col(k);
      if (!c) throw pgError(`Could not find the '${k}' column of '${this.name}'`, "PGRST204");
      out[k] = encode(c, v);
    }
    if (fill) {
      for (const [k, c] of Object.entries(this.t.columns)) {
        if (k in out) continue;
        if (c.default === "uuid") out[k] = uuid();
        if (c.default === "user") out[k] = LOCAL_USER;
      }
    }
    return out;
  }

  private async run(): Promise<{ rows: Record<string, unknown>[]; count: number | null }> {
    const db = sql();
    const t = this.t;
    if (this.op === "select") {
      const [w, p] = this.whereSql();
      if (this.head) {
        const r = await db.select(`SELECT COUNT(*) AS n FROM ${q(this.name)}${w}`, p);
        return { rows: [], count: Number(r[0]?.n ?? 0) };
      }
      const raw = await db.select(`SELECT * FROM ${q(this.name)}${w}${this.tail()}`, p);
      let count: number | null = null;
      if (this.countMode) count = Number((await db.select(`SELECT COUNT(*) AS n FROM ${q(this.name)}${w}`, p))[0]?.n ?? 0);
      return { rows: raw.map((r) => decodeRow(t, r)), count };
    }
    if (this.op === "insert" || this.op === "upsert") {
      const out: Record<string, unknown>[] = [];
      const target = this.conflict ?? t.primaryKey;
      for (const row of this.rows) {
        const prepared = this.prepareRow(row, true);
        // Set on every write; the column default only covers inserts.
        if ("updated_at" in t.columns && !("updated_at" in prepared)) prepared.updated_at = nowIso();
        const cols = Object.keys(prepared);
        let text = `INSERT INTO ${q(this.name)} (${cols.map(q).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
        if (this.op === "upsert") {
          const given = cols.filter((k) => k in row || k === "updated_at").filter((k) => !target.includes(k));
          const sets = given.map((k) => `${q(k)} = excluded.${q(k)}`);
          if (this.ignoreDuplicates || sets.length === 0) text += ` ON CONFLICT (${target.map(q).join(", ")}) DO NOTHING`;
          else text += ` ON CONFLICT (${target.map(q).join(", ")}) DO UPDATE SET ${sets.join(", ")}`;
        }
        const values = Object.values(prepared);
        const returned = await db.select(`${text} RETURNING *`, values);
        out.push(...returned.map((r) => decodeRow(t, r)));
      }
      return { rows: out, count: out.length };
    }
    if (this.op === "update") {
      const prepared = this.prepareRow(this.patch, false);
      if ("updated_at" in t.columns && !("updated_at" in prepared)) prepared.updated_at = nowIso();
      const cols = Object.keys(prepared);
      if (!cols.length) return { rows: [], count: 0 };
      const [w, p] = this.whereSql();
      const returned = await db.select(`UPDATE ${q(this.name)} SET ${cols.map((c) => `${q(c)} = ?`).join(", ")}${w} RETURNING *`, [...Object.values(prepared), ...p]);
      return { rows: returned.map((r) => decodeRow(t, r)), count: returned.length };
    }
    const [w, p] = this.whereSql();
    const returned = await db.select(`DELETE FROM ${q(this.name)}${w} RETURNING *`, p);
    return { rows: returned.map((r) => decodeRow(t, r)), count: returned.length };
  }

  async execute(): Promise<Result<T>> {
    try {
      if (this.failure) throw pgError(this.failure.message, this.failure.code);
      const { rows, count } = await this.run();
      const wantRows = this.op === "select" || this.returning;
      const items = parseSelect(this.columns ?? "*");
      if (wantRows && rows.length) await embed(this.name, rows, items);
      let data: unknown = wantRows ? rows.map((r) => project(items, r)) : null;
      if (this.head) data = null;
      if (this.mode !== "many" && wantRows) {
        const list = data as unknown[];
        if (list.length > 1) throw pgError("JSON object requested, multiple (or no) rows returned", "PGRST116");
        if (list.length === 0 && this.mode === "single") throw pgError("JSON object requested, multiple (or no) rows returned", "PGRST116");
        data = list[0] ?? null;
      }
      return { data: data as T, error: null, count, status: 200, statusText: "OK" };
    } catch (e) {
      return { data: null as T, error: toPgError(e), count: null, status: 400, statusText: "Bad Request" };
    }
  }

  then<A = Result<T>, B = never>(onfulfilled?: ((value: Result<T>) => A | PromiseLike<A>) | null, onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

class RpcCall implements PromiseLike<Result> {
  constructor(
    private readonly name: string,
    private readonly args: Record<string, unknown>,
  ) {}
  async execute(): Promise<Result> {
    const fn = rpcs.get(this.name);
    if (!fn) return { data: null, error: { message: `function ${this.name} does not exist`, code: "42883" }, count: null, status: 404, statusText: "Not Found" };
    try {
      return { data: await fn(this.args), error: null, count: null, status: 200, statusText: "OK" };
    } catch (e) {
      return { data: null, error: toPgError(e), count: null, status: 400, statusText: "Bad Request" };
    }
  }
  single() {
    return this;
  }
  then<A = Result, B = never>(onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null, onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

const localUser = { id: LOCAL_USER, email: "rider@lactic.local", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };

/** The desktop's stand-in for a signed-in Supabase client: one local rider, who owns everything. */
export function createLocalClient() {
  return {
    from: <T = unknown>(name: string) => new Query<T>(name),
    rpc: (name: string, args: Record<string, unknown> = {}) => new RpcCall(name, args),
    auth: {
      getClaims: async () => ({ data: { claims: { sub: LOCAL_USER, email: localUser.email } }, error: null }),
      getUser: async () => ({ data: { user: localUser }, error: null }),
      getSession: async () => ({ data: { session: { user: localUser } }, error: null }),
      signOut: async () => ({ error: null }),
    },
    storage: localStorageBuckets,
  };
}

// Files (coach chat attachments): kept in the database as base64, which is fine at their sizes.
const fileStore = new Map<string, { data: Blob; contentType: string }>();
const localStorageBuckets = {
  from: (bucket: string) => ({
    async upload(path: string, body: Blob | ArrayBuffer | Uint8Array, opts: { contentType?: string } = {}) {
      const blob = body instanceof Blob ? body : new Blob([body as BlobPart], { type: opts.contentType });
      fileStore.set(`${bucket}/${path}`, { data: blob, contentType: opts.contentType ?? blob.type });
      return { data: { path }, error: null };
    },
    async download(path: string) {
      const f = fileStore.get(`${bucket}/${path}`);
      return f ? { data: f.data, error: null } : { data: null, error: { message: "Object not found" } };
    },
    async remove(paths: string[]) {
      for (const p of paths) fileStore.delete(`${bucket}/${p}`);
      return { data: [], error: null };
    },
    async createSignedUrl(path: string) {
      const f = fileStore.get(`${bucket}/${path}`);
      return f ? { data: { signedUrl: URL.createObjectURL(f.data) }, error: null } : { data: null, error: { message: "Object not found" } };
    },
  }),
};

export type LocalClient = ReturnType<typeof createLocalClient>;
