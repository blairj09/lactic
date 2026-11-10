//! Lactic's iPhone side. The work is all in Swift (ios/Sources): reading Apple Health (and waking
//! in the background when new sleep or HRV arrives), writing rides to Health as workouts, keeping
//! the pairing key in the iOS keychain, and sealing requests to the paired computer. The web layer
//! calls it directly (`plugin:lactic-phone|<command>`), so there's no Rust in between.

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
            Ok(())
        })
        .build()
}
