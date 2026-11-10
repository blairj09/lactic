// The computer's side of a paired iPhone. Pairing shows a QR code holding a fresh 256-bit key,
// the computer's addresses on the local network and a port. The phone scans it and from then on
// talks to the computer directly over Wi-Fi: every request and answer is sealed with AES-256-GCM
// under that key, so nothing on the network can read or forge them, and nothing goes through a
// server. The key lives in the keychain (secrets.rs, as "phone:<device id>").
//
// What the phone asks for:
//   hello   finishes pairing (the key is only accepted for this while the QR code is showing)
//   sync    sends its changes and gets this computer's (sync.rs), answered here in Rust
//   health  Apple Health samples it read, imported by the web layer like the Shortcut's file
//
// The listener only runs while a phone is paired or the QR code is showing.

use crate::db::Db;
use crate::secrets::Secrets;
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
const PATH: &str = "/lactic/phone";
/// How long a QR code stays good.
const OFFER_MINUTES: u64 = 10;
/// Requests older (or further in the future) than this are refused, so a recorded one can't be replayed later.
const MAX_SKEW_MS: i64 = 10 * 60_000;

fn default_port() -> u16 {
    if crate::is_preview() { PREVIEW_PORT } else { DEFAULT_PORT }
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
struct Envelope {
    /// Milliseconds since 1970. A float: the iPhone sends fractions of a millisecond.
    t: f64,
    kind: String,
    #[serde(default)]
    body: Value,
}

async fn handle(AxState(app): AxState<AppHandle>, headers: HeaderMap, sealed: Bytes) -> impl IntoResponse {
    let phone = app.state::<Arc<Phone>>().inner().clone();
    let device = headers.get("x-lactic-device").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let offered = phone.offer.lock().await.as_ref().filter(|o| o.id == device && o.expires > now_ms()).map(|o| o.key);
    let key = match offered {
        Some(k) => Some(k),
        None => app.state::<Secrets>().get(&secret_name(&device)).and_then(|k| key_from(&k)),
    };
    let Some(key) = key else { return (StatusCode::UNAUTHORIZED, Vec::new()).into_response() };
    let Some(plain) = open(&key, &sealed) else { return (StatusCode::UNAUTHORIZED, Vec::new()).into_response() };
    let Ok(env) = serde_json::from_slice::<Envelope>(&plain) else { return (StatusCode::BAD_REQUEST, Vec::new()).into_response() };
    if (env.t - now_ms() as f64).abs() > MAX_SKEW_MS as f64 {
        return (StatusCode::UNAUTHORIZED, Vec::new()).into_response();
    }
    let answer = match answer(&app, &phone, &device, offered.is_some(), &key, env).await {
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
        app.state::<Secrets>().set(&secret_name(device), &b64url(key))?;
        *phone.offer.lock().await = None;
        let mut saved = phone.saved.lock().await;
        saved.devices.retain(|d| d.id != device);
        saved.devices.push(Device { id: device.to_string(), name: name.clone(), paired_at: now_ms(), last_seen: Some(now_ms()) });
        let copy = saved.clone();
        drop(saved);
        phone.write(&copy).await;
        let _ = app.emit("phone:paired", json!({ "id": device, "name": name }));
        return Ok(json!({ "computer": computer_name() }));
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

/// The direct link, AirDrop-style: the iPhone finds this Mac by Bonjour (`_lactic._tcp`) and connects
/// over peer-to-peer Wi-Fi (AWDL) when the two aren't on the same network, or over the network when
/// they are. Peer-to-peer Wi-Fi only carries IPv6 link-local traffic, and only to sockets that opt
/// in (SO_RECV_ANYIF), to Bonjour services registered with kDNSServiceFlagsIncludeP2P.
#[cfg(target_os = "macos")]
mod direct {
    use std::ffi::{c_char, c_int, c_void, CString};
    use std::net::{Ipv6Addr, SocketAddr};

    pub const SERVICE: &str = "_lactic._tcp";
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
            let regtype = CString::new(SERVICE).expect("no NUL");
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
        let reply = json!({ "ok": true, "body": { "computer": "Test Mac" } });
        std::fs::write(dir.join("reply.bin"), seal(&key, reply.to_string().as_bytes())).unwrap();
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
