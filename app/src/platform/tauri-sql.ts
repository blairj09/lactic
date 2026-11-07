// The database through the Rust core (db.rs).

import { invoke } from "./native";
import type { Row, Sql } from "~/db/sql";

export const tauriSql: Sql = {
  select: (sql, params = []) => invoke<Row[]>("db_select", { sql, params }),
  execute: (sql, params = []) => invoke<number>("db_execute", { sql, params }),
  batch: (statements) => invoke<number>("db_batch", { statements: statements.map((s) => ({ sql: s.sql, params: s.params ?? [] })) }),
  script: (sql) => invoke<void>("db_script", { sql }),
};
