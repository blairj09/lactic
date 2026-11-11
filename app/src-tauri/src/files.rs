// Files the app reads and writes outside its database: the Apple Health drop folder (the iPhone
// Shortcut saves a file to iCloud Drive and the app imports it), FIT and .zwo files, backups.

use base64::Engine;
use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    name: String,
    path: String,
    modified_ms: u64,
    size: u64,
    is_dir: bool,
}

fn expand(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}

// --- where the web layer may read and write -----------------------------------------------------------
// The screens only need the rider's own documents: the Apple Health folder (iCloud Drive or a
// folder they chose), the places they save exports and backups, and the app's data folder. So
// that a script that got into the window couldn't read an SSH key or a browser profile, or write
// a startup file, these commands refuse the parts of the computer that hold settings and
// credentials: hidden folders, the Library (apart from iCloud Drive), AppData, and anything
// outside the home folder that isn't a temporary folder or a plugged-in drive. The iPhone app is
// already confined to its own container by iOS.

static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Called once at startup with the app's data folder.
pub fn set_data_dir(dir: &Path) {
    let _ = DATA_DIR.set(resolve(dir));
}

/// Files in the data folder that hold secrets of Rust's own (the keychain stand-in, the MCP token).
const PRIVATE_FILES: &[&str] = &["secrets.json", "mcp.json"];

/// The path with `..` worked out and links followed as far as the path exists.
fn resolve(path: &Path) -> PathBuf {
    let mut clean = PathBuf::new();
    for part in path.components() {
        match part {
            Component::ParentDir => {
                clean.pop();
            }
            Component::CurDir => {}
            other => clean.push(other.as_os_str()),
        }
    }
    // Follow links on the longest part that exists, and keep the rest (a file about to be made).
    let mut rest: Vec<std::ffi::OsString> = vec![];
    let mut at = clean.clone();
    loop {
        if let Ok(real) = std::fs::canonicalize(&at) {
            let mut out = real;
            for name in rest.iter().rev() {
                out.push(name);
            }
            return out;
        }
        match (at.parent().map(Path::to_path_buf), at.file_name().map(|n| n.to_os_string())) {
            (Some(parent), Some(name)) => {
                rest.push(name);
                at = parent;
            }
            _ => return clean,
        }
    }
}

fn refuse(path: &Path) -> String {
    format!("Lactic doesn't open files in {}. Pick a folder in your home folder, iCloud Drive or a plugged-in drive.", path.display())
}

/// Whether `path` (already resolved) is somewhere the screens may use, given the home folder,
/// the data folder and the temporary folders.
fn allowed(path: &Path, home: Option<&Path>, data: Option<&Path>, temps: &[PathBuf]) -> bool {
    if let Some(data) = data {
        if let Ok(inside) = path.strip_prefix(data) {
            return !PRIVATE_FILES.iter().any(|f| inside == Path::new(f));
        }
    }
    if temps.iter().any(|t| path.starts_with(t)) {
        return true;
    }
    if let Some(inside) = home.and_then(|h| path.strip_prefix(h).ok()) {
        let parts: Vec<String> = inside.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
        if parts.iter().any(|p| p.starts_with('.')) {
            return false;
        }
        return match parts.first().map(String::as_str) {
            // iCloud Drive lives in the Library; nothing else there is the rider's documents.
            Some("Library") => parts.get(1).map(String::as_str) == Some("Mobile Documents"),
            Some(first) if first.eq_ignore_ascii_case("AppData") => false,
            _ => true,
        };
    }
    // Outside the home folder: plugged-in and network drives only.
    if cfg!(windows) {
        // After the drive letter ("\\?\D:\Backups" → "\backups"): not Windows' own folders or
        // another person's home.
        let lower = path.to_string_lossy().to_ascii_lowercase();
        let rest = lower.split_once(':').map(|(_, r)| r).unwrap_or(&lower);
        return ![r"\windows", r"\program files", r"\programdata", r"\users"].iter().any(|s| rest.starts_with(s));
    }
    ["/Volumes", "/media", "/mnt", "/run/media"].iter().any(|root| path.starts_with(root) && path != Path::new(root))
}

/// The real path for `path`, or why the screens can't use it.
pub fn guard(path: &str) -> Result<PathBuf, String> {
    let raw = expand(path);
    if cfg!(mobile) {
        return Ok(raw);
    }
    if !raw.is_absolute() {
        return Err(refuse(&raw));
    }
    let real = resolve(&raw);
    let home = dirs::home_dir().map(|h| resolve(&h));
    let mut temps = vec![resolve(&std::env::temp_dir())];
    if cfg!(unix) {
        temps.push(resolve(Path::new("/tmp")));
    }
    if allowed(&real, home.as_deref(), DATA_DIR.get().map(PathBuf::as_path), &temps) {
        Ok(real)
    } else {
        Err(refuse(&real))
    }
}

#[tauri::command(async)]
pub fn folder_list(path: String) -> Result<Vec<Entry>, String> {
    let dir = guard(&path)?;
    let mut out = vec![];
    for entry in std::fs::read_dir(&dir).map_err(|e| format!("{}: {e}", dir.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        let modified_ms = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
        out.push(Entry { name: entry.file_name().to_string_lossy().into_owned(), path: entry.path().to_string_lossy().into_owned(), modified_ms, size: meta.len(), is_dir: meta.is_dir() });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[tauri::command(async)]
pub fn folder_ensure(path: String) -> Result<String, String> {
    let dir = guard(&path)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // As the rider wrote it (not with links followed), so a saved folder keeps its familiar path.
    Ok(expand(&path).to_string_lossy().into_owned())
}

#[tauri::command(async)]
pub fn file_read_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(guard(&path)?).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn file_read_base64(path: String) -> Result<String, String> {
    let bytes = std::fs::read(guard(&path)?).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command(async)]
pub fn file_write_text(path: String, text: String) -> Result<(), String> {
    std::fs::write(guard(&path)?, text).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn file_write_base64(path: String, data: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| e.to_string())?;
    std::fs::write(guard(&path)?, bytes).map_err(|e| e.to_string())
}

/// Moves a file into a folder (made if needed), e.g. an imported Health file into "Imported".
#[tauri::command(async)]
pub fn file_move_into(path: String, folder: String) -> Result<String, String> {
    let from = guard(&path)?;
    let dir = guard(&folder)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = from.file_name().ok_or("No file name")?;
    let to = dir.join(name);
    std::fs::rename(&from, &to).or_else(|_| std::fs::copy(&from, &to).and_then(|_| std::fs::remove_file(&from))).map_err(|e| e.to_string())?;
    Ok(to.to_string_lossy().into_owned())
}

/// Where iCloud Drive lives on this computer, if it's turned on: the Mac's own, or iCloud for
/// Windows. Linux has none; the rider picks a synced folder instead.
#[tauri::command]
pub fn icloud_drive() -> Option<String> {
    let home = dirs::home_dir()?;
    let p = if cfg!(target_os = "macos") {
        home.join("Library/Mobile Documents/com~apple~CloudDocs")
    } else if cfg!(target_os = "windows") {
        home.join("iCloudDrive")
    } else {
        return None;
    };
    p.is_dir().then(|| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn home_dir() -> Option<String> {
    dirs::home_dir().map(|p| p.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn the_screens_reach_documents_but_not_settings_or_credentials() {
        let home = Path::new("/Users/sam");
        let data = Path::new("/Users/sam/Library/Application Support/fit.lactic.app");
        let temps = vec![PathBuf::from("/private/tmp")];
        let ok = |p: &str| allowed(Path::new(p), Some(home), Some(data), &temps);
        assert!(ok("/Users/sam/Documents/Lactic backup.db"));
        assert!(ok("/Users/sam/Library/Mobile Documents/com~apple~CloudDocs/Lactic/Health/2026-11-10.json"));
        assert!(ok("/Users/sam/Library/Application Support/fit.lactic.app/lactic-to-computer.db"));
        assert!(ok("/Volumes/Backup/lactic.db"));
        assert!(ok("/private/tmp/ride.fit"));
        assert!(!ok("/Users/sam/.ssh/id_ed25519"));
        assert!(!ok("/Users/sam/.zshrc"));
        assert!(!ok("/Users/sam/Documents/.hidden/x"));
        assert!(!ok("/Users/sam/Library/LaunchAgents/evil.plist"));
        assert!(!ok("/Users/sam/Library/Application Support/Claude/claude_desktop_config.json"));
        assert!(!ok("/Users/sam/Library/Application Support/fit.lactic.app/secrets.json"));
        assert!(!ok("/Users/sam/Library/Application Support/fit.lactic.app/mcp.json"));
        assert!(!ok("/etc/passwd"));
        assert!(!ok("/Volumes"));
        assert!(!ok("/Users/other/Documents/x"));
    }

    #[cfg(unix)]
    #[test]
    fn dot_dot_and_links_dont_get_around_it() {
        let dir = std::env::temp_dir().join(format!("lactic-files-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("docs")).unwrap();
        std::fs::create_dir_all(dir.join("secret")).unwrap();
        std::os::unix::fs::symlink(dir.join("secret"), dir.join("docs/link")).unwrap();
        let real = resolve(&dir);
        assert_eq!(resolve(&dir.join("docs/../secret/key")), real.join("secret/key"));
        assert_eq!(resolve(&dir.join("docs/link/key")), real.join("secret/key"));
        assert_eq!(resolve(&dir.join("docs/new/file.txt")), real.join("docs/new/file.txt"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
