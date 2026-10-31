//! In-app update check.
//!
//! BetterShape has no update server of its own: releases are published on
//! GitHub and the build updates manually. The titlebar chip and the Settings
//! copy were written for a feed that never existed, so this asks GitHub's
//! public releases endpoint for the newest tag, compares it with the running
//! version, and hands the release page back. Nothing is downloaded or installed
//! silently.

use crate::core::error::AppError;
use serde::Serialize;
use tauri::Manager;

/// Repository whose releases ship this build. The release workflow exports
/// `GITHUB_REPOSITORY`, so a fork's installer points at the fork; the fallback
/// keeps an unqualified local build working.
const FALLBACK_REPO: &str = "Owie6789/BetterShape";

fn release_repo() -> &'static str {
    option_env!("GITHUB_REPOSITORY").unwrap_or(FALLBACK_REPO)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateInfo {
    /// Version this build runs, from the bundle's own package info.
    pub current: String,
    /// Newest published version, without its `v` prefix.
    pub latest: String,
    /// True only when `latest` is a higher version than `current`.
    pub newer: bool,
    /// Release page for `latest`, or the releases index when GitHub omits it.
    pub url: String,
    /// Release notes, as published.
    pub notes: String,
}

/// Numeric segments of a version, ignoring a leading `v` and any pre-release
/// suffix (`1.4.0-beta.2` reads as 1.4.0).
fn version_segments(version: &str) -> Vec<u64> {
    version
        .trim()
        .trim_start_matches('v')
        .split('.')
        .map(|part| {
            part.chars()
                .take_while(|character| character.is_ascii_digit())
                .collect::<String>()
                .parse()
                .unwrap_or(0)
        })
        .collect()
}

/// True when `latest` is a later release than `current`. Missing segments count
/// as zero, so `1.2` and `1.2.0` are the same version.
pub fn is_newer_version(current: &str, latest: &str) -> bool {
    let left = version_segments(current);
    let right = version_segments(latest);
    if right.iter().all(|segment| *segment == 0) && left.iter().any(|segment| *segment != 0) {
        return false;
    }
    for index in 0..left.len().max(right.len()) {
        let current_segment = *left.get(index).unwrap_or(&0);
        let latest_segment = *right.get(index).unwrap_or(&0);
        if latest_segment != current_segment {
            return latest_segment > current_segment;
        }
    }
    false
}

#[tauri::command]
pub async fn check_app_update(app: tauri::AppHandle) -> Result<AppUpdateInfo, AppError> {
    let current = app.package_info().version.to_string();
    let repo = release_repo();
    let index = format!("https://github.com/{repo}/releases");
    let endpoint = format!("https://api.github.com/repos/{repo}/releases/latest");

    let client = reqwest::Client::builder()
        .user_agent("BetterShape-Update-Check")
        .build()
        .map_err(|error| AppError::Message(format!("Could not start the update check: {error}")))?;
    let response = client
        .get(&endpoint)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|error| AppError::Message(format!("Could not reach GitHub: {error}")))?;

    if !response.status().is_success() {
        return Err(AppError::Message(format!(
            "GitHub answered {} for the latest release.",
            response.status().as_u16()
        )));
    }

    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|error| AppError::Message(format!("GitHub sent an unreadable answer: {error}")))?;
    let latest = payload
        .get("tag_name")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .trim_start_matches('v')
        .to_string();
    if latest.is_empty() {
        return Err(AppError::Message(
            "The latest release has no version tag.".to_string(),
        ));
    }

    Ok(AppUpdateInfo {
        newer: is_newer_version(&current, &latest),
        url: payload
            .get("html_url")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string())
            .unwrap_or(index),
        notes: payload
            .get("body")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string(),
        latest,
        current,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_dotted_versions_numerically() {
        assert!(is_newer_version("1.0.3", "1.0.4"));
        assert!(is_newer_version("1.0.3", "1.1.0"));
        assert!(is_newer_version("1.9.0", "1.10.0"));
        assert!(is_newer_version("0.9.9", "1.0.0"));
        assert!(!is_newer_version("1.0.3", "1.0.3"));
        assert!(!is_newer_version("1.0.4", "1.0.3"));
    }

    #[test]
    fn ignores_the_prefix_and_prerelease_suffix() {
        assert!(!is_newer_version("1.0.3", "v1.0.3"));
        assert!(!is_newer_version("1.4.0", "1.4.0-beta.2"));
        assert!(is_newer_version("1.4.0-beta.2", "1.4.1"));
        assert!(!is_newer_version("1.2.0", "1.2"));
    }

    #[test]
    fn does_not_treat_an_unparseable_tag_as_newer() {
        assert!(!is_newer_version("1.0.3", "latest"));
        assert!(!is_newer_version("1.0.3", ""));
    }
}
