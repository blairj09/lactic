// Bluetooth LE through the OS (CoreBluetooth on macOS, WinRT on Windows, BlueZ on Linux), so
// trainers, straps, power meters and scales work with no browser, picker or flags. The web layer
// wraps these commands in a Web Bluetooth-shaped API (src/platform/bluetooth.ts), so the same
// SensorHub and scale code run on the web and here.
//
// GATT allows one operation at a time per device: every read, write and subscribe for a device
// holds that device's lock while it runs.

use btleplug::api::{Central, CentralEvent, CharPropFlags, Characteristic, Manager as _, Peripheral as _, ScanFilter, WriteType};
use btleplug::platform::{Adapter, Manager, Peripheral};
use futures::StreamExt;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Default)]
pub struct Ble {
    adapter: Mutex<Option<Adapter>>,
    locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    listening: Mutex<HashMap<String, tokio::task::JoinHandle<()>>>,
    scanning: Mutex<u32>,
}

#[derive(Serialize, Clone)]
struct Advert {
    id: String,
    name: Option<String>,
    rssi: Option<i16>,
    services: Vec<String>,
}

#[derive(Serialize, Clone)]
struct Notification {
    id: String,
    service: String,
    characteristic: String,
    value: Vec<u8>,
}

#[derive(Serialize)]
pub struct CharInfo {
    uuid: String,
    properties: Vec<&'static str>,
}

#[derive(Serialize)]
pub struct ServiceInfo {
    uuid: String,
    characteristics: Vec<CharInfo>,
}

#[derive(Serialize)]
pub struct Availability {
    available: bool,
    reason: Option<String>,
}

impl Ble {
    async fn adapter(&self, app: &AppHandle) -> Result<Adapter, String> {
        let mut slot = self.adapter.lock().await;
        if let Some(a) = slot.as_ref() {
            return Ok(a.clone());
        }
        let manager = Manager::new().await.map_err(|e| format!("Bluetooth isn't available: {e}"))?;
        let adapter = manager
            .adapters()
            .await
            .map_err(|e| format!("Bluetooth isn't available: {e}"))?
            .into_iter()
            .next()
            .ok_or("No Bluetooth adapter found. Is Bluetooth on?")?;
        let events = adapter.events().await.map_err(|e| e.to_string())?;
        let app2 = app.clone();
        let a2 = adapter.clone();
        tokio::spawn(async move {
            let mut events = events;
            while let Some(event) = events.next().await {
                match event {
                    CentralEvent::DeviceDiscovered(id) | CentralEvent::DeviceUpdated(id) | CentralEvent::ServicesAdvertisement { id, .. } => {
                        if let Ok(p) = a2.peripheral(&id).await {
                            if let Ok(Some(props)) = p.properties().await {
                                let _ = app2.emit(
                                    "ble:advert",
                                    Advert { id: p.id().to_string(), name: props.local_name, rssi: props.rssi, services: props.services.iter().map(|u| u.to_string()).collect() },
                                );
                            }
                        }
                    }
                    CentralEvent::DeviceDisconnected(id) => {
                        let _ = app2.emit("ble:disconnected", id.to_string());
                    }
                    _ => {}
                }
            }
        });
        *slot = Some(adapter.clone());
        Ok(adapter)
    }

    async fn lock_for(&self, id: &str) -> Arc<Mutex<()>> {
        self.locks.lock().await.entry(id.to_string()).or_default().clone()
    }

    /// The peripheral with this id. The OS only knows devices it has seen advertising, so a
    /// remembered device not seen yet this launch is scanned for, up to `wait`.
    async fn find(&self, app: &AppHandle, id: &str, wait: Duration) -> Result<Peripheral, String> {
        let adapter = self.adapter(app).await?;
        let lookup = |list: Vec<Peripheral>| list.into_iter().find(|p| p.id().to_string() == id);
        if let Some(p) = lookup(adapter.peripherals().await.map_err(|e| e.to_string())?) {
            return Ok(p);
        }
        let started_scan = *self.scanning.lock().await == 0;
        if started_scan {
            adapter.start_scan(ScanFilter::default()).await.map_err(|e| e.to_string())?;
        }
        let deadline = tokio::time::Instant::now() + wait;
        let found = loop {
            if let Some(p) = lookup(adapter.peripherals().await.map_err(|e| e.to_string())?) {
                break Some(p);
            }
            if tokio::time::Instant::now() > deadline {
                break None;
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        };
        if started_scan && *self.scanning.lock().await == 0 {
            let _ = adapter.stop_scan().await;
        }
        found.ok_or_else(|| "Device not found. Wake it up (pedal, or put the strap on) and try again.".into())
    }
}

fn props(flags: CharPropFlags) -> Vec<&'static str> {
    let mut out = vec![];
    if flags.contains(CharPropFlags::READ) {
        out.push("read");
    }
    if flags.contains(CharPropFlags::WRITE) {
        out.push("write");
    }
    if flags.contains(CharPropFlags::WRITE_WITHOUT_RESPONSE) {
        out.push("writeWithoutResponse");
    }
    if flags.contains(CharPropFlags::NOTIFY) {
        out.push("notify");
    }
    if flags.contains(CharPropFlags::INDICATE) {
        out.push("indicate");
    }
    out
}

fn characteristic(p: &Peripheral, service: &str, uuid: &str) -> Result<Characteristic, String> {
    let s = Uuid::parse_str(service).map_err(|e| e.to_string())?;
    let c = Uuid::parse_str(uuid).map_err(|e| e.to_string())?;
    p.characteristics()
        .into_iter()
        .find(|ch| ch.uuid == c && ch.service_uuid == s)
        .ok_or_else(|| format!("Characteristic {uuid} not found"))
}

#[tauri::command]
pub async fn ble_available(app: AppHandle, ble: State<'_, Ble>) -> Result<Availability, String> {
    Ok(match ble.adapter(&app).await {
        Ok(_) => Availability { available: true, reason: None },
        Err(e) => Availability { available: false, reason: Some(e) },
    })
}

/// Starts listening for advertisements (ble:advert events). Scans nest: each start needs a stop.
#[tauri::command]
pub async fn ble_scan(app: AppHandle, ble: State<'_, Ble>) -> Result<(), String> {
    let adapter = ble.adapter(&app).await?;
    let mut n = ble.scanning.lock().await;
    if *n == 0 {
        adapter.start_scan(ScanFilter::default()).await.map_err(|e| e.to_string())?;
    }
    *n += 1;
    Ok(())
}

#[tauri::command]
pub async fn ble_stop_scan(app: AppHandle, ble: State<'_, Ble>) -> Result<(), String> {
    let adapter = ble.adapter(&app).await?;
    let mut n = ble.scanning.lock().await;
    if *n > 0 {
        *n -= 1;
        if *n == 0 {
            adapter.stop_scan().await.map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn ble_connect(app: AppHandle, ble: State<'_, Ble>, id: String) -> Result<Vec<ServiceInfo>, String> {
    let p = ble.find(&app, &id, Duration::from_secs(8)).await?;
    let lock = ble.lock_for(&id).await;
    let _guard = lock.lock().await;
    if !p.is_connected().await.unwrap_or(false) {
        tokio::time::timeout(Duration::from_secs(12), p.connect())
            .await
            .map_err(|_| "Timed out connecting".to_string())?
            .map_err(|e| e.to_string())?;
    }
    p.discover_services().await.map_err(|e| e.to_string())?;
    // One task per device forwards its notifications for as long as it's connected.
    let mut listening = ble.listening.lock().await;
    if let Some(old) = listening.remove(&id) {
        old.abort();
    }
    let stream = p.notifications().await.map_err(|e| e.to_string())?;
    let app2 = app.clone();
    let id2 = id.clone();
    let chars = p.characteristics();
    listening.insert(
        id.clone(),
        tokio::spawn(async move {
            let mut stream = stream;
            while let Some(n) = stream.next().await {
                let service = chars.iter().find(|c| c.uuid == n.uuid).map(|c| c.service_uuid.to_string()).unwrap_or_default();
                let _ = app2.emit("ble:notify", Notification { id: id2.clone(), service, characteristic: n.uuid.to_string(), value: n.value });
            }
        }),
    );
    Ok(p
        .services()
        .into_iter()
        .map(|s| ServiceInfo {
            uuid: s.uuid.to_string(),
            characteristics: s.characteristics.into_iter().map(|c| CharInfo { uuid: c.uuid.to_string(), properties: props(c.properties) }).collect(),
        })
        .collect())
}

#[tauri::command]
pub async fn ble_disconnect(app: AppHandle, ble: State<'_, Ble>, id: String) -> Result<(), String> {
    if let Some(task) = ble.listening.lock().await.remove(&id) {
        task.abort();
    }
    if let Ok(p) = ble.find(&app, &id, Duration::from_millis(0)).await {
        let _ = p.disconnect().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn ble_subscribe(app: AppHandle, ble: State<'_, Ble>, id: String, service: String, characteristic: String, on: bool) -> Result<(), String> {
    let p = ble.find(&app, &id, Duration::from_millis(0)).await?;
    let c = self::characteristic(&p, &service, &characteristic)?;
    let lock = ble.lock_for(&id).await;
    let _guard = lock.lock().await;
    if on {
        p.subscribe(&c).await.map_err(|e| e.to_string())
    } else {
        p.unsubscribe(&c).await.map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn ble_write(app: AppHandle, ble: State<'_, Ble>, id: String, service: String, characteristic: String, value: Vec<u8>, with_response: bool) -> Result<(), String> {
    let p = ble.find(&app, &id, Duration::from_millis(0)).await?;
    let c = self::characteristic(&p, &service, &characteristic)?;
    let lock = ble.lock_for(&id).await;
    let _guard = lock.lock().await;
    let kind = if with_response { WriteType::WithResponse } else { WriteType::WithoutResponse };
    tokio::time::timeout(Duration::from_secs(8), p.write(&c, &value, kind))
        .await
        .map_err(|_| "Timed out writing".to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ble_read(app: AppHandle, ble: State<'_, Ble>, id: String, service: String, characteristic: String) -> Result<Vec<u8>, String> {
    let p = ble.find(&app, &id, Duration::from_millis(0)).await?;
    let c = self::characteristic(&p, &service, &characteristic)?;
    let lock = ble.lock_for(&id).await;
    let _guard = lock.lock().await;
    p.read(&c).await.map_err(|e| e.to_string())
}

/// Whether the OS still holds a connection to this device.
#[tauri::command]
pub async fn ble_is_connected(app: AppHandle, ble: State<'_, Ble>, id: String) -> Result<bool, String> {
    match ble.find(&app, &id, Duration::from_millis(0)).await {
        Ok(p) => Ok(p.is_connected().await.unwrap_or(false)),
        Err(_) => Ok(false),
    }
}
