// Lactic's native core. The app's screens are web code (src/); this crate gives them what a
// browser can't: the SQLite database, the keychain, Bluetooth, HTTP without CORS, files, a native
// ride overlay and the MCP server for external AI coaches.

pub mod ble;
pub mod db;
pub mod files;
pub mod mcp;
pub mod net;
pub mod secrets;
pub mod strava;
pub mod window;

use std::sync::{Arc, OnceLock};
use tauri::Manager;

/// The bundle identifier of the released app. Preview builds (tauri.preview.conf.json) are
/// "fit.lactic.preview": their own app, data folder, keychain item and Claude Desktop entry, so
/// testing a build never touches the rider's real Lactic.
pub const RELEASE_IDENTIFIER: &str = "fit.lactic.app";
static IDENTIFIER: OnceLock<String> = OnceLock::new();

/// This build's bundle identifier (also the name of its data folder and keychain service).
pub fn identifier() -> &'static str {
    IDENTIFIER.get().map(String::as_str).unwrap_or(RELEASE_IDENTIFIER)
}

/// A Lactic Preview build (a testing build from a pull request or main), not a release.
pub fn is_preview() -> bool {
    identifier() != RELEASE_IDENTIFIER
}

#[tauri::command]
fn app_info(app: tauri::AppHandle) -> serde_json::Value {
    serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "osVersion": os_info::get().version().to_string(),
        "dataDir": app.path().app_data_dir().ok().map(|p| p.to_string_lossy().into_owned()),
        "preview": is_preview(),
    })
}

/// The Mac's standard menus, plus Lactic → Check for Updates… under About (src/updates/).
/// Windows and Linux have no menu bar; there it's in Settings → About.
#[cfg(target_os = "macos")]
fn app_menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    let handle = app.handle();
    let menu = Menu::default(handle)?;
    if let Some(app_submenu) = menu.items()?.first().and_then(|item| item.as_submenu().cloned()) {
        let check = MenuItem::with_id(handle, "check-updates", "Check for Updates…", true, None::<&str>)?;
        app_submenu.insert(&check, 1)?;
    }
    app.set_menu(menu)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    let _ = IDENTIFIER.set(context.config().identifier.clone());
    // `lactic --mcp` is the stdio bridge an AI app (Claude Desktop, ChatGPT...) launches to reach
    // the coach tools of the running app. Anything else opens the app.
    if std::env::args().any(|a| a == "--mcp") {
        mcp::run_stdio_bridge();
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // Updates: the app checks GitHub Releases' latest.json, downloads the signed build for
        // this computer, installs it and restarts (src/updates/). Signed with the release key;
        // the public half is in tauri.conf.json.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .on_menu_event(|app, event| {
            if event.id() == "check-updates" {
                use tauri::Emitter;
                let _ = app.emit_to("main", "lactic:check-updates", ());
            }
        })
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app_menu(app)?;
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let db = db::Db::open(data_dir.join("lactic.db")).map_err(|e| e.to_string())?;
            app.manage(db);
            app.manage(secrets::Secrets::new(data_dir.clone()));
            app.manage(net::Net::new());
            app.manage(ble::Ble::default());
            let mcp = Arc::new(mcp::Mcp::default());
            app.manage(mcp.clone());
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(mcp::start(handle, mcp, data_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            db::db_select,
            db::db_execute,
            db::db_script,
            db::db_batch,
            db::db_path,
            db::db_backup,
            db::db_restore,
            db::db_forget_previous,
            secrets::secret_set,
            secrets::secret_delete,
            secrets::secret_status,
            net::http_request,
            net::http_stream,
            net::http_cancel,
            strava::strava_connect,
            strava::strava_refresh,
            strava::strava_disconnect,
            ble::ble_available,
            ble::ble_scan,
            ble::ble_stop_scan,
            ble::ble_connect,
            ble::ble_disconnect,
            ble::ble_subscribe,
            ble::ble_write,
            ble::ble_read,
            ble::ble_is_connected,
            files::folder_list,
            files::folder_ensure,
            files::file_read_text,
            files::file_read_base64,
            files::file_write_text,
            files::file_write_base64,
            files::file_move_into,
            files::icloud_drive,
            files::home_dir,
            window::overlay_open,
            window::overlay_close,
            window::overlay_support,
            mcp::mcp_respond,
            mcp::mcp_set_enabled,
            mcp::mcp_setup,
            mcp::mcp_install_claude,
        ])
        .run(context)
        .expect("error while running Lactic");
}
