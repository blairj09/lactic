// Lactic's native core. The app's screens are web code (src/); this crate gives them what a
// browser can't: the SQLite database, the keychain, Bluetooth, HTTP without CORS, files, a native
// ride overlay and the MCP server for external AI coaches.

pub mod ble;
pub mod db;
pub mod files;
pub mod mcp;
pub mod net;
pub mod secrets;
pub mod window;

use std::sync::Arc;
use tauri::Manager;

#[tauri::command]
fn app_info(app: tauri::AppHandle) -> serde_json::Value {
    serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "osVersion": os_info::get().version().to_string(),
        "dataDir": app.path().app_data_dir().ok().map(|p| p.to_string_lossy().into_owned()),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
        .setup(|app| {
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
            secrets::secret_set,
            secrets::secret_delete,
            secrets::secret_status,
            net::http_request,
            net::http_stream,
            net::http_cancel,
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
            mcp::mcp_respond,
            mcp::mcp_set_enabled,
            mcp::mcp_setup,
            mcp::mcp_install_claude,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lactic");
}
