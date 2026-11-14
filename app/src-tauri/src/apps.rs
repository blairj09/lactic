// Head unit with Zwift: which training app (Zwift, Rouvy, MyWhoosh) is open on this computer, so
// Lactic can get the head unit ready by itself, and the menu bar icon that keeps Lactic running
// with its window closed so it's there when the app opens.
//
// Lactic can't see inside the other app, so it reads the names of running programs and nothing
// else: no window titles, no arguments, nothing leaves the computer.

use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager};

/// Training apps, by the start of their program's name (lowercase), and the name riders know.
const APPS: &[(&str, &str)] = &[("zwiftapp", "Zwift"), ("rouvy", "Rouvy"), ("mywhoosh", "MyWhoosh")];

/// The training app a program name belongs to. Zwift's launcher doesn't count: it stays open
/// after the game closes.
pub fn training_app(program: &str) -> Option<&'static str> {
    let name = program.rsplit(['/', '\\']).next().unwrap_or(program).trim().trim_matches('"').to_lowercase();
    APPS.iter().find(|(prefix, _)| name.starts_with(prefix)).map(|(_, app)| *app)
}

/// Names of the programs running now.
fn programs() -> Vec<String> {
    #[cfg(target_os = "windows")]
    let out = {
        use std::os::windows::process::CommandExt;
        // No console window flashing up every few seconds.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        Command::new("tasklist").args(["/fo", "csv", "/nh"]).creation_flags(CREATE_NO_WINDOW).output()
    };
    #[cfg(not(target_os = "windows"))]
    let out = Command::new("ps").args(["-axco", "comm="]).output();
    let Ok(out) = out else { return Vec::new() };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        // tasklist: "ZwiftApp.exe","1234",...
        .map(|l| l.split(',').next().unwrap_or(l).trim().trim_matches('"').trim_end_matches(".exe").to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

/// The training app open now (Zwift, Rouvy or MyWhoosh), if any.
#[tauri::command]
pub async fn training_app_open() -> Option<&'static str> {
    tauri::async_runtime::spawn_blocking(|| programs().iter().find_map(|p| training_app(p))).await.ok().flatten()
}

/// Closing the window hides it while this is on, so the menu bar icon keeps Lactic running.
static KEEP_RUNNING: AtomicBool = AtomicBool::new(false);

pub fn keeps_running() -> bool {
    KEEP_RUNNING.load(Ordering::Relaxed)
}

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

const TRAY: &str = "lactic-menu-bar";

/// Puts Lactic's icon in the menu bar (the system tray on Windows and Linux), or takes it away.
#[tauri::command]
pub fn menu_bar_set(app: AppHandle, on: bool) -> Result<(), String> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;
    KEEP_RUNNING.store(on, Ordering::Relaxed);
    if !on {
        app.remove_tray_by_id(TRAY);
        return Ok(());
    }
    if app.tray_by_id(TRAY).is_some() {
        return Ok(());
    }
    let open = MenuItem::with_id(&app, "tray-open", "Open Lactic", true, None::<&str>).map_err(|e| e.to_string())?;
    let quit = MenuItem::with_id(&app, "tray-quit", "Quit Lactic", true, None::<&str>).map_err(|e| e.to_string())?;
    let menu = Menu::with_items(&app, &[&open, &quit]).map_err(|e| e.to_string())?;
    let mut tray = TrayIconBuilder::with_id(TRAY).tooltip("Lactic").menu(&menu).on_menu_event(|app, event| match event.id().as_ref() {
        "tray-open" => show_main(app),
        "tray-quit" => app.exit(0),
        _ => {}
    });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(&app).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::training_app;

    #[test]
    fn knows_training_apps_by_program_name() {
        assert_eq!(training_app("ZwiftAppSilicon"), Some("Zwift"));
        assert_eq!(training_app("ZwiftApp"), Some("Zwift"));
        assert_eq!(training_app("/Applications/Zwift.app/Contents/MacOS/ZwiftAppSilicon"), Some("Zwift"));
        assert_eq!(training_app("ROUVY"), Some("Rouvy"));
        assert_eq!(training_app("MyWhoosh"), Some("MyWhoosh"));
        assert_eq!(training_app("ZwiftLauncher"), None);
        assert_eq!(training_app("Finder"), None);
    }
}
