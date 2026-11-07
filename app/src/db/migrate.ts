// Brings the database up to schema.ts: creates missing tables and adds missing columns. Only
// additive changes happen here, so a rider's data is never dropped or rewritten by an update.

import { columnSql, createTableSql, TABLES, type Column } from "./schema";
import type { Sql } from "./sql";

export async function migrate(db: Sql): Promise<void> {
  const existing = new Set((await db.select("SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => String(r.name)));
  for (const [name, table] of Object.entries(TABLES)) {
    if (!existing.has(name)) {
      for (const stmt of createTableSql(name, table)) await db.script(stmt);
      continue;
    }
    const have = new Set((await db.select(`PRAGMA table_info("${name}")`)).map((r) => String(r.name)));
    for (const [col, c] of Object.entries(table.columns)) {
      if (have.has(col)) continue;
      // SQLite can only add a column with a constant default; "now" ones start empty.
      const addable: Column = c.default === "now" || c.default === "uuid" ? { type: c.type } : c;
      await db.script(`ALTER TABLE "${name}" ADD COLUMN ${columnSql(col, addable)}`);
    }
    for (const stmt of createTableSql(name, table).slice(1)) await db.script(stmt);
  }
}
