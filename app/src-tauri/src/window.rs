// The ride overlay: a small always-on-top window with the workout, over whatever else is open
// (Zwift, a video, a browser).
// It floats over other apps, on every Space, and over full-screen apps on macOS, which Chrome's
// Picture-in-Picture couldn't do. Windows and Linux have no window level above full-screen apps,
// so there it puts itself back on top every second instead; see keep_on_top().

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const MIN_W: f64 = 220.0;
const MIN_H: f64 = 120.0;
/// Where the overlay last was and how big, in the app's data folder, so it opens there next ride.
const GEOMETRY_FILE: &str = "overlay-window.json";

/// A window or screen area in logical pixels (points on macOS).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    fn overlap(&self, o: &Rect) -> f64 {
        let w = (self.x + self.width).min(o.x + o.width) - self.x.max(o.x);
        let h = (self.y + self.height).min(o.y + o.height) - self.y.max(o.y);
        if w > 0.0 && h > 0.0 {
            w * h
        } else {
            0.0
        }
    }
}

/// Puts the saved overlay back where it was, kept whole on the screen it overlaps most. If it's on
/// no screen now (a display was unplugged), None, and the overlay opens in the default spot.
pub fn place(saved: Rect, screens: &[Rect]) -> Option<Rect> {
    let screen = screens
        .iter()
        .map(|s| (s, saved.overlap(s)))
        .filter(|(_, a)| *a > 0.0)
        .max_by(|a, b| a.1.total_cmp(&b.1))?
        .0;
    let width = saved.width.min(screen.width).max(MIN_W);
    let height = saved.height.min(screen.height).max(MIN_H);
    let x = saved.x.min(screen.x + screen.width - width).max(screen.x);
    let y = saved.y.min(screen.y + screen.height - height).max(screen.y);
    Some(Rect { x, y, width, height })
}

fn geometry_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join(GEOMETRY_FILE))
}

fn saved_geometry(app: &AppHandle) -> Option<Rect> {
    let text = std::fs::read_to_string(geometry_path(app)?).ok()?;
    let r: Rect = serde_json::from_str(&text).ok()?;
    (r.x.is_finite() && r.y.is_finite() && r.width.is_finite() && r.height.is_finite()).then_some(r)
}

/// Each screen's usable area (without the menu bar, Dock or taskbar), in logical pixels.
fn screens(app: &AppHandle) -> Vec<Rect> {
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let area = m.work_area();
            let scale = m.scale_factor();
            let pos = area.position.to_logical::<f64>(scale);
            let size = area.size.to_logical::<f64>(scale);
            Rect { x: pos.x, y: pos.y, width: size.width, height: size.height }
        })
        .collect()
}

/// Saves where the overlay is whenever the rider moves or resizes it, half a second after they stop.
fn remember_geometry(window: &tauri::WebviewWindow) {
    let Some(path) = geometry_path(window.app_handle()) else { return };
    let generation = Arc::new(AtomicU64::new(0));
    let w = window.clone();
    window.on_window_event(move |e| {
        if !matches!(e, tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)) {
            return;
        }
        if w.is_minimized().unwrap_or(false) || w.is_fullscreen().unwrap_or(false) {
            return;
        }
        let (Ok(scale), Ok(pos), Ok(size)) = (w.scale_factor(), w.outer_position(), w.inner_size()) else { return };
        let pos = pos.to_logical::<f64>(scale);
        let size = size.to_logical::<f64>(scale);
        if size.width < MIN_W - 1.0 || size.height < MIN_H - 1.0 {
            return;
        }
        let rect = Rect { x: pos.x, y: pos.y, width: size.width, height: size.height };
        let mine = generation.fetch_add(1, Ordering::Relaxed) + 1;
        let generation = generation.clone();
        let path = path.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            if generation.load(Ordering::Relaxed) == mine {
                if let Ok(json) = serde_json::to_string(&rect) {
                    let _ = std::fs::write(&path, json);
                }
            }
        });
    });
}

#[tauri::command]
pub async fn overlay_open(app: AppHandle, width: Option<f64>, height: Option<f64>) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("overlay") {
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    // Back where the rider left it last time, at that size; the first time, the size the Ride page asks for.
    let restored = saved_geometry(&app).and_then(|r| place(r, &screens(&app)));
    let builder = WebviewWindowBuilder::new(&app, "overlay", WebviewUrl::App("index.html#/overlay".into()));
    let builder = match restored {
        Some(r) => builder.inner_size(r.width, r.height).position(r.x, r.y),
        None => builder.inner_size(width.unwrap_or(360.0), height.unwrap_or(220.0)),
    };
    let window = builder
        .title("Lactic ride")
        .min_inner_size(MIN_W, MIN_H)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .decorations(false)
        .resizable(true)
        .skip_taskbar(true)
        .build()
        .map_err(|e| e.to_string())?;
    float_over_full_screen(&window);
    remember_geometry(&window);
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
    use std::sync::atomic::AtomicBool;
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

#[cfg(test)]
mod tests {
    use super::*;

    const MAIN: Rect = Rect { x: 0.0, y: 25.0, width: 1512.0, height: 920.0 };
    const RIGHT: Rect = Rect { x: 1512.0, y: 0.0, width: 2560.0, height: 1415.0 };

    #[test]
    fn keeps_a_window_that_fits() {
        let r = Rect { x: 1000.0, y: 60.0, width: 420.0, height: 260.0 };
        assert_eq!(place(r, &[MAIN, RIGHT]), Some(r));
        let r = Rect { x: 3000.0, y: 900.0, width: 600.0, height: 300.0 };
        assert_eq!(place(r, &[MAIN, RIGHT]), Some(r));
    }

    #[test]
    fn pulls_a_window_hanging_off_the_edge_back_on() {
        let r = Rect { x: 1300.0, y: 800.0, width: 420.0, height: 260.0 };
        assert_eq!(place(r, &[MAIN]), Some(Rect { x: 1092.0, y: 685.0, width: 420.0, height: 260.0 }));
    }

    #[test]
    fn picks_the_screen_it_mostly_sits_on() {
        let r = Rect { x: 1400.0, y: 100.0, width: 400.0, height: 200.0 };
        assert_eq!(place(r, &[MAIN, RIGHT]), Some(Rect { x: 1512.0, y: 100.0, width: 400.0, height: 200.0 }));
    }

    #[test]
    fn forgets_the_spot_when_its_screen_is_gone() {
        let r = Rect { x: 3000.0, y: 900.0, width: 600.0, height: 300.0 };
        assert_eq!(place(r, &[MAIN]), None);
        assert_eq!(place(r, &[]), None);
    }

    #[test]
    fn shrinks_a_window_bigger_than_the_screen() {
        let r = Rect { x: 0.0, y: 25.0, width: 2400.0, height: 1300.0 };
        assert_eq!(place(r, &[MAIN]), Some(MAIN));
    }
}
