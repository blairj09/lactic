// The built-in MCP server, so an AI app the rider already uses (Claude Desktop, ChatGPT, Cursor,
// anything that speaks MCP) can be their coach. It listens on 127.0.0.1 only and needs the token
// in mcp.json. The tools themselves are the coach tools in the web layer (src/coach/tools.ts):
// Rust answers the MCP handshake and hands tools/list and tools/call to the main window, which
// runs them against the engine and answers through mcp_respond.
//
// AI apps that launch servers as a command (Claude Desktop) run `lactic --mcp`, a stdio bridge
// that forwards each JSON-RPC line to the running app, opening the app first if it's closed.

use axum::{extract::State as AxState, http::{HeaderMap, StatusCode}, response::IntoResponse, routing::post, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{oneshot, Mutex};

pub const DEFAULT_PORT: u16 = 47615;
/// Lactic Preview starts further up, so it can run beside Lactic without taking its port.
const PREVIEW_PORT: u16 = 47645;
/// Lactic Modular, further up again, so all three can run at once.
const MODULAR_PORT: u16 = 47675;

fn default_port() -> u16 {
    if crate::is_modular() { MODULAR_PORT } else if crate::is_preview() { PREVIEW_PORT } else { DEFAULT_PORT }
}
const PROTOCOL: &str = "2025-06-18";

#[derive(Serialize, Deserialize, Clone)]
pub struct McpInfo {
    pub port: u16,
    pub token: String,
}

pub struct Mcp {
    pub info: Mutex<Option<McpInfo>>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<Value, Value>>>>,
    next: AtomicU64,
    enabled: AtomicBool,
    /// The main window has said whether the external coach is on (it does as it starts).
    known: AtomicBool,
    app: Mutex<Option<AppHandle>>,
    /// The AI app that last connected (its clientInfo), so Lactic can say who the coach is.
    client: Mutex<Option<String>>,
}

impl Default for Mcp {
    fn default() -> Self {
        Mcp { info: Mutex::new(None), pending: Mutex::new(HashMap::new()), next: AtomicU64::new(1), enabled: AtomicBool::new(false), known: AtomicBool::new(false), app: Mutex::new(None), client: Mutex::new(None) }
    }
}

pub fn info_path(data_dir: &PathBuf) -> PathBuf {
    data_dir.join("mcp.json")
}

fn load_or_create(data_dir: &PathBuf) -> McpInfo {
    if let Some(info) = std::fs::read_to_string(info_path(data_dir)).ok().and_then(|s| serde_json::from_str::<McpInfo>(&s).ok()) {
        return info;
    }
    use rand::Rng;
    let token: String = rand::thread_rng().sample_iter(&rand::distributions::Alphanumeric).take(40).map(char::from).collect();
    McpInfo { port: default_port(), token }
}

fn save(data_dir: &PathBuf, info: &McpInfo) {
    let _ = std::fs::create_dir_all(data_dir);
    let path = info_path(data_dir);
    let _ = std::fs::write(&path, serde_json::to_string_pretty(info).unwrap_or_default());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
}

/// Starts the server on the saved port, or the next free one, and records where it is.
pub async fn start(app: AppHandle, mcp: Arc<Mcp>, data_dir: PathBuf) {
    *mcp.app.lock().await = Some(app);
    let mut info = load_or_create(&data_dir);
    let mut listener = None;
    for port in std::iter::once(info.port).chain(default_port()..default_port() + 20) {
        if let Ok(l) = tokio::net::TcpListener::bind(("127.0.0.1", port)).await {
            info.port = port;
            listener = Some(l);
            break;
        }
    }
    let Some(listener) = listener else { return };
    save(&data_dir, &info);
    *mcp.info.lock().await = Some(info);
    let router = Router::new().route("/mcp", post(handle).get(|| async { StatusCode::METHOD_NOT_ALLOWED })).with_state(mcp);
    let _ = axum::serve(listener, router).await;
}

fn rpc_result(id: &Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn rpc_error(id: &Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

async fn handle(AxState(mcp): AxState<Arc<Mcp>>, headers: HeaderMap, Json(body): Json<Value>) -> impl IntoResponse {
    let token = mcp.info.lock().await.as_ref().map(|i| i.token.clone()).unwrap_or_default();
    let auth = headers.get("authorization").and_then(|v| v.to_str().ok()).unwrap_or("");
    if auth != format!("Bearer {token}") {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Missing or wrong token. Copy the setup from Lactic → Settings → Coach." }))).into_response();
    }
    let messages = match &body {
        Value::Array(list) => list.clone(),
        one => vec![one.clone()],
    };
    let mut out = vec![];
    for m in messages {
        if let Some(r) = answer(&mcp, m).await {
            out.push(r);
        }
    }
    if out.is_empty() {
        return StatusCode::ACCEPTED.into_response();
    }
    if body.is_array() {
        Json(Value::Array(out)).into_response()
    } else {
        Json(out.remove(0)).into_response()
    }
}

async fn answer(mcp: &Mcp, m: Value) -> Option<Value> {
    let id = m.get("id").cloned()?; // Notifications get no answer.
    let method = m.get("method").and_then(|v| v.as_str()).unwrap_or("");
    let params = m.get("params").cloned().unwrap_or(Value::Null);
    Some(match method {
        "initialize" => {
            let info = params.get("clientInfo");
            let name = info.and_then(|i| i.get("title").or_else(|| i.get("name"))).and_then(|v| v.as_str()).map(str::to_string);
            if name.is_some() {
                *mcp.client.lock().await = name;
            }
            let asked = params.get("protocolVersion").and_then(|v| v.as_str()).unwrap_or(PROTOCOL).to_string();
            rpc_result(
                &id,
                json!({
                    "protocolVersion": asked,
                    "capabilities": { "tools": { "listChanged": false } },
                    "serverInfo": { "name": "lactic", "title": "Lactic", "version": env!("CARGO_PKG_VERSION") },
                    "instructions": "You are the rider's cycling coach, working through Lactic. Lactic's engine owns every number (fitness, fatigue, form, FTP, zones, the plan): read them with the tools and never compute your own. To change the plan, use the propose_* tools; the rider sees each proposal in Lactic and applies it there."
                }),
            )
        }
        "ping" => rpc_result(&id, json!({})),
        "tools/list" | "tools/call" | "resources/list" | "prompts/list" => {
            if matches!(method, "resources/list") {
                return Some(rpc_result(&id, json!({ "resources": [] })));
            }
            if matches!(method, "prompts/list") {
                return Some(rpc_result(&id, json!({ "prompts": [] })));
            }
            if !coach_on(mcp).await {
                return Some(rpc_result(&id, turned_off(method)));
            }
            match forward(mcp, method, params).await {
                Ok(v) => rpc_result(&id, v),
                Err(e) => json!({ "jsonrpc": "2.0", "id": id, "error": e }),
            }
        }
        _ => rpc_error(&id, -32601, "Method not found"),
    })
}

const OFF_TOOL: &str = "lactic_status";
const OFF_TEXT: &str = "Lactic's coach tools are turned off, so there's no training data to read here. To use them, open Lactic, go to Settings → Coach and choose \"An AI app you already use\", or let AI apps connect alongside the built-in coach. To stop seeing Lactic here, remove it from this app's connectors.";

/// Whether the external coach is on. Right after Lactic opens (an AI app can open it), the main
/// window hasn't said yet, so wait a little for it rather than answer "off" by mistake.
async fn coach_on(mcp: &Mcp) -> bool {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
    while !mcp.known.load(Ordering::Relaxed) && tokio::time::Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    mcp.enabled.load(Ordering::Relaxed)
}

/// With the external coach off, Lactic still answers like a healthy server, so AI apps that keep
/// Lactic in their list (Claude Desktop) don't show an error: one tool that says how to turn the
/// coach on. AI apps list tools again from time to time, so turning it on needs no restart.
fn turned_off(method: &str) -> Value {
    if method == "tools/list" {
        json!({ "tools": [{
            "name": OFF_TOOL,
            "title": "Lactic status",
            "description": "Lactic's coach tools are turned off. Call this to tell the rider how to turn them on.",
            "inputSchema": { "type": "object", "properties": {} },
            "annotations": { "readOnlyHint": true }
        }] })
    } else {
        json!({ "content": [{ "type": "text", "text": OFF_TEXT }] })
    }
}

async fn forward(mcp: &Mcp, method: &str, params: Value) -> Result<Value, Value> {
    let app = mcp.app.lock().await.clone().ok_or_else(|| json!({ "code": -32002, "message": "Lactic is starting" }))?;
    let n = mcp.next.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = oneshot::channel();
    mcp.pending.lock().await.insert(n, tx);
    let client = mcp.client.lock().await.clone();
    let _ = app.emit_to("main", "mcp:request", json!({ "requestId": n, "method": method, "params": params, "client": client }));
    match tokio::time::timeout(Duration::from_secs(90), rx).await {
        Ok(Ok(r)) => r,
        _ => {
            mcp.pending.lock().await.remove(&n);
            Err(json!({ "code": -32003, "message": "Lactic didn't answer in time. Is its window open?" }))
        }
    }
}

#[tauri::command]
pub async fn mcp_respond(mcp: State<'_, Arc<Mcp>>, request_id: u64, result: Option<Value>, error: Option<Value>) -> Result<(), String> {
    if let Some(tx) = mcp.pending.lock().await.remove(&request_id) {
        let _ = tx.send(match error {
            Some(e) => Err(e),
            None => Ok(result.unwrap_or(Value::Null)),
        });
    }
    Ok(())
}

#[tauri::command]
pub fn mcp_set_enabled(mcp: State<'_, Arc<Mcp>>, enabled: bool) {
    mcp.enabled.store(enabled, Ordering::Relaxed);
    mcp.known.store(true, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn off() -> Mcp {
        let mcp = Mcp::default();
        mcp.known.store(true, Ordering::Relaxed);
        mcp
    }

    #[tokio::test]
    async fn coach_off_lists_a_status_tool_not_an_error() {
        let r = answer(&off(), json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" })).await.unwrap();
        assert!(r.get("error").is_none());
        assert_eq!(r["result"]["tools"][0]["name"], OFF_TOOL);
    }

    #[tokio::test]
    async fn coach_off_tool_call_says_how_to_turn_it_on() {
        let r = answer(&off(), json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": "get_fitness" } })).await.unwrap();
        assert!(r.get("error").is_none());
        assert!(r["result"]["content"][0]["text"].as_str().unwrap().contains("Settings → Coach"));
    }

    #[tokio::test]
    async fn initialize_and_ping_work_with_the_coach_off() {
        let mcp = off();
        let r = answer(&mcp, json!({ "jsonrpc": "2.0", "id": 0, "method": "initialize", "params": {} })).await.unwrap();
        assert_eq!(r["result"]["serverInfo"]["name"], "lactic");
        let r = answer(&mcp, json!({ "jsonrpc": "2.0", "id": 3, "method": "ping" })).await.unwrap();
        assert!(r.get("error").is_none());
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpSetup {
    url: Option<String>,
    token: Option<String>,
    command: String,
    claude_config: Option<String>,
    /// Lactic is in Claude Desktop's MCP servers.
    claude_added: bool,
}

/// Where the server is, and what an AI app needs to reach it.
#[tauri::command]
pub async fn mcp_setup(mcp: State<'_, Arc<Mcp>>) -> Result<McpSetup, String> {
    let info = mcp.info.lock().await.clone();
    let command = own_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| "lactic".into());
    Ok(McpSetup {
        url: info.as_ref().map(|i| format!("http://127.0.0.1:{}/mcp", i.port)),
        token: info.map(|i| i.token),
        command,
        claude_config: claude_config_path().map(|p| p.to_string_lossy().into_owned()),
        claude_added: claude_has_lactic(),
    })
}

/// The program an AI app should launch for `--mcp`. An AppImage runs from a temporary mount, so
/// it's the AppImage file itself (Linux sets $APPIMAGE), not the binary inside it.
fn own_exe() -> std::io::Result<PathBuf> {
    if let Some(p) = std::env::var_os("APPIMAGE") {
        return Ok(PathBuf::from(p));
    }
    std::env::current_exe()
}

fn claude_config_path() -> Option<PathBuf> {
    // Application Support on a Mac, %APPDATA% on Windows, ~/.config on Linux.
    let base = dirs::config_dir()?.join("Claude");
    Some(base.join("claude_desktop_config.json"))
}

fn claude_has_lactic() -> bool {
    let Some(path) = claude_config_path() else { return false };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .is_some_and(|c| c.get("mcpServers").and_then(|m| m.get(server_name())).is_some())
}

/// Adds Lactic to Claude Desktop's MCP servers, keeping everything else in its config. Claude
/// Desktop picks it up after a restart.
#[tauri::command]
pub fn mcp_install_claude() -> Result<String, String> {
    let path = claude_config_path().ok_or("Couldn't find Claude Desktop's settings folder")?;
    let mut config: Value = std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_else(|| json!({}));
    let exe = own_exe().map_err(|e| e.to_string())?;
    if !config.is_object() {
        config = json!({});
    }
    let servers = config.as_object_mut().unwrap().entry("mcpServers").or_insert_with(|| json!({}));
    if !servers.is_object() {
        *servers = json!({});
    }
    servers.as_object_mut().unwrap().insert(server_name().into(), json!({ "command": exe.to_string_lossy(), "args": ["--mcp"] }));
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    if path.exists() {
        let _ = std::fs::copy(&path, path.with_extension("json.bak"));
    }
    std::fs::write(&path, serde_json::to_string_pretty(&config).unwrap()).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Tauri keeps app data in <data dir>/<identifier> on every OS (Lactic Preview has its own).
fn data_dir() -> Option<PathBuf> {
    Some(dirs::data_dir()?.join(crate::identifier()))
}

/// The name Lactic goes by in Claude Desktop's MCP servers: "lactic", or "lactic-preview" for a
/// preview build, so installing a preview's bridge never replaces the real app's.
fn server_name() -> &'static str {
    if crate::is_modular() { "lactic-modular" } else if crate::is_preview() { "lactic-preview" } else { "lactic" }
}

/// `lactic --mcp`: JSON-RPC over stdin and stdout, forwarded to the running app.
pub fn run_stdio_bridge() {
    let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build().expect("runtime");
    rt.block_on(async {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
        let client = reqwest::Client::new();
        let mut lines = BufReader::new(tokio::io::stdin()).lines();
        let mut stdout = tokio::io::stdout();
        let mut launched = false;
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            let message: Value = match serde_json::from_str(&line) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let id = message.get("id").cloned();
            let reply = send(&client, &line, &mut launched).await;
            let out = match (reply, id) {
                (Ok(Some(body)), _) => Some(body),
                (Ok(None), _) => None,
                (Err(e), Some(id)) => Some(rpc_error(&id, -32000, &e).to_string()),
                (Err(_), None) => None,
            };
            if let Some(text) = out {
                let _ = stdout.write_all(text.as_bytes()).await;
                let _ = stdout.write_all(b"\n").await;
                let _ = stdout.flush().await;
            }
        }
    });
}

async fn send(client: &reqwest::Client, line: &str, launched: &mut bool) -> Result<Option<String>, String> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(40);
    loop {
        let info = data_dir().and_then(|d| std::fs::read_to_string(info_path(&d)).ok()).and_then(|s| serde_json::from_str::<McpInfo>(&s).ok());
        if let Some(info) = &info {
            let res = client
                .post(format!("http://127.0.0.1:{}/mcp", info.port))
                .bearer_auth(&info.token)
                .header("content-type", "application/json")
                .header("accept", "application/json, text/event-stream")
                .body(line.to_string())
                .send()
                .await;
            match res {
                Ok(r) if r.status() == reqwest::StatusCode::ACCEPTED => return Ok(None),
                Ok(r) => {
                    let text = r.text().await.map_err(|e| e.to_string())?;
                    return Ok(if text.trim().is_empty() { None } else { Some(text) });
                }
                Err(e) if !e.is_connect() => return Err(e.to_string()),
                Err(_) => {}
            }
        }
        // The app isn't running: open it once, then wait for its server.
        if !*launched {
            *launched = true;
            if let Ok(exe) = std::env::current_exe() {
                let _ = std::process::Command::new(exe).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).spawn();
            }
        }
        if tokio::time::Instant::now() > deadline {
            return Err("Lactic isn't running and didn't open. Open Lactic and try again.".into());
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}
