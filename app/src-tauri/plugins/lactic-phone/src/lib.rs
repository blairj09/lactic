//! Lactic's phone side. The work is all native: Swift on the iPhone (ios/Sources), Kotlin on
//! Android (android/src). Reading Apple Health or Health Connect (and waking in the background when
//! new sleep or HRV arrives), writing rides there as workouts, keeping the pairing key in the
//! phone's keystore, and sealing requests to the paired computer. On Android it also does
//! Bluetooth. The web layer calls it directly (`plugin:lactic-phone|<command>`), so there's no Rust
//! in between. One exception: on Android the core's secrets.rs keeps the rider's API keys through
//! `keys_read` / `keys_write`, which only Rust can reach (the commands have no permission, so the
//! web layer can't read a key back).

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_lactic_phone);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("lactic-phone")
        .setup(|_app, _api| {
            #[cfg(target_os = "ios")]
            _api.register_ios_plugin(init_plugin_lactic_phone)?;
            #[cfg(target_os = "android")]
            {
                let handle = _api.register_android_plugin("fit.lactic.phone", "LacticPhonePlugin")?;
                let _ = android::NATIVE.set(Box::new(move |command, payload| {
                    handle.run_mobile_plugin::<serde_json::Value>(command, payload).map_err(|e| e.to_string())
                }));
            }
            Ok(())
        })
        .build()
}

#[cfg(target_os = "android")]
mod android {
    use std::sync::OnceLock;

    type Run = Box<dyn Fn(&str, serde_json::Value) -> Result<serde_json::Value, String> + Send + Sync>;
    /// Calls a Kotlin command and waits for its answer. Kotlin answers on Android's main thread,
    /// so this must never be called from it (every caller is an async command).
    pub static NATIVE: OnceLock<Run> = OnceLock::new();

    pub fn run(command: &str, payload: serde_json::Value) -> Result<serde_json::Value, String> {
        NATIVE.get().ok_or_else(|| "The phone plugin isn't ready yet".to_string())?(command, payload)
    }
}

/// Android: the rider's API keys (secrets.rs's JSON map), kept encrypted under an Android
/// Keystore key (Keys.kt). None when nothing is saved yet.
#[cfg(target_os = "android")]
pub fn keys_read() -> Result<Option<String>, String> {
    let reply = android::run("keysRead", serde_json::json!({}))?;
    Ok(reply.get("text").and_then(|t| t.as_str()).map(str::to_string))
}

/// Android: saves the keys' JSON map (None: deletes it).
#[cfg(target_os = "android")]
pub fn keys_write(text: Option<&str>) -> Result<(), String> {
    android::run("keysWrite", serde_json::json!({ "text": text })).map(|_| ())
}
