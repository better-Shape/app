//! MCP server administration: one place that changes `mcp.json`.
//!
//! Everything an agent or the UI does to the server list goes through here so
//! one place owns:
//!
//! * **the file shape** — `{"mcpServers": {id: {...}}}`, with every other key in
//!   the document preserved (users keep comments-as-keys, `$schema`, notes…);
//! * **atomic writes** — temp file + rename, plus a `.bak` of the previous
//!   version, because this file is the user's working configuration;
//! * **validation** — a stdio server needs a command, an HTTP server needs a URL,
//!   ids must be usable in tool names (`mcp_<id>_<tool>`);
//! * **secret hygiene** — env *values* are never echoed back to a model, only
//!   their names, and never written into logs.

use crate::mcp::types::{McpAuthType, McpServerConfig, McpTransport};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, OnceLock};

/// `<data dir>/bettershape/mcp.json` — the same file Settings → Agents → MCP opens.
pub fn config_path() -> Result<PathBuf, String> {
    let base = dirs::data_dir().ok_or_else(|| "Could not resolve data directory".to_string())?;
    Ok(base.join("bettershape").join("mcp.json"))
}

/// Create the file (and its directory) if missing. Returns the path.
pub fn ensure_file() -> Result<PathBuf, String> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if !path.exists() {
        std::fs::write(&path, "{\n  \"mcpServers\": {}\n}\n").map_err(|e| e.to_string())?;
    }
    Ok(path)
}

/// Serialises every read-modify-write cycle on the file. The agent tool, the
/// Tauri commands and the Settings screen all write `mcp.json`, and two writers
/// that interleave lose one of the two changes.
fn write_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn lock_writes() -> Result<MutexGuard<'static, ()>, String> {
    write_lock().lock().map_err(|e| e.to_string())
}

/// The whole document, or an empty one when the file is blank/corrupt.
pub fn read_doc() -> Result<Value, String> {
    let _guard = lock_writes()?;
    read_doc_unlocked()
}

fn read_doc_unlocked() -> Result<Value, String> {
    let path = ensure_file()?;
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if raw.trim().is_empty() {
        return Ok(json!({ "mcpServers": {} }));
    }
    match serde_json::from_str::<Value>(&raw) {
        Ok(Value::Object(_)) => Ok(serde_json::from_str(&raw).map_err(|e| e.to_string())?),
        Ok(_) => Err("mcp.json must contain a JSON object at the top level".to_string()),
        Err(e) => Err(format!("mcp.json is not valid JSON: {e}")),
    }
}

/// Replace the file with `content` verbatim, under the same lock. Settings
/// writes the whole document this way.
pub fn write_raw(content: &str) -> Result<(), String> {
    let _guard = lock_writes()?;
    write_text(content)
}

fn write_doc_unlocked(doc: &Value) -> Result<(), String> {
    let body = serde_json::to_string_pretty(doc).map_err(|e| e.to_string())?;
    note_written_ids(doc);
    write_text(&format!("{body}\n"))
}

/// Ids this process has put into `mcp.json`, whatever path wrote them.
///
/// A reload needs to tell "the user deleted this from the file" apart from "this
/// never lived in the file" so it can drop the first and keep the second. The
/// file alone cannot answer that once the entry is gone, so remember it here.
fn written_ids() -> &'static std::sync::Mutex<std::collections::HashSet<String>> {
    static IDS: std::sync::OnceLock<std::sync::Mutex<std::collections::HashSet<String>>> =
        std::sync::OnceLock::new();
    IDS.get_or_init(|| std::sync::Mutex::new(std::collections::HashSet::new()))
}

fn note_written_ids(doc: &Value) {
    let ids: Vec<String> = doc
        .get("mcpServers")
        .and_then(|v| v.as_object())
        .map(|map| map.keys().cloned().collect())
        .unwrap_or_default();
    if let Ok(mut guard) = written_ids().lock() {
        for id in ids {
            guard.insert(id);
        }
    }
}

/// Ids this process has written into `mcp.json`, ever.
pub fn written_ids_snapshot() -> std::collections::HashSet<String> {
    written_ids().lock().map(|g| g.clone()).unwrap_or_default()
}

/// Temp file + rename, plus a `.bak`. The temp name carries the pid so two
/// processes can never share one.
fn write_text(body: &str) -> Result<(), String> {
    let path = ensure_file()?;
    let tmp = path.with_extension(format!("json.{}.tmp", std::process::id()));
    std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
    if path.exists() {
        let _ = std::fs::copy(&path, path.with_extension("json.bak"));
    }
    std::fs::rename(&tmp, &path).map_err(|e| format!("Could not update mcp.json: {e}"))
}

fn servers_object(doc: &mut Value) -> &mut serde_json::Map<String, Value> {
    if !doc.is_object() {
        *doc = json!({});
    }
    let obj = doc.as_object_mut().expect("object");
    if !obj.get("mcpServers").map(|v| v.is_object()).unwrap_or(false) {
        obj.insert("mcpServers".into(), json!({}));
    }
    obj.get_mut("mcpServers")
        .and_then(|v| v.as_object_mut())
        .expect("mcpServers object")
}

/// Every server in `mcp.json`, in file order.
pub fn load_servers() -> Result<Vec<McpServerConfig>, String> {
    let doc = read_doc()?;
    let Some(map) = doc.get("mcpServers").and_then(|v| v.as_object()) else {
        return Ok(Vec::new());
    };
    Ok(map.iter().map(|(id, v)| parse_entry(id, v)).collect())
}

/// One server, by id.
pub fn load_server(id: &str) -> Result<Option<McpServerConfig>, String> {
    Ok(load_servers()?.into_iter().find(|s| s.id == id))
}

/// Config → the on-disk shape. Only the keys other MCP clients read are written.
pub fn entry_json(cfg: &McpServerConfig) -> Value {
    let mut obj = serde_json::Map::new();
    obj.insert("transport".into(), json!(cfg.transport));
    match cfg.transport {
        McpTransport::Stdio => {
            obj.insert("command".into(), json!(cfg.command));
            if !cfg.args.is_empty() {
                obj.insert("args".into(), json!(cfg.args));
            }
            if !cfg.env.is_empty() {
                obj.insert("env".into(), json!(cfg.env));
            }
        }
        McpTransport::Http => {
            if let Some(url) = cfg.url.as_ref().filter(|u| !u.trim().is_empty()) {
                obj.insert("url".into(), json!(url));
            }
            if !cfg.headers.is_empty() {
                obj.insert("headers".into(), json!(cfg.headers));
            }
            // `parse_entry` reads `env` for HTTP too (`env.AUTHORIZATION` is the
            // bearer), so dropping it here would delete a working credential the
            // next time anything rewrites this entry.
            if !cfg.env.is_empty() {
                obj.insert("env".into(), json!(cfg.env));
            }
            obj.insert("auth".into(), json!(cfg.auth));
        }
    }
    if !cfg.enabled {
        obj.insert("disabled".into(), json!(true));
    }
    if !cfg.disabled_tools.is_empty() {
        obj.insert("disabledTools".into(), json!(cfg.disabled_tools));
    }
    if let Some(client_id) = cfg.oauth_client_id.as_ref().filter(|s| !s.trim().is_empty()) {
        obj.insert("oauthClientId".into(), json!(client_id));
    }
    Value::Object(obj)
}

/// The on-disk shape → config. Tolerant: `url` alone implies HTTP, a missing
/// `auth` on a URL implies OAuth (what remote MCP servers overwhelmingly use).
pub fn parse_entry(id: &str, value: &Value) -> McpServerConfig {
    let url = value
        .get("url")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let transport = match value.get("transport").and_then(|v| v.as_str()) {
        Some("http") => McpTransport::Http,
        Some("stdio") => McpTransport::Stdio,
        _ if url.is_some() => McpTransport::Http,
        _ => McpTransport::Stdio,
    };
    let auth = match value.get("auth").and_then(|v| v.as_str()) {
        Some("none") => McpAuthType::None,
        Some("oauth") => McpAuthType::Oauth,
        _ if url.is_some() => McpAuthType::Oauth,
        _ => McpAuthType::None,
    };
    McpServerConfig {
        id: id.to_string(),
        name: value
            .get("name")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(id)
            .to_string(),
        transport,
        command: value
            .get("command")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        args: string_list(value.get("args")),
        env: string_map(value.get("env")),
        url,
        auth,
        headers: string_map(value.get("headers")),
        enabled: value.get("disabled").and_then(|v| v.as_bool()) != Some(true),
        disabled_tools: string_list(value.get("disabledTools")),
        oauth_client_id: value
            .get("oauthClientId")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .filter(|s| !s.trim().is_empty()),
        skill_hint: None,
    }
}

fn string_list(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| match item {
                    Value::String(s) => Some(s.clone()),
                    Value::Number(n) => Some(n.to_string()),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default()
}

fn string_map(value: Option<&Value>) -> HashMap<String, String> {
    value
        .and_then(|v| v.as_object())
        .map(|obj| {
            obj.iter()
                .filter_map(|(k, v)| match v {
                    Value::String(s) => Some((k.clone(), s.clone())),
                    Value::Number(n) => Some((k.clone(), n.to_string())),
                    Value::Bool(b) => Some((k.clone(), b.to_string())),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default()
}

/// A server id that is safe inside tool names and stable across renames.
pub fn slug(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut last_dash = true; // trims leading dashes
    for ch in name.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "mcp".to_string()
    } else {
        out
    }
}

/// Reject configs that cannot work, with a message that says how to fix them.
pub fn validate(cfg: &McpServerConfig) -> Result<(), String> {
    if cfg.id.trim().is_empty() {
        return Err("Server id is required (lowercase letters, digits, dashes).".to_string());
    }
    if cfg.id.len() > 64 {
        return Err("Server id must be 64 characters or fewer.".to_string());
    }
    if !cfg
        .id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!(
            "Server id '{}' must use only letters, digits, dashes or underscores.",
            cfg.id
        ));
    }
    match cfg.transport {
        McpTransport::Stdio => {
            if cfg.command.trim().is_empty() {
                return Err(
                    "stdio servers need a `command` — the executable BetterShape should launch, e.g. \"npx\" or \"uvx\"."
                        .to_string(),
                );
            }
            if cfg.command.contains('\u{0}') {
                return Err("Invalid character in command.".to_string());
            }
        }
        McpTransport::Http => {
            let url = cfg
                .url
                .as_deref()
                .map(str::trim)
                .filter(|u| !u.is_empty())
                .ok_or_else(|| "HTTP servers need a `url`.".to_string())?;
            if !(url.starts_with("https://") || url.starts_with("http://")) {
                return Err(format!("`{url}` is not an http(s) URL."));
            }
            // A bad name or value is stored by reqwest and only fails at send
            // time, which reads as "the server is broken" instead of "your
            // header is wrong".
            for (name, value) in &cfg.headers {
                if reqwest::header::HeaderName::from_bytes(name.as_bytes()).is_err() {
                    return Err(format!("`{name}` is not a valid header name."));
                }
                if reqwest::header::HeaderValue::from_str(value).is_err() {
                    return Err(format!("Header `{name}` has a value HTTP cannot carry."));
                }
            }
        }
    }
    Ok(())
}

/// Insert or replace one server. Returns the previous config when it existed.
pub fn upsert(cfg: &McpServerConfig) -> Result<Option<McpServerConfig>, String> {
    validate(cfg)?;
    let _guard = lock_writes()?;
    let mut doc = read_doc_unlocked()?;
    let previous = doc
        .get("mcpServers")
        .and_then(|v| v.as_object())
        .and_then(|m| m.get(&cfg.id))
        .map(|v| parse_entry(&cfg.id, v));
    {
        let servers = servers_object(&mut doc);
        servers.insert(cfg.id.clone(), entry_json(cfg));
    }
    write_doc_unlocked(&doc)?;
    Ok(previous)
}

/// Remove one server. Returns `true` when the entry existed.
pub fn remove(id: &str) -> Result<bool, String> {
    let _guard = lock_writes()?;
    let mut doc = read_doc_unlocked()?;
    let removed = {
        let servers = servers_object(&mut doc);
        servers.remove(id).is_some()
    };
    if removed {
        write_doc_unlocked(&doc)?;
    }
    Ok(removed)
}

/// Flip a server on or off without touching its other fields.
pub fn set_enabled(id: &str, enabled: bool) -> Result<bool, String> {
    let _guard = lock_writes()?;
    let mut doc = read_doc_unlocked()?;
    let found = {
        let servers = servers_object(&mut doc);
        match servers.get_mut(id).and_then(|v| v.as_object_mut()) {
            Some(entry) => {
                if enabled {
                    entry.remove("disabled");
                } else {
                    entry.insert("disabled".into(), json!(true));
                }
                true
            }
            None => false,
        }
    };
    if found {
        write_doc_unlocked(&doc)?;
    }
    Ok(found)
}

/// `KEY=set, OTHER=set` — never the values themselves.
pub fn redact_env(env: &HashMap<String, String>) -> String {
    if env.is_empty() {
        return String::new();
    }
    let mut keys: Vec<&String> = env.keys().collect();
    keys.sort();
    keys.iter()
        .map(|k| format!("{k}={}", if env[*k].is_empty() { "empty" } else { "set" }))
        .collect::<Vec<_>>()
        .join(", ")
}

/// One-line description of where a server lives, with secrets removed.
pub fn describe_target(cfg: &McpServerConfig) -> String {
    match cfg.transport {
        McpTransport::Stdio => {
            let mut line = format!("{} {}", cfg.command, cfg.args.join(" "));
            line = line.trim().to_string();
            let env = redact_env(&cfg.env);
            if env.is_empty() {
                line
            } else {
                format!("{line} (env: {env})")
            }
        }
        McpTransport::Http => cfg.url.clone().unwrap_or_default(),
    }
}

/// Outcome of a live connection test.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpTestReport {
    pub ok: bool,
    /// `connected` | `needs_auth` | `error`
    pub status: String,
    pub tool_count: usize,
    pub tools: Vec<String>,
    pub error: Option<String>,
    pub latency_ms: u64,
}

/// Connect once, list tools, disconnect. Does not touch the running state.
pub fn test_config(cfg: &McpServerConfig) -> McpTestReport {
    let started = std::time::Instant::now();
    if let Err(e) = validate(cfg) {
        return McpTestReport {
            ok: false,
            status: "error".to_string(),
            tool_count: 0,
            tools: Vec::new(),
            error: Some(e),
            latency_ms: started.elapsed().as_millis() as u64,
        };
    }
    match crate::mcp::McpState::connect_server(cfg) {
        Ok(client) => {
            let tools = client.tools().to_vec();
            McpTestReport {
                ok: true,
                status: "connected".to_string(),
                tool_count: tools.len(),
                tools: tools.iter().map(|t| t.name.clone()).collect(),
                error: client.last_error(),
                latency_ms: started.elapsed().as_millis() as u64,
            }
        }
        Err(e) if e == "NEEDS_AUTH" => McpTestReport {
            ok: false,
            status: "needs_auth".to_string(),
            tool_count: 0,
            tools: Vec::new(),
            error: Some(
                "Server requires OAuth — start the sign-in flow, then test again.".to_string(),
            ),
            latency_ms: started.elapsed().as_millis() as u64,
        },
        Err(e) => McpTestReport {
            ok: false,
            status: "error".to_string(),
            tool_count: 0,
            tools: Vec::new(),
            error: Some(e),
            latency_ms: started.elapsed().as_millis() as u64,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stdio_cfg(id: &str, command: &str) -> McpServerConfig {
        McpServerConfig {
            id: id.to_string(),
            name: id.to_string(),
            transport: McpTransport::Stdio,
            command: command.to_string(),
            args: vec![],
            env: HashMap::new(),
            url: None,
            auth: McpAuthType::None,
            headers: HashMap::new(),
            enabled: true,
            disabled_tools: vec![],
            oauth_client_id: None,
            skill_hint: None,
        }
    }

    fn http_cfg(id: &str, url: &str) -> McpServerConfig {
        McpServerConfig {
            transport: McpTransport::Http,
            url: Some(url.to_string()),
            auth: McpAuthType::Oauth,
            ..stdio_cfg(id, "")
        }
    }

    #[test]
    fn slug_makes_tool_safe_ids() {
        assert_eq!(slug("Playwright MCP"), "playwright-mcp");
        assert_eq!(slug("  Sentry!! "), "sentry");
        assert_eq!(slug("!!!"), "mcp");
    }

    #[test]
    fn validation_requires_a_target_per_transport() {
        assert!(validate(&stdio_cfg("a", "")).is_err());
        assert!(validate(&stdio_cfg("a", "npx")).is_ok());
        assert!(validate(&http_cfg("b", "")).is_err());
        assert!(validate(&http_cfg("b", "https://mcp.example.com")).is_ok());
        assert!(validate(&http_cfg("b", "ftp://nope")).is_err());
    }

    #[test]
    fn ids_are_restricted() {
        let mut cfg = stdio_cfg("has space", "npx");
        assert!(validate(&cfg).is_err());
        cfg.id = "ok-id_1".to_string();
        assert!(validate(&cfg).is_ok());
    }

    #[test]
    fn entry_round_trips_through_disk_shape() {
        let mut cfg = stdio_cfg("pw", "npx");
        cfg.args = vec!["-y".into(), "@playwright/mcp@latest".into()];
        cfg.env.insert("TOKEN".into(), "secret".into());
        cfg.disabled_tools = vec!["close_browser".into()];
        let json = entry_json(&cfg);
        assert_eq!(json["transport"], "stdio");
        assert_eq!(json["disabledTools"][0], "close_browser");
        let back = parse_entry("pw", &json);
        assert_eq!(back.command, "npx");
        assert_eq!(back.args.len(), 2);
        assert_eq!(back.env.get("TOKEN").map(String::as_str), Some("secret"));
        assert!(back.enabled);
    }

    #[test]
    fn url_entries_infer_http_and_oauth() {
        let back = parse_entry("remote", &json!({ "url": "https://mcp.example.com" }));
        assert_eq!(back.transport, McpTransport::Http);
        assert_eq!(back.auth, McpAuthType::Oauth);
    }

    #[test]
    fn disabled_entries_stay_disabled() {
        let back = parse_entry("x", &json!({ "command": "npx", "disabled": true }));
        assert!(!back.enabled);
    }

    #[test]
    fn env_values_are_never_echoed() {
        let mut cfg = stdio_cfg("x", "npx");
        cfg.env.insert("API_KEY".into(), "sk-live-123".into());
        cfg.env.insert("EMPTY".into(), String::new());
        let line = redact_env(&cfg.env);
        assert!(line.contains("API_KEY=set"));
        assert!(!line.contains("sk-live-123"));
        assert!(line.contains("EMPTY=empty"));
    }

    #[test]
    fn describe_target_shows_headersless_targets_only() {
        let mut cfg = http_cfg("x", "https://mcp.example.com/sse");
        cfg.headers
            .insert("Authorization".into(), "Bearer secret".into());
        let line = describe_target(&cfg);
        assert_eq!(line, "https://mcp.example.com/sse");
        assert!(!line.contains("secret"));
    }

    #[test]
    fn patch_only_touches_supplied_fields() {
        let cfg = stdio_cfg("keep", "npx");
        let mut doc = json!({ "mcpServers": { "keep": entry_json(&cfg), "other": { "command": "uvx" } } });
        // Exercise the same mutation path `patch` uses, without touching disk.
        {
            let servers = servers_object(&mut doc);
            let existing = servers.get("keep").cloned().unwrap();
            let mut parsed = parse_entry("keep", &existing);
            parsed.args = vec!["--flag".into()];
            servers.insert("keep".into(), entry_json(&parsed));
        }
        let servers = doc["mcpServers"].as_object().unwrap();
        assert_eq!(servers.len(), 2);
        assert_eq!(servers["keep"]["args"][0], "--flag");
        assert_eq!(servers["other"]["command"], "uvx");
    }
}
