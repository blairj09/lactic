// The app's SQLite database: one file in the app's data folder. The web layer sends SQL with
// parameters; Rust owns the file, so nothing else (and no network) ever touches it.

use rusqlite::{types::Value as SqlValue, Connection};
use serde::Deserialize;
use serde_json::{Map, Value};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

pub struct Db {
    pub conn: Mutex<Connection>,
    pub path: PathBuf,
}

impl Db {
    pub fn open(path: PathBuf) -> rusqlite::Result<Self> {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let conn = Connection::open(&path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;")?;
        confine(&conn);
        Ok(Db { conn: Mutex::new(conn), path })
    }
}

/// The web layer sends SQL, and SQL can open other files (ATTACH, VACUUM INTO). Nothing in the
/// app does, so the database refuses: its SQL only ever touches lactic.db. (A plain VACUUM
/// attaches a nameless temporary database, which stays allowed.)
fn confine(conn: &Connection) {
    use rusqlite::hooks::{AuthAction, Authorization};
    conn.authorizer(Some(|ctx: rusqlite::hooks::AuthContext<'_>| match ctx.action {
        AuthAction::Attach { filename } if !filename.is_empty() => Authorization::Deny,
        _ => Authorization::Allow,
    }));
}

pub(crate) fn to_sql(v: &Value) -> SqlValue {
    match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(*b as i64),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                SqlValue::Integer(i)
            } else {
                SqlValue::Real(n.as_f64().unwrap_or(0.0))
            }
        }
        Value::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

pub(crate) fn from_sql(v: rusqlite::types::ValueRef) -> Value {
    use rusqlite::types::ValueRef::*;
    match v {
        Null => Value::Null,
        Integer(i) => Value::from(i),
        Real(f) => serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null),
        Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        Blob(b) => {
            use base64::Engine;
            Value::String(base64::engine::general_purpose::STANDARD.encode(b))
        }
    }
}

fn run_select(conn: &Connection, sql: &str, params: &[Value]) -> Result<Vec<Map<String, Value>>, String> {
    let mut stmt = conn.prepare_cached(sql).map_err(|e| e.to_string())?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let values: Vec<SqlValue> = params.iter().map(to_sql).collect();
    let mut rows = stmt.query(rusqlite::params_from_iter(values)).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let mut obj = Map::new();
        for (i, name) in names.iter().enumerate() {
            obj.insert(name.clone(), from_sql(row.get_ref(i).map_err(|e| e.to_string())?));
        }
        out.push(obj);
    }
    Ok(out)
}

fn run_execute(conn: &Connection, sql: &str, params: &[Value]) -> Result<usize, String> {
    let mut stmt = conn.prepare_cached(sql).map_err(|e| e.to_string())?;
    let values: Vec<SqlValue> = params.iter().map(to_sql).collect();
    stmt.execute(rusqlite::params_from_iter(values)).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn db_select(db: State<Db>, sql: String, params: Vec<Value>) -> Result<Vec<Map<String, Value>>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    run_select(&conn, &sql, &params)
}

#[tauri::command(async)]
pub fn db_execute(db: State<Db>, sql: String, params: Vec<Value>) -> Result<usize, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    run_execute(&conn, &sql, &params)
}

/// Runs SQL with no parameters, possibly several statements (migrations).
#[tauri::command(async)]
pub fn db_script(db: State<Db>, sql: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute_batch(&sql).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
pub struct Statement {
    sql: String,
    #[serde(default)]
    params: Vec<Value>,
}

/// Several writes in one transaction: all of them land, or none.
#[tauri::command(async)]
pub fn db_batch(db: State<Db>, statements: Vec<Statement>) -> Result<usize, String> {
    let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut total = 0;
    for s in &statements {
        total += run_execute(&tx, &s.sql, &s.params)?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(total)
}

#[tauri::command(async)]
pub fn db_path(db: State<Db>) -> String {
    db.path.to_string_lossy().into_owned()
}

/// Copies the live database to a file, safely while it's in use.
#[tauri::command(async)]
pub fn db_backup(db: State<Db>, to: String) -> Result<(), String> {
    let to = crate::files::guard(&to)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut dest = Connection::open(&to).map_err(|e| e.to_string())?;
    let backup = rusqlite::backup::Backup::new(&conn, &mut dest).map_err(|e| e.to_string())?;
    backup.run_to_completion(256, std::time::Duration::from_millis(0), None).map_err(|e| e.to_string())
}

/// Where restoring keeps the data it replaced, next to the database.
pub fn previous_path(live: &std::path::Path) -> PathBuf {
    live.with_file_name("lactic-before-restore.db")
}

const NOT_A_BACKUP: &str = "That file isn't a Lactic backup. Pick the .db file you saved with Back up… on your other computer.";

/// Replaces everything in `conn` (the database at `live`) with the backup at `from`. What was
/// there first is kept at `previous_path(live)`. The backup is checked before anything changes.
pub fn restore_into(conn: &mut Connection, live: &std::path::Path, from: &std::path::Path) -> Result<(), String> {
    let same = match (std::fs::canonicalize(from), std::fs::canonicalize(live)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    };
    if same {
        return Err("That's the database Lactic is using now. Pick a backup you saved.".into());
    }
    // Work from a copy in the data folder, so a backup on a read-only drive or a cloud folder
    // opens the same way and nothing is written next to the rider's file.
    let staged = live.with_file_name("lactic-restoring.db");
    let _ = std::fs::remove_file(&staged);
    std::fs::copy(from, &staged).map_err(|e| format!("Couldn't read the backup: {e}"))?;
    let result = (|| {
        let src = Connection::open(&staged).map_err(|_| NOT_A_BACKUP.to_string())?;
        let check: String = src.query_row("PRAGMA quick_check", [], |r| r.get(0)).map_err(|_| NOT_A_BACKUP.to_string())?;
        if check != "ok" {
            return Err("That backup is damaged, so nothing was changed. Try another copy.".into());
        }
        let tables: i64 = src
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name IN ('app_settings', 'activities', 'athlete_settings')",
                [],
                |r| r.get(0),
            )
            .map_err(|_| NOT_A_BACKUP.to_string())?;
        if tables < 3 {
            return Err(NOT_A_BACKUP.into());
        }

        // Keep what's here now, in case the wrong file was picked.
        let previous = previous_path(live);
        let _ = std::fs::remove_file(&previous);
        {
            let mut dest = Connection::open(&previous).map_err(|e| e.to_string())?;
            let copy = rusqlite::backup::Backup::new(conn, &mut dest).map_err(|e| e.to_string())?;
            copy.run_to_completion(256, std::time::Duration::from_millis(0), None).map_err(|e| e.to_string())?;
        }

        // Out of WAL for the copy, so a backup with another page size still restores.
        conn.execute_batch("PRAGMA journal_mode=DELETE;").map_err(|e| e.to_string())?;
        let copied = (|| {
            let copy = rusqlite::backup::Backup::new(&src, conn).map_err(|e| e.to_string())?;
            copy.run_to_completion(256, std::time::Duration::from_millis(0), None).map_err(|e| e.to_string())
        })();
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;").map_err(|e| e.to_string())?;
        copied
    })();
    let _ = std::fs::remove_file(&staged);
    for ext in ["-wal", "-shm", "-journal"] {
        let mut p = staged.clone().into_os_string();
        p.push(ext);
        let _ = std::fs::remove_file(PathBuf::from(p));
    }
    result
}

/// Settings → Your data → Restore: swaps in a backup from another computer (or an earlier day).
#[tauri::command(async)]
pub fn db_restore(db: State<Db>, from: String) -> Result<(), String> {
    let from = crate::files::guard(&from)?;
    let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
    restore_into(&mut conn, &db.path, &from)?;
    // A paired phone's place in the old history means nothing now: it starts over with a snapshot.
    crate::sync::prepare(&conn).and_then(|_| crate::sync::new_epoch(&conn))
}

/// Removes the copy restoring kept (delete-all-data leaves nothing behind).
#[tauri::command(async)]
pub fn db_forget_previous(db: State<Db>) -> Result<(), String> {
    match std::fs::remove_file(previous_path(&db.path)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("lactic-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn lactic_db(path: &std::path::Path, ride: &str, page_size: Option<u32>) -> Connection {
        let conn = Connection::open(path).unwrap();
        if let Some(size) = page_size {
            conn.execute_batch(&format!("PRAGMA page_size={size};")).unwrap();
        }
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT);
             CREATE TABLE athlete_settings (id TEXT PRIMARY KEY);
             CREATE TABLE activities (id TEXT PRIMARY KEY, name TEXT);",
        )
        .unwrap();
        conn.execute("INSERT INTO activities (id, name) VALUES ('1', ?)", [ride]).unwrap();
        conn
    }

    fn ride(conn: &Connection) -> String {
        conn.query_row("SELECT name FROM activities", [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn restores_a_backup_and_keeps_what_was_there() {
        let d = dir("restore");
        let live_path = d.join("lactic.db");
        let mut live = lactic_db(&live_path, "Here", None);
        let backup_path = d.join("backup.db");
        lactic_db(&backup_path, "From the old Mac", Some(8192));

        restore_into(&mut live, &live_path, &backup_path).unwrap();
        assert_eq!(ride(&live), "From the old Mac");
        let mode: String = live.query_row("PRAGMA journal_mode", [], |r| r.get(0)).unwrap();
        assert_eq!(mode, "wal");
        let previous = Connection::open(previous_path(&live_path)).unwrap();
        assert_eq!(ride(&previous), "Here");
        assert!(!d.join("lactic-restoring.db").exists());
    }

    #[test]
    fn sql_cant_open_other_files() {
        let d = dir("confine");
        let db = Db::open(d.join("lactic.db")).unwrap();
        let conn = db.conn.lock().unwrap();
        conn.execute_batch("CREATE TABLE t (x); INSERT INTO t VALUES (1);").unwrap();
        let other = d.join("other.db");
        assert!(conn.execute_batch(&format!("ATTACH DATABASE '{}' AS o", other.display())).is_err());
        assert!(conn.execute_batch(&format!("VACUUM INTO '{}'", d.join("copy.db").display())).is_err());
        assert!(!other.exists() && !d.join("copy.db").exists());
        conn.execute_batch("VACUUM").unwrap();
        let n: i64 = conn.query_row("SELECT count(*) FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn refuses_files_that_arent_lactic_backups() {
        let d = dir("refuse");
        let live_path = d.join("lactic.db");
        let mut live = lactic_db(&live_path, "Here", None);

        let text = d.join("notes.db");
        std::fs::write(&text, "not a database at all, just some words in a file").unwrap();
        assert!(restore_into(&mut live, &live_path, &text).is_err());

        let other = d.join("other.db");
        Connection::open(&other).unwrap().execute_batch("CREATE TABLE things (x);").unwrap();
        assert!(restore_into(&mut live, &live_path, &other).is_err());

        assert!(restore_into(&mut live, &live_path, &live_path).is_err());
        assert_eq!(ride(&live), "Here");
    }
}
