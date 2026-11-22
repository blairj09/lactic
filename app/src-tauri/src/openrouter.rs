// Sign in with OpenRouter: OpenRouter's PKCE sign-in makes an API key for Lactic on the rider's
// account, so they don't copy one by hand. The key goes straight into the keychain as "ai" (the
// same place a pasted key goes) and never reaches the web layer.
//
// OpenRouter sends the browser back to lactic.fit/openrouter/ (site/openrouter/index.html), so its
// page names lactic.fit rather than "localhost:<port>". That static page only passes the code on:
// to the one-shot listener on 127.0.0.1 here (the port rides in `state`), or to
// lactic://lactic.fit/openrouter on the iPhone, whose sign-in sheet hands it to
// `openrouter_finish`. The code is useless without the verifier, which never leaves this device.

use crate::net::Net;
use crate::secrets::Secrets;
use crate::strava::{page, parse_request};
use base64::Engine;
use rand::RngCore;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use std::time::Duration;
use tauri::State;
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const CALLBACK: &str = "https://lactic.fit/openrouter/";
const KEYS: &str = "https://openrouter.ai/api/v1/auth/keys";
/// How long the browser sign-in may take.
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(600);

/// A computer sign-in still waiting for the browser; a new one, or Cancel, stops it.
static WAITING: Mutex<Option<tokio::sync::oneshot::Sender<()>>> = Mutex::new(None);
/// The iPhone's sign-in in progress: (state, verifier).
static PENDING: Mutex<Option<(String, String)>> = Mutex::new(None);

fn random_hex(bytes: usize) -> String {
    let mut b = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut b);
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn b64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// A fresh code verifier (43 characters from 32 random bytes) and its S256 challenge.
pub fn verifier_and_challenge() -> (String, String) {
    let mut b = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut b);
    let verifier = b64url(&b);
    let challenge = b64url(&Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// OpenRouter's sign-in page. `state` tells lactic.fit where to pass the code: "<port>-<hex>" to
/// 127.0.0.1:<port>, "app-<hex>" to the iPhone app.
pub fn auth_url(challenge: &str, state: &str) -> String {
    format!(
        "https://openrouter.ai/auth?callback_url={}&code_challenge={challenge}&code_challenge_method=S256&key_label=Lactic&state={state}",
        encode(CALLBACK)
    )
}

#[derive(serde::Deserialize)]
struct Made {
    key: String,
}

/// Swaps the code for the key with OpenRouter and keeps it in the keychain.
async fn exchange(net: &Net, secrets: &Secrets, code: &str, verifier: &str) -> Result<(), String> {
    let res = net
        .client
        .post(KEYS)
        .json(&serde_json::json!({ "code": code, "code_verifier": verifier, "code_challenge_method": "S256" }))
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| format!("Couldn't reach OpenRouter: {e}"))?;
    let status = res.status();
    if !status.is_success() {
        return Err(if status.as_u16() == 403 {
            "OpenRouter turned the sign-in down (it may have taken longer than 10 minutes). Try again.".into()
        } else {
            format!("OpenRouter sign-in failed ({status}). Try again.")
        });
    }
    let made: Made = res.json().await.map_err(|_| "OpenRouter sent something unexpected. Try again.".to_string())?;
    if made.key.trim().is_empty() {
        return Err("OpenRouter didn't send a key. Try again.".into());
    }
    secrets.set_for_host("ai", made.key.trim(), None)
}

/// Waits for lactic.fit to pass the browser on to /openrouter with `state`. Ok(code).
async fn wait_for_code(listener: TcpListener, state: &str) -> Result<String, String> {
    loop {
        let (mut socket, _) = listener.accept().await.map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; 8192];
        let n = tokio::time::timeout(Duration::from_secs(10), socket.read(&mut buf)).await.ok().and_then(|r| r.ok()).unwrap_or(0);
        let head = String::from_utf8_lossy(&buf[..n]).into_owned();
        let Some((path, query)) = parse_request(&head) else {
            continue;
        };
        if path != "/openrouter" {
            let _ = socket.write_all(b"HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\nconnection: close\r\n\r\n").await;
            continue;
        }
        let get = |k: &str| query.iter().find(|(name, _)| name == k).map(|(_, v)| v.clone());
        if get("state").as_deref() != Some(state) {
            let _ = socket
                .write_all(page("That sign-in link is out of date", "Go back to Lactic and choose Sign in with OpenRouter again.").as_bytes())
                .await;
            continue;
        }
        let Some(code) = get("code").filter(|c| !c.is_empty()) else {
            continue;
        };
        let _ = socket.write_all(page("Signed in to OpenRouter", "You can close this tab and go back to Lactic.").as_bytes()).await;
        return Ok(code);
    }
}

/// The computer's sign-in: opens OpenRouter in the browser and waits for the rider to allow Lactic.
#[tauri::command]
pub async fn openrouter_connect(app: tauri::AppHandle, net: State<'_, Net>, secrets: State<'_, Secrets>) -> Result<(), String> {
    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let state = format!("{port}-{}", random_hex(16));
    let (verifier, challenge) = verifier_and_challenge();
    let (tx, rx) = tokio::sync::oneshot::channel();
    if let Some(previous) = WAITING.lock().unwrap().replace(tx) {
        let _ = previous.send(());
    }
    app.opener()
        .open_url(auth_url(&challenge, &state), None::<&str>)
        .map_err(|e| format!("Couldn't open the browser: {e}"))?;
    let code = tokio::select! {
        r = wait_for_code(listener, &state) => r,
        _ = rx => Err("Sign-in was cancelled.".into()),
        _ = tokio::time::sleep(SIGN_IN_TIMEOUT) => Err("OpenRouter sign-in timed out. Try again.".into()),
    }?;
    exchange(&net, &secrets, &code, &verifier).await
}

/// Stops a computer sign-in that's waiting for the browser.
#[tauri::command]
pub fn openrouter_cancel() {
    if let Some(tx) = WAITING.lock().unwrap().take() {
        let _ = tx.send(());
    }
}

#[derive(Serialize)]
pub struct Begun {
    url: String,
}

/// The iPhone's sign-in, step one: the page for its sign-in sheet. The verifier stays here.
#[tauri::command]
pub fn openrouter_begin() -> Begun {
    let state = format!("app-{}", random_hex(16));
    let (verifier, challenge) = verifier_and_challenge();
    let url = auth_url(&challenge, &state);
    *PENDING.lock().unwrap() = Some((state, verifier));
    Begun { url }
}

/// The iPhone's sign-in, step two: the code the sheet came back with, for the key.
#[tauri::command]
pub async fn openrouter_finish(net: State<'_, Net>, secrets: State<'_, Secrets>, code: String, state: String) -> Result<(), String> {
    let pending = PENDING.lock().unwrap().take();
    let Some((expected, verifier)) = pending else {
        return Err("That sign-in was out of date. Try again.".into());
    };
    if state != expected {
        return Err("That sign-in was out of date. Try again.".into());
    }
    exchange(&net, &secrets, &code, &verifier).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn challenge_is_s256_of_verifier() {
        let (v, c) = verifier_and_challenge();
        assert_eq!(v.len(), 43);
        assert_eq!(c, b64url(&Sha256::digest(v.as_bytes())));
        assert!(!c.contains('=') && !c.contains('+') && !c.contains('/'));
    }

    #[test]
    fn auth_url_names_lactic_fit() {
        let url = auth_url("abc", "51423-ff");
        assert!(url.starts_with("https://openrouter.ai/auth?callback_url=https%3A%2F%2Flactic.fit%2Fopenrouter%2F&"));
        assert!(url.contains("code_challenge=abc&code_challenge_method=S256"));
        assert!(url.ends_with("&state=51423-ff"));
    }
}
