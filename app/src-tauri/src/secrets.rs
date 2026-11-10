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

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

/// The keychain item (account) that holds every key.
const BUNDLE: &str = "keys";
/// Keys that follow the rider to a paired iPhone (and back): the coach's AI key and the
/// intervals.icu key. The phone's pairing keys stay on their own computer, and Strava's sign-in
/// stays with the computer that runs the Strava uploads (two devices refreshing one sign-in would
/// sign each other out).
pub const SYNCED: &[&str] = &["ai", "intervals"];
/// Inside the bundle: when each synced key was last saved or deleted here (ms since 1970), so a
/// paired phone and computer can tell whose copy is newer. Not a valid key name, so no clash.
const STAMPS: &str = "~at";

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
            stamp(all, name, now_ms());
            self.save(all)
        })
        .unwrap_or_else(|| Err(REFUSED.into()))
    }

    pub fn delete(&self, name: &str) -> Result<(), String> {
        self.with_all(true, |all| {
            let had = all.remove(name).is_some();
            if SYNCED.contains(&name) {
                // Remembered as deleted, so the paired device deletes its copy too.
                stamp(all, name, now_ms());
            } else if !had {
                return Ok(());
            }
            self.save(all)
        })
        .unwrap_or_else(|| Err(REFUSED.into()))
    }

    // --- following a paired phone ------------------------------------------------------------------

    /// Each synced key's stamp and whether it's saved here. None when the keychain refused.
    pub fn states(&self) -> Option<HashMap<String, KeyState>> {
        self.with_all(false, |all| states_of(all))
    }

    /// The computer, before answering a phone: keys saved before stamps existed get one now, so
    /// the phone takes the computer's copy (the computer is the source of truth).
    pub fn stamp_unstamped(&self) -> Result<(), String> {
        self.with_all(false, |all| {
            let now = now_ms();
            let mut changed = false;
            for name in SYNCED {
                if all.contains_key(*name) && stamp_of(all, name) == 0 {
                    stamp(all, name, now);
                    changed = true;
                }
            }
            if changed { self.save(all) } else { Ok(()) }
        })
        .unwrap_or_else(|| Err(REFUSED.into()))
    }

    /// The saved value (or its deletion) of these synced keys, with their stamps.
    pub fn values(&self, names: &[String]) -> Option<HashMap<String, KeyValue>> {
        self.with_all(false, |all| {
            names
                .iter()
                .filter(|n| SYNCED.contains(&n.as_str()))
                .map(|n| (n.clone(), KeyValue { at: stamp_of(all, n), value: all.get(n).cloned() }))
                .collect()
        })
    }

    /// Takes the other device's copies that are newer than this one's (`or_equal`: the phone also
    /// takes a copy stamped the same, which is the computer's to give). Returns how many changed.
    pub fn receive(&self, incoming: &HashMap<String, KeyValue>, or_equal: bool) -> Result<usize, String> {
        if incoming.is_empty() {
            return Ok(0);
        }
        self.with_all(true, |all| {
            let mut n = 0;
            for (name, kv) in incoming {
                if !SYNCED.contains(&name.as_str()) {
                    continue;
                }
                let here = stamp_of(all, name);
                if kv.at < here || (kv.at == here && !or_equal) {
                    continue;
                }
                match &kv.value {
                    Some(v) if !v.is_empty() => all.insert(name.clone(), v.clone()),
                    _ => all.remove(name),
                };
                stamp(all, name, kv.at);
                n += 1;
            }
            if n > 0 { self.save(all).map(|_| n) } else { Ok(0) }
        })
        .unwrap_or_else(|| Err(REFUSED.into()))
    }
}

const REFUSED: &str = "Couldn't open the keychain. Unlock it, choose Allow, and try again.";

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn stamps(all: &HashMap<String, String>) -> HashMap<String, i64> {
    all.get(STAMPS).and_then(|s| serde_json::from_str(s).ok()).unwrap_or_default()
}

fn stamp_of(all: &HashMap<String, String>, name: &str) -> i64 {
    stamps(all).get(name).copied().unwrap_or(0)
}

fn stamp(all: &mut HashMap<String, String>, name: &str, at: i64) {
    if !SYNCED.contains(&name) {
        return;
    }
    let mut s = stamps(all);
    s.insert(name.to_string(), at);
    all.insert(STAMPS.to_string(), serde_json::to_string(&s).unwrap_or_default());
}

fn states_of(all: &HashMap<String, String>) -> HashMap<String, KeyState> {
    SYNCED.iter().map(|n| (n.to_string(), KeyState { at: stamp_of(all, n), set: all.contains_key(*n) })).collect()
}

/// One synced key on one device: when it was last saved or deleted, and whether it's saved now.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Default)]
pub struct KeyState {
    pub at: i64,
    pub set: bool,
}

/// A synced key's value (None: deleted) and stamp, as it travels inside the sealed link.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct KeyValue {
    pub at: i64,
    pub value: Option<String>,
}

/// The computer's side: which of its keys the phone should take, and which of the phone's it
/// wants. The newer stamp wins; on a tie the device that has the key gives it.
pub fn plan(mine: &HashMap<String, KeyState>, theirs: &HashMap<String, KeyState>) -> (Vec<String>, Vec<String>) {
    let mut give = vec![];
    let mut want = vec![];
    for name in SYNCED {
        let m = mine.get(*name).copied().unwrap_or_default();
        let t = theirs.get(*name).copied().unwrap_or_default();
        if m.at > t.at || (m.at == t.at && m.set && !t.set) {
            give.push(name.to_string());
        } else if t.at > m.at || (t.at == m.at && t.set && !m.set) {
            want.push(name.to_string());
        }
    }
    (give, want)
}

#[tauri::command]
pub fn secret_set(secrets: State<Secrets>, name: String, value: String) -> Result<(), String> {
    if name == STAMPS {
        return Err("Not a key name".into());
    }
    secrets.set(&name, &value)
}

#[tauri::command]
pub fn secret_delete(secrets: State<Secrets>, name: String) -> Result<(), String> {
    if name == STAMPS {
        return Err("Not a key name".into());
    }
    secrets.delete(&name)
}

/// Whether a key is saved, and its last four characters so Settings can show which one.
#[tauri::command]
pub fn secret_status(secrets: State<Secrets>, name: String) -> Option<String> {
    if name == STAMPS {
        return None;
    }
    secrets.get(&name).map(|v| {
        let tail: String = v.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
        format!("…{tail}")
    })
}

// --- the iPhone's side of key sync ------------------------------------------------------------------
// The phone carries keys to and from its computer inside the sealed link (phone.rs, kind "keys").
// The link runs in the phone's Swift plugin, so these hand values to the phone's web layer for the
// moment it takes to pass them on. They only work on the iPhone: on a computer the web layer never
// sees a key.

const PHONE_ONLY: &str = "Only the iPhone app syncs keys this way";

/// The phone: each synced key's stamp, to send with a "keys" request.
#[tauri::command]
pub fn secrets_offer(secrets: State<Secrets>) -> Result<HashMap<String, KeyState>, String> {
    if !cfg!(target_os = "ios") {
        return Err(PHONE_ONLY.into());
    }
    secrets.states().ok_or_else(|| REFUSED.into())
}

/// The phone: the keys the computer asked for.
#[tauri::command]
pub fn secrets_give(secrets: State<Secrets>, names: Vec<String>) -> Result<HashMap<String, KeyValue>, String> {
    if !cfg!(target_os = "ios") {
        return Err(PHONE_ONLY.into());
    }
    secrets.values(&names).ok_or_else(|| REFUSED.into())
}

/// The phone: keys the computer sent. Returns how many changed here.
#[tauri::command]
pub fn secrets_take(secrets: State<Secrets>, take: HashMap<String, KeyValue>) -> Result<usize, String> {
    if !cfg!(target_os = "ios") {
        return Err(PHONE_ONLY.into());
    }
    secrets.receive(&take, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn st(at: i64, set: bool) -> KeyState {
        KeyState { at, set }
    }

    fn map(items: &[(&str, KeyState)]) -> HashMap<String, KeyState> {
        items.iter().map(|(n, s)| (n.to_string(), *s)).collect()
    }

    #[test]
    fn the_newer_copy_wins_each_way() {
        let mac = map(&[("ai", st(200, true)), ("intervals", st(100, true))]);
        let phone = map(&[("ai", st(100, true)), ("intervals", st(300, false))]);
        let (give, want) = plan(&mac, &phone);
        assert_eq!(give, vec!["ai"]);
        assert_eq!(want, vec!["intervals"]);
    }

    #[test]
    fn a_new_phone_gets_every_key_and_matching_ones_stay_put() {
        let mac = map(&[("ai", st(5, true)), ("intervals", st(7, true))]);
        let (give, want) = plan(&mac, &HashMap::new());
        assert_eq!(give, vec!["ai", "intervals"]);
        assert!(want.is_empty());
        let (give, want) = plan(&mac, &mac);
        assert!(give.is_empty() && want.is_empty());
    }

    #[test]
    fn an_unstamped_key_only_the_phone_has_comes_to_the_computer() {
        let phone = map(&[("ai", st(0, true))]);
        let (give, want) = plan(&HashMap::new(), &phone);
        assert!(give.is_empty());
        assert_eq!(want, vec!["ai"]);
    }

    #[test]
    fn stamps_ride_along_in_the_bundle_and_only_for_synced_keys() {
        let mut all = HashMap::new();
        all.insert("ai".to_string(), "sk-1".to_string());
        stamp(&mut all, "ai", 42);
        stamp(&mut all, "phone:abc", 43);
        assert_eq!(stamp_of(&all, "ai"), 42);
        assert_eq!(stamp_of(&all, "phone:abc"), 0);
        let s = states_of(&all);
        assert_eq!(s["ai"], st(42, true));
        assert_eq!(s["intervals"], st(0, false));
        assert!(!s.contains_key("phone:abc") && !s.contains_key(STAMPS));
    }
}
