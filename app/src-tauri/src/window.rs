// The ride overlay: a small always-on-top window with the workout, over whatever else is open
// (Zwift, a video, a browser).
// It floats over other apps, on every Space, and over full-screen apps on macOS, which Chrome's
// Picture-in-Picture couldn't do. Windows and Linux have no window level above full-screen apps,
// so there it puts itself back on top every second instead; see keep_on_top().

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

/// How far the overlay can float on this computer, so the Ride page can say what to expect:
/// "floats" (macOS: over full-screen apps too), "windows", "x11" or "wayland".
#[tauri::command]
pub fn overlay_support() -> &'static str {
    if cfg!(target_os = "macos") {
        "floats"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else if std::env::var_os("WAYLAND_DISPLAY").is_some() && std::env::var("GDK_BACKEND").map_or(true, |b| !b.starts_with("x11")) {
        // GTK on Wayland can't ask to stay on top; the rider turns it on from the window menu.
        "wayland"
    } else {
        "x11"
    }
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
fn float_over_full_screen(window: &tauri::WebviewWindow) {
    keep_on_top(window);
}

/// A game or video that goes full screen (or another always-on-top window) can push the overlay
/// down. Put it back on top once a second, without taking focus, until the overlay closes.
/// This covers borderless full screen on Windows and X11 desktops that stack full-screen apps with
/// always-on-top windows; nothing can draw over a game in exclusive full screen.
#[cfg(not(target_os = "macos"))]
fn keep_on_top(window: &tauri::WebviewWindow) {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    let closed = Arc::new(AtomicBool::new(false));
    let flag = closed.clone();
    window.on_window_event(move |e| {
        if matches!(e, tauri::WindowEvent::Destroyed) {
            flag.store(true, Ordering::Relaxed);
        }
    });
    let window = window.clone();
    tauri::async_runtime::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(1));
        loop {
            tick.tick().await;
            if closed.load(Ordering::Relaxed) {
                break;
            }
            if window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false) {
                raise(&window);
            }
        }
    });
}

#[cfg(target_os = "windows")]
fn raise(window: &tauri::WebviewWindow) {
    // Tauri only calls SetWindowPos when always-on-top changes, so call it directly: it moves the
    // window to the top of the topmost band again. Async, and without activating it, so the game
    // keeps focus and this thread never waits on the window's thread.
    #[link(name = "user32")]
    extern "system" {
        fn SetWindowPos(hwnd: isize, insert_after: isize, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
    }
    const HWND_TOPMOST: isize = -1;
    const SWP_NOSIZE: u32 = 0x0001;
    const SWP_NOMOVE: u32 = 0x0002;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const SWP_NOOWNERZORDER: u32 = 0x0200;
    const SWP_ASYNCWINDOWPOS: u32 = 0x4000;
    let Ok(hwnd) = window.hwnd() else { return };
    unsafe {
        SetWindowPos(hwnd.0 as isize, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_ASYNCWINDOWPOS);
    }
}

#[cfg(target_os = "linux")]
fn raise(window: &tauri::WebviewWindow) {
    // Restack above the full-screen app where the window manager keeps both in one layer (GNOME on
    // X11 does). A raise doesn't move focus. On Wayland this does nothing; see overlay_support().
    let w = window.clone();
    let _ = window.run_on_main_thread(move || {
        use gtk::prelude::*;
        if let Ok(gw) = w.gtk_window() {
            if let Some(gdk) = gw.window() {
                gdk.raise();
            }
        }
    });
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn raise(_window: &tauri::WebviewWindow) {}
