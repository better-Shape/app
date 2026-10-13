//! Read-only client for the official MCP registry.
//!
//! `registry.modelcontextprotocol.io` is the canonical index of published MCP
//! servers: it answers unauthenticated `GET`s with a page of entries carrying
//! the package to run (`registryType` + `identifier` + `version`), the
//! transport, and a description. That is exactly what is needed to turn "add
//! the Playwright MCP" into a concrete config, instead of guessing a package
//! name from memory.
//!
//! Only search + one-entry lookups are used here. Everything is best-effort:
//! a registry outage must never break `mcp_manage`, so callers get an error
//! string and the tool suggests manual configuration.

use serde::Serialize;
use serde_json::Value;

const REGISTRY_BASE: &str = "https://registry.modelcontextprotocol.io";

/// One installable server, flattened from the registry's nested schema.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryServer {
    /// Reverse-DNS name, e.g. `io.github.microsoft/playwright-mcp`.
    pub name: String,
    pub description: String,
    pub version: String,
    /// `npm` | `pypi` | `nuget` | `oci` | `other`
    pub registry_type: String,
    /// Package identifier, e.g. `@playwright/mcp`.
    pub identifier: String,
    pub transport: String,
    pub url: Option<String>,
    /// Ready-to-use `command` + `args`, when the package is trivially runnable.
    pub command: Option<String>,
    pub args: Vec<String>,
    pub repository: Option<String>,
}

fn str_at(value: &Value, path: &[&str]) -> Option<String> {
    let mut cur = value;
    for key in path {
        cur = cur.get(*key)?;
    }
    cur.as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Turn a registry package entry into a runnable command, when it is obvious.
///
/// Only the two ecosystems an agent can rely on are handled: `npx` for npm and
/// `uvx` for PyPI. Anything else is reported with its identifier so the human
/// (or the model) can decide.
fn runnable(registry_type: &str, identifier: &str, version: &str) -> (Option<String>, Vec<String>) {
    if identifier.trim().is_empty() {
        return (None, Vec::new());
    }
    let pinned = if version.trim().is_empty() || version == "latest" {
        identifier.to_string()
    } else {
        format!("{identifier}@{version}")
    };
    match registry_type {
        "npm" => (Some("npx".to_string()), vec!["-y".to_string(), pinned]),
        "pypi" => (Some("uvx".to_string()), vec![pinned]),
        _ => (None, Vec::new()),
    }
}

fn flatten(entry: &Value) -> Option<RegistryServer> {
    let server = entry.get("server")?;
    let name = str_at(server, &["name"])?;
    let package = server
        .get("packages")
        .and_then(|p| p.as_array())
        .and_then(|arr| {
            arr.iter()
                .find(|p| {
                    let t = p.get("transport").and_then(|t| t.get("type")).and_then(|v| v.as_str());
                    t == Some("stdio")
                })
                .or_else(|| arr.first())
        });

    let mut registry_type = String::from("other");
    let mut identifier = String::new();
    let mut version = String::new();
    let mut command = None;
    let mut args = Vec::new();
    let mut transport = String::from("stdio");
    let mut url = None;

    if let Some(pkg) = package {
        registry_type = str_at(pkg, &["registryType"]).unwrap_or(registry_type);
        identifier = str_at(pkg, &["identifier"]).unwrap_or_default();
        version = str_at(pkg, &["version"]).unwrap_or_default();
        let (c, a) = runnable(&registry_type, &identifier, &version);
        command = c;
        args = a;
        transport = str_at(pkg, &["transport", "type"]).unwrap_or(transport);
        url = str_at(pkg, &["transport", "url"]);
    }

    // A hosted server has no package at all: the registry puts its endpoint in
    // `remotes` instead. Without this it came back with no way to reach it.
    // Only when there is no local command either, so a runnable package is
    // never turned into an HTTP server.
    if url.is_none() && command.is_none() {
        let remote = server
            .get("remotes")
            .and_then(|r| r.as_array())
            .and_then(|arr| arr.iter().find(|r| str_at(r, &["url"]).is_some()));
        if let Some(remote) = remote {
            url = str_at(remote, &["url"]);
            // Shape reaches both `streamable-http` and `sse` remotes with the
            // same HTTP client, which follows whichever content type answers.
            transport = "http".to_string();
        }
    }

    Some(RegistryServer {
        name,
        description: str_at(server, &["description"]).unwrap_or_default(),
        version,
        registry_type,
        identifier,
        transport,
        url,
        command,
        args,
        repository: str_at(server, &["repository", "url"]),
    })
}

/// Search the registry. Returns at most `limit` (clamped 1..=8) entries.
pub async fn search(query: &str, limit: usize) -> Result<Vec<RegistryServer>, String> {
    let limit = limit.clamp(1, 8);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?;

    let mut request = client
        .get(format!("{REGISTRY_BASE}/v0.1/servers"))
        .query(&[("limit", limit.to_string())]);
    let trimmed = query.trim();
    if !trimmed.is_empty() {
        request = request.query(&[("search", trimmed.to_string())]);
    }

    let response = request
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("MCP registry unreachable: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "MCP registry returned {} — try again or configure the server manually.",
            response.status()
        ));
    }

    let body: Value = response
        .json()
        .await
        .map_err(|e| format!("MCP registry sent an unexpected response: {e}"))?;

    let entries = body
        .get("servers")
        .and_then(|s| s.as_array())
        .cloned()
        .unwrap_or_default();

    Ok(entries.iter().filter_map(flatten).take(limit).collect())
}

/// Render search results for a model, small enough to stay in context.
pub fn render_results(query: &str, results: &[RegistryServer]) -> String {
    if results.is_empty() {
        return format!(
            "No registry servers matched \"{query}\". Try a shorter query (the package or product name), or configure the server manually from its docs."
        );
    }
    let mut out = format!(
        "{} registry result(s) for \"{query}\". Install with mcp_manage action:add using `identifier`/`command`/`args` below.\n",
        results.len()
    );
    for r in results {
        out.push_str(&format!(
            "\nname: {}\ndescription: {}\n",
            r.name,
            r.description.trim()
        ));
        if !r.identifier.is_empty() {
            out.push_str(&format!(
                "package: {} ({}){}\n",
                r.identifier,
                r.registry_type,
                if r.version.is_empty() {
                    String::new()
                } else {
                    format!(" version {}", r.version)
                }
            ));
        }
        if let Some(command) = &r.command {
            out.push_str(&format!(
                "run: {} {}\n",
                command,
                r.args.join(" ")
            ));
        }
        if let Some(url) = &r.url {
            out.push_str(&format!("url: {url}\n"));
        }
        if let Some(repo) = &r.repository {
            out.push_str(&format!("repository: {repo}\n"));
        }
        out.push_str("---\n");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn npm_packages_gain_an_npx_command() {
        let entry = json!({
            "server": {
                "name": "io.github.acme/files",
                "description": "File tools",
                "packages": [{
                    "registryType": "npm",
                    "identifier": "@acme/files-mcp",
                    "version": "1.2.3",
                    "transport": { "type": "stdio" }
                }]
            }
        });
        let flat = flatten(&entry).expect("flattened");
        assert_eq!(flat.command.as_deref(), Some("npx"));
        assert_eq!(flat.args, vec!["-y", "@acme/files-mcp@1.2.3"]);
        assert_eq!(flat.registry_type, "npm");
    }

    #[test]
    fn pypi_packages_gain_uvx() {
        let entry = json!({
            "server": {
                "name": "io.github.acme/py",
                "description": "",
                "packages": [{
                    "registryType": "pypi",
                    "identifier": "acme-mcp",
                    "transport": { "type": "stdio" }
                }]
            }
        });
        let flat = flatten(&entry).expect("flattened");
        assert_eq!(flat.command.as_deref(), Some("uvx"));
        assert_eq!(flat.args, vec!["acme-mcp"]);
    }

    #[test]
    fn remote_entries_expose_the_url() {
        let entry = json!({
            "server": {
                "name": "io.github.acme/remote",
                "description": "Remote tools",
                "packages": [{
                    "registryType": "npm",
                    "identifier": "acme-remote",
                    "transport": { "type": "http", "url": "https://mcp.acme.dev" }
                }]
            }
        });
        let flat = flatten(&entry).expect("flattened");
        assert_eq!(flat.transport, "http");
        assert_eq!(flat.url.as_deref(), Some("https://mcp.acme.dev"));
    }

    #[test]
    fn hosted_entries_expose_their_remote_url() {
        // A server with no package at all: the registry lists it under `remotes`.
        let entry = json!({
            "server": {
                "name": "io.github.acme/hosted",
                "description": "Hosted tools",
                "remotes": [
                    { "type": "streamable-http", "url": "https://mcp.acme.dev/mcp" }
                ]
            }
        });
        let flat = flatten(&entry).expect("flattened");
        assert_eq!(flat.url.as_deref(), Some("https://mcp.acme.dev/mcp"));
        assert_eq!(flat.transport, "http");
        assert!(flat.command.is_none());
    }

    #[test]
    fn entries_without_a_name_are_skipped() {
        assert!(flatten(&json!({ "server": { "description": "nope" } })).is_none());
    }

    #[test]
    fn render_lists_packages_and_says_how_to_run_them() {
        let results = vec![RegistryServer {
            name: "io.github.acme/files".into(),
            description: "File tools".into(),
            version: "1.2.3".into(),
            registry_type: "npm".into(),
            identifier: "@acme/files-mcp".into(),
            transport: "stdio".into(),
            url: None,
            command: Some("npx".into()),
            args: vec!["-y".into(), "@acme/files-mcp@1.2.3".into()],
            repository: None,
        }];
        let out = render_results("files", &results);
        assert!(out.contains("npx -y @acme/files-mcp@1.2.3"));
        assert!(out.contains("io.github.acme/files"));
    }

    #[test]
    fn empty_results_suggest_a_shorter_query() {
        let out = render_results("nonsense", &[]);
        assert!(out.contains("No registry servers matched"));
    }
}
