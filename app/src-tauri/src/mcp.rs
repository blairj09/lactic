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
    app: Mutex<Option<AppHandle>>,
}

impl Default for Mcp {
    fn default() -> Self {
        Mcp { info: Mutex::new(None), pending: Mutex::new(HashMap::new()), next: AtomicU64::new(1), enabled: AtomicBool::new(false), app: Mutex::new(None) }
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
    McpInfo { port: DEFAULT_PORT, token }
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
    for port in std::iter::once(info.port).chain(DEFAULT_PORT..DEFAULT_PORT + 20) {
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
            if !mcp.enabled.load(Ordering::Relaxed) {
                return Some(rpc_error(&id, -32001, "The external coach is turned off. In Lactic, open Settings → Coach and choose \"An AI app I already use\"."));
            }
            match forward(mcp, method, params).await {
                Ok(v) => rpc_result(&id, v),
                Err(e) => json!({ "jsonrpc": "2.0", "id": id, "error": e }),
            }
        }
        _ => rpc_error(&id, -32601, "Method not found"),
    })
}

async fn forward(mcp: &Mcp, method: &str, params: Value) -> Result<Value, Value> {
    let app = mcp.app.lock().await.clone().ok_or_else(|| json!({ "code": -32002, "message": "Lactic is starting" }))?;
    let n = mcp.next.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = oneshot::channel();
    mcp.pending.lock().await.insert(n, tx);
    let _ = app.emit_to("main", "mcp:request", json!({ "requestId": n, "method": method, "params": params }));
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
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpSetup {
    url: Option<String>,
    token: Option<String>,
    command: String,
    claude_config: Option<String>,
}

/// Where the server is, and what an AI app needs to reach it.
#[tauri::command]
pub async fn mcp_setup(mcp: State<'_, Arc<Mcp>>) -> Result<McpSetup, String> {
    let info = mcp.info.lock().await.clone();
    let command = std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| "lactic".into());
    Ok(McpSetup {
        url: info.as_ref().map(|i| format!("http://127.0.0.1:{}/mcp", i.port)),
        token: info.map(|i| i.token),
        command,
        claude_config: claude_config_path().map(|p| p.to_string_lossy().into_owned()),
    })
}

fn claude_config_path() -> Option<PathBuf> {
    let base = if cfg!(target_os = "macos") {
        dirs::home_dir()?.join("Library/Application Support/Claude")
    } else if cfg!(target_os = "windows") {
        dirs::config_dir()?.join("Claude")
    } else {
        dirs::config_dir()?.join("Claude")
    };
    Some(base.join("claude_desktop_config.json"))
}

/// Adds Lactic to Claude Desktop's MCP servers, keeping everything else in its config. Claude
/// Desktop picks it up after a restart.
#[tauri::command]
pub fn mcp_install_claude() -> Result<String, String> {
    let path = claude_config_path().ok_or("Couldn't find Claude Desktop's settings folder")?;
    let mut config: Value = std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_else(|| json!({}));
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    if !config.is_object() {
        config = json!({});
    }
    let servers = config.as_object_mut().unwrap().entry("mcpServers").or_insert_with(|| json!({}));
    if !servers.is_object() {
        *servers = json!({});
    }
    servers.as_object_mut().unwrap().insert("lactic".into(), json!({ "command": exe.to_string_lossy(), "args": ["--mcp"] }));
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    if path.exists() {
        let _ = std::fs::copy(&path, path.with_extension("json.bak"));
    }
    std::fs::write(&path, serde_json::to_string_pretty(&config).unwrap()).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Tauri keeps app data in <data dir>/<identifier> on every OS.
fn data_dir() -> Option<PathBuf> {
    Some(dirs::data_dir()?.join("fit.lactic.app"))
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
