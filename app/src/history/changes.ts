// App history: recording changes. A change is opened with recordChange() around a rider action (or
// a Coach Apply, an AI app's suggestion, a plugin being added); every write to a recorded table
// inside it is noted with the row before and after, and saved as one entry when it closes, like a
// commit. Writes outside one aren't recorded, so the plan rebuilding itself on load never shows up.
//
// Writes through the local supabase client (db/supa.ts) are noted there; the few raw SQL writers
// (plugins, app settings) wrap theirs in captureAround().

import { TABLES } from "~/db/schema";
import { sql, type Row, type SqlValue } from "~/db/sql";
import { titleFor } from "./describe";

export type Author = "you" | "coach" | "ai_app" | "lactic" | "sync";

export interface ChangeMeta {
  author?: Author;
  /** The AI app that suggested it, for ai_app. */
  client?: string | null;
  /** The plugin it was about, so Settings → Plugins can show its history. */
  pluginId?: string | null;
  /** Rider words. Left out, it's worked out from the rows. */
  title?: string;
  /** The entry this one undoes. */
  undoOf?: string;
  /** Offer Undo in a toast once it's saved (Coach Apply). */
  toast?: boolean;
}

export interface RowChange {
  table: string;
  key: Record<string, SqlValue>;
  before: Row | null;
  after: Row | null;
}

/** Tables whose changes are kept: what the rider sets up. Rides, streams, health days and chats aren't. */
export const RECORDED = new Set([
  "athlete_settings",
  "ftp_history",
  "training_goals",
  "training_plans",
  "plan_breaks",
  "plan_days",
  "plan_weeks",
  "event_courses",
  "custom_workouts",
  "workout_favorites",
  "layouts",
  "coach_memory",
  "coach_persona",
  "app_settings",
  "plugins",
  "plugin_grants",
]);

/** Fired on window when an entry is saved or undone. detail: { id, title, toast }. */
export const HISTORY_EVENT = "lactic:history";

/** How long entries are kept. */
const KEEP_DAYS = 365;

interface Open {
  meta: ChangeMeta;
  changes: RowChange[];
}

let open: Open | null = null;

/** True when a write to this table should be noted now. */
export function recording(table: string): boolean {
  return open !== null && RECORDED.has(table);
}

export function keyOf(table: string, row: Row): Record<string, SqlValue> {
  const key: Record<string, SqlValue> = {};
  for (const k of TABLES[table].primaryKey) key[k] = row[k] ?? null;
  return key;
}

const sameKey = (a: Record<string, SqlValue>, b: Record<string, SqlValue>) => JSON.stringify(a) === JSON.stringify(b);

/** Same row, leaving out when it was written. Null only matches null. */
export function sameRow(a: Row | null, b: Row | null): boolean {
  if (!a || !b) return a === b;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.delete("updated_at");
  for (const k of keys) if ((a[k] ?? null) !== (b[k] ?? null)) return false;
  return true;
}

/** Notes one row's change in the open entry. A row written twice keeps its first before and last after. */
export function noteChange(change: RowChange) {
  if (!open || !RECORDED.has(change.table)) return;
  const had = open.changes.find((c) => c.table === change.table && sameKey(c.key, change.key));
  if (had) had.after = change.after;
  else open.changes.push(change);
}

/** Notes the rows a write touched, matched by key: `before` read just before it, `after` just after. */
export function noteRows(table: string, before: Row[], after: Row[]) {
  if (!recording(table)) return;
  const seen = new Set<string>();
  for (const b of before) {
    const key = keyOf(table, b);
    seen.add(JSON.stringify(key));
    noteChange({ table, key, before: b, after: after.find((a) => sameKey(keyOf(table, a), key)) ?? null });
  }
  for (const a of after) {
    const key = keyOf(table, a);
    if (!seen.has(JSON.stringify(key))) noteChange({ table, key, before: null, after: a });
  }
}

/** Reads these rows again by their keys; rows gone since are left out. */
export async function rereadRows(table: string, rows: Row[]): Promise<Row[]> {
  const out: Row[] = [];
  for (const r of rows) {
    const key = keyOf(table, r);
    const cols = Object.keys(key);
    const found = await sql().select(`SELECT * FROM "${table}" WHERE ${cols.map((c) => `"${c}" = ?`).join(" AND ")}`, cols.map((c) => key[c]));
    if (found[0]) out.push(found[0]);
  }
  return out;
}

/** Recorded rows that point at these (by a foreign key), which a delete of them cascades to or clears. */
export async function dependentRows(table: string, parents: Row[]): Promise<{ table: string; rows: Row[] }[]> {
  const out: { table: string; rows: Row[] }[] = [];
  if (!parents.length) return out;
  for (const [child, t] of Object.entries(TABLES)) {
    if (!RECORDED.has(child)) continue;
    for (const [col, fk] of Object.entries(t.foreignKeys ?? {})) {
      if (fk.table !== table) continue;
      const values = parents.map((p) => p[fk.column] ?? null);
      const rows = await sql().select(`SELECT * FROM "${child}" WHERE "${col}" IN (${values.map(() => "?").join(", ")})`, values);
      if (rows.length) out.push({ table: child, rows });
    }
  }
  return out;
}

/** Runs `work` without recording it: what the app does on its own while a change is open (the plan keeping a week on load). */
export async function outsideHistory<T>(work: () => Promise<T>): Promise<T> {
  const was = open;
  open = null;
  try {
    return await work();
  } finally {
    open = was;
  }
}

/** Gives the open entry its title, once what was done is known (Coach Apply's summary). */
export function setChangeTitle(title: string) {
  if (open) open.meta.title = title;
}

/**
 * Runs `work` as one App history entry. Inside another entry it just runs, as part of that one.
 * The entry is saved even when `work` fails partway, so what it did write can still be undone.
 */
export async function recordChange<T>(meta: ChangeMeta, work: () => Promise<T>): Promise<T> {
  if (open) return work();
  const mine: Open = { meta: { author: "you", ...meta }, changes: [] };
  open = mine;
  try {
    return await work();
  } finally {
    open = null;
    try {
      await saveEntry(mine.meta, mine.changes);
    } catch (e) {
      console.error("Couldn't save to App history:", e);
    }
  }
}

/**
 * For raw SQL writes: reads the rows `where` picks in each table before and after `work`, and notes
 * what changed. Outside an entry it only runs `work`.
 */
export async function captureAround<T>(specs: { table: string; where: string; params: SqlValue[] }[], work: () => Promise<T>): Promise<T> {
  const live = specs.filter((s) => recording(s.table));
  if (!live.length) return work();
  const read = (s: (typeof live)[number]) => sql().select(`SELECT * FROM "${s.table}" WHERE ${s.where}`, s.params);
  const before = await Promise.all(live.map(read));
  const result = await work();
  const after = await Promise.all(live.map(read));
  live.forEach((s, i) => noteRows(s.table, before[i], after[i]));
  return result;
}

/** Saves an entry and its rows (only those that really changed). Returns its id, or null when nothing did. */
export async function saveEntry(meta: ChangeMeta, changes: RowChange[]): Promise<string | null> {
  const real = changes.filter((c) => !sameRow(c.before, c.after));
  if (!real.length) return null;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const title = (meta.title?.trim() || titleFor(real)).slice(0, 200);
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString();
  await sql().batch([
    {
      sql: `INSERT INTO app_history (id, at, author, client, plugin_id, title, undo_of, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [id, now, meta.author ?? "you", meta.client ?? null, meta.pluginId ?? null, title, meta.undoOf ?? null, now, now],
    },
    ...real.map((c, seq) => ({
      sql: `INSERT INTO app_history_rows (id, entry_id, seq, table_name, row_key, "before", "after", updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [crypto.randomUUID(), id, seq, c.table, JSON.stringify(c.key), c.before ? JSON.stringify(c.before) : null, c.after ? JSON.stringify(c.after) : null, now],
    })),
    { sql: `DELETE FROM app_history_rows WHERE entry_id IN (SELECT id FROM app_history WHERE at < ?)`, params: [cutoff] },
    { sql: `DELETE FROM app_history WHERE at < ?`, params: [cutoff] },
  ]);
  announce({ id, title, toast: meta.toast === true });
  return id;
}

export function announce(detail: { id: string; title: string; toast: boolean }) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(HISTORY_EVENT, { detail }));
}
