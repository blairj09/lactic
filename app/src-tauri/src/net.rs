// HTTP for the web layer, from Rust: no browser CORS rules in the way of local models or APIs, and
// API keys are added here from the keychain so the web layer never holds them.

use crate::secrets::Secrets;
use base64::Engine;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{ipc::Channel, State};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Auth {
    /// The keychain entry holding the key.
    secret: String,
    /// bearer: Authorization: Bearer KEY. basic: Basic user:KEY. header: <header>: KEY.
    scheme: String,
    user: Option<String>,
    header: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    url: String,
    #[serde(default = "get")]
    method: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    body: Option<String>,
    body_base64: Option<String>,
    auth: Option<Auth>,
    timeout_ms: Option<u64>,
    /// "text" (default) or "binary" (returned as base64).
    response: Option<String>,
    /// Lets http_cancel stop a streaming request.
    stream_id: Option<String>,
}

fn get() -> String {
    "GET".into()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    status: u16,
    headers: HashMap<String, String>,
    body: String,
    body_base64: Option<String>,
}

pub struct Net {
    client: reqwest::Client,
    cancels: Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>,
}

impl Net {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .user_agent(concat!("Lactic/", env!("CARGO_PKG_VERSION"), " (+https://lactic.fit)"))
            .connect_timeout(Duration::from_secs(15))
            .build()
            .expect("http client");
        Net { client, cancels: Mutex::new(HashMap::new()) }
    }
}

fn build(net: &Net, secrets: &Secrets, req: &Request) -> Result<reqwest::RequestBuilder, String> {
    let method = reqwest::Method::from_bytes(req.method.to_uppercase().as_bytes()).map_err(|e| e.to_string())?;
    let mut b = net.client.request(method, &req.url);
    for (k, v) in &req.headers {
        b = b.header(k, v);
    }
    if let Some(auth) = &req.auth {
        let key = secrets.get(&auth.secret).ok_or_else(|| format!("No key saved for {}", auth.secret))?;
        b = match auth.scheme.as_str() {
            "basic" => b.basic_auth(auth.user.clone().unwrap_or_default(), Some(key)),
            "header" => b.header(auth.header.clone().unwrap_or_else(|| "x-api-key".into()), key),
            _ => b.bearer_auth(key),
        };
    }
    if let Some(t) = req.timeout_ms {
        b = b.timeout(Duration::from_millis(t));
    }
    if let Some(body) = &req.body {
        b = b.body(body.clone());
    } else if let Some(b64) = &req.body_base64 {
        let bytes = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|e| e.to_string())?;
        b = b.body(bytes);
    }
    Ok(b)
}

fn header_map(h: &reqwest::header::HeaderMap) -> HashMap<String, String> {
    h.iter().filter_map(|(k, v)| v.to_str().ok().map(|v| (k.to_string(), v.to_string()))).collect()
}

fn friendly(e: reqwest::Error) -> String {
    if e.is_connect() {
        format!("Couldn't connect: {}", e.url().map(|u| u.as_str()).unwrap_or(""))
    } else if e.is_timeout() {
        "The request timed out".into()
    } else {
        e.to_string()
    }
}

#[tauri::command]
pub async fn http_request(net: State<'_, Net>, secrets: State<'_, Secrets>, request: Request) -> Result<Response, String> {
    let res = build(&net, &secrets, &request)?.send().await.map_err(friendly)?;
    let status = res.status().as_u16();
    let headers = header_map(res.headers());
    if request.response.as_deref() == Some("binary") {
        let bytes = res.bytes().await.map_err(friendly)?;
        return Ok(Response { status, headers, body: String::new(), body_base64: Some(base64::engine::general_purpose::STANDARD.encode(bytes)) });
    }
    let body = res.text().await.map_err(friendly)?;
    Ok(Response { status, headers, body, body_base64: None })
}

/// Streams the response: first {"status", "headers"}, then {"chunk": text} as the body arrives
/// (server-sent events from a model). Resolves once the body ends.
#[tauri::command]
pub async fn http_stream(net: State<'_, Net>, secrets: State<'_, Secrets>, request: Request, on_chunk: Channel<serde_json::Value>) -> Result<Response, String> {
    let res = build(&net, &secrets, &request)?.send().await.map_err(friendly)?;
    let status = res.status().as_u16();
    let headers = header_map(res.headers());
    let _ = on_chunk.send(serde_json::json!({ "status": status, "headers": headers }));
    let (tx, mut rx) = tokio::sync::oneshot::channel::<()>();
    if let Some(id) = &request.stream_id {
        net.cancels.lock().unwrap().insert(id.clone(), tx);
    }
    let mut stream = res.bytes_stream();
    let mut pending: Vec<u8> = Vec::new();
    loop {
        tokio::select! {
            _ = &mut rx => break,
            next = stream.next() => match next {
                Some(Ok(bytes)) => {
                    pending.extend_from_slice(&bytes);
                    // Only send whole UTF-8 characters; keep a split one for the next chunk.
                    let valid = match std::str::from_utf8(&pending) { Ok(_) => pending.len(), Err(e) => e.valid_up_to() };
                    if valid > 0 {
                        let text = String::from_utf8_lossy(&pending[..valid]).into_owned();
                        pending.drain(..valid);
                        let _ = on_chunk.send(serde_json::json!({ "chunk": text }));
                    }
                }
                Some(Err(e)) => return Err(friendly(e)),
                None => break,
            }
        }
    }
    if !pending.is_empty() {
        let _ = on_chunk.send(serde_json::json!({ "chunk": String::from_utf8_lossy(&pending).into_owned() }));
    }
    if let Some(id) = &request.stream_id {
        net.cancels.lock().unwrap().remove(id);
    }
    Ok(Response { status, headers, body: String::new(), body_base64: None })
}

#[tauri::command]
pub fn http_cancel(net: State<Net>, stream_id: String) {
    if let Some(tx) = net.cancels.lock().unwrap().remove(&stream_id) {
        let _ = tx.send(());
    }
}
