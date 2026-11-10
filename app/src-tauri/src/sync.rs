// Keeping a paired iPhone in step with this computer. The computer's database is the source of
// truth; the phone keeps its own copy and sends back what it changed.
//
// Every table gets three triggers that note the primary key of each row written or deleted in
// sync_log. One exchange is: the phone sends the rows it changed (current row, or null when it
// was deleted), the computer applies them last-writer-wins on updated_at, then answers with a page
// of its own changes since the phone's cursor. A phone that has never synced (or whose cursor
// came from another database, such as one restored from a backup) gets a snapshot of every table
// first, parents before children. While the phone applies what it was sent, its triggers are off,
// so it never echoes the computer's rows back.
//
// sync_log and sync_meta are bookkeeping about this one database, so they don't follow the
// every-table-has-id-and-updated_at rule and never sync themselves.

use crate::db::{from_sql, to_sql};
use rusqlite::{params_from_iter, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

/// app_settings keys that belong to one device (where its files are, its gear, its pairing).
const LOCAL_SETTINGS: &[&str] = &["health.folder", "bluetooth.", "data.restored", "mcp.", "sync.", "phone.", "secrets.", "updates."];
/// Roughly how much row data one page carries.
const PAGE_BYTES: usize = 1_500_000;
const PAGE_ROWS: usize = 2_000;

/// One changed row: its table, primary key values, and the row now (None: deleted).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Change {
    pub t: String,
    pub k: Vec<Value>,
    pub r: Option<Map<String, Value>>,
}

/// Where a phone is in the computer's history. `snap` is set while a snapshot is under way:
/// the table it got to and the last rowid sent from it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Cursor {
    pub epoch: String,
    pub seq: i64,
    #[serde(default)]
    pub snap: Option<(String, i64)>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Exchange {
    #[serde(default)]
    pub cursor: Option<Cursor>,
    #[serde(default)]
    pub changes: Vec<Change>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Reply {
    pub cursor: Cursor,
    pub changes: Vec<Change>,
    /// More pages are waiting: ask again straight away.
    pub more: bool,
    /// How many of the phone's changes were applied, and the ones that weren't (with why).
    pub applied: usize,
    pub rejected: Vec<String>,
}

fn quote(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn is_local_setting(key: &str) -> bool {
    LOCAL_SETTINGS.iter().any(|p| if p.ends_with('.') { key.starts_with(p) } else { key == *p })
}

/// The tables that sync, parents before children (by foreign key).
pub fn tables(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'sync_%' ORDER BY name")?;
    let names: Vec<String> = stmt.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
    let mut parents: HashMap<String, HashSet<String>> = HashMap::new();
    for n in &names {
        let mut fk = conn.prepare(&format!("PRAGMA foreign_key_list({})", quote(n)))?;
        let refs: HashSet<String> = fk.query_map([], |r| r.get::<_, String>(2))?.filter_map(Result::ok).filter(|p| p != n).collect();
        parents.insert(n.clone(), refs);
    }
    let mut out: Vec<String> = vec![];
    let mut placed: HashSet<String> = HashSet::new();
    while out.len() < names.len() {
        let before = out.len();
        for n in &names {
            if !placed.contains(n) && parents[n].iter().all(|p| placed.contains(p) || !parents.contains_key(p)) {
                placed.insert(n.clone());
                out.push(n.clone());
            }
        }
        if out.len() == before {
            // A cycle: the rest in name order (the phone applies with foreign keys off anyway).
            for n in &names {
                if placed.insert(n.clone()) {
                    out.push(n.clone());
                }
            }
        }
    }
    Ok(out)
}

struct Shape {
    columns: Vec<String>,
    pk: Vec<String>,
}

fn shape(conn: &Connection, table: &str) -> rusqlite::Result<Shape> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", quote(table)))?;
    let mut cols: Vec<(String, i64)> = stmt.query_map([], |r| Ok((r.get::<_, String>(1)?, r.get::<_, i64>(5)?)))?.collect::<Result<_, _>>()?;
    let columns = cols.iter().map(|c| c.0.clone()).collect();
    cols.retain(|c| c.1 > 0);
    cols.sort_by_key(|c| c.1);
    Ok(Shape { columns, pk: cols.into_iter().map(|c| c.0).collect() })
}

/// Creates the log and the triggers (again after an update adds tables). Safe to run every start.
pub fn prepare(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS sync_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT NOT NULL, pk TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS sync_meta (id INTEGER PRIMARY KEY CHECK (id = 1), applying INTEGER NOT NULL DEFAULT 0, epoch TEXT, cursor TEXT);
         INSERT OR IGNORE INTO sync_meta (id, applying) VALUES (1, 0);
         UPDATE sync_meta SET applying = 0;",
    )
    .map_err(|e| e.to_string())?;
    let epoch: Option<String> = conn.query_row("SELECT epoch FROM sync_meta WHERE id = 1", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if epoch.is_none() {
        new_epoch(conn)?;
    }
    for t in tables(conn).map_err(|e| e.to_string())? {
        let s = shape(conn, &t).map_err(|e| e.to_string())?;
        if s.pk.is_empty() {
            continue;
        }
        let key = |row: &str| format!("json_array({})", s.pk.iter().map(|c| format!("{row}.{}", quote(c))).collect::<Vec<_>>().join(", "));
        let lit = t.replace('\'', "''");
        let when = "WHEN (SELECT applying FROM sync_meta WHERE id = 1) = 0";
        let log = |row: &str| format!("INSERT INTO sync_log (tbl, pk) VALUES ('{lit}', {});", key(row));
        let name = |suffix: &str| quote(&format!("sync_{t}_{suffix}"));
        conn.execute_batch(&format!(
            "CREATE TRIGGER IF NOT EXISTS {} AFTER INSERT ON {q} {when} BEGIN {} END;
             CREATE TRIGGER IF NOT EXISTS {} AFTER UPDATE ON {q} {when} BEGIN {} {} END;
             CREATE TRIGGER IF NOT EXISTS {} AFTER DELETE ON {q} {when} BEGIN {} END;",
            name("i"),
            log("NEW"),
            name("u"),
            log("OLD"),
            log("NEW"),
            name("d"),
            log("OLD"),
            q = quote(&t),
        ))
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Logs every row of `which` (in that order) as changed, so the next exchanges send them all: a
/// phone that was used on its own keeps its rides when it pairs with a computer that has data.
pub fn relog(conn: &Connection, which: &[String]) -> Result<usize, String> {
    let known = tables(conn).map_err(|e| e.to_string())?;
    let mut n = 0;
    for t in which.iter().filter(|t| known.contains(t)) {
        let s = shape(conn, t).map_err(|e| e.to_string())?;
        if s.pk.is_empty() {
            continue;
        }
        let key = format!("json_array({})", s.pk.iter().map(|c| quote(c)).collect::<Vec<_>>().join(", "));
        n += conn
            .execute(&format!("INSERT INTO sync_log (tbl, pk) SELECT ?1, {key} FROM {}", quote(t)), [t])
            .map_err(|e| e.to_string())?;
    }
    Ok(n)
}

/// A new identity for this database's history, so phones synced against an earlier one start
/// over with a snapshot (after a restore, for one).
pub fn new_epoch(conn: &Connection) -> Result<(), String> {
    let epoch = uuid::Uuid::new_v4().to_string();
    conn.execute("UPDATE sync_meta SET epoch = ?1", [epoch]).map_err(|e| e.to_string())?;
    Ok(())
}

fn epoch(conn: &Connection) -> Result<String, String> {
    conn.query_row("SELECT epoch FROM sync_meta WHERE id = 1", [], |r| r.get::<_, Option<String>>(0)).map_err(|e| e.to_string())?.ok_or_else(|| "Sync isn't set up".into())
}

fn max_seq(conn: &Connection) -> Result<i64, String> {
    conn.query_row("SELECT COALESCE(MAX(seq), 0) FROM sync_log", [], |r| r.get(0)).map_err(|e| e.to_string())
}

fn read_row(conn: &Connection, table: &str, s: &Shape, key: &[Value]) -> Result<Option<Map<String, Value>>, String> {
    if key.len() != s.pk.len() {
        return Ok(None);
    }
    let cond = s.pk.iter().enumerate().map(|(i, c)| format!("{} = ?{}", quote(c), i + 1)).collect::<Vec<_>>().join(" AND ");
    let mut stmt = conn.prepare_cached(&format!("SELECT * FROM {} WHERE {cond}", quote(table))).map_err(|e| e.to_string())?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    stmt.query_row(params_from_iter(key.iter().map(to_sql)), |r| {
        let mut m = Map::new();
        for (i, n) in names.iter().enumerate() {
            m.insert(n.clone(), from_sql(r.get_ref(i)?));
        }
        Ok(m)
    })
    .optional()
    .map_err(|e| e.to_string())
}

fn skip(table: &str, key: &[Value]) -> bool {
    table == "app_settings" && key.first().and_then(|k| k.as_str()).is_some_and(is_local_setting)
}

/// The changes logged after `since` (each row once, as it is now), up to a page, and the last
/// sequence number read.
fn logged(conn: &Connection, since: i64, shapes: &mut HashMap<String, Shape>) -> Result<(Vec<Change>, i64, bool), String> {
    let mut stmt = conn.prepare_cached("SELECT seq, tbl, pk FROM sync_log WHERE seq > ?1 ORDER BY seq LIMIT ?2").map_err(|e| e.to_string())?;
    let entries: Vec<(i64, String, String)> =
        stmt.query_map(rusqlite::params![since, PAGE_ROWS as i64], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map_err(|e| e.to_string())?.collect::<Result<_, _>>().map_err(|e| e.to_string())?;
    let full = entries.len() == PAGE_ROWS;
    let mut seen = HashSet::new();
    let mut out = vec![];
    let mut last = since;
    let mut bytes = 0;
    for (seq, t, pk) in entries {
        last = seq;
        if !seen.insert((t.clone(), pk.clone())) {
            continue;
        }
        let key: Vec<Value> = serde_json::from_str(&pk).unwrap_or_default();
        if skip(&t, &key) {
            continue;
        }
        if !shapes.contains_key(&t) {
            match shape(conn, &t) {
                Ok(s) => shapes.insert(t.clone(), s),
                Err(_) => continue,
            };
        }
        let row = read_row(conn, &t, &shapes[&t], &key)?;
        bytes += row.as_ref().map(|r| Value::Object(r.clone()).to_string().len()).unwrap_or(40);
        out.push(Change { t, k: key, r: row });
        if bytes > PAGE_BYTES {
            return Ok((out, last, true));
        }
    }
    Ok((out, last, full))
}

/// A page of a snapshot, from `at` (table, last rowid sent). Returns where to carry on, or None
/// once every table is sent.
fn snapshot(conn: &Connection, at: Option<(String, i64)>) -> Result<(Vec<Change>, Option<(String, i64)>), String> {
    let all = tables(conn).map_err(|e| e.to_string())?;
    let (mut ti, mut after) = match &at {
        Some((t, r)) => (all.iter().position(|x| x == t).unwrap_or(all.len()), *r),
        None => (0, 0),
    };
    let mut out = vec![];
    let mut bytes = 0;
    while ti < all.len() {
        let t = &all[ti];
        let s = shape(conn, t).map_err(|e| e.to_string())?;
        if s.pk.is_empty() {
            ti += 1;
            after = 0;
            continue;
        }
        let mut stmt = conn.prepare(&format!("SELECT rowid, * FROM {} WHERE rowid > ?1 ORDER BY rowid LIMIT ?2", quote(t))).map_err(|e| e.to_string())?;
        let names: Vec<String> = stmt.column_names().iter().skip(1).map(|s| s.to_string()).collect();
        let mut rows = stmt.query(rusqlite::params![after, PAGE_ROWS as i64]).map_err(|e| e.to_string())?;
        let mut count = 0;
        while let Some(r) = rows.next().map_err(|e| e.to_string())? {
            count += 1;
            after = r.get(0).map_err(|e| e.to_string())?;
            let mut m = Map::new();
            for (i, n) in names.iter().enumerate() {
                m.insert(n.clone(), from_sql(r.get_ref(i + 1).map_err(|e| e.to_string())?));
            }
            let key: Vec<Value> = s.pk.iter().map(|c| m.get(c).cloned().unwrap_or(Value::Null)).collect();
            if skip(t, &key) {
                continue;
            }
            bytes += Value::Object(m.clone()).to_string().len();
            out.push(Change { t: t.clone(), k: key, r: Some(m) });
            if bytes > PAGE_BYTES || out.len() >= PAGE_ROWS {
                return Ok((out, Some((t.clone(), after))));
            }
        }
        if count < PAGE_ROWS {
            ti += 1;
            after = 0;
        }
    }
    Ok((out, None))
}

/// Writes one change. `newer_wins`: keep the row here when it was updated later than the incoming one.
fn apply_one(conn: &Connection, c: &Change, s: &Shape, newer_wins: bool) -> Result<bool, String> {
    if s.pk.is_empty() || c.k.len() != s.pk.len() || skip(&c.t, &c.k) {
        return Ok(false);
    }
    let cond = s.pk.iter().enumerate().map(|(i, col)| format!("{} = ?{}", quote(col), i + 1)).collect::<Vec<_>>().join(" AND ");
    let Some(row) = &c.r else {
        conn.execute(&format!("DELETE FROM {} WHERE {cond}", quote(&c.t)), params_from_iter(c.k.iter().map(to_sql))).map_err(|e| e.to_string())?;
        return Ok(true);
    };
    if newer_wins && s.columns.iter().any(|x| x == "updated_at") {
        if let Some(Value::String(incoming)) = row.get("updated_at") {
            let here: Option<Option<String>> = conn
                .query_row(&format!("SELECT updated_at FROM {} WHERE {cond}", quote(&c.t)), params_from_iter(c.k.iter().map(to_sql)), |r| r.get(0))
                .optional()
                .map_err(|e| e.to_string())?;
            if let Some(Some(here)) = here {
                if here.as_str() > incoming.as_str() {
                    return Ok(false);
                }
            }
        }
    }
    // Only columns both sides have (the two apps can be a version apart).
    let cols: Vec<&String> = s.columns.iter().filter(|x| row.contains_key(*x)).collect();
    if !s.pk.iter().all(|p| row.contains_key(p)) {
        return Err("row without its key".into());
    }
    let names = cols.iter().map(|x| quote(x)).collect::<Vec<_>>().join(", ");
    let marks = (1..=cols.len()).map(|i| format!("?{i}")).collect::<Vec<_>>().join(", ");
    let set: Vec<String> = cols.iter().filter(|x| !s.pk.contains(x)).map(|x| format!("{q} = excluded.{q}", q = quote(x))).collect();
    let conflict = s.pk.iter().map(|x| quote(x)).collect::<Vec<_>>().join(", ");
    let action = if set.is_empty() { "NOTHING".to_string() } else { format!("UPDATE SET {}", set.join(", ")) };
    let sql = format!("INSERT INTO {} ({names}) VALUES ({marks}) ON CONFLICT ({conflict}) DO {action}", quote(&c.t));
    conn.execute(&sql, params_from_iter(cols.iter().map(|x| to_sql(&row[x.as_str()])))).map_err(|e| e.to_string())?;
    Ok(true)
}

/// The computer's side of one exchange: apply the phone's changes, then answer with the next page.
pub fn exchange(conn: &mut Connection, req: Exchange) -> Result<Reply, String> {
    let mut shapes: HashMap<String, Shape> = HashMap::new();
    let mut applied = 0;
    let mut rejected = vec![];
    // Rows the phone sent that didn't take (this side was newer, or the row broke a rule): this
    // side's version goes back so the phone matches again.
    let mut back: Vec<Change> = vec![];
    if !req.changes.is_empty() {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        for c in &req.changes {
            if !shapes.contains_key(&c.t) {
                match shape(&tx, &c.t) {
                    Ok(s) if !s.columns.is_empty() && !c.t.starts_with("sync_") => {
                        shapes.insert(c.t.clone(), s);
                    }
                    _ => {
                        rejected.push(format!("{}: no such table here", c.t));
                        continue;
                    }
                }
            }
            // Each row on its own, so one bad row doesn't hold back the rest.
            tx.execute_batch("SAVEPOINT row").map_err(|e| e.to_string())?;
            match apply_one(&tx, c, &shapes[&c.t], true) {
                Ok(done) => {
                    tx.execute_batch("RELEASE row").map_err(|e| e.to_string())?;
                    if done {
                        applied += 1;
                    } else if !skip(&c.t, &c.k) {
                        back.push(Change { t: c.t.clone(), k: c.k.clone(), r: read_row(&tx, &c.t, &shapes[&c.t], &c.k)? });
                    }
                }
                Err(e) => {
                    tx.execute_batch("ROLLBACK TO row; RELEASE row").map_err(|e| e.to_string())?;
                    rejected.push(format!("{}: {e}", c.t));
                    back.push(Change { t: c.t.clone(), k: c.k.clone(), r: read_row(&tx, &c.t, &shapes[&c.t], &c.k)? });
                }
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
    }

    let epoch = epoch(conn)?;
    let top = max_seq(conn)?;
    let fresh = match &req.cursor {
        Some(c) => c.epoch != epoch || c.seq > top,
        None => true,
    };
    let (mut changes, cursor, more) = if fresh || req.cursor.as_ref().is_some_and(|c| c.snap.is_some()) {
        // The snapshot starts at the log's current end, so whatever changes while it's sent comes after.
        let (seq, at) = match (&req.cursor, fresh) {
            (Some(c), false) => (c.seq, c.snap.clone()),
            _ => (top, None),
        };
        let (changes, next) = snapshot(conn, at)?;
        let more = next.is_some() || seq < max_seq(conn)?;
        (changes, Cursor { epoch, seq, snap: next }, more)
    } else {
        let since = req.cursor.as_ref().map(|c| c.seq).unwrap_or(0);
        let (changes, last, more) = logged(conn, since, &mut shapes)?;
        (changes, Cursor { epoch, seq: last, snap: None }, more)
    };
    changes.extend(back);
    Ok(Reply { cursor, changes, more, applied, rejected })
}

/// The phone's changes waiting to go (each row once, as it is now), and the last sequence number
/// they cover, to forget once the computer has them.
pub fn outgoing(conn: &Connection) -> Result<(Vec<Change>, i64, bool), String> {
    let mut shapes = HashMap::new();
    logged(conn, 0, &mut shapes)
}

/// The phone saved what the computer sent: forget the changes it took, apply the reply's rows
/// with the triggers off, and keep the cursor.
pub fn incoming(conn: &mut Connection, upto: i64, reply: &Reply) -> Result<usize, String> {
    conn.execute_batch("PRAGMA foreign_keys = OFF").map_err(|e| e.to_string())?;
    let result = (|| {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM sync_log WHERE seq <= ?1", [upto]).map_err(|e| e.to_string())?;
        // Rows changed here since are still to be sent: they win until the computer has them.
        let mut pending: HashSet<(String, String)> = HashSet::new();
        {
            let mut stmt = tx.prepare("SELECT tbl, pk FROM sync_log").map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))).map_err(|e| e.to_string())?;
            for r in rows.flatten() {
                pending.insert(r);
            }
        }
        tx.execute("UPDATE sync_meta SET applying = 1", []).map_err(|e| e.to_string())?;
        let mut shapes: HashMap<String, Shape> = HashMap::new();
        let mut n = 0;
        for c in &reply.changes {
            let pk = Value::Array(c.k.clone()).to_string();
            if pending.contains(&(c.t.clone(), pk)) {
                continue;
            }
            if !shapes.contains_key(&c.t) {
                match shape(&tx, &c.t) {
                    Ok(s) if !s.columns.is_empty() => {
                        shapes.insert(c.t.clone(), s);
                    }
                    _ => continue, // A table this version doesn't have yet.
                }
            }
            tx.execute_batch("SAVEPOINT row").map_err(|e| e.to_string())?;
            match apply_one(&tx, c, &shapes[&c.t], false) {
                Ok(_) => {
                    tx.execute_batch("RELEASE row").map_err(|e| e.to_string())?;
                    n += 1;
                }
                Err(_) => tx.execute_batch("ROLLBACK TO row; RELEASE row").map_err(|e| e.to_string())?,
            }
        }
        tx.execute("UPDATE sync_meta SET applying = 0, cursor = ?1", [serde_json::to_string(&reply.cursor).unwrap_or_default()]).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(n)
    })();
    conn.execute_batch("PRAGMA foreign_keys = ON").map_err(|e| e.to_string())?;
    result
}

/// The phone's saved cursor (None before its first sync).
pub fn saved_cursor(conn: &Connection) -> Result<Option<Cursor>, String> {
    let text: Option<String> = conn.query_row("SELECT cursor FROM sync_meta WHERE id = 1", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    Ok(text.and_then(|t| serde_json::from_str(&t).ok()))
}

/// Forgets the phone's cursor and pending changes (unpairing, or pairing with another computer).
pub fn forget(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("UPDATE sync_meta SET cursor = NULL; DELETE FROM sync_log;").map_err(|e| e.to_string())
}

// --- commands ---------------------------------------------------------------------------------------

use crate::db::Db;
use tauri::State;

/// After the schema is up to date at startup: the log and its triggers.
#[tauri::command]
pub fn sync_prepare(db: State<Db>) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    prepare(&conn)
}

#[derive(Serialize)]
pub struct Outgoing {
    cursor: Option<Cursor>,
    changes: Vec<Change>,
    upto: i64,
    more: bool,
}

/// The phone: sends these tables' rows in full on the next exchanges (see `relog`).
#[tauri::command]
pub fn sync_keep(db: State<Db>, tables: Vec<String>) -> Result<usize, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    relog(&conn, &tables)
}

/// The phone: what to send in the next exchange.
#[tauri::command]
pub fn sync_outgoing(db: State<Db>) -> Result<Outgoing, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let (changes, upto, more) = outgoing(&conn)?;
    Ok(Outgoing { cursor: saved_cursor(&conn)?, changes, upto, more })
}

/// The phone: the computer's answer to the exchange that sent changes up to `upto`.
#[tauri::command]
pub fn sync_incoming(db: State<Db>, upto: i64, reply: Reply) -> Result<usize, String> {
    let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
    incoming(&mut conn, upto, &reply)
}

#[tauri::command]
pub fn sync_forget(db: State<Db>) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    forget(&conn)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE activities (id TEXT PRIMARY KEY, name TEXT, updated_at TEXT);
             CREATE TABLE activity_streams (activity_id TEXT PRIMARY KEY, watts TEXT, updated_at TEXT, FOREIGN KEY (activity_id) REFERENCES activities (id) ON DELETE CASCADE);
             CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
             CREATE TABLE plan_days (user_id TEXT, day TEXT, kind TEXT, updated_at TEXT, PRIMARY KEY (user_id, day));
             CREATE TABLE recovery_days (user_id TEXT, day TEXT, hrv_ms REAL, resting_hr REAL, sleep_hours REAL, source TEXT, updated_at TEXT, PRIMARY KEY (user_id, day));",
        )
        .unwrap();
        prepare(&c).unwrap();
        c
    }

    /// Runs exchanges until the computer has nothing more, as the phone does.
    fn sync(mac: &mut Connection, phone: &mut Connection) -> Reply {
        loop {
            let (changes, upto, _) = outgoing(phone).unwrap();
            let cursor = saved_cursor(phone).unwrap();
            let reply = exchange(mac, Exchange { cursor, changes }).unwrap();
            incoming(phone, upto, &reply).unwrap();
            if !reply.more {
                return reply;
            }
        }
    }

    fn names(c: &Connection) -> Vec<String> {
        let mut s = c.prepare("SELECT name FROM activities ORDER BY id").unwrap();
        s.query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect()
    }

    #[test]
    fn parents_come_first() {
        let c = db();
        let t = tables(&c).unwrap();
        assert!(t.iter().position(|x| x == "activities") < t.iter().position(|x| x == "activity_streams"));
    }

    #[test]
    fn a_new_phone_gets_everything_then_only_changes() {
        let mut mac = db();
        let mut phone = db();
        mac.execute_batch(
            "INSERT INTO activities VALUES ('a', 'Ride one', '2026-11-01T00:00:00.000Z');
             INSERT INTO activity_streams VALUES ('a', '[100,200]', '2026-11-01T00:00:00.000Z');
             INSERT INTO plan_days VALUES ('u', '2026-11-10', 'endurance', '2026-11-01T00:00:00.000Z');
             INSERT INTO app_settings VALUES ('onboarding.done', 'true', 'x'), ('health.folder', '\"/Users/me\"', 'x');",
        )
        .unwrap();
        sync(&mut mac, &mut phone);
        assert_eq!(names(&phone), vec!["Ride one"]);
        let streams: i64 = phone.query_row("SELECT COUNT(*) FROM activity_streams", [], |r| r.get(0)).unwrap();
        assert_eq!(streams, 1);
        // This computer's folder stays on this computer.
        let keys: Vec<String> = phone.prepare("SELECT key FROM app_settings").unwrap().query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect();
        assert_eq!(keys, vec!["onboarding.done"]);
        // Nothing the phone applied is waiting to be sent back.
        assert!(outgoing(&phone).unwrap().0.is_empty());

        mac.execute_batch("UPDATE activities SET name = 'Renamed', updated_at = '2026-11-02T00:00:00.000Z'; DELETE FROM plan_days;").unwrap();
        let reply = sync(&mut mac, &mut phone);
        assert_eq!(reply.changes.len(), 2);
        assert_eq!(names(&phone), vec!["Renamed"]);
        let days: i64 = phone.query_row("SELECT COUNT(*) FROM plan_days", [], |r| r.get(0)).unwrap();
        assert_eq!(days, 0);
    }

    #[test]
    fn a_phone_used_alone_keeps_its_rides_when_it_pairs() {
        let mut mac = db();
        let mut phone = db();
        mac.execute("INSERT INTO plan_days VALUES ('m', '2026-11-10', 'endurance', '2026-11-01T00:00:00.000Z')", []).unwrap();
        phone.execute_batch(
            "INSERT INTO activities VALUES ('p', 'Phone ride', '2026-10-01T00:00:00.000Z');
             INSERT INTO activity_streams VALUES ('p', '[1]', '2026-10-01T00:00:00.000Z');
             INSERT INTO plan_days VALUES ('q', '2026-11-11', 'vo2', '2026-10-01T00:00:00.000Z');",
        )
        .unwrap();
        // Pairing forgets the phone's history, then keeps the ride tables.
        forget(&phone).unwrap();
        let kept = relog(&phone, &["activities".into(), "activity_streams".into(), "nope".into()]).unwrap();
        assert_eq!(kept, 2);
        sync(&mut mac, &mut phone);
        assert_eq!(names(&mac), vec!["Phone ride"]);
        let streams: i64 = mac.query_row("SELECT COUNT(*) FROM activity_streams", [], |r| r.get(0)).unwrap();
        assert_eq!(streams, 1);
        // The phone's own plan stays behind; the computer's plan is the plan.
        let days: Vec<String> = mac.prepare("SELECT user_id FROM plan_days").unwrap().query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect();
        assert_eq!(days, vec!["m"]);
    }

    #[test]
    fn the_phones_changes_reach_the_computer_and_newer_wins() {
        let mut mac = db();
        let mut phone = db();
        mac.execute("INSERT INTO activities VALUES ('a', 'Mac name', '2026-11-05T00:00:00.000Z')", []).unwrap();
        sync(&mut mac, &mut phone);

        phone.execute_batch("INSERT INTO activities VALUES ('b', 'Phone ride', '2026-11-06T00:00:00.000Z');").unwrap();
        // An older edit on the phone loses to the computer's newer one.
        phone.execute("UPDATE activities SET name = 'Old phone name', updated_at = '2026-11-04T00:00:00.000Z' WHERE id = 'a'", []).unwrap();
        let reply = sync(&mut mac, &mut phone);
        assert_eq!(reply.applied, 1);
        assert_eq!(names(&mac), vec!["Mac name", "Phone ride"]);
        assert_eq!(names(&phone), vec!["Mac name", "Phone ride"]);
        assert!(outgoing(&phone).unwrap().0.is_empty());

        phone.execute("DELETE FROM activities WHERE id = 'b'", []).unwrap();
        sync(&mut mac, &mut phone);
        assert_eq!(names(&mac), vec!["Mac name"]);
    }

    #[test]
    fn apple_health_read_on_the_phone_reaches_the_computer() {
        let mut mac = db();
        let mut phone = db();
        // Last night half-arrived on the computer earlier (resting HR only).
        mac.execute("INSERT INTO recovery_days VALUES ('u', '2026-11-10', NULL, 52, NULL, 'shortcut', '2026-11-10T06:00:00.000Z')", []).unwrap();
        sync(&mut mac, &mut phone);
        // The phone reads Health: the whole night, plus its status for the computer's settings card.
        phone
            .execute_batch(
                "INSERT INTO recovery_days VALUES ('u', '2026-11-10', 48, 51, 7.2, 'shortcut', '2026-11-10T08:00:00.000Z')
                   ON CONFLICT (user_id, day) DO UPDATE SET hrv_ms = excluded.hrv_ms, resting_hr = excluded.resting_hr, sleep_hours = excluded.sleep_hours, updated_at = excluded.updated_at;
                 INSERT INTO recovery_days VALUES ('u', '2026-11-09', 55, 50, 7.8, 'shortcut', '2026-11-10T08:00:00.000Z');
                 INSERT INTO app_settings VALUES ('health.iphone', '{\"at\":\"2026-11-10T08:00:00.000Z\"}', '2026-11-10T08:00:00.000Z'),
                                                 ('phone.health.imported', 'true', '2026-11-10T08:00:00.000Z');",
            )
            .unwrap();
        sync(&mut mac, &mut phone);
        let night: (f64, f64, f64) = mac.query_row("SELECT hrv_ms, resting_hr, sleep_hours FROM recovery_days WHERE day = '2026-11-10'", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        assert_eq!(night, (48.0, 51.0, 7.2));
        let nights: i64 = mac.query_row("SELECT COUNT(*) FROM recovery_days", [], |r| r.get(0)).unwrap();
        assert_eq!(nights, 2);
        let keys: Vec<String> = mac.prepare("SELECT key FROM app_settings").unwrap().query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect();
        assert_eq!(keys, vec!["health.iphone"]);
    }

    #[test]
    fn a_restored_computer_sends_a_fresh_snapshot() {
        let mut mac = db();
        let mut phone = db();
        mac.execute("INSERT INTO activities VALUES ('a', 'One', 'x')", []).unwrap();
        sync(&mut mac, &mut phone);
        new_epoch(&mac).unwrap();
        mac.execute_batch("UPDATE sync_meta SET applying = 1; INSERT INTO activities VALUES ('c', 'Restored', 'x'); UPDATE sync_meta SET applying = 0;").unwrap();
        sync(&mut mac, &mut phone);
        assert_eq!(names(&phone), vec!["One", "Restored"]);
    }

    #[test]
    fn big_histories_come_in_pages() {
        let mut mac = db();
        let mut phone = db();
        {
            let tx = mac.transaction().unwrap();
            for i in 0..5000 {
                tx.execute("INSERT INTO activities VALUES (?1, 'r', 'x')", [format!("{i:05}")]).unwrap();
            }
            tx.commit().unwrap();
        }
        let first = exchange(&mut mac, Exchange { cursor: None, changes: vec![] }).unwrap();
        assert!(first.more);
        sync(&mut mac, &mut phone);
        let n: i64 = phone.query_row("SELECT COUNT(*) FROM activities", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 5000);
    }
}
