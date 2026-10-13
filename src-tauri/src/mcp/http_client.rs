use crate::mcp::oauth::{ensure_fresh_token, get_token, refresh_access_token};
use crate::mcp::types::{CallToolResult, McpAuthType, McpToolInfo, ToolContent};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};

static REQUEST_ID: AtomicU64 = AtomicU64::new(1);

/// Headers the transport sets itself. A configured header with one of these
/// names would be appended as a duplicate and can break the session.
/// `authorization` is handled separately: it is the credential when the server
/// carries one in its config.
const RESERVED_HEADERS: &[&str] = &["accept", "content-type", "mcp-session-id"];

pub struct HttpMcpClient {
    pub server_id: String,
    pub server_name: String,
    pub url: String,
    pub auth: McpAuthType,
    /// Static bearer for auth:none + token paste (from mcp.json env).
    pub static_bearer: Option<String>,
    /// Extra headers from the server config (never logged).
    pub headers: Vec<(String, String)>,
    pub tools: Vec<McpToolInfo>,
    pub last_error: Option<String>,
    pub session_id: Option<String>,
    client: reqwest::Client,
}

/// Do the configured credential headers make this request carry a secret?
fn carries_credentials(
    headers: &[(String, String)],
    static_bearer: &Option<String>,
    auth: &McpAuthType,
) -> bool {
    !headers.is_empty()
        || static_bearer.as_ref().map(|t| !t.trim().is_empty()).unwrap_or(false)
        || *auth != McpAuthType::None
}

/// True when the URL points at this machine.
///
/// Plain http to a server you run yourself is fine; to anywhere else it would
/// put the credential on the wire in the clear. `localhost`, name suffixes that
/// end in it, and any literal loopback address (v4, v6, bracketed or not) count.
fn is_loopback_host(url: &reqwest::Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    let bare = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_ascii_lowercase();
    if bare == "localhost" || bare.ends_with(".localhost") {
        return true;
    }
    match bare.parse::<std::net::IpAddr>() {
        Ok(ip) => ip.is_loopback(),
        Err(_) => false,
    }
}

impl HttpMcpClient {
    pub async fn connect(
        server_id: &str,
        server_name: &str,
        url: &str,
        auth: McpAuthType,
        static_bearer: Option<String>,
        headers: Vec<(String, String)>,
    ) -> Result<Self, String> {
        // A dead endpoint must not hold a tool call open forever, and the
        // handshake must fail fast enough to leave a clear error.
        // A configured credential rides in a header, and reqwest only strips
        // `Authorization` and `Cookie` when a redirect leaves the origin. An
        // `X-Api-Key` would follow a redirect to whoever answered, so follow a
        // hop only when it stays on the same origin.
        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(15))
            .timeout(std::time::Duration::from_secs(300))
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() >= 5 {
                    return attempt.error("too many redirects");
                }
                let same_origin = attempt
                    .previous()
                    .first()
                    .map(|first| {
                        first.scheme() == attempt.url().scheme()
                            && first.host_str() == attempt.url().host_str()
                            && first.port_or_known_default()
                                == attempt.url().port_or_known_default()
                    })
                    .unwrap_or(false);
                if same_origin {
                    attempt.follow()
                } else {
                    attempt.error("cross-origin redirect refused: configured credentials would travel with it")
                }
            }))
            .build()
            .map_err(|e| format!("Could not build the MCP HTTP client: {e}"))?;

        // Plain http is fine for a server on this machine. Anywhere else it
        // would put the key or token on the wire in the clear.
        if let Ok(parsed) = reqwest::Url::parse(url) {
            if parsed.scheme() == "http" {
                if !is_loopback_host(&parsed)
                    && carries_credentials(&headers, &static_bearer, &auth)
                {
                    return Err(format!(
                        "Refusing to send credentials to {url} over plain http. Use an https URL, or keep the server on localhost."
                    ));
                }
            }
        }
        let mut http = Self {
            server_id: server_id.to_string(),
            server_name: server_name.to_string(),
            url: url.to_string(),
            auth,
            static_bearer,
            headers,
            tools: Vec::new(),
            last_error: None,
            session_id: None,
            client,
        };

        let token = http.resolve_token(true).await?;
        http.initialize(token.as_deref()).await?;
        http.tools = http.fetch_tools(token.as_deref()).await?;
        Ok(http)
    }

    /// `None` auth → optional static bearer. OAuth → load/refresh from keyring.
    async fn resolve_token(&self, proactive_refresh: bool) -> Result<Option<String>, String> {
        match self.auth {
            McpAuthType::None => Ok(self.static_bearer.clone()),
            McpAuthType::Oauth => {
                if proactive_refresh {
                    let tokens = ensure_fresh_token(&self.server_id).await?;
                    Ok(Some(tokens.access_token))
                } else {
                    let tokens = get_token(&self.server_id).ok_or_else(|| {
                        "Authentication required. Connect this MCP server in Settings → Integrations."
                            .to_string()
                    })?;
                    Ok(Some(tokens.access_token))
                }
            }
        }
    }

    async fn rpc(&mut self, token: Option<&str>, method: &str, params: Value) -> Result<Value, String> {
        match self.rpc_once(token, method, &params).await {
            Ok(v) => Ok(v),
            Err(err) if self.auth == McpAuthType::Oauth && is_unauthorized(&err) => {
                let refreshed = refresh_access_token(&self.server_id).await?;
                self.rpc_once(Some(&refreshed.access_token), method, &params)
                    .await
            }
            Err(err) => Err(err),
        }
    }

    async fn rpc_once(
        &mut self,
        token: Option<&str>,
        method: &str,
        params: &Value,
    ) -> Result<Value, String> {
        let id = REQUEST_ID.fetch_add(1, Ordering::SeqCst);
        let body = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });

        let mut req = self
            .client
            .post(&self.url)
            .header("Accept", "application/json, text/event-stream")
            .header("Content-Type", "application/json")
            .json(&body);

        if let Some(t) = token {
            if !t.is_empty() {
                req = req.header("Authorization", format!("Bearer {}", t));
            }
        }
        if let Some(sid) = &self.session_id {
            req = req.header("Mcp-Session-Id", sid);
        }
        // The transport owns Authorization when it has a token to send. With no
        // token, a configured header is the credential (an API key, say), so it
        // has to be sent rather than treated as a duplicate.
        let transport_auth = token.is_some() || self.auth == McpAuthType::Oauth;
        for (k, v) in &self.headers {
            if k.eq_ignore_ascii_case("authorization") {
                if transport_auth {
                    continue;
                }
            } else if RESERVED_HEADERS.iter().any(|r| k.eq_ignore_ascii_case(r)) {
                // Protocol headers are set above. A second copy of one of these
                // can break the transport.
                continue;
            }
            req = req.header(k, v);
        }

        let resp = req
            .send()
            .await
            .map_err(|e| format!("HTTP MCP request failed: {}", e))?;

        if let Some(sid) = resp.headers().get("mcp-session-id").and_then(|v| v.to_str().ok()) {
            self.session_id = Some(sid.to_string());
        }

        let status = resp.status();
        let content_type = resp
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        let text = resp
            .text()
            .await
            .map_err(|e| format!("Failed to read MCP response: {}", e))?;

        if status.as_u16() == 401 {
            return Err(format!("HTTP MCP error {}: {}", status, text));
        }
        if !status.is_success() {
            return Err(format!("HTTP MCP error {}: {}", status, text));
        }

        let json = if content_type.contains("text/event-stream") || text.trim_start().starts_with("event:") {
            parse_sse_jsonrpc(&text)?
        } else {
            serde_json::from_str::<Value>(&text)
                .map_err(|e| format!("Invalid MCP JSON response: {}", e))?
        };

        if let Some(err) = json.get("error") {
            return Err(err.to_string());
        }

        // notifications/initialized may omit result
        if method.starts_with("notifications/") {
            return Ok(json.get("result").cloned().unwrap_or(Value::Null));
        }

        json.get("result")
            .cloned()
            .ok_or_else(|| "Missing result in MCP response".to_string())
    }

    async fn initialize(&mut self, token: Option<&str>) -> Result<(), String> {
        self.rpc(
            token,
            "initialize",
            json!({
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": { "name": "bettershape", "version": "1.0.0" }
            }),
        )
        .await?;
        let _ = self
            .rpc(token, "notifications/initialized", json!({}))
            .await;
        Ok(())
    }

    async fn fetch_tools(&mut self, token: Option<&str>) -> Result<Vec<McpToolInfo>, String> {
        let result = self.rpc(token, "tools/list", json!({})).await?;
        let tools = result
            .get("tools")
            .and_then(|t| t.as_array())
            .cloned()
            .unwrap_or_default();

        Ok(tools
            .into_iter()
            .filter_map(|t| {
                let name = t.get("name")?.as_str()?.to_string();
                let description = t
                    .get("description")
                    .and_then(|d| d.as_str())
                    .unwrap_or("")
                    .to_string();
                let input_schema = t
                    .get("inputSchema")
                    .cloned()
                    .unwrap_or(json!({"type": "object"}));
                Some(McpToolInfo {
                    server_id: self.server_id.clone(),
                    server_name: self.server_name.clone(),
                    name: name.clone(),
                    qualified_name: format!(
                        "mcp_{}_{}",
                        crate::mcp::client::sanitize_name(&self.server_id),
                        crate::mcp::client::sanitize_name(&name)
                    ),
                    description,
                    input_schema,
                })
            })
            .collect())
    }

    pub fn call_tool(&mut self, name: &str, args: Value) -> Result<CallToolResult, String> {
        let rt = tokio::runtime::Handle::current();
        let result = tokio::task::block_in_place(|| {
            rt.block_on(async {
                let token = self.resolve_token(true).await?;
                self.rpc(
                    token.as_deref(),
                    "tools/call",
                    json!({ "name": name, "arguments": args }),
                )
                .await
            })
        })?;

        let is_error = result
            .get("isError")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let content = result
            .get("content")
            .and_then(|c| c.as_array())
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|item| {
                let text = item.get("text")?.as_str()?.to_string();
                Some(ToolContent::Text { text })
            })
            .collect();

        Ok(CallToolResult { content, is_error })
    }
}

fn is_unauthorized(err: &str) -> bool {
    err.contains("401") || err.to_lowercase().contains("unauthorized")
}

/// Extract the last JSON-RPC message from an SSE body (`data: {...}` lines).
fn parse_sse_jsonrpc(body: &str) -> Result<Value, String> {
    let mut last: Option<Value> = None;
    for line in body.lines() {
        let trimmed = line.trim();
        let data = if let Some(rest) = trimmed.strip_prefix("data:") {
            rest.trim()
        } else if trimmed.starts_with('{') {
            trimmed
        } else {
            continue;
        };
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<Value>(data) {
            last = Some(v);
        }
    }
    last.ok_or_else(|| "No JSON-RPC payload in SSE response".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(text: &str) -> reqwest::Url {
        reqwest::Url::parse(text).expect("url")
    }

    #[test]
    fn loopback_hosts_are_recognised() {
        assert!(is_loopback_host(&url("http://localhost:3000/mcp")));
        assert!(is_loopback_host(&url("http://127.0.0.1:3000/mcp")));
        assert!(is_loopback_host(&url("http://127.5.5.5/mcp")));
        assert!(is_loopback_host(&url("http://[::1]:3000/mcp")));
        assert!(is_loopback_host(&url("http://api.localhost/mcp")));
    }

    #[test]
    fn every_other_host_is_not_loopback() {
        assert!(!is_loopback_host(&url("http://mcp.example.com/mcp")));
        assert!(!is_loopback_host(&url("http://10.0.0.7:8080/mcp")));
        assert!(!is_loopback_host(&url("http://[2001:db8::1]/mcp")));
        // A name that merely mentions it is not it.
        assert!(!is_loopback_host(&url("http://localhost.evil.com/mcp")));
    }

    #[test]
    fn credentials_are_seen_in_any_of_the_three_places() {
        let none: Vec<(String, String)> = Vec::new();
        assert!(!carries_credentials(&none, &None, &McpAuthType::None));
        assert!(carries_credentials(
            &[("X-Api-Key".into(), "k".into())],
            &None,
            &McpAuthType::None
        ));
        assert!(carries_credentials(
            &none,
            &Some("token".into()),
            &McpAuthType::None
        ));
        assert!(carries_credentials(&none, &None, &McpAuthType::Oauth));
        // An empty bearer is not a credential.
        assert!(!carries_credentials(&none, &Some("   ".into()), &McpAuthType::None));
    }
}
