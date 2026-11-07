// The ride overlay: a small always-on-top window for riding with Zwift (or anything) full screen.
// It floats over other apps, on every Space, and over full-screen apps on macOS, which Chrome's
// Picture-in-Picture couldn't do.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
pub async fn overlay_open(app: AppHandle, width: Option<f64>, height: Option<f64>) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("overlay") {
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    let window = WebviewWindowBuilder::new(&app, "overlay", WebviewUrl::App("index.html#/overlay".into()))
        .title("Lactic ride")
        .inner_size(width.unwrap_or(360.0), height.unwrap_or(220.0))
        .min_inner_size(220.0, 120.0)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .decorations(false)
        .resizable(true)
        .skip_taskbar(true)
        .build()
        .map_err(|e| e.to_string())?;
    float_over_full_screen(&window);
    Ok(())
}

#[tauri::command]
pub fn overlay_close(app: AppHandle) {
    if let Some(w) = app.get_webview_window("overlay") {
        let _ = w.close();
    }
}

#[cfg(target_os = "macos")]
fn float_over_full_screen(window: &tauri::WebviewWindow) {
    use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
    let Ok(ptr) = window.ns_window() else { return };
    // The pointer crosses to the main thread as a number; AppKit objects aren't Send.
    let addr = ptr as usize;
    let _ = window.run_on_main_thread(move || {
        #[allow(unused_unsafe)]
        unsafe {
            let ns: &NSWindow = &*(addr as *const NSWindow);
            ns.setCollectionBehavior(
                NSWindowCollectionBehavior::CanJoinAllSpaces | NSWindowCollectionBehavior::FullScreenAuxiliary | NSWindowCollectionBehavior::Stationary,
            );
            // Above the main menu's level, so it stays over a full-screen game.
            ns.setLevel(25);
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn float_over_full_screen(_window: &tauri::WebviewWindow) {}
