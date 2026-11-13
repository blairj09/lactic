// Strava: the rider signs in once in their browser, and rides recorded in Lactic are posted to
// their Strava as Lactic activities.
//
// Strava's sign-in needs the app's client secret, which an open-source app can't ship, so the code
// swap and token refreshes go through a small relay on lactic.fit (site/api/strava.js) that holds
// it. The tokens land here, in the keychain, and never reach the web layer: uploads carry the
// `keychain:strava` placeholder and net.rs adds the access token on the way out.
//
// Sign-in on a computer: a one-shot listener on 127.0.0.1 (Strava always accepts localhost as a
// redirect) catches the browser coming back with the code. On the iPhone, a sign-in sheet catches
// Strava sending the rider to lactic://lactic.fit/strava, and the code comes here through
// `strava_finish`.

use crate::net::Net;
use crate::secrets::Secrets;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::State;
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// The access token (used through the `keychain:strava` placeholder).
pub const ACCESS: &str = "strava";
const REFRESH: &str = "strava.refresh";
const EXPIRES: &str = "strava.expires";
/// Refresh when the access token has less than this left (Strava's last six hours).
const REFRESH_BEFORE_SECS: u64 = 3600;
/// How long the browser sign-in may take.
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);

fn relay() -> String {
    std::env::var("LACTIC_STRAVA_RELAY").unwrap_or_else(|_| "https://lactic.fit/api/strava".into())
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// A sign-in still waiting for the browser; a new one cancels it.
static WAITING: Mutex<Option<tokio::sync::oneshot::Sender<()>>> = Mutex::new(None);

#[derive(Deserialize)]
struct Tokens {
    access_token: String,
    refresh_token: String,
    expires_at: u64,
    athlete: Option<Athlete>,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct Athlete {
    id: u64,
    firstname: Option<String>,
    lastname: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connected {
    athlete_id: String,
    name: String,
    /// What the rider allowed, e.g. "read,activity:write". Posting needs activity:write.
    scope: String,
}

fn save(secrets: &Secrets, t: &Tokens) -> Result<(), String> {
    secrets.set(ACCESS, &t.access_token)?;
    secrets.set(REFRESH, &t.refresh_token)?;
    secrets.set(EXPIRES, &t.expires_at.to_string())
}

async fn call_relay(net: &Net, body: serde_json::Value) -> Result<Tokens, String> {
    let res = net
        .client
        .post(relay())
        .json(&body)
        .header("x-lactic-client", concat!("lactic/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| format!("Couldn't reach lactic.fit: {e}"))?;
    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    if !status.is_success() {
        let message = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| v.get("error").and_then(|m| m.as_str()).map(String::from))
            .unwrap_or_else(|| format!("Strava sign-in failed ({status})"));
        // 400/401 from Strava: the code or refresh token is no good, so the rider must sign in again.
        return Err(if status.as_u16() == 400 || status.as_u16() == 401 { format!("reconnect: {message}") } else { message });
    }
    serde_json::from_str(&text).map_err(|_| "Strava sent something unexpected".into())
}

/// What the browser asked for: (path, query pairs).
fn parse_request(head: &str) -> Option<(String, Vec<(String, String)>)> {
    let target = head.lines().next()?.split_whitespace().nth(1)?;
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    let pairs = query
        .split('&')
        .filter(|p| !p.is_empty())
        .map(|p| {
            let (k, v) = p.split_once('=').unwrap_or((p, ""));
            (decode(k), decode(v))
        })
        .collect();
    Some((path.to_string(), pairs))
}

fn decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = bytes.get(i + 1..i + 3).and_then(|h| std::str::from_utf8(h).ok()).and_then(|h| u8::from_str_radix(h, 16).ok());
        match (bytes[i], hex) {
            (b'+', _) => out.push(b' '),
            (b'%', Some(b)) => {
                out.push(b);
                i += 2;
            }
            (b, _) => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn page(title: &str, line: &str) -> String {
    let html = format!(
        "<!doctype html><meta charset=utf-8><title>Lactic</title><body style=\"font:16px system-ui;display:grid;place-items:center;height:90vh;color:#222\"><div style=\"text-align:center\"><h1 style=\"font-size:22px\">{title}</h1><p>{line}</p></div>"
    );
    format!("HTTP/1.1 200 OK\r\ncontent-type: text/html; charset=utf-8\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{html}", html.len())
}

/// Waits for the browser to come back to /strava with `state`. Ok((code, scope)).
async fn wait_for_code(listener: TcpListener, state: &str) -> Result<(String, String), String> {
    loop {
        let (mut socket, _) = listener.accept().await.map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; 8192];
        let n = tokio::time::timeout(Duration::from_secs(10), socket.read(&mut buf)).await.ok().and_then(|r| r.ok()).unwrap_or(0);
        let head = String::from_utf8_lossy(&buf[..n]).into_owned();
        let Some((path, query)) = parse_request(&head) else { continue };
        if path != "/strava" {
            let _ = socket.write_all(b"HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\nconnection: close\r\n\r\n").await;
            continue;
        }
        let get = |k: &str| query.iter().find(|(name, _)| name == k).map(|(_, v)| v.clone());
        if get("state").as_deref() != Some(state) {
            let _ = socket.write_all(page("That sign-in link is out of date", "Go back to Lactic and choose Connect with Strava again.").as_bytes()).await;
            continue;
        }
        if get("error").is_some() {
            let _ = socket.write_all(page("Strava wasn't connected", "You can close this tab and go back to Lactic.").as_bytes()).await;
            return Err("You didn't allow Lactic on Strava.".into());
        }
        let Some(code) = get("code") else { continue };
        let _ = socket.write_all(page("Strava is connected", "You can close this tab and go back to Lactic.").as_bytes()).await;
        return Ok((code, get("scope").unwrap_or_default()));
    }
}

/// Opens Strava's sign-in in the browser and waits for the rider to allow Lactic.
#[tauri::command]
pub async fn strava_connect(app: tauri::AppHandle, net: State<'_, Net>, secrets: State<'_, Secrets>, client_id: String) -> Result<Connected, String> {
    if client_id.is_empty() || !client_id.chars().all(|c| c.is_ascii_digit()) {
        return Err("Strava isn't set up for this build of Lactic.".into());
    }
    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let state = uuid::Uuid::new_v4().simple().to_string();
    let redirect = format!("http://127.0.0.1:{port}/strava");
    let url = format!(
        "https://www.strava.com/oauth/authorize?client_id={client_id}&response_type=code&approval_prompt=auto&scope=activity:write&state={state}&redirect_uri={}",
        redirect.replace(':', "%3A").replace('/', "%2F")
    );
    let (tx, rx) = tokio::sync::oneshot::channel();
    if let Some(previous) = WAITING.lock().unwrap().replace(tx) {
        let _ = previous.send(());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| format!("Couldn't open the browser: {e}"))?;
    let result = tokio::select! {
        r = wait_for_code(listener, &state) => r,
        _ = rx => Err("Sign-in was started again.".into()),
        _ = tokio::time::sleep(SIGN_IN_TIMEOUT) => Err("Strava sign-in timed out. Try again.".into()),
    };
    let (code, scope) = result?;
    finish(&net, &secrets, code, scope).await
}

/// The iPhone's sign-in: the app shows Strava's page in a sign-in sheet (the lactic-phone
/// plugin's web_auth, since iOS pauses the app, and a 127.0.0.1 listener with it, while Safari is
/// in front) and hands the code it came back with to this.
#[tauri::command]
pub async fn strava_finish(net: State<'_, Net>, secrets: State<'_, Secrets>, code: String, scope: String) -> Result<Connected, String> {
    finish(&net, &secrets, code, scope).await
}

/// Swaps the sign-in code for tokens through the relay and keeps them in the keychain.
async fn finish(net: &Net, secrets: &Secrets, code: String, scope: String) -> Result<Connected, String> {
    if !scope.split(',').any(|s| s == "activity:write") {
        return Err("Lactic needs \"Upload your activities\" ticked on Strava's page to post your rides. Try again and leave it ticked.".into());
    }
    let tokens = call_relay(net, serde_json::json!({ "grant_type": "authorization_code", "code": code })).await?;
    save(secrets, &tokens)?;
    let athlete = tokens.athlete.clone().ok_or("Strava didn't say who signed in")?;
    let name = [athlete.firstname.unwrap_or_default(), athlete.lastname.unwrap_or_default()].join(" ").trim().to_string();
    Ok(Connected { athlete_id: athlete.id.to_string(), name, scope })
}

/// Makes sure the saved access token is good for at least another hour, refreshing it through the
/// relay when it isn't. An error starting "reconnect:" means the rider has to sign in again.
#[tauri::command]
pub async fn strava_refresh(net: State<'_, Net>, secrets: State<'_, Secrets>) -> Result<(), String> {
    let Some(refresh) = secrets.get(REFRESH) else { return Err("reconnect: Strava isn't connected.".into()) };
    let expires: u64 = secrets.get(EXPIRES).and_then(|v| v.parse().ok()).unwrap_or(0);
    if secrets.get(ACCESS).is_some() && expires > now() + REFRESH_BEFORE_SECS {
        return Ok(());
    }
    let tokens = call_relay(&net, serde_json::json!({ "grant_type": "refresh_token", "refresh_token": refresh })).await?;
    save(&secrets, &tokens)
}

/// Signs Lactic out of the rider's Strava and forgets the tokens.
#[tauri::command]
pub async fn strava_disconnect(net: State<'_, Net>, secrets: State<'_, Secrets>) -> Result<(), String> {
    if let Some(token) = secrets.get(ACCESS) {
        // Best effort: if Strava can't be reached, the tokens still go, and the rider can remove
        // Lactic under My Apps on Strava's site.
        let _ = net
            .client
            .post("https://www.strava.com/oauth/deauthorize")
            .bearer_auth(token)
            .timeout(Duration::from_secs(10))
            .send()
            .await;
    }
    for name in [ACCESS, REFRESH, EXPIRES] {
        secrets.delete(name)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_redirect() {
        let (path, q) = parse_request("GET /strava?state=abc&code=12%2F3&scope=read,activity:write HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
        assert_eq!(path, "/strava");
        assert_eq!(q, vec![("state".into(), "abc".into()), ("code".into(), "12/3".into()), ("scope".into(), "read,activity:write".into())]);
    }

    #[test]
    fn decodes_percent_and_plus() {
        assert_eq!(decode("a+b%20c%2"), "a b c%2");
    }
}
