// Files the app reads and writes outside its database: the Apple Health drop folder (the iPhone
// Shortcut saves a file to iCloud Drive and the app imports it), FIT and .zwo files, backups.

use base64::Engine;
use serde::Serialize;
use std::path::PathBuf;

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

#[tauri::command]
pub fn folder_list(path: String) -> Result<Vec<Entry>, String> {
    let dir = expand(&path);
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

#[tauri::command]
pub fn folder_ensure(path: String) -> Result<String, String> {
    let dir = expand(&path);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn file_read_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(expand(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn file_read_base64(path: String) -> Result<String, String> {
    let bytes = std::fs::read(expand(&path)).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
pub fn file_write_text(path: String, text: String) -> Result<(), String> {
    std::fs::write(expand(&path), text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn file_write_base64(path: String, data: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| e.to_string())?;
    std::fs::write(expand(&path), bytes).map_err(|e| e.to_string())
}

/// Moves a file into a folder (made if needed), e.g. an imported Health file into "Imported".
#[tauri::command]
pub fn file_move_into(path: String, folder: String) -> Result<String, String> {
    let from = expand(&path);
    let dir = expand(&folder);
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
