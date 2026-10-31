//! In-app update check.
//!
//! BetterShape has no update server of its own: releases are published on
//! GitHub and this build updates by hand. The titlebar chip and its dismissal
//! were written for a feed that never existed, so this asks GitHub's public
//! releases endpoint for the newest tag, compares it with the running version
//! and hands back the release page. Nothing is downloaded or installed
//! silently.

use crate::core::error::AppError;
use serde::Serialize;

/// Repository whose releases ship this build. The release workflow exports
/// `GITHUB_REPOSITORY`, so a fork's installer points at the fork; the fallback
/// keeps an unqualified local build working.
const FALLBACK_REPO: &str = "Owie6789/BetterShape";

const USER_AGENT: &str = "BetterShape-Update-Check";

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

fn reach_failure(error: reqwest::Error) -> AppError {
    let message = format!("Could not reach GitHub: {error}");
    AppError::Message(message)
}

fn parse_failure(error: reqwest::Error) -> AppError {
    let message = format!("GitHub sent an unreadable answer: {error}");
    AppError::Message(message)
}

fn client_failure(error: reqwest::Error) -> AppError {
    let message = format!("Could not start the update check: {error}");
    AppError::Message(message)
}

/// Numeric segments of a version, ignoring a leading `v` and any pre-release
/// suffix (`1.4.0-beta.2` reads as 1.4.0).
fn version_segments(version: &str) -> Vec<u64> {
    version
        .trim()
        .trim_start_matches('v')
        .split('.')
        .map(|part| {
            let digits: String = part
                .chars()
                .take_while(|character| character.is_ascii_digit())
                .collect();
            digits.parse().unwrap_or(0)
        })
        .collect()
}

/// True when `latest` is a later release than `current`. Missing segments count
/// as zero, so `1.2` and `1.2.0` are the same version, and a tag with no digits
/// is never treated as newer.
pub fn is_newer_version(current: &str, latest: &str) -> bool {
    let mine = version_segments(current);
    let theirs = version_segments(latest);
    let latest_blank = theirs.iter().all(|segment| *segment == 0);
    let current_set = mine.iter().any(|segment| *segment != 0);
    if latest_blank && current_set {
        return false;
    }
    let width = mine.len().max(theirs.len());
    for index in 0..width {
        let left = *mine.get(index).unwrap_or(&0);
        let right = *theirs.get(index).unwrap_or(&0);
        if right != left {
            return right > left;
        }
    }
    false
}

async fn latest_release(repo: &str) -> Result<serde_json::Value, AppError> {
    let endpoint = format!("https://api.github.com/repos/{repo}/releases/latest");
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(client_failure)?;
    let response = client
        .get(&endpoint)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(reach_failure)?;
    let status = response.status();
    if !status.is_success() {
        let code = status.as_u16();
        let message = format!("GitHub answered {code} for the latest release.");
        return Err(AppError::Message(message));
    }
    let payload = response.json::<serde_json::Value>().await.map_err(parse_failure)?;
    Ok(payload)
}

#[tauri::command]
pub async fn check_app_update(app: tauri::AppHandle) -> Result<AppUpdateInfo, AppError> {
    let current = app.package_info().version.to_string();
    let repo = release_repo();
    let index = format!("https://github.com/{repo}/releases");
    let payload = latest_release(repo).await?;

    let tag = payload.get("tag_name");
    let tag = tag.and_then(|value| value.as_str()).unwrap_or("");
    let latest = tag.trim_start_matches('v').to_string();
    if latest.is_empty() {
        let message = "The latest release has no version tag.".to_string();
        return Err(AppError::Message(message));
    }

    let page = payload.get("html_url");
    let url = page
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .unwrap_or(index);
    let body = payload.get("body");
    let notes = body.and_then(|value| value.as_str()).unwrap_or("");

    Ok(AppUpdateInfo {
        newer: is_newer_version(&current, &latest),
        current,
        latest,
        url,
        notes: notes.to_string(),
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
    fn ignores_the_prefix_and_the_prerelease_suffix() {
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
