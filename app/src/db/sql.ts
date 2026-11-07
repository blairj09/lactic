// The one way the app talks to SQLite. In the desktop app it's the Rust core (db.rs); in a plain
// browser (npm run dev, tests, screenshots) it's sql.js, an in-browser SQLite, saved to IndexedDB.

export type SqlValue = string | number | boolean | null;
export type Row = Record<string, SqlValue>;

export interface Sql {
  select(sql: string, params?: SqlValue[]): Promise<Row[]>;
  execute(sql: string, params?: SqlValue[]): Promise<number>;
  /** Several writes in one transaction. */
  batch(statements: { sql: string; params?: SqlValue[] }[]): Promise<number>;
  /** Statements without parameters, such as migrations. */
  script(sql: string): Promise<void>;
}

let current: Sql | null = null;

export function setSql(sql: Sql) {
  current = sql;
}

export function sql(): Sql {
  if (!current) throw new Error("The database isn't open yet");
  return current;
}
