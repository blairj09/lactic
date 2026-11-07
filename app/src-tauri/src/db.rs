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
        Ok(Db { conn: Mutex::new(conn), path })
    }
}

fn to_sql(v: &Value) -> SqlValue {
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

fn from_sql(v: rusqlite::types::ValueRef) -> Value {
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

#[tauri::command]
pub fn db_select(db: State<Db>, sql: String, params: Vec<Value>) -> Result<Vec<Map<String, Value>>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    run_select(&conn, &sql, &params)
}

#[tauri::command]
pub fn db_execute(db: State<Db>, sql: String, params: Vec<Value>) -> Result<usize, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    run_execute(&conn, &sql, &params)
}

/// Runs SQL with no parameters, possibly several statements (migrations).
#[tauri::command]
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
#[tauri::command]
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

#[tauri::command]
pub fn db_path(db: State<Db>) -> String {
    db.path.to_string_lossy().into_owned()
}

/// Copies the live database to a file, safely while it's in use.
#[tauri::command]
pub fn db_backup(db: State<Db>, to: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut dest = Connection::open(&to).map_err(|e| e.to_string())?;
    let backup = rusqlite::backup::Backup::new(&conn, &mut dest).map_err(|e| e.to_string())?;
    backup.run_to_completion(256, std::time::Duration::from_millis(0), None).map_err(|e| e.to_string())
}
