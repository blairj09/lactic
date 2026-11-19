// lactic:// links from lactic.fit, so far only the test drive handoff: lactic.fit/ride's
// "Open Lactic" carries the rider's FTP and the test ride (src/try/handoff.ts reads it). A link can
// arrive before the window's JavaScript is up (it launched the app), so it waits here until
// `handoff_take` collects it, and `lactic:handoff` tells a window that's already running.
//
// The scheme is per build (tauri.conf.json plugins.deep-link): `lactic`, `lactic-preview`.

use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

static PENDING: Mutex<Option<String>> = Mutex::new(None);

/// Only links meant for this app's handoff are kept; the web layer checks the rest.
fn is_handoff(url: &str) -> bool {
    let Some((scheme, rest)) = url.split_once("://") else { return false };
    (scheme == "lactic" || scheme.starts_with("lactic-")) && rest.starts_with("lactic.fit/test-drive?") && url.len() <= 2 * 1024 * 1024
}

/// Takes the links the system opened the app with.
pub fn receive(app: &AppHandle, urls: impl IntoIterator<Item = String>) {
    let Some(url) = urls.into_iter().filter(|u| is_handoff(u)).last() else { return };
    *PENDING.lock().unwrap() = Some(url);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
    let _ = app.emit_to("main", "lactic:handoff", ());
}

/// The waiting handoff link, once.
#[tauri::command]
pub fn handoff_take() -> Option<String> {
    PENDING.lock().unwrap().take()
}

#[cfg(test)]
mod tests {
    use super::is_handoff;

    #[test]
    fn keeps_only_handoff_links() {
        assert!(is_handoff("lactic://lactic.fit/test-drive?ftp=245"));
        assert!(is_handoff("lactic-preview://lactic.fit/test-drive?ftp=245"));
        assert!(!is_handoff("lactic://lactic.fit/strava?code=1"));
        assert!(!is_handoff("https://lactic.fit/test-drive?ftp=245"));
        assert!(!is_handoff("lacticx://lactic.fit/test-drive?ftp=245"));
    }
}
