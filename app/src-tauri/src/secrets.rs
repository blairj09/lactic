// API keys (AI providers, intervals.icu) live in the system keychain: macOS Keychain, Windows
// Credential Manager or the Linux Secret Service. The web layer can save and delete a key and ask
// whether one is set, but never reads it back: requests that need a key go through net.rs, which
// adds it on the way out. Where no keychain is available (some Linux setups) a file readable only
// by the user stands in.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

const SERVICE: &str = "fit.lactic.app";

pub struct Secrets {
    fallback: PathBuf,
    cache: Mutex<HashMap<String, String>>,
}

impl Secrets {
    pub fn new(data_dir: PathBuf) -> Self {
        Secrets { fallback: data_dir.join("secrets.json"), cache: Mutex::new(HashMap::new()) }
    }

    fn read_fallback(&self) -> HashMap<String, String> {
        std::fs::read_to_string(&self.fallback)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn write_fallback(&self, all: &HashMap<String, String>) -> Result<(), String> {
        let text = serde_json::to_string(all).map_err(|e| e.to_string())?;
        std::fs::write(&self.fallback, text).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&self.fallback, std::fs::Permissions::from_mode(0o600));
        }
        Ok(())
    }

    pub fn get(&self, name: &str) -> Option<String> {
        if let Some(v) = self.cache.lock().ok()?.get(name) {
            return Some(v.clone());
        }
        let value = keyring::Entry::new(SERVICE, name)
            .ok()
            .and_then(|e| e.get_password().ok())
            .or_else(|| self.read_fallback().get(name).cloned())?;
        if let Ok(mut c) = self.cache.lock() {
            c.insert(name.to_string(), value.clone());
        }
        Some(value)
    }

    pub fn set(&self, name: &str, value: &str) -> Result<(), String> {
        let stored = keyring::Entry::new(SERVICE, name).and_then(|e| e.set_password(value));
        if stored.is_err() {
            let mut all = self.read_fallback();
            all.insert(name.to_string(), value.to_string());
            self.write_fallback(&all)?;
        }
        if let Ok(mut c) = self.cache.lock() {
            c.insert(name.to_string(), value.to_string());
        }
        Ok(())
    }

    pub fn delete(&self, name: &str) -> Result<(), String> {
        if let Ok(e) = keyring::Entry::new(SERVICE, name) {
            let _ = e.delete_credential();
        }
        let mut all = self.read_fallback();
        if all.remove(name).is_some() {
            self.write_fallback(&all)?;
        }
        if let Ok(mut c) = self.cache.lock() {
            c.remove(name);
        }
        Ok(())
    }
}

#[tauri::command]
pub fn secret_set(secrets: State<Secrets>, name: String, value: String) -> Result<(), String> {
    secrets.set(&name, &value)
}

#[tauri::command]
pub fn secret_delete(secrets: State<Secrets>, name: String) -> Result<(), String> {
    secrets.delete(&name)
}

/// Whether a key is saved, and its last four characters so Settings can show which one.
#[tauri::command]
pub fn secret_status(secrets: State<Secrets>, name: String) -> Option<String> {
    secrets.get(&name).map(|v| {
        let tail: String = v.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
        format!("…{tail}")
    })
}
