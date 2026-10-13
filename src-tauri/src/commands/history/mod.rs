use crate::core::error::AppError;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: String,
    pub timestamp: i64,
    pub label: String,
    pub size: usize,
}

fn history_root() -> Result<PathBuf, AppError> {
    let base = dirs::data_dir()
        .ok_or_else(|| AppError::Message("Could not resolve data directory".to_string()))?;
    Ok(base.join("bettershape").join("local-history"))
}

fn hash_key(input: &str) -> String {
    let mut hasher = DefaultHasher::new();
    input.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn file_history_dir(project_path: &str, file_path: &str) -> Result<PathBuf, AppError> {
    let project_key = crate::core::project_key::stable_project_key(project_path);
    let rel = normalize_relative(project_path, file_path);
    let file_key = crate::core::project_key::stable_project_key(&rel);
    Ok(history_root()?.join(project_key).join(file_key))
}

fn legacy_file_history_dir(p: &str, f: &str) -> Result<PathBuf, AppError> {
    Ok(history_root()?
        .join(hash_key(p))
        .join(hash_key(&normalize_relative(p, f))))
}

fn normalize_relative(project_path: &str, file_path: &str) -> String {
    let project = Path::new(project_path);
    let file = Path::new(file_path);
    file.strip_prefix(project)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| file_path.replace('\\', "/"))
}

pub fn save_history_version(
    project_path: &str,
    file_path: &str,
    content: &str,
) -> Result<(), AppError> {
    if file_path.starts_with("bettershape://") {
        return Ok(());
    }

    let dir = file_history_dir(project_path, file_path)?;
    fs::create_dir_all(&dir).map_err(AppError::Io)?;

    let timestamp = chrono_like_timestamp();
    static C: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let (id, mut file) = loop {
        let id = format!(
            "{}-{:010}",
            timestamp * 1000,
            C.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        );
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(dir.join(format!("{id}.json")))
        {
            Ok(f) => break (id, f),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(AppError::Io(e)),
        }
    };

    let entry = serde_json::json!({
        "id": id,
        "timestamp": timestamp,
        "label": format!("Save at {}", format_timestamp(timestamp)),
        "content": content,
    });

    let serialized = serde_json::to_string_pretty(&entry)
        .map_err(|e| AppError::Message(format!("Failed to serialize history: {}", e)))?;
    std::io::Write::write_all(&mut file, serialized.as_bytes()).map_err(AppError::Io)?;

    trim_history_versions(&dir, 50)?;
    Ok(())
}

fn trim_history_versions(dir: &Path, max: usize) -> Result<(), AppError> {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .map_err(AppError::Io)?
        .filter_map(|e| e.ok().map(|d| d.path()))
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("json"))
        .collect();

    entries.sort_by_key(|p| p.metadata().and_then(|m| m.modified()).ok());

    if entries.len() > max {
        for path in entries.iter().take(entries.len() - max) {
            let _ = fs::remove_file(path);
        }
    }
    Ok(())
}

pub fn get_file_history(
    project_path: &str,
    file_path: &str,
) -> Result<Vec<HistoryEntry>, AppError> {
    if file_path.starts_with("bettershape://") {
        return Ok(vec![]);
    }

    let mut dirs = vec![file_history_dir(project_path, file_path)?];
    if let Ok(legacy) = legacy_file_history_dir(project_path, file_path) {
        if legacy != dirs[0] {
            dirs.push(legacy);
        }
    }

    let mut entries: Vec<HistoryEntry> = Vec::new();
    for entry in dirs
        .iter()
        .filter(|d| d.exists())
        .filter_map(|d| fs::read_dir(d).ok())
        .flatten()
        .flatten()
    {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let raw = fs::read_to_string(&path).map_err(AppError::Io)?;
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) {
            let content_len = parsed
                .get("content")
                .and_then(|c| c.as_str())
                .map(|s| s.len())
                .unwrap_or(0);
            entries.push(HistoryEntry {
                id: parsed
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string(),
                timestamp: parsed
                    .get("timestamp")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0),
                label: parsed
                    .get("label")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Version")
                    .to_string(),
                size: content_len,
            });
        }
    }

    entries.sort_by(|a, b| b.timestamp.cmp(&a.timestamp).then_with(|| b.id.cmp(&a.id)));
    Ok(entries)
}

pub fn restore_history_version(
    project_path: &str,
    file_path: &str,
    version_id: &str,
) -> Result<String, AppError> {
    let dir = file_history_dir(project_path, file_path)?;
    let mut entry_path = dir.join(format!("{}.json", version_id));
    if !entry_path.exists() {
        if let Ok(lp) = legacy_file_history_dir(project_path, file_path)
            .map(|d| d.join(format!("{version_id}.json")))
        {
            if lp.exists() {
                entry_path = lp;
            }
        }
    }
    if !entry_path.exists() {
        return Err(AppError::Message("History version not found".to_string()));
    }

    let raw = fs::read_to_string(&entry_path).map_err(AppError::Io)?;
    let parsed: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| AppError::Message(format!("Invalid history entry: {}", e)))?;

    parsed
        .get("content")
        .and_then(|c| c.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::Message("History entry missing content".to_string()))
}

fn chrono_like_timestamp() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn format_timestamp(ts: i64) -> String {
    // Simple ISO-like formatting without chrono dependency
    let secs = ts;
    let (days, rem) = (secs.div_euclid(86400), secs.rem_euclid(86400));
    let hours = rem / 3600;
    let mins = (rem % 3600) / 60;
    let secs = rem % 60;
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02} {hours:02}:{mins:02}:{secs:02}")
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let e = (if z >= 0 { z } else { z - 146096 }) / 146097;
    let d = (z - e * 146097) as u64;
    let y = (d - d / 1460 + d / 36524 - d / 146096) / 365;
    let (yr, dy) = (y as i64 + e * 400, d - (365 * y + y / 4 - y / 100));
    let mp = (5 * dy + 2) / 153;
    let (da, mo) = (
        (dy - (153 * mp + 2) / 5 + 1) as u32,
        (if mp < 10 { mp + 3 } else { mp - 9 }) as u32,
    );
    (if mo <= 2 { yr + 1 } else { yr }, mo, da)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn format_ts() {
        assert!(
            format_timestamp(0) == "1970-01-01 00:00:00"
                && format_timestamp(1_700_000_000) == "2023-11-14 22:13:20"
        );
    }
}
