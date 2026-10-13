pub mod admin;
pub(crate) mod client;
pub(crate) mod credentials;
mod http_client;
mod oauth;
pub mod registry;
mod types;

pub use oauth::{handle_oauth_callback, start_oauth};
pub use types::*;

use client::McpClient as StdioClient;
use http_client::HttpMcpClient;
use oauth::get_token;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

pub(crate) enum ConnectedClient {
    Stdio(StdioClient),
    Http(HttpMcpClient),
}

impl ConnectedClient {
    pub(crate) fn tools(&self) -> &[McpToolInfo] {
        match self {
            ConnectedClient::Stdio(c) => &c.tools,
            ConnectedClient::Http(c) => &c.tools,
        }
    }

    pub(crate) fn last_error(&self) -> Option<String> {
        match self {
            ConnectedClient::Stdio(c) => c.last_error.clone(),
            ConnectedClient::Http(c) => c.last_error.clone(),
        }
    }

    fn call_tool(&mut self, name: &str, args: Value) -> Result<CallToolResult, String> {
        match self {
            ConnectedClient::Stdio(c) => c.call_tool(name, args),
            ConnectedClient::Http(c) => c.call_tool(name, args),
        }
    }
}

pub struct McpState {
    /// Per-server locks so a long tool call does not block status/sync/schema.
    clients: Mutex<HashMap<String, Arc<Mutex<ConnectedClient>>>>,
    configs: Mutex<Vec<McpServerConfig>>,
    /// Serialises connect-then-insert. Two upserts for the same id could
    /// otherwise finish in either order and leave the older connection live.
    connecting: Mutex<()>,
    /// Ids that were loaded from `mcp.json` the last time the file was read.
    /// A server removed from the file is dropped on the next reload; one that
    /// came from Settings is kept, because it never lives in that file.
    file_sourced: Mutex<std::collections::HashSet<String>>,
}

impl McpState {
    pub fn new() -> Self {
        Self {
            clients: Mutex::new(HashMap::new()),
            configs: Mutex::new(Vec::new()),
            connecting: Mutex::new(()),
            file_sourced: Mutex::new(std::collections::HashSet::new()),
        }
    }

    pub(crate) fn connect_server(server: &McpServerConfig) -> Result<ConnectedClient, String> {
        if server.transport == McpTransport::Http {
            let url = server
                .url
                .as_ref()
                .filter(|u| !u.is_empty())
                .ok_or("HTTP MCP server missing url")?;
            if server.auth == McpAuthType::Oauth && get_token(&server.id).is_none() {
                return Err("NEEDS_AUTH".to_string());
            }
            let bearer = server
                .env
                .get("AUTHORIZATION")
                .or_else(|| server.env.get("Authorization"))
                .map(|v| {
                    let t = v.trim();
                    t.strip_prefix("Bearer ")
                        .or_else(|| t.strip_prefix("bearer "))
                        .unwrap_or(t)
                        .to_string()
                })
                .filter(|s| !s.is_empty());
            // Reached from async Tauri commands: `block_on` on a tokio worker panics
            // unless the worker is first moved to blocking mode via `block_in_place`.
            let rt = tokio::runtime::Handle::current();
            let auth = server.auth.clone();
            let headers: Vec<(String, String)> = server
                .headers
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect();
            let client = tokio::task::block_in_place(|| {
                rt.block_on(HttpMcpClient::connect(
                    &server.id,
                    &server.name,
                    url,
                    auth,
                    bearer,
                    headers,
                ))
            })?;
            return Ok(ConnectedClient::Http(client));
        }

        StdioClient::spawn(
            &server.id,
            &server.name,
            &server.command,
            &server.args,
            &server.env,
        )
        .map(ConnectedClient::Stdio)
    }

    pub fn sync_servers(&self, servers: Vec<McpServerConfig>) -> Result<Vec<McpStatusEntry>, String> {
        // This replaces every config and every connection at once, so it must not
        // interleave with a single-server upsert, restart or removal.
        let _connecting = self.connecting.lock().map_err(|e| e.to_string())?;
        {
            let mut configs = self.configs.lock().map_err(|e| e.to_string())?;
            *configs = servers.clone();
        }

        let mut statuses = Vec::new();
        // Built aside and swapped in at the end: the old connections keep
        // answering while the new ones handshake, instead of every server going
        // dark for the length of the sync.
        let mut fresh: HashMap<String, Arc<Mutex<ConnectedClient>>> = HashMap::new();

        for server in servers {
            if !server.enabled {
                statuses.push(McpStatusEntry {
                    id: server.id.clone(),
                    name: server.name.clone(),
                    status: McpServerStatus::Disabled,
                    tool_count: 0,
                    error: None,
                    auth: server.auth.clone(),
                });
                continue;
            }

            match Self::connect_server(&server) {
                Ok(client) => {
                    let tool_count = client.tools().len();
                    statuses.push(McpStatusEntry {
                        id: server.id.clone(),
                        name: server.name.clone(),
                        status: McpServerStatus::Connected,
                        tool_count,
                        error: client.last_error(),
                        auth: server.auth.clone(),
                    });
                    fresh.insert(server.id.clone(), Arc::new(Mutex::new(client)));
                }
                Err(e) if e == "NEEDS_AUTH" => {
                    statuses.push(McpStatusEntry {
                        id: server.id.clone(),
                        name: server.name.clone(),
                        status: McpServerStatus::NeedsAuth,
                        tool_count: 0,
                        // Auth pending is not an error — UI shows a Sign in CTA.
                        error: None,
                        auth: server.auth.clone(),
                    });
                }
                Err(e) => {
                    statuses.push(McpStatusEntry {
                        id: server.id.clone(),
                        name: server.name.clone(),
                        status: McpServerStatus::Error,
                        tool_count: 0,
                        error: Some(e),
                        auth: server.auth.clone(),
                    });
                }
            }
        }

        {
            let mut clients = self.clients.lock().map_err(|e| e.to_string())?;
            *clients = fresh;
        }

        Ok(statuses)
    }

    pub fn get_status(&self) -> Result<Vec<McpStatusEntry>, String> {
        // `configs` before `clients`: every other path that holds both takes
        // them in that order, and mixing the two can deadlock.
        let configs = self.configs.lock().map_err(|e| e.to_string())?;
        let clients = self.clients.lock().map_err(|e| e.to_string())?;

        Ok(configs
            .iter()
            .map(|cfg| {
                if !cfg.enabled {
                    return McpStatusEntry {
                        id: cfg.id.clone(),
                        name: cfg.name.clone(),
                        status: McpServerStatus::Disabled,
                        tool_count: 0,
                        error: None,
                        auth: cfg.auth.clone(),
                    };
                }
                if let Some(client) = clients.get(&cfg.id) {
                    let guard = client.lock().unwrap_or_else(|e| e.into_inner());
                    McpStatusEntry {
                        id: cfg.id.clone(),
                        name: cfg.name.clone(),
                        status: McpServerStatus::Connected,
                        tool_count: guard.tools().len(),
                        // Don't surface last tool-call failures as connection errors.
                        error: None,
                        auth: cfg.auth.clone(),
                    }
                } else if cfg.transport == McpTransport::Http
                    && cfg.auth == McpAuthType::Oauth
                    && get_token(&cfg.id).is_none()
                {
                    McpStatusEntry {
                        id: cfg.id.clone(),
                        name: cfg.name.clone(),
                        status: McpServerStatus::NeedsAuth,
                        tool_count: 0,
                        error: None,
                        auth: cfg.auth.clone(),
                    }
                } else if cfg.transport == McpTransport::Http
                    && cfg.auth == McpAuthType::Oauth
                    && get_token(&cfg.id).is_some()
                {
                    // Token saved but client not loaded yet — avoid yellow "Not connected".
                    McpStatusEntry {
                        id: cfg.id.clone(),
                        name: cfg.name.clone(),
                        status: McpServerStatus::Error,
                        tool_count: 0,
                        error: None,
                        auth: cfg.auth.clone(),
                    }
                } else {
                    McpStatusEntry {
                        id: cfg.id.clone(),
                        name: cfg.name.clone(),
                        status: McpServerStatus::Error,
                        tool_count: 0,
                        error: Some("Not connected".to_string()),
                        auth: cfg.auth.clone(),
                    }
                }
            })
            .collect())
    }

    pub fn all_tools(&self) -> Result<Vec<McpToolInfo>, String> {
        let clients = self.clients.lock().map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for client in clients.values() {
            let guard = client.lock().map_err(|e| e.to_string())?;
            out.extend(guard.tools().iter().cloned());
        }
        Ok(out)
    }

    #[allow(dead_code)]
    pub fn tools_as_openai_schema(&self) -> Result<Vec<Value>, String> {
        let configs = self.configs.lock().map_err(|e| e.to_string())?;
        let disabled: HashMap<&str, &Vec<String>> = configs
            .iter()
            .map(|c| (c.id.as_str(), &c.disabled_tools))
            .collect();
        Ok(self
            .all_tools()?
            .into_iter()
            .filter(|t| {
                !disabled
                    .get(t.server_id.as_str())
                    .map(|list| list.iter().any(|n| n == &t.name))
                    .unwrap_or(false)
            })
            .map(|t| {
                json!({
                    "type": "function",
                    "function": {
                        "name": t.qualified_name,
                        "description": format!("[MCP: {}] {}", t.server_name, t.description),
                        "parameters": t.input_schema,
                    }
                })
            })
            .collect())
    }

    /// Short catalog for `mcp_search`. Full schemas stay out of the cached tool prefix.
    pub fn search_catalog(&self, query: &str, limit: usize) -> Result<String, String> {
        let limit = limit.clamp(1, 8);
        let q = query.trim().to_ascii_lowercase();
        let mut tools = self.all_tools()?;
        tools.sort_by(|a, b| a.qualified_name.cmp(&b.qualified_name));
        let hits: Vec<_> = tools
            .into_iter()
            .filter(|t| {
                q.is_empty()
                    || t.qualified_name.to_ascii_lowercase().contains(&q)
                    || t.description.to_ascii_lowercase().contains(&q)
                    || t.server_name.to_ascii_lowercase().contains(&q)
            })
            .take(limit)
            .collect();
        if hits.is_empty() {
            return Ok("No connected MCP tools matched. Connect a server in Settings, or broaden the query.".into());
        }
        let hints: HashMap<String, String> = {
            let configs = self.configs.lock().map_err(|e| e.to_string())?;
            configs
                .iter()
                .filter_map(|c| {
                    let hint = c.skill_hint.as_ref()?.trim();
                    if hint.is_empty() {
                        None
                    } else {
                        Some((c.id.clone(), hint.to_string()))
                    }
                })
                .collect()
        };
        let mut hinted = std::collections::HashSet::new();
        let mut out = String::new();
        for tool in hits {
            let schema = serde_json::to_string(&tool.input_schema).unwrap_or_else(|_| "{}".into());
            let schema = if schema.chars().count() > 1_200 {
                let head: String = schema.chars().take(1_200).collect();
                format!("{head}…")
            } else {
                schema
            };
            let guidance = if hinted.insert(tool.server_id.clone()) {
                hints
                    .get(&tool.server_id)
                    .map(|hint| format!("\nguidance: {hint}"))
                    .unwrap_or_default()
            } else {
                String::new()
            };
            out.push_str(&format!(
                "name: {}\nserver: {}\n{}{guidance}\nargs: {}\n---\n",
                tool.qualified_name,
                tool.server_name,
                tool.description.trim(),
                schema
            ));
        }
        Ok(out)
    }

    pub fn call_tool(&self, qualified_name: &str, args_json: &str) -> Result<String, String> {
        let args: Value = serde_json::from_str(args_json)
            .map_err(|e| format!("Invalid MCP tool arguments JSON: {}", e))?;

        // Resolve the target client under the map lock, then drop it before the
        // network/stdio round-trip so status/sync/schema are not blocked.
        let target = {
            let configs = self.configs.lock().map_err(|e| e.to_string())?;
            let clients = self.clients.lock().map_err(|e| e.to_string())?;
            let mut found = None;
            for client in clients.values() {
                let guard = client.lock().map_err(|e| e.to_string())?;
                if let Some(tool) = guard
                    .tools()
                    .iter()
                    .find(|t| t.qualified_name == qualified_name)
                {
                    let blocked = configs
                        .iter()
                        .find(|c| c.id == tool.server_id)
                        .map(|c| c.disabled_tools.iter().any(|n| n == &tool.name))
                        .unwrap_or(false);
                    if blocked {
                        return Err(format!(
                            "MCP tool is disabled in Integrations: {}",
                            qualified_name
                        ));
                    }
                    found = Some((Arc::clone(client), tool.name.clone()));
                    break;
                }
            }
            found
        };

        let Some((client, name)) = target else {
            return Err(format!("Unknown MCP tool: {}", qualified_name));
        };

        let mut guard = client.lock().map_err(|e| e.to_string())?;
        let result = guard.call_tool(&name, args)?;
        let text = result
            .content
            .into_iter()
            .filter_map(|c| match c {
                ToolContent::Text { text } => Some(text),
            })
            .collect::<Vec<_>>()
            .join("\n");
        if result.is_error {
            return Err(text);
        }
        Ok(text)
    }

    /// Add or replace a single server without disturbing the others.
    ///
    /// The agent's `mcp_manage` tool writes `mcp.json` and then calls this: it
    /// reconnects just the changed server, so servers the user added through
    /// Settings (which never live in that file) keep running untouched.
    pub fn upsert_server(&self, server: McpServerConfig) -> Result<McpStatusEntry, String> {
        // Held across the connect so a second upsert for this server cannot
        // insert its client first and lose to the older connection.
        let _connecting = self.connecting.lock().map_err(|e| e.to_string())?;
        {
            let mut configs = self.configs.lock().map_err(|e| e.to_string())?;
            configs.retain(|c| c.id != server.id);
            configs.push(server.clone());
        }

        {
            let mut clients = self.clients.lock().map_err(|e| e.to_string())?;
            clients.remove(&server.id);
        }

        if !server.enabled {
            return Ok(McpStatusEntry {
                id: server.id.clone(),
                name: server.name.clone(),
                status: McpServerStatus::Disabled,
                tool_count: 0,
                error: None,
                auth: server.auth.clone(),
            });
        }

        // Connecting spawns a process or opens a socket. Doing that with the
        // map locked would stall `get_status`, `all_tools` and `call_tool` for
        // every other server until the handshake ends.
        match Self::connect_server(&server) {
            Ok(client) => {
                let entry = McpStatusEntry {
                    id: server.id.clone(),
                    name: server.name.clone(),
                    status: McpServerStatus::Connected,
                    tool_count: client.tools().len(),
                    error: client.last_error(),
                    auth: server.auth.clone(),
                };
                // A removal may have landed while the handshake was open. Read
                // the config map first: every path that takes both takes
                // `configs` before `clients`, and this one has to match.
                let still_configured = self
                    .configs
                    .lock()
                    .map(|c| c.iter().any(|s| s.id == server.id))
                    .unwrap_or(true);
                if !still_configured {
                    return Ok(McpStatusEntry {
                        id: server.id.clone(),
                        name: server.name.clone(),
                        status: McpServerStatus::Disabled,
                        tool_count: 0,
                        error: None,
                        auth: server.auth.clone(),
                    });
                }
                let mut clients = self.clients.lock().map_err(|e| e.to_string())?;
                clients.insert(server.id.clone(), Arc::new(Mutex::new(client)));
                Ok(entry)
            }
            Err(e) if e == "NEEDS_AUTH" => Ok(McpStatusEntry {
                id: server.id.clone(),
                name: server.name.clone(),
                status: McpServerStatus::NeedsAuth,
                tool_count: 0,
                error: None,
                auth: server.auth.clone(),
            }),
            Err(e) => Ok(McpStatusEntry {
                id: server.id.clone(),
                name: server.name.clone(),
                status: McpServerStatus::Error,
                tool_count: 0,
                error: Some(e),
                auth: server.auth.clone(),
            }),
        }
    }

    /// Forget a server and drop its connection. Returns false when it was not
    /// configured in the first place.
    pub fn remove_server(&self, server_id: &str) -> Result<bool, String> {
        // Same lock upsert holds while it connects: otherwise a removal can
        // finish first and the upsert then inserts the client it just removed.
        let _connecting = self.connecting.lock().map_err(|e| e.to_string())?;
        let removed = {
            let mut configs = self.configs.lock().map_err(|e| e.to_string())?;
            let before = configs.len();
            configs.retain(|c| c.id != server_id);
            configs.len() != before
        };
        let mut clients = self.clients.lock().map_err(|e| e.to_string())?;
        clients.remove(server_id);
        Ok(removed)
    }

    /// Ids the file provided at the last reload.
    pub fn file_sourced_ids(&self) -> std::collections::HashSet<String> {
        self.file_sourced.lock().map(|s| s.clone()).unwrap_or_default()
    }

    /// Remember which ids the file provided.
    pub fn remember_file_sourced(&self, ids: std::collections::HashSet<String>) {
        if let Ok(mut guard) = self.file_sourced.lock() {
            *guard = ids;
        }
    }

    /// Tools one connected server currently exposes.
    pub fn tools_for_server(&self, server_id: &str) -> Result<Vec<McpToolInfo>, String> {
        let clients = self.clients.lock().map_err(|e| e.to_string())?;
        let Some(client) = clients.get(server_id) else {
            return Ok(Vec::new());
        };
        let guard = client.lock().map_err(|e| e.to_string())?;
        Ok(guard.tools().to_vec())
    }

    /// Configured servers exactly as the running state holds them.
    pub fn configs_snapshot(&self) -> Vec<McpServerConfig> {
        self.configs
            .lock()
            .map(|c| c.clone())
            .unwrap_or_default()
    }

    /// Restart the current server.
    pub fn restart_server(&self, server_id: &str) -> Result<McpStatusEntry, String> {
        // Held across the connect, like `upsert_server`: otherwise an upsert can
        // finish between this read and this insert, and the older connection
        // wins. Reading the config keeps its own short lock.
        let _connecting = self.connecting.lock().map_err(|e| e.to_string())?;
        let server = {
            let configs = self.configs.lock().map_err(|e| e.to_string())?;
            configs
                .iter()
                .find(|s| s.id == server_id)
                .cloned()
                .ok_or_else(|| "Server not found".to_string())?
        };

        // Drop the old client, then connect with no map locked: a handshake can
        // take seconds and must not stall status or tool calls.
        {
            let mut clients = self.clients.lock().map_err(|e| e.to_string())?;
            clients.remove(server_id);
        }

        if !server.enabled {
            return Ok(McpStatusEntry {
                id: server.id,
                name: server.name,
                status: McpServerStatus::Disabled,
                tool_count: 0,
                error: None,
                auth: server.auth.clone(),
            });
        }

        match Self::connect_server(&server) {
            Ok(client) => {
                let entry = McpStatusEntry {
                    id: server.id.clone(),
                    name: server.name.clone(),
                    status: McpServerStatus::Connected,
                    tool_count: client.tools().len(),
                    error: client.last_error(),
                    auth: server.auth.clone(),
                };
                let mut clients = self.clients.lock().map_err(|e| e.to_string())?;
                clients.insert(server.id, Arc::new(Mutex::new(client)));
                Ok(entry)
            }
            Err(e) if e == "NEEDS_AUTH" => Ok(McpStatusEntry {
                id: server.id,
                name: server.name,
                status: McpServerStatus::NeedsAuth,
                tool_count: 0,
                error: None,
                auth: server.auth.clone(),
            }),
            Err(e) => Ok(McpStatusEntry {
                id: server.id,
                name: server.name,
                status: McpServerStatus::Error,
                tool_count: 0,
                error: Some(e),
                auth: server.auth.clone(),
            }),
        }
    }

    pub async fn start_server_oauth(&self, server_id: &str) -> Result<String, String> {
        let (server_id_owned, url, client_id) = {
            let configs = self.configs.lock().map_err(|e| e.to_string())?;
            let server = configs
                .iter()
                .find(|s| s.id == server_id)
                .cloned()
                .ok_or_else(|| "Server not found".to_string())?;
            let url = server
                .url
                .as_ref()
                .ok_or("HTTP MCP server missing url")?
                .clone();
            let client_id = server.oauth_client_id.clone();
            (server.id, url, client_id)
        };
        start_oauth(&server_id_owned, &url, client_id.as_deref()).await
    }
}
