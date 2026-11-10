// API keys (AI providers, intervals.icu) live in the system keychain: macOS Keychain, Windows
// Credential Manager or the Linux Secret Service (the iPhone's keychain on iOS). The web layer can save and delete a key and ask
// whether one is set, but never reads it back: requests that need a key go through net.rs, which
// adds it on the way out. Where no keychain is available (some Linux setups) a file readable only
// by the user stands in.
//
// All keys share ONE keychain item (a small JSON map), read once per run and kept in memory. On a
// Mac every keychain item has its own access list, so one item means at most one "Lactic wants to
// use your confidential information" prompt per app build instead of one per key, and none after
// that until the app is rebuilt. Builds signed ad hoc (no Developer ID yet) look like a new app
// to the keychain after every update, so the prompt comes back once per update until Lactic is
// signed with a Developer ID, which keeps "Always Allow" across updates.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

/// The keychain item (account) that holds every key.
const BUNDLE: &str = "keys";
/// Keys saved one item each by v0.1.4 and earlier, moved into the bundle on first read.
const LEGACY: &[&str] = &["ai", "intervals"];

enum Loaded {
    /// Not read from the keychain yet this run.
    No,
    /// Read (or found empty).
    Yes(HashMap<String, String>),
    /// The keychain refused (locked, or the rider chose Deny). Not asked again this run unless a
    /// key is saved, so a "Deny" doesn't turn into a stream of prompts.
    Refused,
}

pub struct Secrets {
    fallback: PathBuf,
    state: Mutex<Loaded>,
}

fn entry(account: &str) -> Option<keyring::Entry> {
    // Android has no keychain the keyring crate can reach (it would keep keys in memory only), so
    // the file stands in: it lives in the app's private storage, which no other app can read, and
    // the app opts out of Android's cloud backups.
    if cfg!(target_os = "android") {
        return None;
    }
    // The service is the bundle identifier, so Lactic Preview keeps its own keys.
    keyring::Entry::new(crate::identifier(), account).ok()
}

impl Secrets {
    pub fn new(data_dir: PathBuf) -> Self {
        Secrets { fallback: data_dir.join("secrets.json"), state: Mutex::new(Loaded::No) }
    }

    fn read_fallback(&self) -> HashMap<String, String> {
        std::fs::read_to_string(&self.fallback)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn write_fallback(&self, all: &HashMap<String, String>) -> Result<(), String> {
        if all.is_empty() {
            let _ = std::fs::remove_file(&self.fallback);
            return Ok(());
        }
        let text = serde_json::to_string(all).map_err(|e| e.to_string())?;
        std::fs::write(&self.fallback, text).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&self.fallback, std::fs::Permissions::from_mode(0o600));
        }
        Ok(())
    }

    /// Reads the one keychain item. Ok(None) when there is no keychain or no item yet.
    fn read_keychain() -> Result<Option<HashMap<String, String>>, ()> {
        let Some(e) = entry(BUNDLE) else { return Ok(None) };
        match e.get_password() {
            Ok(text) => Ok(Some(serde_json::from_str(&text).unwrap_or_default())),
            Err(keyring::Error::NoEntry) => Ok(None),
            // A Mac keychain that is locked or was refused: say so rather than lose the keys.
            Err(_) if cfg!(target_os = "macos") => Err(()),
            // No usable keychain (some Linux setups): the file stands in.
            Err(_) => Ok(None),
        }
    }

    /// One-time move from one item per key to the shared item.
    fn take_legacy() -> HashMap<String, String> {
        let mut found = HashMap::new();
        for name in LEGACY {
            if let Some(e) = entry(name) {
                if let Ok(v) = e.get_password() {
                    found.insert(name.to_string(), v);
                    let _ = e.delete_credential();
                }
            }
        }
        found
    }

    fn write_keychain(all: &HashMap<String, String>) -> bool {
        let Some(e) = entry(BUNDLE) else { return false };
        if all.is_empty() {
            return matches!(e.delete_credential(), Ok(()) | Err(keyring::Error::NoEntry));
        }
        let Ok(text) = serde_json::to_string(all) else { return false };
        e.set_password(&text).is_ok()
    }

    /// Every saved key, reading the keychain the first time only. The lock is held while reading
    /// so two requests at once can't each raise a prompt.
    fn with_all<T>(&self, retry_refused: bool, f: impl FnOnce(&mut HashMap<String, String>) -> T) -> Option<T> {
        let mut state = self.state.lock().ok()?;
        let reload = match &*state {
            Loaded::No => true,
            Loaded::Refused => retry_refused,
            Loaded::Yes(_) => false,
        };
        if reload {
            *state = match Self::read_keychain() {
                Ok(Some(mut all)) => {
                    for (k, v) in self.read_fallback() {
                        all.entry(k).or_insert(v);
                    }
                    Loaded::Yes(all)
                }
                Ok(None) => {
                    let mut all = self.read_fallback();
                    let legacy = Self::take_legacy();
                    if !legacy.is_empty() {
                        all.extend(legacy);
                        if Self::write_keychain(&all) {
                            let _ = self.write_fallback(&HashMap::new());
                        } else {
                            let _ = self.write_fallback(&all);
                        }
                    }
                    Loaded::Yes(all)
                }
                Err(()) => Loaded::Refused,
            };
        }
        match &mut *state {
            Loaded::Yes(all) => Some(f(all)),
            _ => None,
        }
    }

    pub fn get(&self, name: &str) -> Option<String> {
        self.with_all(false, |all| all.get(name).cloned()).flatten()
    }

    fn save(&self, all: &HashMap<String, String>) -> Result<(), String> {
        if Self::write_keychain(all) {
            self.write_fallback(&HashMap::new())
        } else {
            self.write_fallback(all)
        }
    }

    pub fn set(&self, name: &str, value: &str) -> Result<(), String> {
        self.with_all(true, |all| {
            all.insert(name.to_string(), value.to_string());
            self.save(all)
        })
        .unwrap_or_else(|| Err("Couldn't open the keychain. Unlock it, choose Allow, and try again.".into()))
    }

    pub fn delete(&self, name: &str) -> Result<(), String> {
        self.with_all(true, |all| {
            if all.remove(name).is_some() {
                self.save(all)
            } else {
                Ok(())
            }
        })
        .unwrap_or_else(|| Err("Couldn't open the keychain. Unlock it, choose Allow, and try again.".into()))
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
