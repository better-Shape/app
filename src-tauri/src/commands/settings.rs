use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager, WebviewWindow};

use crate::core::error::AppError;
use crate::core::settings_file::{self, SettingsFile};

static SETTINGS_IO: Mutex<()> = Mutex::new(());

fn settings_root(window: &WebviewWindow) -> Result<PathBuf, AppError> {
    let url = window
        .url()
        .map_err(|_| AppError::from("Settings caller is unavailable"))?;
    let packaged = url.port().is_none()
        && ((url.scheme() == "tauri" && url.host_str() == Some("localhost"))
            || (matches!(url.scheme(), "http" | "https")
                && url.host_str() == Some("tauri.localhost")));
    let development = cfg!(debug_assertions)
        && window
            .app_handle()
            .config()
            .build
            .dev_url
            .as_ref()
            .is_some_and(|dev| dev.origin() == url.origin());
    if !settings_file::is_settings_window(window.label()) || !(packaged || development) {
        return Err(AppError::from(
            "Settings are available only to application windows",
        ));
    }
    window
        .app_handle()
        .path()
        .app_data_dir()
        .map_err(|_| AppError::from("Settings directory is unavailable"))
}

fn revision(record: &Option<Value>) -> Result<String, AppError> {
    match record {
        None => Ok("missing".to_string()),
        Some(record) => serde_json::to_vec(record)
            .map(|bytes| format!("{:x}", Sha256::digest(bytes)))
            .map_err(|_| AppError::from("Settings revision cannot be computed")),
    }
}

#[tauri::command]
pub async fn read_settings_file(window: WebviewWindow, file: String) -> Result<Value, AppError> {
    let root = settings_root(&window)?;
    let file = SettingsFile::parse(&file).map_err(AppError::from)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = SETTINGS_IO
            .lock()
            .map_err(|_| AppError::from("Settings storage is unavailable"))?;
        let record = settings_file::read(&root, file).map_err(AppError::from)?;
        Ok(json!({ "revision": revision(&record)?, "record": record }))
    })
    .await
    .map_err(|_| AppError::from("Settings storage task failed"))?
}

#[tauri::command]
pub async fn write_settings_file(
    window: WebviewWindow,
    file: String,
    settings: Value,
    expected: String,
) -> Result<String, AppError> {
    let app = window.app_handle().clone();
    let root = settings_root(&window)?;
    let file = SettingsFile::parse(&file).map_err(AppError::from)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = SETTINGS_IO
            .lock()
            .map_err(|_| AppError::from("Settings storage is unavailable"))?;
        let current = settings_file::read(&root, file).map_err(AppError::from)?;
        if revision(&current)? != expected {
            return Err(AppError::from(
                "Settings changed before they could be saved",
            ));
        }
        settings_file::write(&root, file, settings, current).map_err(AppError::from)?;
        let next = revision(&settings_file::read(&root, file).map_err(AppError::from)?)?;
        drop(_guard);
        if matches!(file, SettingsFile::Preferences) {
            let _ = app.emit("bettershape-settings-changed", ());
        }
        Ok(next)
    })
    .await
    .map_err(|_| AppError::from("Settings storage task failed"))?
}
