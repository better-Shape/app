//! Plugins (Composio) — the user's own Composio account, no server in between.
//!
//! Everything here talks to `backend.composio.dev/api/v3` with the API key the
//! user stored in Settings → Plugins. The tool surface (`plugin_list`,
//! `plugin_tools`, `plugin_search`, `plugin_run`) is unchanged so agent prompts
//! and the UI keep working.

use std::collections::HashSet;
use std::time::Duration;

use serde_json::{json, Value};

use crate::core::ai_providers::composio_config;

const COMPOSIO_BASE: &str = "https://backend.composio.dev/api/v3";

fn strip_urls(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    loop {
        let http = rest.find("http://");
        let https = rest.find("https://");
        let idx = match (http, https) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (Some(a), None) => Some(a),
            (None, Some(b)) => Some(b),
            (None, None) => None,
        };
        let Some(i) = idx else {
            out.push_str(rest);
            break;
        };
        out.push_str(&rest[..i]);
        let after = &rest[i..];
        let end = after
            .find(|c: char| {
                c.is_whitespace() || matches!(c, '"' | '\'' | ')' | '<' | '>' | ']' | ',')
            })
            .unwrap_or(after.len());
        rest = &after[end..];
    }
    out
}

fn sanitize_plugin_error(raw: &str) -> String {
    if let Ok(v) = serde_json::from_str::<Value>(raw) {
        if let Some(e) = v
            .get("error")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        {
            return strip_urls(e).chars().take(240).collect();
        }
        if let Some(e) = v
            .get("message")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        {
            return strip_urls(e).chars().take(240).collect();
        }
    }
    let cleaned = strip_urls(raw);
    let first = cleaned
        .lines()
        .next()
        .unwrap_or("Plugin request failed.")
        .trim();
    if first.is_empty() {
        "Plugin request failed.".to_string()
    } else {
        first.chars().take(240).collect()
    }
}

fn not_configured() -> String {
    "Plugins are not configured. Add your Composio API key in Settings → Plugins, then reconnect the apps you want the agent to use."
        .to_string()
}

/// Call the user's Composio account.
pub(crate) async fn composio_request(
    method: &str,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let config = composio_config();
    let api_key = config.api_key.trim().to_string();
    if api_key.is_empty() {
        return Err(not_configured());
    }

    let url = format!("{}{}", COMPOSIO_BASE, path);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let mut req = match method {
        "POST" => client.post(&url),
        "DELETE" => client.delete(&url),
        _ => client.get(&url),
    };
    req = req
        .header("x-api-key", api_key)
        .header("Content-Type", "application/json");
    if let Some(body) = body {
        req = req.json(&body);
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("Could not reach Composio: {}", strip_urls(&e.to_string())))?;

    if resp.status().as_u16() == 401 || resp.status().as_u16() == 403 {
        return Err("Composio rejected the API key. Check it in Settings → Plugins.".to_string());
    }
    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(sanitize_plugin_error(&text));
    }
    resp.json::<Value>()
        .await
        .map_err(|_| "Failed to parse Composio response.".to_string())
}

fn user_id() -> String {
    let configured = composio_config().user_id.trim().to_string();
    if configured.is_empty() {
        "bettershape-local".to_string()
    } else {
        configured
    }
}

/// Connected toolkits for this user.
async fn connected_toolkits() -> Result<Vec<Value>, String> {
    let path = format!(
        "/connected_accounts?user_ids={}&statuses=ACTIVE&limit=100",
        urlencoding::encode(&user_id())
    );
    let data = composio_request("GET", &path, None).await?;
    let items = data
        .get("items")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(items)
}

fn toolkit_slug(account: &Value) -> String {
    account
        .get("toolkit")
        .and_then(|t| t.get("slug"))
        .and_then(|s| s.as_str())
        .or_else(|| account.get("toolkit_slug").and_then(|s| s.as_str()))
        .unwrap_or("")
        .to_string()
}

pub async fn execute_plugin_list(_api_key: &str) -> String {
    let accounts = match connected_toolkits().await {
        Ok(items) => items,
        Err(e) => return e,
    };
    if accounts.is_empty() {
        return "No plugins are connected yet. Tell the user to connect apps in Settings → Plugins."
            .to_string();
    }

    let mut seen = HashSet::new();
    let mut rows: Vec<Value> = Vec::new();
    for account in &accounts {
        let slug = toolkit_slug(account);
        if slug.is_empty() || !seen.insert(slug.clone()) {
            continue;
        }
        let name = account
            .get("toolkit")
            .and_then(|t| t.get("name"))
            .and_then(|n| n.as_str())
            .unwrap_or(&slug);
        rows.push(json!({ "toolkit": slug, "name": name, "connected": true }));
    }
    serde_json::to_string_pretty(&rows).unwrap_or_else(|_| "[]".to_string())
}

pub async fn execute_plugin_tools(toolkit: &str, query: Option<&str>, _api_key: &str) -> String {
    let mut path = format!(
        "/tools?toolkit_slug={}&limit=50",
        urlencoding::encode(toolkit)
    );
    if let Some(q) = query.filter(|s| !s.is_empty()) {
        path.push_str("&search=");
        path.push_str(&urlencoding::encode(q));
    }
    match composio_request("GET", &path, None).await {
        Ok(data) => {
            let items = data
                .get("items")
                .cloned()
                .unwrap_or_else(|| json!([]));
            serde_json::to_string_pretty(&items).unwrap_or_else(|_| "[]".to_string())
        }
        Err(e) => e,
    }
}

/// Find the best tool for a request, then tell the agent how to run it.
///
/// The old server did this with a model call. Locally we look up candidate
/// tools on Composio and let the user's own default model pick one; without a
/// model we still return the candidates so the agent can choose.
pub async fn execute_plugin_search(
    query: &str,
    _api_key: &str,
    _turn_id: Option<&str>,
    _conversation_id: Option<&str>,
) -> String {
    let connected: Vec<String> = match connected_toolkits().await {
        Ok(accounts) => {
            let mut slugs: Vec<String> = Vec::new();
            for account in accounts {
                let slug = toolkit_slug(&account);
                if !slug.is_empty() && !slugs.contains(&slug) {
                    slugs.push(slug);
                }
            }
            slugs
        }
        Err(e) => return e,
    };
    if connected.is_empty() {
        return "No plugins are connected. Tell the user to connect the app in Settings → Plugins."
            .to_string();
    }

    let mut candidates: Vec<Value> = Vec::new();
    for toolkit in connected.iter().take(6) {
        let path = format!(
            "/tools?toolkit_slug={}&search={}&limit=8",
            urlencoding::encode(toolkit),
            urlencoding::encode(query)
        );
        if let Ok(data) = composio_request("GET", &path, None).await {
            if let Some(items) = data.get("items").and_then(|v| v.as_array()) {
                for item in items {
                    let slug = item.get("slug").and_then(|s| s.as_str()).unwrap_or("");
                    if slug.is_empty() {
                        continue;
                    }
                    candidates.push(json!({
                        "slug": slug,
                        "name": item.get("name").and_then(|n| n.as_str()).unwrap_or(slug),
                        "description": item.get("description").and_then(|d| d.as_str()).unwrap_or(""),
                        "toolkit": toolkit,
                    }));
                }
            }
        }
    }

    if candidates.is_empty() {
        return format!(
            "Connected: {}. No matching actions for that request. Rephrase it with a plain verb like \"list\" or \"send\".",
            connected.join(", ")
        );
    }

    let recommended = recommend_tool(query, &candidates).await;
    let recommended = recommended.unwrap_or_else(|| {
        candidates
            .first()
            .and_then(|c| c.get("slug"))
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string()
    });

    let mut lines = vec![
        format!("Connected: {}.", connected.join(", ")),
        format!("plugin_run now: slug={recommended} arguments={{}}"),
        "Allowed slugs below. Prefer the recommended slug, but any listed slug is valid. After a list result, plugin_run the FETCH/GET/HISTORY slug with the id from the list. Do not list twice.".to_string(),
    ];
    for candidate in candidates.iter().take(8) {
        let slug = candidate.get("slug").and_then(|s| s.as_str()).unwrap_or("");
        let description = candidate
            .get("description")
            .and_then(|d| d.as_str())
            .unwrap_or("");
        let description = description.chars().take(120).collect::<String>();
        lines.push(format!("- {slug} — {description}"));
    }
    lines.join("\n")
}

/// Ask the configured model which candidate slug matches the request.
async fn recommend_tool(query: &str, candidates: &[Value]) -> Option<String> {
    let slugs: Vec<String> = candidates
        .iter()
        .filter_map(|c| c.get("slug").and_then(|s| s.as_str()).map(|s| s.to_string()))
        .collect();
    if slugs.is_empty() {
        return None;
    }
    let prompt = format!(
        "Request: {query}\n\nTool slugs:\n{}\n\nReply with exactly one slug from the list and nothing else.",
        slugs.join("\n")
    );
    let client = reqwest::Client::new();
    let ctx = crate::agent::commands::streaming::ProxyContext::new("plugin-search");
    let text = crate::agent::commands::streaming::complete_chat(
        &client,
        "",
        &prompt,
        "auto",
        &ctx,
    )
    .await
    .ok()?;
    let cleaned = text.trim().trim_matches(|c: char| c == '"' || c == '`' || c == '.');
    slugs
        .iter()
        .find(|slug| slug.eq_ignore_ascii_case(cleaned))
        .cloned()
}

pub async fn execute_plugin_run(
    slug: &str,
    arguments: &Value,
    _api_key: &str,
    _turn_id: Option<&str>,
    _conversation_id: Option<&str>,
    _task: Option<&str>,
) -> String {
    let body = json!({
        "arguments": arguments,
        "user_id": user_id(),
    });
    let path = format!("/tools/execute/{}", urlencoding::encode(slug));
    match composio_request("POST", &path, Some(body)).await {
        Ok(data) => {
            if let Some(error) = data.get("error").and_then(|e| e.as_str()) {
                if !error.trim().is_empty() {
                    return format!("ERROR: {}", sanitize_plugin_error(error));
                }
            }
            if data.get("successful").and_then(|s| s.as_bool()) == Some(false) {
                return format!(
                    "ERROR: {}",
                    sanitize_plugin_error(&data.to_string())
                );
            }
            let payload = data.get("data").cloned().unwrap_or(data);
            serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "{}".to_string())
        }
        Err(e) => e,
    }
}

/// Per-turn tool-pack selection.
///
/// This is a local heuristic — it used to be a server call. It only narrows the
/// tool list, so an over-broad answer is harmless and a wrong answer is
/// recoverable: [`crate::agent::tools::schema::SteerPacks`] falls back to
/// everything when nothing is selected.
pub async fn fetch_steer(
    message: &str,
    mode: &str,
    _turn_id: Option<&str>,
    _conversation_id: Option<&str>,
) -> crate::agent::tools::schema::SteerPacks {
    use crate::agent::tools::schema::SteerPacks;

    let text = message.to_ascii_lowercase();
    let mode = mode.to_ascii_lowercase();
    let read_only = mode == "ask" || mode == "plan";

    let mut packs = SteerPacks::all_on();
    packs.terminal = !read_only && mentions(&text, &["run", "build", "test", "install", "npm", "cargo", "pnpm", "yarn", "serve", "start", "lint", "compile", "docker", "git "]);
    packs.plugins = !mentions(&text, &["local", "offline", "this file", "this project"]);
    packs.browse = mentions(&text, &["browser", "page", "url", "localhost", "http://", "https://", "site", "web", "click", "screenshot", "preview", "render"]);
    packs.web = mentions(&text, &["search the web", "google", "latest", "news", "docs for", "documentation", "up to date", "release notes", "look up"]);
    packs.media = mentions(&text, &["image", "logo", "icon", "svg", "illustration", "mockup", "design", "art", "audio", "voice"]);
    packs.git = !mentions(&text, &["explain this function", "what does this do"]) || mentions(&text, &["git", "commit", "branch", "diff", "pull request", "merge"]);

    if read_only {
        // Read-only turns never write: keep the packs that can still read.
        packs.terminal = false;
        packs.media = false;
    }

    SteerPacks::from_json(&json!({
        "workspace": packs.workspace,
        "plugins": packs.plugins,
        "browse": packs.browse,
        "web": packs.web,
        "git": packs.git,
        "terminal": packs.terminal,
        "media": packs.media,
        "hint": packs.hint,
    }))
}

fn mentions(text: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| text.contains(needle))
}

/// Verified-completion gate.
///
/// The deterministic checks (evidence quality, file writes) already ran in the
/// tool; there is no second opinion to fetch locally, so this returns "no
/// opinion" and the local rules decide.
pub async fn fetch_gate(
    _access_token: &str,
    _body: Value,
    _turn_id: Option<&str>,
    _conversation_id: Option<&str>,
) -> Value {
    json!({})
}

pub fn gate_action(body: &Value) -> &str {
    body.get("action").and_then(|v| v.as_str()).unwrap_or("")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn steer_narrows_read_only_turns() {
        let packs = futures::executor::block_on(fetch_steer("what does this do?", "Ask", None, None));
        assert!(!packs.terminal);
        assert!(!packs.media);
        assert!(packs.workspace);
    }

    #[test]
    fn steer_enables_terminal_for_build_requests() {
        let packs =
            futures::executor::block_on(fetch_steer("run the tests and build the app", "Code", None, None));
        assert!(packs.terminal);
    }

    #[test]
    fn gate_is_neutral_without_a_server() {
        assert_eq!(gate_action(&json!({})), "");
    }

    #[test]
    fn missing_key_is_explained() {
        assert!(not_configured().contains("Settings"));
    }
}
