// App history: reading entries, and undoing one. Undo works like `git revert`: it writes the rows
// back as they were and saves that as a new entry, so nothing is erased. A row that changed again
// since is left as it is now (and said), so an undo never overwrites a later change.

import { TABLES } from "~/db/schema";
import { sql, type Row, type SqlValue } from "~/db/sql";
import { announce, keyOf, noteChange, recordChange, sameRow, type Author } from "./changes";
import { describeChanges, type ChangeLine, type ChangedRow } from "./describe";

export interface Entry {
  id: string;
  at: string;
  author: Author;
  client: string | null;
  pluginId: string | null;
  title: string;
  undoOf: string | null;
  undoneAt: string | null;
}

export interface StoredChange extends ChangedRow {
  key: Record<string, SqlValue>;
}

export type HistoryFilter = "all" | "you" | "coach" | "plugins" | "sync";

const FILTER_SQL: Record<HistoryFilter, string> = {
  all: "1 = 1",
  you: "author = 'you' AND plugin_id IS NULL",
  coach: "author IN ('coach', 'ai_app')",
  plugins: "plugin_id IS NOT NULL",
  sync: "author IN ('sync', 'lactic')",
};

function toEntry(r: Row): Entry {
  return {
    id: String(r.id),
    at: String(r.at),
    author: (String(r.author) as Author) ?? "you",
    client: r.client ? String(r.client) : null,
    pluginId: r.plugin_id ? String(r.plugin_id) : null,
    title: String(r.title),
    undoOf: r.undo_of ? String(r.undo_of) : null,
    undoneAt: r.undone_at ? String(r.undone_at) : null,
  };
}

/** Newest first. `before`: only entries older than this time, for paging. `pluginId` narrows to one plugin. */
export async function listEntries(opts: { filter?: HistoryFilter; limit?: number; before?: string; pluginId?: string } = {}): Promise<Entry[]> {
  const where = [FILTER_SQL[opts.filter ?? "all"]];
  const params: SqlValue[] = [];
  if (opts.before) {
    where.push("at < ?");
    params.push(opts.before);
  }
  if (opts.pluginId) {
    where.push("plugin_id = ?");
    params.push(opts.pluginId);
  }
  const rows = await sql().select(`SELECT * FROM app_history WHERE ${where.join(" AND ")} ORDER BY at DESC LIMIT ?`, [...params, opts.limit ?? 30]);
  return rows.map(toEntry);
}

export async function getEntry(id: string): Promise<Entry | null> {
  const rows = await sql().select(`SELECT * FROM app_history WHERE id = ?`, [id]);
  return rows[0] ? toEntry(rows[0]) : null;
}

const parse = (v: SqlValue): Row | null => {
  if (v === null || v === undefined) return null;
  try {
    return JSON.parse(String(v)) as Row;
  } catch {
    return null;
  }
};

export async function entryChanges(id: string): Promise<StoredChange[]> {
  const rows = await sql().select(`SELECT table_name, row_key, "before", "after" FROM app_history_rows WHERE entry_id = ? ORDER BY seq`, [id]);
  return rows
    .filter((r) => TABLES[String(r.table_name)])
    .map((r) => ({ table: String(r.table_name), key: (parse(r.row_key) ?? {}) as Record<string, SqlValue>, before: parse(r.before), after: parse(r.after) }));
}

async function current(c: StoredChange): Promise<Row | null> {
  const cols = Object.keys(c.key);
  if (!cols.length) return null;
  const rows = await sql().select(`SELECT * FROM "${c.table}" WHERE ${cols.map((k) => `"${k}" = ?`).join(" AND ")}`, cols.map((k) => c.key[k]));
  return rows[0] ?? null;
}

/** Rows elsewhere that point at this one by a foreign key, which removing it would take with it. */
async function hasDependents(table: string, row: Row, leaving: StoredChange[]): Promise<boolean> {
  for (const [child, t] of Object.entries(TABLES)) {
    for (const [col, fk] of Object.entries(t.foreignKeys ?? {})) {
      if (fk.table !== table) continue;
      const found = await sql().select(`SELECT * FROM "${child}" WHERE "${col}" = ?`, [row[fk.column] ?? null]);
      // Ones this same undo removes first are fine.
      const others = found.filter((f) => !leaving.some((l) => l.table === child && JSON.stringify(l.key) === JSON.stringify(keyOf(child, f))));
      if (others.length) return true;
    }
  }
  return false;
}

export interface UndoPlan {
  /** What Undo would put back. */
  lines: ChangeLine[];
  /** What it would leave as it is: changed again since. */
  kept: ChangeLine[];
  steps: { change: StoredChange; now: Row | null }[];
}

/** Works out an undo without writing anything: which rows go back and which changed again since. */
export async function planUndo(id: string): Promise<UndoPlan> {
  const changes = await entryChanges(id);
  const steps: UndoPlan["steps"] = [];
  const kept: StoredChange[] = [];
  for (const c of changes) {
    const now = await current(c);
    if (sameRow(now, c.after)) steps.push({ change: c, now });
    else kept.push(c);
  }
  // A row this undo would remove that something newer now points at stays too.
  const removing = steps.filter((s) => !s.change.before && s.now).map((s) => s.change);
  for (const s of [...steps]) {
    if (s.change.before || !s.now) continue;
    if (await hasDependents(s.change.table, s.now, removing)) {
      steps.splice(steps.indexOf(s), 1);
      kept.push(s.change);
    }
  }
  return { lines: describeChanges(steps.map((s) => s.change)), kept: describeChanges(kept), steps };
}

/** Undoes an entry. Returns what was put back and what was left as it is. Throws when nothing can be. */
export async function undoEntry(id: string): Promise<{ title: string; kept: ChangeLine[] }> {
  const entry = await getEntry(id);
  if (!entry) throw new Error("That change isn't in App history any more");
  if (entry.undoneAt) throw new Error("Already undone");
  const plan = await planUndo(id);
  if (!plan.steps.length) throw new Error("Everything it changed has changed again since, so there's nothing to undo");
  const title = `Undid: ${entry.title}`.slice(0, 200);
  const now = new Date().toISOString();

  // Rows coming back go in the order they were written (a parent before the rows pointing at it);
  // rows going away go in reverse (those pointing at a row before it).
  const back = plan.steps.filter((s) => s.change.before);
  const away = plan.steps.filter((s) => !s.change.before).reverse();
  const statements: { sql: string; params: SqlValue[] }[] = [];
  const restored: { change: StoredChange; now: Row | null; to: Row | null }[] = [];
  for (const s of back) {
    const row: Row = { ...(s.change.before as Row) };
    if ("updated_at" in TABLES[s.change.table].columns) row.updated_at = now;
    const cols = Object.keys(row).filter((k) => TABLES[s.change.table].columns[k]);
    if (s.now) {
      const keys = Object.keys(s.change.key);
      const sets = cols.filter((k) => !keys.includes(k));
      statements.push({
        sql: `UPDATE "${s.change.table}" SET ${sets.map((k) => `"${k}" = ?`).join(", ")} WHERE ${keys.map((k) => `"${k}" = ?`).join(" AND ")}`,
        params: [...sets.map((k) => row[k] ?? null), ...keys.map((k) => s.change.key[k])],
      });
    } else {
      statements.push({ sql: `INSERT INTO "${s.change.table}" (${cols.map((k) => `"${k}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, params: cols.map((k) => row[k] ?? null) });
    }
    restored.push({ change: s.change, now: s.now, to: row });
  }
  for (const s of away) {
    const keys = Object.keys(s.change.key);
    statements.push({ sql: `DELETE FROM "${s.change.table}" WHERE ${keys.map((k) => `"${k}" = ?`).join(" AND ")}`, params: keys.map((k) => s.change.key[k]) });
    restored.push({ change: s.change, now: s.now, to: null });
  }
  statements.push({ sql: `UPDATE app_history SET undone_at = ?, updated_at = ? WHERE id = ?`, params: [now, now, id] });
  // Undoing an undo: the entry it undid counts as done again.
  if (entry.undoOf) statements.push({ sql: `UPDATE app_history SET undone_at = NULL, updated_at = ? WHERE id = ?`, params: [now, entry.undoOf] });

  await recordChange({ author: "you", title, undoOf: id, pluginId: entry.pluginId }, async () => {
    await sql().batch(statements);
    for (const r of restored) noteChange({ table: r.change.table, key: r.change.key, before: r.now, after: r.to });
  });
  announce({ id, title, toast: false });
  if (typeof window !== "undefined") {
    const tables = new Set(plan.steps.map((s) => s.change.table));
    if (tables.has("plugins") || tables.has("plugin_grants")) window.dispatchEvent(new CustomEvent("lactic:plugins"));
    if (tables.has("app_settings")) for (const s of plan.steps) if (s.change.table === "app_settings") window.dispatchEvent(new CustomEvent("lactic:settings", { detail: s.change.key.key }));
  }
  return { title, kept: plan.kept };
}
