// Bluetooth on Android. btleplug needs Java glue on Android that Tauri doesn't load, so there the
// phone plugin does Bluetooth in Kotlin (plugins/lactic-phone/android, Ble.kt) and the web layer
// calls it directly (src/bluetooth/backend.ts, `pluginBackend`). These stand-ins keep the command
// list the same on every platform; nothing on Android calls them.

use serde::Serialize;

#[derive(Default)]
pub struct Ble;

#[derive(Serialize)]
pub struct Availability {
    available: bool,
    reason: Option<String>,
}

const ELSEWHERE: &str = "On Android, Bluetooth goes through the phone plugin";

#[tauri::command]
pub async fn ble_available() -> Result<Availability, String> {
    Ok(Availability { available: false, reason: Some(ELSEWHERE.into()) })
}

#[tauri::command]
pub async fn ble_scan() -> Result<(), String> {
    Err(ELSEWHERE.into())
}

#[tauri::command]
pub async fn ble_stop_scan() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn ble_connect(id: String) -> Result<Vec<serde_json::Value>, String> {
    let _ = id;
    Err(ELSEWHERE.into())
}

#[tauri::command]
pub async fn ble_disconnect(id: String) -> Result<(), String> {
    let _ = id;
    Ok(())
}

#[tauri::command]
pub async fn ble_subscribe(id: String, service: String, characteristic: String, on: bool) -> Result<(), String> {
    let _ = (id, service, characteristic, on);
    Err(ELSEWHERE.into())
}

#[tauri::command]
pub async fn ble_write(id: String, service: String, characteristic: String, value: Vec<u8>, with_response: bool) -> Result<(), String> {
    let _ = (id, service, characteristic, value, with_response);
    Err(ELSEWHERE.into())
}

#[tauri::command]
pub async fn ble_read(id: String, service: String, characteristic: String) -> Result<Vec<u8>, String> {
    let _ = (id, service, characteristic);
    Err(ELSEWHERE.into())
}

#[tauri::command]
pub async fn ble_is_connected(id: String) -> Result<bool, String> {
    let _ = id;
    Ok(false)
}
