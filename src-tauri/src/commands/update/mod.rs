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
use std::time::Duration;

/// Repository whose releases ship this build. GitHub Actions sets
/// `GITHUB_REPOSITORY` for every step, so a release built there asks the
/// repository that built it; the fallback keeps a local build working.
const FALLBACK_REPO: &str = "better-Shape/app";

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
    /// False when the channel has nothing to compare against: a project that has
    /// cut no release answers 404, which is not a failure to reach GitHub, and a
    /// stable check on a repository of prereleases answers the same way.
    pub published: bool,
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
/// or build suffix: `1.4.0-beta.2` reads as 1.4.0, not as 1.4.0.2.
fn version_segments(version: &str) -> Vec<u64> {
    let core = version.trim().trim_start_matches('v');
    let core = core.split(['-', '+']).next().unwrap_or("");
    core.split('.')
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

/// How many releases one nightly page asks for. GitHub caps a page at 100, and a
/// project that publishes many stables between prereleases would need more.
const RELEASE_PAGE: u32 = 100;

/// Release endpoint for the channel. Stable asks for the newest published
/// release; nightly lists releases newest first, because the newest entry can be
/// a stable that shipped after the prerelease the channel is looking for.
fn release_endpoint(repo: &str, nightly: bool) -> String {
    if nightly {
        format!("https://api.github.com/repos/{repo}/releases?per_page={RELEASE_PAGE}")
    } else {
        format!("https://api.github.com/repos/{repo}/releases/latest")
    }
}

/// True when the release is flagged as a prerelease.
fn is_prerelease(release: &serde_json::Value) -> bool {
    release
        .get("prerelease")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
}

/// The release a nightly check should offer.
///
/// The newest prerelease, because that is what the channel follows, and the
/// newest release when the project publishes no prereleases at all, so a nightly
/// build still hears about a stable one. The endpoint answers newest first.
fn nightly_release(releases: &[serde_json::Value]) -> Option<serde_json::Value> {
    releases
        .iter()
        .find(|release| is_prerelease(release))
        .or_else(|| releases.first())
        .cloned()
}

/// The release body, or `None` when the repository has published nothing yet.
async fn fetch_release(repo: &str, nightly: bool) -> Result<Option<serde_json::Value>, AppError> {
    let endpoint = release_endpoint(repo, nightly);
    // A bounded request: GitHub can accept the connection and then stall, and an
    // unbounded await would leave the update check on "checking" until restart.
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(client_failure)?;
    let response = client
        .get(&endpoint)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(reach_failure)?;
    let status = response.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !status.is_success() {
        let code = status.as_u16();
        let message = format!("GitHub answered {code} for the release list.");
        return Err(AppError::Message(message));
    }
    let payload = response
        .json::<serde_json::Value>()
        .await
        .map_err(parse_failure)?;
    if !nightly {
        return Ok(Some(payload));
    }
    // The list endpoint answers an array ordered newest first; an empty array is
    // the same "nothing published" answer as the 404 above. Anything else is a
    // body this build cannot read, which must not read as "no releases".
    let Some(releases) = payload.as_array() else {
        let message = "GitHub sent a release list this build cannot read.".to_string();
        return Err(AppError::Message(message));
    };
    Ok(nightly_release(releases))
}

fn channel_is_nightly(channel: Option<&str>) -> bool {
    matches!(
        channel
            .map(|value| value.trim().to_ascii_lowercase())
            .as_deref(),
        Some("nightly")
    )
}

/// Reads the newest release for `channel`, or reports that the channel has
/// nothing to compare against. `None` and any unknown value read as stable.
#[tauri::command]
pub async fn check_app_update(
    app: tauri::AppHandle,
    channel: Option<String>,
) -> Result<AppUpdateInfo, AppError> {
    let current = app.package_info().version.to_string();
    let repo = release_repo();
    let index = format!("https://github.com/{repo}/releases");
    let Some(payload) = fetch_release(repo, channel_is_nightly(channel.as_deref())).await? else {
        return Ok(AppUpdateInfo {
            current,
            latest: String::new(),
            newer: false,
            published: false,
            url: index,
            notes: String::new(),
        });
    };

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
        published: true,
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
        assert!(!is_newer_version("1.4.0", "1.4.0-rc.1"));
        assert!(!is_newer_version("1.4.0", "1.4.0+build.7"));
        assert!(is_newer_version("1.4.0-beta.2", "1.4.1"));
        assert!(!is_newer_version("1.2.0", "1.2"));
    }

    #[test]
    fn nightly_follows_the_newest_prerelease_past_a_newer_stable() {
        let releases = serde_json::json!([
            { "tag_name": "v1.0.4", "prerelease": false },
            { "tag_name": "v2.0.0-nightly.3", "prerelease": true },
            { "tag_name": "v1.0.3", "prerelease": false }
        ]);
        let picked = nightly_release(releases.as_array().expect("an array"));
        assert_eq!(
            picked.and_then(|release| release["tag_name"].as_str().map(str::to_string)),
            Some("v2.0.0-nightly.3".to_string())
        );
    }

    #[test]
    fn nightly_falls_back_to_the_newest_release_when_none_is_a_prerelease() {
        let releases = serde_json::json!([
            { "tag_name": "v1.0.4", "prerelease": false },
            { "tag_name": "v1.0.3", "prerelease": false }
        ]);
        let picked = nightly_release(releases.as_array().expect("an array"));
        assert_eq!(
            picked.and_then(|release| release["tag_name"].as_str().map(str::to_string)),
            Some("v1.0.4".to_string())
        );
    }

    #[test]
    fn nightly_reads_an_empty_list_as_nothing_published() {
        let releases = serde_json::json!([]);
        assert!(nightly_release(releases.as_array().expect("an array")).is_none());
    }

    #[test]
    fn asks_the_endpoint_the_channel_needs() {
        // Nightly asks for a page of releases, because the newest one can be a
        // stable that shipped after the prerelease the channel follows.
        assert!(release_endpoint("better-Shape/app", true).ends_with("/releases?per_page=100"));
        assert!(release_endpoint("better-Shape/app", false).ends_with("/releases/latest"));
        assert!(channel_is_nightly(Some("Nightly")));
        assert!(!channel_is_nightly(Some("stable")));
        assert!(!channel_is_nightly(None));
    }

    #[test]
    fn does_not_treat_an_unparseable_tag_as_newer() {
        assert!(!is_newer_version("1.0.3", "latest"));
        assert!(!is_newer_version("1.0.3", ""));
    }
}
