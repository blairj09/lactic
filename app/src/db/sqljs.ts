// SQLite in the browser (sql.js), for running Lactic outside the desktop shell: development,
// tests and the web preview. Saved to IndexedDB after each write when `persist` is set.

import initSqlJs, { type Database } from "sql.js";
import type { Row, Sql, SqlValue } from "./sql";

const DB_NAME = "lactic";
const STORE = "db";

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadBytes(): Promise<Uint8Array | null> {
  try {
    const db = await idb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get("main");
      req.onsuccess = () => resolve((req.result as Uint8Array) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function saveBytes(bytes: Uint8Array) {
  try {
    const db = await idb();
    db.transaction(STORE, "readwrite").objectStore(STORE).put(bytes, "main");
  } catch {
    // Private mode: this session only.
  }
}

const bind = (params: SqlValue[] = []) => params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p));

export function wrapDatabase(db: Database, onWrite?: () => void): Sql {
  const select = async (sql: string, params?: SqlValue[]): Promise<Row[]> => {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(bind(params));
      const rows: Row[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as Row);
      return rows;
    } finally {
      stmt.free();
    }
  };
  const execute = async (sql: string, params?: SqlValue[]) => {
    db.run(sql, bind(params));
    const changed = db.getRowsModified();
    onWrite?.();
    return changed;
  };
  return {
    select,
    execute,
    async batch(statements) {
      db.run("BEGIN");
      let total = 0;
      try {
        for (const s of statements) {
          db.run(s.sql, bind(s.params));
          total += db.getRowsModified();
        }
        db.run("COMMIT");
      } catch (e) {
        db.run("ROLLBACK");
        throw e;
      }
      onWrite?.();
      return total;
    },
    async script(sql) {
      db.exec(sql);
      onWrite?.();
    },
  };
}

export async function openSqlJs({ persist = true, wasmUrl }: { persist?: boolean; wasmUrl?: string } = {}): Promise<Sql> {
  const SQL = await initSqlJs(wasmUrl ? { locateFile: () => wasmUrl } : undefined);
  const bytes = persist ? await loadBytes() : null;
  const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  db.run("PRAGMA foreign_keys = ON");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onWrite = persist
    ? () => {
        clearTimeout(timer);
        timer = setTimeout(() => void saveBytes(db.export()), 300);
      }
    : undefined;
  return wrapDatabase(db, onWrite);
}
