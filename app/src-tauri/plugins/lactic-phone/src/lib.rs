//! Lactic's phone side. The work is all native: Swift on the iPhone (ios/Sources), Kotlin on
//! Android (android/src). Reading Apple Health or Health Connect (and waking in the background when
//! new sleep or HRV arrives), writing rides there as workouts, keeping the pairing key in the
//! phone's keystore, and sealing requests to the paired computer. On Android it also does
//! Bluetooth. The web layer calls it directly (`plugin:lactic-phone|<command>`), so there's no Rust
//! in between.

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
            _api.register_android_plugin("fit.lactic.phone", "LacticPhonePlugin")?;
            Ok(())
        })
        .build()
}
