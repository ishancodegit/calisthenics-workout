//! Small files in the app config directory.
//!
//! Three things outlive a launch — the folders you granted, your Google
//! sign-in, and your settings — and all three were growing their own copy of
//! "work out the path, write it, chmod it". This is that, once.

use serde::de::DeserializeOwned;
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn path_for(app: &AppHandle, name: &str) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join(name))
}

/// Read a file, or the type's default if it's missing or unreadable. Config
/// that fails to parse must never stop the app starting — the person would
/// have no way to fix it.
pub fn read<T: DeserializeOwned + Default>(app: &AppHandle, name: &str) -> T {
    path_for(app, name)
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Write owner-only. Two of these files hold credentials; the third doesn't,
/// but there's no reason for anyone else on the machine to read it either.
pub fn write<T: Serialize>(app: &AppHandle, name: &str, value: &T) {
    let Some(path) = path_for(app, name) else {
        return;
    };
    let Ok(json) = serde_json::to_string_pretty(value) else {
        return;
    };
    if std::fs::write(&path, json).is_err() {
        return;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
}

pub fn remove(app: &AppHandle, name: &str) {
    if let Some(path) = path_for(app, name) {
        let _ = std::fs::remove_file(path);
    }
}
