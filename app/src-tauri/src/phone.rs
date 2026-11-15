// The computer's side of a paired iPhone. Pairing shows a QR code holding a fresh 256-bit key,
// the computer's addresses on the local network and a port. The phone scans it, the two agree
// on a key of their own (see "pairing" below), and from then on the phone talks to the computer
// directly over Wi-Fi: every request and answer is sealed with AES-256-GCM under that key, so
// nothing on the network can read or forge them, and nothing goes through a server. The key
// lives in the keychain (secrets.rs, as "phone:<device id>").
//
// What the phone asks for:
//   hello   finishes pairing (the key is only accepted for this while the QR code is showing)
//   sync    sends its changes and gets this computer's (sync.rs), answered here in Rust
//   keys    the rider's API keys (AI, intervals.icu), both ways, answered here in Rust
//   health  Apple Health samples it read, imported by the web layer like the Shortcut's file
//
// The listener only runs while a phone is paired or the QR code is showing.

use crate::db::Db;
use crate::secrets::{KeyState, KeyValue, Secrets};
use crate::sync;
use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use axum::{body::Bytes, extract::State as AxState, http::{HeaderMap, StatusCode}, response::IntoResponse, routing::post, Router};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{oneshot, Mutex};

pub const DEFAULT_PORT: u16 = 47620;
const PREVIEW_PORT: u16 = 47650;
const MODULAR_PORT: u16 = 47680;
const PATH: &str = "/lactic/phone";
/// How long a QR code stays good.
const OFFER_MINUTES: u64 = 10;
/// Requests older (or further in the future) than this are refused, so a recorded one can't be replayed later.
const MAX_SKEW_MS: i64 = 10 * 60_000;

fn default_port() -> u16 {
    if crate::is_modular() { MODULAR_PORT } else if crate::is_preview() { PREVIEW_PORT } else { DEFAULT_PORT }
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub name: String,
    pub paired_at: i64,
    #[serde(default)]
    pub last_seen: Option<i64>,
}

#[derive(Serialize, Deserialize, Default, Clone)]
struct Saved {
    #[serde(default)]
    port: u16,
    #[serde(default)]
    devices: Vec<Device>,
}

struct Offer {
    id: String,
    key: [u8; 32],
    expires: i64,
}

pub struct Phone {
    saved: Mutex<Saved>,
    offer: Mutex<Option<Offer>>,
    listening: AtomicBool,
    port: AtomicU64,
    waiting: Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>,
    next: AtomicU64,
    file: PathBuf,
}

impl Phone {
    pub fn new(data_dir: &PathBuf) -> Self {
        let file = data_dir.join("phones.json");
        let saved = std::fs::read_to_string(&file).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        Phone { saved: Mutex::new(saved), offer: Mutex::new(None), listening: AtomicBool::new(false), port: AtomicU64::new(0), waiting: Mutex::new(HashMap::new()), next: AtomicU64::new(1), file }
    }

    async fn write(&self, saved: &Saved) {
        let _ = std::fs::write(&self.file, serde_json::to_string_pretty(saved).unwrap_or_default());
    }
}

// --- sealing --------------------------------------------------------------------------------------

/// nonce (12 bytes) + ciphertext + tag (16 bytes): the layout CryptoKit's AES.GCM.SealedBox.combined uses.
pub fn seal(key: &[u8; 32], plain: &[u8]) -> Vec<u8> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let mut out = nonce.to_vec();
    out.extend(cipher.encrypt(&nonce, plain).expect("sealing never fails"));
    out
}

pub fn open(key: &[u8; 32], sealed: &[u8]) -> Option<Vec<u8>> {
    if sealed.len() < 28 {
        return None;
    }
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    cipher.decrypt(Nonce::from_slice(&sealed[..12]), &sealed[12..]).ok()
}

fn b64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn key_from(text: &str) -> Option<[u8; 32]> {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(text.trim_end_matches('=')).ok()?.try_into().ok()
}

// --- pairing: the QR code's key is used once ----------------------------------------------------------
// The code on screen holds a key that only proves the phone saw this screen. In its hello the
// phone sends a fresh public key; the computer answers with its own, and both work out the key
// they keep (X25519, then HKDF-SHA256 salted with the code's key). So a photo of the code, or
// the code read off a recording later, opens nothing that was sent afterwards.

/// How long the code keeps working after a phone paired with it, so the phone can ask again if
/// the answer got lost on the way.
const RETRY_MS: i64 = 60_000;

/// The key both sides keep, from the agreed secret, the code's key and the phone's id.
fn pairing_key(shared: &[u8; 32], code: &[u8; 32], device: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    hkdf::Hkdf::<sha2::Sha256>::new(Some(code), shared).expand(format!("lactic pairing v2 {device}").as_bytes(), &mut out).expect("32 bytes is a valid length");
    out
}

/// The computer's half: its public key to send back and the key to keep, or None when the
/// phone's public key is one that gives everyone the same secret.
fn agree(mine: x25519_dalek::StaticSecret, phone_pub: [u8; 32], code: &[u8; 32], device: &str) -> Option<([u8; 32], [u8; 32])> {
    let public = x25519_dalek::PublicKey::from(&mine);
    let shared = mine.diffie_hellman(&x25519_dalek::PublicKey::from(phone_pub));
    shared.was_contributory().then(|| (public.to_bytes(), pairing_key(shared.as_bytes(), code, device)))
}

fn secret_name(device: &str) -> String {
    format!("phone:{device}")
}

fn percent(s: &str) -> String {
    s.bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-._~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect()
}

// --- where this computer is -------------------------------------------------------------------------

/// What the phone shows as the computer's name.
fn computer_name() -> String {
    #[cfg(target_os = "macos")]
    if let Ok(out) = std::process::Command::new("scutil").args(["--get", "ComputerName"]).output() {
        let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !name.is_empty() {
            return name;
        }
    }
    std::env::var("COMPUTERNAME").ok().or_else(|| hostname()).unwrap_or_else(|| "your computer".into())
}

fn hostname() -> Option<String> {
    #[cfg(target_os = "macos")]
    if let Ok(out) = std::process::Command::new("scutil").args(["--get", "LocalHostName"]).output() {
        let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !name.is_empty() {
            return Some(name);
        }
    }
    let out = std::process::Command::new("hostname").output().ok()?;
    let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!name.is_empty()).then_some(name)
}

/// Ways to reach this computer: its .local name (which follows it when its address changes), then
/// its private IPv4 addresses.
fn hosts() -> Vec<String> {
    let mut out = vec![];
    if let Some(h) = hostname() {
        out.push(if h.ends_with(".local") { h } else { format!("{h}.local") });
    }
    for iface in if_addrs::get_if_addrs().unwrap_or_default() {
        if let std::net::IpAddr::V4(ip) = iface.ip() {
            if !ip.is_loopback() && !ip.is_link_local() && ip.is_private() {
                out.push(ip.to_string());
            }
        }
    }
    out.dedup();
    out
}

// --- starting from the phone's data -----------------------------------------------------------------

fn onboarded(app: &AppHandle) -> Result<bool, String> {
    let db = app.state::<Db>();
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let value: Option<String> = conn
        .query_row("SELECT value FROM app_settings WHERE key = 'onboarding.done'", [], |r| r.get(0))
        .ok();
    Ok(value.as_deref() == Some("true"))
}

#[derive(Deserialize)]
struct Chunk {
    /// This piece, counting from 0, of `n`.
    i: u32,
    n: u32,
    /// Standard base64.
    data: String,
}

/// A phone set up on its own, pairing with a computer that hasn't been set up: the phone sends its
/// whole database in pieces, and the computer starts from it (as restoring a backup does). Only
/// while this computer has nothing of its own, so it can never replace a rider's data.
fn adopt(app: &AppHandle, body: Value) -> Result<Value, String> {
    if onboarded(app)? {
        return Err("This computer already has Lactic set up; it keeps its own data.".into());
    }
    let chunk: Chunk = serde_json::from_value(body).map_err(|e| e.to_string())?;
    if chunk.n == 0 || chunk.i >= chunk.n {
        return Err("Bad piece".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(&chunk.data).map_err(|e| e.to_string())?;
    let db = app.state::<Db>();
    let incoming = db.path.with_file_name("lactic-from-phone.db");
    {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .append(chunk.i > 0)
            .truncate(chunk.i == 0)
            .open(&incoming)
            .map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
    }
    if chunk.i + 1 < chunk.n {
        return Ok(json!({ "done": false }));
    }
    let result = {
        let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
        crate::db::restore_into(&mut conn, &db.path, &incoming)
            .and_then(|_| crate::sync::prepare(&conn))
            .and_then(|_| crate::sync::new_epoch(&conn))
    };
    let _ = std::fs::remove_file(&incoming);
    result?;
    let _ = app.emit("phone:adopted", json!({}));
    Ok(json!({ "done": true }))
}

// --- the listener -------------------------------------------------------------------------------------

/// Starts listening if it isn't already. Keeps the port it had before so paired phones find it.
pub async fn listen(app: AppHandle) -> Result<u16, String> {
    let phone = app.state::<Arc<Phone>>().inner().clone();
    if phone.listening.load(Ordering::SeqCst) {
        return Ok(phone.port.load(Ordering::SeqCst) as u16);
    }
    let mut saved = phone.saved.lock().await.clone();
    let wanted = if saved.port == 0 { default_port() } else { saved.port };
    let mut found = None;
    for port in std::iter::once(wanted).chain(default_port()..default_port() + 20) {
        if let Ok(l) = tokio::net::TcpListener::bind(("0.0.0.0", port)).await {
            found = Some((port, l));
            break;
        }
    }
    let (port, listener) = found.ok_or("Couldn't open a port for the phone")?;
    if saved.port != port {
        saved.port = port;
        *phone.saved.lock().await = saved.clone();
        phone.write(&saved).await;
    }
    phone.port.store(port as u64, Ordering::SeqCst);
    phone.listening.store(true, Ordering::SeqCst);
    let router = Router::new().route(PATH, post(handle).get(here)).with_state(app.clone());
    // On a Mac, the iPhone can also come straight over peer-to-peer Wi-Fi, whatever network each is on.
    #[cfg(target_os = "macos")]
    if let Some(direct) = direct::listen(port) {
        let router = router.clone();
        tauri::async_runtime::spawn(async move {
            let _ = axum::serve(direct, router).await;
        });
    }
    // Away from each other, the iPhone leaves sync requests in Lactic's iCloud folder.
    #[cfg(target_os = "macos")]
    tauri::async_runtime::spawn(mailbox::watch(app.clone()));
    tauri::async_runtime::spawn(async move {
        let _ = axum::serve(listener, router).await;
        app.state::<Arc<Phone>>().listening.store(false, Ordering::SeqCst);
    });
    Ok(port)
}

/// Opened in a browser (Safari on the phone, say), so a rider can check the phone reaches this computer.
async fn here() -> &'static str {
    "Lactic is here. This iPhone can reach your computer: pair from the Lactic app."
}

/// At startup: listen when a phone is paired.
pub async fn start(app: AppHandle) {
    let paired = !app.state::<Arc<Phone>>().saved.lock().await.devices.is_empty();
    if paired {
        let _ = listen(app).await;
    }
}

#[derive(Deserialize)]
pub struct Envelope {
    /// Milliseconds since 1970. A float: the iPhone sends fractions of a millisecond.
    t: f64,
    kind: String,
    #[serde(default)]
    body: Value,
}

async fn handle(AxState(app): AxState<AppHandle>, headers: HeaderMap, sealed: Bytes) -> impl IntoResponse {
    let phone = app.state::<Arc<Phone>>().inner().clone();
    let device = headers.get("x-lactic-device").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    // The code on screen first (a phone pairing), then the key this phone was given.
    let offered = phone.offer.lock().await.as_ref().filter(|o| o.id == device && o.expires > now_ms()).map(|o| o.key);
    let with_code = offered.and_then(|k| open(&k, &sealed).map(|plain| (k, plain)));
    let pairing = with_code.is_some();
    let opened = match with_code {
        Some(found) => Some(found),
        None => app.state::<Secrets>().get(&secret_name(&device)).and_then(|k| key_from(&k)).and_then(|k| open(&k, &sealed).map(|plain| (k, plain))),
    };
    let Some((key, plain)) = opened else { return (StatusCode::UNAUTHORIZED, Vec::new()).into_response() };
    if offered.is_some() && !pairing {
        // The phone is using the key it was given, so the code has done its job.
        phone.offer.lock().await.take_if(|o| o.id == device);
    }
    let Ok(env) = serde_json::from_slice::<Envelope>(&plain) else { return (StatusCode::BAD_REQUEST, Vec::new()).into_response() };
    if (env.t - now_ms() as f64).abs() > MAX_SKEW_MS as f64 {
        return (StatusCode::UNAUTHORIZED, Vec::new()).into_response();
    }
    let answer = match answer(&app, &phone, &device, pairing, &key, env).await {
        Ok(v) => json!({ "ok": true, "body": v }),
        Err(e) => json!({ "ok": false, "error": e }),
    };
    let bytes = seal(&key, answer.to_string().as_bytes());
    (StatusCode::OK, [("content-type", "application/octet-stream")], bytes).into_response()
}

async fn answer(app: &AppHandle, phone: &Phone, device: &str, pairing: bool, key: &[u8; 32], env: Envelope) -> Result<Value, String> {
    if env.kind == "hello" {
        if !pairing {
            // Already paired: just say who we are.
            return Ok(json!({ "computer": computer_name() }));
        }
        let name = env.body.get("name").and_then(|v| v.as_str()).unwrap_or("iPhone").chars().take(80).collect::<String>();
        // A phone that sends a public key gets a key of its own; an older Lactic on the phone
        // sends none and keeps the code's key, as before.
        let agreed = match env.body.get("pub").and_then(|v| v.as_str()) {
            Some(text) => {
                let mine = x25519_dalek::StaticSecret::random_from_rng(OsRng);
                Some(key_from(text).and_then(|theirs| agree(mine, theirs, key, device)).ok_or("That code didn't work. Show a new one and scan again.")?)
            }
            None => None,
        };
        app.state::<Secrets>().set(&secret_name(device), &b64url(agreed.as_ref().map_or(key, |(_, kept)| kept)))?;
        {
            let mut offer = phone.offer.lock().await;
            match (&agreed, offer.as_mut()) {
                (Some(_), Some(o)) if o.id == device => o.expires = o.expires.min(now_ms() + RETRY_MS),
                _ => *offer = None,
            }
        }
        let mut saved = phone.saved.lock().await;
        saved.devices.retain(|d| d.id != device);
        saved.devices.push(Device { id: device.to_string(), name: name.clone(), paired_at: now_ms(), last_seen: Some(now_ms()) });
        let copy = saved.clone();
        drop(saved);
        phone.write(&copy).await;
        let _ = app.emit("phone:paired", json!({ "id": device, "name": name }));
        return Ok(match agreed {
            Some((public, _)) => json!({ "computer": computer_name(), "pub": b64url(&public) }),
            None => json!({ "computer": computer_name() }),
        });
    }
    if pairing {
        return Err("Finish pairing first".into());
    }
    {
        // The ride remote asks every second; note the time at most once a minute.
        let mut saved = phone.saved.lock().await;
        let now = now_ms();
        let stale = match saved.devices.iter_mut().find(|d| d.id == device) {
            Some(d) if d.last_seen.map_or(true, |t| now - t >= 60_000) => {
                d.last_seen = Some(now);
                true
            }
            _ => false,
        };
        if stale {
            let copy = saved.clone();
            drop(saved);
            phone.write(&copy).await;
        }
    }
    match env.kind.as_str() {
        // Whether this computer is new to Lactic: a phone already in use then brings its data here.
        "status" => Ok(json!({ "fresh": !onboarded(&app)?, "computer": computer_name() })),
        "adopt" => adopt(&app, env.body),
        "sync" => {
            let req: sync::Exchange = serde_json::from_value(env.body).map_err(|e| e.to_string())?;
            let db = app.state::<Db>();
            let reply = {
                let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
                sync::exchange(&mut conn, req)?
            };
            if reply.applied > 0 {
                let _ = app.emit("phone:changed", json!({ "applied": reply.applied }));
            }
            serde_json::to_value(reply).map_err(|e| e.to_string())
        }
        // The rider's API keys, both ways (secrets.rs `plan`). Answered here so the computer's web
        // layer never sees a key. Only over the live link: the iCloud mailbox answers "sync" alone,
        // and that must stay so, keys never sit in a file even sealed.
        "keys" => {
            #[derive(Deserialize)]
            struct Keys {
                #[serde(default)]
                have: HashMap<String, KeyState>,
                #[serde(default)]
                give: HashMap<String, KeyValue>,
            }
            let req: Keys = serde_json::from_value(env.body).map_err(|e| e.to_string())?;
            let secrets = app.state::<Secrets>();
            let took = secrets.receive(&req.give, false)?;
            secrets.stamp_unstamped()?;
            let mine = secrets.states().ok_or("The keychain on the computer is locked")?;
            // What the phone has after this exchange: what it said, plus what it just gave.
            let mut theirs = req.have;
            for (name, kv) in &req.give {
                theirs.insert(name.clone(), KeyState { at: kv.at, set: kv.value.as_deref().is_some_and(|v| !v.is_empty()) });
            }
            let (give, want) = crate::secrets::plan(&mine, &theirs);
            let take = secrets.values(&give).ok_or("The keychain on the computer is locked")?;
            if took > 0 {
                let _ = app.emit("secrets:changed", json!({ "count": took }));
            }
            Ok(json!({ "take": take, "want": want }))
        }
        // Handled by the web layer (src/phone/computer.ts), which owns the Health import.
        kind => {
            let n = phone.next.fetch_add(1, Ordering::Relaxed);
            let (tx, rx) = oneshot::channel();
            phone.waiting.lock().await.insert(n, tx);
            let _ = app.emit_to("main", "phone:request", json!({ "requestId": n, "kind": kind, "body": env.body }));
            match tokio::time::timeout(Duration::from_secs(90), rx).await {
                Ok(Ok(r)) => r,
                _ => {
                    phone.waiting.lock().await.remove(&n);
                    Err("Lactic on the computer didn't answer in time".into())
                }
            }
        }
    }
}

// --- commands for Settings ----------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    devices: Vec<Device>,
    listening: bool,
    port: Option<u16>,
    computer: String,
}

#[tauri::command]
pub async fn phone_status(phone: State<'_, Arc<Phone>>) -> Result<Status, String> {
    let saved = phone.saved.lock().await.clone();
    let listening = phone.listening.load(Ordering::SeqCst);
    Ok(Status { devices: saved.devices, listening, port: listening.then(|| phone.port.load(Ordering::SeqCst) as u16), computer: computer_name() })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfferInfo {
    /// What the QR code holds. The fragment never leaves the phone, even if the Camera app opens it.
    url: String,
    expires_at: i64,
    hosts: Vec<String>,
    port: u16,
}

/// A new QR code (replacing any earlier one), good for ten minutes.
#[tauri::command]
pub async fn phone_pair_start(app: AppHandle) -> Result<OfferInfo, String> {
    let port = listen(app.clone()).await?;
    use rand::RngCore;
    let mut key = [0u8; 32];
    OsRng.fill_bytes(&mut key);
    let mut idb = [0u8; 12];
    OsRng.fill_bytes(&mut idb);
    let id = b64url(&idb);
    let expires = now_ms() + (OFFER_MINUTES * 60_000) as i64;
    let hosts = hosts();
    let url = format!(
        "https://lactic.fit/pair#v=1&d={id}&k={}&p={port}&h={}&n={}",
        b64url(&key),
        hosts.iter().map(|h| percent(h)).collect::<Vec<_>>().join(","),
        percent(&computer_name())
    );
    *app.state::<Arc<Phone>>().offer.lock().await = Some(Offer { id, key, expires });
    Ok(OfferInfo { url, expires_at: expires, hosts, port })
}

#[tauri::command]
pub async fn phone_pair_cancel(phone: State<'_, Arc<Phone>>) -> Result<(), String> {
    *phone.offer.lock().await = None;
    Ok(())
}

/// Unpairs a phone: its key is deleted, so it can't reach this computer again.
#[tauri::command]
pub async fn phone_forget(phone: State<'_, Arc<Phone>>, secrets: State<'_, Secrets>, id: String) -> Result<(), String> {
    secrets.delete(&secret_name(&id))?;
    let mut saved = phone.saved.lock().await;
    saved.devices.retain(|d| d.id != id);
    let copy = saved.clone();
    drop(saved);
    phone.write(&copy).await;
    Ok(())
}

#[tauri::command]
pub async fn phone_respond(phone: State<'_, Arc<Phone>>, request_id: u64, result: Option<Value>, error: Option<String>) -> Result<(), String> {
    if let Some(tx) = phone.waiting.lock().await.remove(&request_id) {
        let _ = tx.send(match error {
            Some(e) => Err(e),
            None => Ok(result.unwrap_or(Value::Null)),
        });
    }
    Ok(())
}

/// The iCloud fallback, for when the iPhone and the Mac can't reach each other (away from home,
/// say). The iPhone writes a sealed sync request into Lactic's iCloud container, at
/// `Documents/Link/<device>/to-computer/<name>.bin`; iCloud brings it to this Mac, which answers
/// into `to-phone/<name>.bin`. Only `sync` goes this way: it's safe to run late or twice. iCloud
/// only moves the sealed bytes, which only the two devices can open.
pub mod mailbox {
    use super::*;
    use std::path::{Path, PathBuf};

    /// Requests older than this are dropped unanswered: a newer one has replaced it by then.
    pub const MAX_AGE_MS: i64 = 3 * 24 * 3600 * 1000;

    /// Lactic's iCloud container as this Mac's iCloud Drive keeps it: the iPhone app's
    /// (iCloud.fit.lactic.app, which Lactic Preview shares), or Lactic Modular's own.
    pub fn root() -> Option<PathBuf> {
        let home = std::env::var_os("HOME")?;
        let container = if crate::is_modular() { "iCloud~fit~lactic~modular" } else { "iCloud~fit~lactic~app" };
        Some(PathBuf::from(home).join("Library/Mobile Documents").join(container).join("Documents/Link"))
    }

    /// Answers every request waiting in `dir/to-computer` with `respond`, writing each answer to
    /// `dir/to-phone` under the same name. Returns how many it answered.
    pub async fn process<F, Fut>(dir: &Path, key: &[u8; 32], mut respond: F) -> usize
    where
        F: FnMut(Envelope) -> Fut,
        Fut: std::future::Future<Output = Result<Value, String>>,
    {
        let inbox = dir.join("to-computer");
        let outbox = dir.join("to-phone");
        let Ok(entries) = std::fs::read_dir(&inbox) else { return 0 };
        let mut names: Vec<String> = entries.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        let mut answered = 0;
        for name in names {
            // Not downloaded yet (older iCloud Drive shows ".name.bin.icloud"): ask for it, next pass.
            if name.starts_with('.') && name.ends_with(".icloud") {
                #[cfg(target_os = "macos")]
                {
                    let _ = std::process::Command::new("brctl").arg("download").arg(inbox.join(&name)).output();
                }
                continue;
            }
            if !name.ends_with(".bin") {
                continue;
            }
            let path = inbox.join(&name);
            let Ok(sealed) = std::fs::read(&path) else { continue };
            let env = open(key, &sealed).and_then(|plain| serde_json::from_slice::<Envelope>(&plain).ok());
            let reply = match env {
                Some(env) if env.kind == "sync" && (now_ms() as f64 - env.t) < MAX_AGE_MS as f64 => Some(match respond(env).await {
                    Ok(v) => json!({ "ok": true, "body": v }),
                    Err(e) => json!({ "ok": false, "error": e }),
                }),
                // Damaged, too old or not something to answer late: drop it.
                _ => None,
            };
            if let Some(reply) = reply {
                if std::fs::create_dir_all(&outbox).is_err() {
                    continue;
                }
                let tmp = outbox.join(format!("{name}.part"));
                if std::fs::write(&tmp, seal(key, reply.to_string().as_bytes())).is_err() || std::fs::rename(&tmp, outbox.join(&name)).is_err() {
                    continue;
                }
                answered += 1;
            }
            let _ = std::fs::remove_file(&path);
        }
        // Answers the iPhone never collected (it gave up waiting and asked again).
        if let Ok(entries) = std::fs::read_dir(&outbox) {
            for e in entries.filter_map(|e| e.ok()) {
                let old = e.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|age| age.as_millis() as i64 > MAX_AGE_MS);
                if old {
                    let _ = std::fs::remove_file(e.path());
                }
            }
        }
        answered
    }

    /// Looks for requests from each paired iPhone every 15 seconds while Lactic runs.
    #[cfg(target_os = "macos")]
    pub async fn watch(app: AppHandle) {
        let phone = app.state::<Arc<Phone>>().inner().clone();
        loop {
            if let Some(root) = root().filter(|r| r.is_dir()) {
                let devices: Vec<String> = phone.saved.lock().await.devices.iter().map(|d| d.id.clone()).collect();
                for device in devices {
                    let Some(key) = app.state::<Secrets>().get(&secret_name(&device)).and_then(|k| key_from(&k)) else { continue };
                    let dir = root.join(&device);
                    let n = process(&dir, &key, |env| {
                        let (app, phone, device) = (app.clone(), phone.clone(), device.clone());
                        async move { answer(&app, &phone, &device, false, &key, env).await }
                    })
                    .await;
                    if n > 0 {
                        eprintln!("phone: answered {n} request(s) through iCloud");
                    }
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(15)).await;
        }
    }
}

/// The direct link, AirDrop-style: the iPhone finds this Mac by Bonjour (`_lactic._tcp`) and connects
/// over peer-to-peer Wi-Fi (AWDL) when the two aren't on the same network, or over the network when
/// they are. Peer-to-peer Wi-Fi only carries IPv6 link-local traffic, and only to sockets that opt
/// in (SO_RECV_ANYIF), to Bonjour services registered with kDNSServiceFlagsIncludeP2P.
#[cfg(target_os = "macos")]
mod direct {
    use std::ffi::{c_char, c_int, c_void, CString};
    use std::net::{Ipv6Addr, SocketAddr};

    pub const SERVICE: &str = "_lactic._tcp";
    /// Lactic Modular's own, so the iPhone app of one never finds the other's computer.
    pub const MODULAR_SERVICE: &str = "_lactic-modular._tcp";

    pub fn service() -> &'static str {
        if crate::is_modular() { MODULAR_SERVICE } else { SERVICE }
    }
    const SO_RECV_ANYIF: c_int = 0x1104;
    const K_DNS_SERVICE_FLAGS_INCLUDE_P2P: u32 = 0x20000;

    #[allow(non_camel_case_types)]
    type DNSServiceRef = *mut c_void;
    type RegisterReply = extern "C" fn(DNSServiceRef, u32, i32, *const c_char, *const c_char, *const c_char, *mut c_void);

    extern "C" {
        fn DNSServiceRegister(
            sd_ref: *mut DNSServiceRef,
            flags: u32,
            interface_index: u32,
            name: *const c_char,
            regtype: *const c_char,
            domain: *const c_char,
            host: *const c_char,
            port: u16,
            txt_len: u16,
            txt_record: *const c_void,
            callback: Option<RegisterReply>,
            context: *mut c_void,
        ) -> i32;
        fn DNSServiceProcessResult(sd_ref: DNSServiceRef) -> i32;
    }

    extern "C" fn registered(_: DNSServiceRef, _: u32, _: i32, _: *const c_char, _: *const c_char, _: *const c_char, _: *mut c_void) {}

    /// An IPv6 socket on `port` that also takes peer-to-peer Wi-Fi, advertised over Bonjour. None
    /// if either step fails: the plain network listener still works.
    pub fn listen(port: u16) -> Option<tokio::net::TcpListener> {
        let socket = socket2::Socket::new(socket2::Domain::IPV6, socket2::Type::STREAM, Some(socket2::Protocol::TCP)).ok()?;
        socket.set_only_v6(true).ok()?;
        socket.set_reuse_address(true).ok()?;
        let on: c_int = 1;
        // SAFETY: a valid socket and a c_int option value of the right size.
        let set = unsafe {
            libc::setsockopt(
                std::os::fd::AsRawFd::as_raw_fd(&socket),
                libc::SOL_SOCKET,
                SO_RECV_ANYIF,
                &on as *const c_int as *const c_void,
                std::mem::size_of::<c_int>() as libc::socklen_t,
            )
        };
        if set != 0 {
            return None;
        }
        socket.bind(&SocketAddr::from((Ipv6Addr::UNSPECIFIED, port)).into()).ok()?;
        socket.listen(16).ok()?;
        socket.set_nonblocking(true).ok()?;
        let listener = tokio::net::TcpListener::from_std(socket.into()).ok()?;
        advertise(port);
        Some(listener)
    }

    /// Registers the Bonjour service for as long as Lactic runs (the registration lives with the
    /// connection to mDNSResponder, kept open on its own thread).
    fn advertise(port: u16) {
        std::thread::spawn(move || {
            let regtype = CString::new(service()).expect("no NUL");
            let mut sd: DNSServiceRef = std::ptr::null_mut();
            // SAFETY: valid out-pointer and C strings; a null name means the computer's name.
            let err = unsafe {
                DNSServiceRegister(
                    &mut sd,
                    K_DNS_SERVICE_FLAGS_INCLUDE_P2P,
                    0,
                    std::ptr::null(),
                    regtype.as_ptr(),
                    std::ptr::null(),
                    std::ptr::null(),
                    port.to_be(),
                    0,
                    std::ptr::null(),
                    Some(registered),
                    std::ptr::null_mut(),
                )
            };
            if err != 0 || sd.is_null() {
                eprintln!("phone: Bonjour registration failed ({err})");
                return;
            }
            // SAFETY: sd is a live registration; this blocks until mDNSResponder goes away.
            while unsafe { DNSServiceProcessResult(sd) } == 0 {}
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The iPhone's real Swift code against this side, in both directions. CI (ios.yml) builds
    /// plugins/lactic-phone/ios/WireCheck, has it seal a hello into $LACTIC_SWIFT_WIRE, runs this,
    /// then has it open the reply. Skipped where Swift isn't (no variable set).
    #[test]
    fn swift_wire() {
        let Ok(dir) = std::env::var("LACTIC_SWIFT_WIRE") else { return };
        let dir = std::path::Path::new(&dir);
        let key = [7u8; 32];
        let sealed = std::fs::read(dir.join("request.bin")).expect("run wire-check request first");
        let plain = open(&key, &sealed).expect("the iPhone's request opens with the shared key");
        let env: Envelope = serde_json::from_slice(&plain).unwrap_or_else(|e| panic!("the iPhone's envelope doesn't parse ({e}): {}", String::from_utf8_lossy(&plain)));
        assert_eq!(env.kind, "hello");
        assert_eq!(env.body.get("name").and_then(|v| v.as_str()), Some("Test iPhone"));
        assert!((env.t - now_ms() as f64).abs() < MAX_SKEW_MS as f64, "the iPhone's clock field is off: {}", env.t);
        // The key exchange, as answer() does it: the reply carries this side's public key, and
        // paired.bin is sealed with the key both should now hold.
        let theirs = key_from(env.body.get("pub").and_then(|v| v.as_str()).expect("the iPhone's hello carries its public key")).expect("32 bytes");
        let (public, kept) = agree(x25519_dalek::StaticSecret::random_from_rng(OsRng), theirs, &key, "test").expect("a real public key");
        let reply = json!({ "ok": true, "body": { "computer": "Test Mac", "pub": b64url(&public) } });
        std::fs::write(dir.join("reply.bin"), seal(&key, reply.to_string().as_bytes())).unwrap();
        std::fs::write(dir.join("paired.bin"), seal(&kept, json!({ "ok": true, "body": { "computer": "Test Mac" } }).to_string().as_bytes())).unwrap();
    }

    #[test]
    fn pairing_gives_both_sides_a_key_the_code_alone_cant_work_out() {
        let code = [7u8; 32];
        let phone = x25519_dalek::StaticSecret::random_from_rng(OsRng);
        let phone_pub = x25519_dalek::PublicKey::from(&phone).to_bytes();
        let (computer_pub, kept) = agree(x25519_dalek::StaticSecret::random_from_rng(OsRng), phone_pub, &code, "abc").unwrap();
        // The phone's half.
        let shared = phone.diffie_hellman(&x25519_dalek::PublicKey::from(computer_pub));
        assert_eq!(pairing_key(shared.as_bytes(), &code, "abc"), kept);
        assert_ne!(kept, code);
        // Another code, another phone id or another pairing each give a different key.
        assert_ne!(pairing_key(shared.as_bytes(), &[8u8; 32], "abc"), kept);
        assert_ne!(pairing_key(shared.as_bytes(), &code, "abd"), kept);
        assert_ne!(agree(x25519_dalek::StaticSecret::random_from_rng(OsRng), phone_pub, &code, "abc").unwrap().1, kept);
        // A public key that would give every listener the same secret is refused.
        assert!(agree(x25519_dalek::StaticSecret::random_from_rng(OsRng), [0u8; 32], &code, "abc").is_none());
        // A fixed case, so this side and the phone's Swift can't drift apart together.
        let fixed = pairing_key(&[1u8; 32], &[2u8; 32], "test");
        assert_eq!(b64url(&fixed), "J8pHG4sZGDAV5zM_3G8-zR4VMraP8_CnZwlozAkmT8o");
    }

    /// The direct link end to end on a Mac: this side's peer-to-peer listener and Bonjour
    /// registration, the iPhone's Swift finding it and posting over it (CI, ios.yml).
    #[cfg(target_os = "macos")]
    #[test]
    fn swift_direct() {
        let Ok(dir) = std::env::var("LACTIC_SWIFT_WIRE") else { return };
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let listener = direct::listen(47699).expect("the direct listener opens and registers");
            let router = Router::new().route(
                PATH,
                post(|sealed: Bytes| async move {
                    let key = [7u8; 32];
                    let plain = open(&key, &sealed).expect("opens");
                    let env: Envelope = serde_json::from_slice(&plain).expect("parses");
                    assert_eq!(env.kind, "hello");
                    seal(&key, json!({ "ok": true, "body": { "computer": "Test Mac" } }).to_string().as_bytes())
                }),
            );
            tokio::spawn(async move {
                let _ = axum::serve(listener, router).await;
            });
            let check = std::path::Path::new(&dir).join("wire-check");
            let out = tokio::task::spawn_blocking(move || std::process::Command::new(check).arg("direct").arg(&dir).output()).await.unwrap().unwrap();
            println!("{}", String::from_utf8_lossy(&out.stdout));
            assert!(out.status.success(), "the iPhone's direct link failed");
        });
    }

    #[test]
    fn icloud_requests_get_answers_and_the_rest_are_dropped() {
        let dir = std::env::temp_dir().join(format!("lactic-mailbox-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("to-computer")).unwrap();
        let key = [7u8; 32];
        let now = now_ms();
        let put = |name: &str, kind: &str, t: i64| {
            let env = json!({ "t": t, "kind": kind, "body": { "n": name } }).to_string();
            std::fs::write(dir.join("to-computer").join(name), seal(&key, env.as_bytes())).unwrap();
        };
        put("1-sync.bin", "sync", now);
        put("2-ride.bin", "ride", now); // not answered late
        put("3-old.bin", "sync", now - mailbox::MAX_AGE_MS - 1);
        std::fs::write(dir.join("to-computer/4-junk.bin"), b"not sealed").unwrap();
        std::fs::write(dir.join("to-computer/5-other.bin"), seal(&[8u8; 32], b"{}")).unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let answered = rt.block_on(mailbox::process(&dir, &key, |env| async move { Ok(json!({ "echo": env.body })) }));
        assert_eq!(answered, 1);
        assert_eq!(std::fs::read_dir(dir.join("to-computer")).unwrap().count(), 0, "every request is handled once");
        let reply: Value = serde_json::from_slice(&open(&key, &std::fs::read(dir.join("to-phone/1-sync.bin")).unwrap()).unwrap()).unwrap();
        assert_eq!(reply, json!({ "ok": true, "body": { "echo": { "n": "1-sync.bin" } } }));
        assert_eq!(std::fs::read_dir(dir.join("to-phone")).unwrap().count(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_iphone_envelope_parses_with_a_fractional_time() {
        // Swift's Date gives fractions of a millisecond; this once answered 400 and blocked pairing.
        let env: Envelope = serde_json::from_str(r#"{"t":1762758840123.456,"kind":"hello","body":{"name":"iPhone"}}"#).unwrap();
        assert_eq!(env.kind, "hello");
        let env: Envelope = serde_json::from_str(r#"{"t":1762758840123,"kind":"sync"}"#).unwrap();
        assert!(env.body.is_null());
    }

    #[test]
    fn sealed_messages_open_only_with_their_key() {
        let key = [7u8; 32];
        let sealed = seal(&key, b"{\"kind\":\"sync\"}");
        assert_eq!(open(&key, &sealed).unwrap(), b"{\"kind\":\"sync\"}");
        assert!(open(&[8u8; 32], &sealed).is_none());
        let mut tampered = sealed.clone();
        tampered[20] ^= 1;
        assert!(open(&key, &tampered).is_none());
        assert!(open(&key, &sealed[..10]).is_none());
    }

    #[test]
    fn keys_survive_the_qr_code() {
        let key = [42u8; 32];
        assert_eq!(key_from(&b64url(&key)), Some(key));
        assert_eq!(percent("James's Mac"), "James%27s%20Mac");
    }
}
