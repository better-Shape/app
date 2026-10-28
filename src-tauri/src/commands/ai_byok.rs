//! BYOK diagnostics and secret storage.
//!
//! Two jobs the BYOK story needs beyond "push a key and hope":
//!
//! 1. **Test a connection** — ask the provider for its model list with the key
//!    the user just typed. That verifies the key *and* the base URL, and the
//!    answer doubles as model discovery, so people can import the ids their
//!    account actually serves instead of trusting a hardcoded preset list.
//! 2. **Keep keys off disk** — provider keys live in the OS keychain (Keychain
//!    on macOS, Credential Manager on Windows, Secret Service on Linux) rather
//!    than in the settings JSON. Settings keep the non-secret fields, and the
//!    keychain is hydrated at launch.
//!
//! Every command here is local: the only network traffic is the user's own
//! request to the provider they configured.

use std::collections::HashMap;
use std::time::Instant;

use serde::Serialize;

use crate::core::ai_providers::{self, ProviderKind, ResolvedProvider};
use crate::core::error::AppError;

/// Keychain service name for model-provider credentials.
const VAULT_SERVICE: &str = "bettershape-ai";
/// How long a test request may take before it is reported as unreachable.
const TEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);
/// Upper bound on discovered model ids sent back to the UI.
const MAX_DISCOVERED_MODELS: usize = 300;
/// Prompt for the live completion check. Short enough to cost nothing.
const CHECK_PROMPT: &str = "Reply with the single word: pong";
/// Public OpenRouter catalog feed providing `{ data: [...] }` metadata.
const PUBLIC_MODEL_CATALOG_URL: &str = "https://openrouter.ai/api/v1/models";
/// Upper bound on downloaded public catalog bytes so untrusted payloads stay bounded.
const MAX_MODEL_CATALOG_BYTES: usize = 8 * 1024 * 1024;

/// Result of probing one provider connection.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTestReport {
    /// True when the provider answered the model-list request.
    pub ok: bool,
    /// HTTP status, or 0 when the request never completed.
    pub status: u16,
    /// User-facing summary (or the actionable error text).
    pub message: String,
    /// Model ids the provider reports for this key.
    pub models: Vec<String>,
    pub latency_ms: u64,
}

fn kind_from_str(raw: Option<&str>) -> ProviderKind {
    match raw.unwrap_or_default().trim().to_ascii_lowercase().as_str() {
        "anthropic" => ProviderKind::Anthropic,
        "google" => ProviderKind::Google,
        _ => ProviderKind::OpenAi,
    }
}

/// Route a diagnostics call to either the saved connection or the values the
/// user is editing right now, so "Test" works before the first save.
fn resolve_target(
    provider_id: &str,
    kind: Option<&str>,
    api_key: Option<&str>,
    base_url: Option<&str>,
) -> Result<ResolvedProvider, AppError> {
    let id = provider_id.trim();
    if id.is_empty() {
        return Err(AppError::Message("Provider id is required.".to_string()));
    }
    let mut provider = match ai_providers::provider_by_id(id) {
        Some(provider) => provider,
        None => {
            let kind = kind_from_str(kind);
            let raw = base_url.unwrap_or_default().trim().to_string();
            let base = ai_providers::normalize_base_url(&raw, kind).map_err(AppError::Message)?;
            ResolvedProvider {
                id: id.to_string(),
                kind,
                label: id.to_string(),
                api_key: String::new(),
                base_url: base,
                headers: HashMap::new(),
                auth_style: String::new(),
            }
        }
    };
    if let Some(key) = api_key {
        provider.api_key = key.trim().to_string();
    }
    if let Some(url) = base_url {
        let trimmed = url.trim().trim_end_matches('/');
        if !trimmed.is_empty() {
            ai_providers::normalize_base_url(trimmed, provider.kind).map_err(AppError::Message)?;
            provider.base_url = trimmed.to_string();
        }
    }
    Ok(provider)
}

/// Model ids out of a provider's list response, in the provider's own naming.
fn collect_models(kind: ProviderKind, body: &str) -> Vec<String> {
    let Ok(json) = serde_json::from_str::<serde_json::Value>(body) else {
        return Vec::new();
    };
    let mut out: Vec<String> = Vec::new();
    match kind {
        ProviderKind::OpenAi | ProviderKind::Anthropic => {
            let items = json.get("data").and_then(|d| d.as_array());
            if let Some(items) = items {
                for item in items {
                    if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                        out.push(id.trim().to_string());
                    }
                }
            }
        }
        ProviderKind::Google => {
            let items = json.get("models").and_then(|d| d.as_array());
            if let Some(items) = items {
                for item in items {
                    // Google lists embedding and other special-purpose models too;
                    // only ones that can generate content belong in a chat picker.
                    let supports_chat = item
                        .get("supportedGenerationMethods")
                        .and_then(|m| m.as_array())
                        .map(|methods| {
                            methods
                                .iter()
                                .any(|m| m.as_str() == Some("generateContent"))
                        })
                        .unwrap_or(true);
                    if !supports_chat {
                        continue;
                    }
                    if let Some(name) = item.get("name").and_then(|v| v.as_str()) {
                        out.push(name.trim().trim_start_matches("models/").to_string());
                    }
                }
            }
        }
    }
    out.retain(|model| !model.is_empty());
    out.sort();
    out.dedup();
    out.truncate(MAX_DISCOVERED_MODELS);
    out
}

fn apply_diagnostic_overrides(
    provider: &mut ResolvedProvider,
    headers: Option<HashMap<String, String>>,
    auth_style: Option<String>,
) {
    if let Some(headers) = headers {
        provider.headers = headers
            .into_iter()
            .map(|(name, value)| (name.trim().to_string(), value.trim().to_string()))
            .filter(|(name, value)| !name.is_empty() && !value.is_empty())
            .collect();
    }
    if let Some(style) = auth_style {
        let style = style.trim().to_ascii_lowercase();
        if !style.is_empty() {
            provider.auth_style = style;
        }
    }
}

/// Probe one provider: key validity, base URL, and the models it serves.
#[tauri::command]
pub async fn ai_test_provider(
    provider_id: String,
    kind: Option<String>,
    api_key: Option<String>,
    base_url: Option<String>,
    headers: Option<HashMap<String, String>>,
    auth_style: Option<String>,
) -> Result<ProviderTestReport, AppError> {
    let mut provider = resolve_target(
        &provider_id,
        kind.as_deref(),
        api_key.as_deref(),
        base_url.as_deref(),
    )?;
    apply_diagnostic_overrides(&mut provider, headers, auth_style);
    if provider.api_key.trim().is_empty()
        && !ai_providers::is_keyless_provider_id(&provider.id)
        && !provider.auth_style.trim().eq_ignore_ascii_case("none")
    {
        return Err(AppError::Message(format!(
            "Enter an API key for {} before testing the connection.",
            provider.label_or_id()
        )));
    }
    let client = reqwest::Client::builder()
        .timeout(TEST_TIMEOUT)
        .build()
        .map_err(AppError::Network)?;

    // Same headers the agent sends: identification, the connection's own
    // headers, and the key in whichever header this connection asks for.
    let request = match provider.kind {
        ProviderKind::OpenAi => client.get(format!("{}/models", provider.base_url)),
        ProviderKind::Anthropic => client
            .get(format!("{}/v1/models?limit=100", provider.base_url))
            .header("anthropic-version", "2023-06-01"),
        ProviderKind::Google => {
            client.get(format!("{}/v1beta/models?pageSize=200", provider.base_url))
        }
    }
    .header("Accept", "application/json")
    .headers(ai_providers::request_headers(&provider));

    let label = provider.label_or_id().to_string();
    let started = Instant::now();
    let response = request.send().await?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    let latency_ms = started.elapsed().as_millis() as u64;

    if !status.is_success() {
        return Ok(ProviderTestReport {
            ok: false,
            status: status.as_u16(),
            message: ai_providers::describe_http_error(&label, status.as_u16(), &body),
            models: Vec::new(),
            latency_ms,
        });
    }

    let models = collect_models(provider.kind, &body);

    // OpenCode's gateways serve `/models` to anyone, so a 200 here says nothing
    // about the key. Ask a free model to answer instead.
    if ai_providers::is_opencode_gateway(&provider) {
        return probe_opencode_connection(&client, &provider, &label, models, latency_ms).await;
    }

    let message = if models.is_empty() {
        format!("{label} answered with {status}, but listed no models for this key.")
    } else {
        format!(
            "{label} is reachable — {} model{} available.",
            models.len(),
            if models.len() == 1 { "" } else { "s" }
        )
    };
    Ok(ProviderTestReport {
        ok: true,
        status: status.as_u16(),
        message,
        models,
        latency_ms,
    })
}

/// Ask an OpenCode gateway for one real answer.
///
/// Free ids are tried first: they answer for any Console account, so a success
/// means "key works and the free models are usable", and a refusal surfaces the
/// gateway's own reason instead of the anonymous model list hiding it.
async fn probe_opencode_connection(
    client: &reqwest::Client,
    provider: &ResolvedProvider,
    label: &str,
    models: Vec<String>,
    list_latency_ms: u64,
) -> Result<ProviderTestReport, AppError> {
    let probe_model = models
        .iter()
        .find(|id| id.ends_with("-free"))
        .or_else(|| models.iter().find(|id| id.as_str() == "big-pickle"))
        .or_else(|| models.first())
        .cloned()
        .unwrap_or_else(|| "big-pickle".to_string());
    let model = strip_provider_prefix(&provider.id, &probe_model);

    let body = serde_json::json!({
        "model": model,
        "messages": [{ "role": "user", "content": CHECK_PROMPT }],
        "max_tokens": 16,
        "stream": false,
    });

    let started = Instant::now();
    let response = crate::agent::commands::provider_wire::request(
        client,
        provider,
        &model,
        &body,
        false,
        Some("bettershape-connection-test"),
    )
    .send()
    .await?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    let probe_latency_ms = started.elapsed().as_millis() as u64;

    let (ok, message) = opencode_probe_verdict(
        label,
        status.as_u16(),
        &text,
        &model,
        models.len(),
        probe_latency_ms,
    );
    Ok(ProviderTestReport {
        ok,
        status: status.as_u16(),
        message,
        models,
        latency_ms: list_latency_ms.max(probe_latency_ms),
    })
}

/// Verdict for an OpenCode gateway probe. Pure so it can be tested offline.
fn opencode_probe_verdict(
    label: &str,
    status: u16,
    body: &str,
    model: &str,
    listed: usize,
    latency_ms: u64,
) -> (bool, String) {
    if (200..300).contains(&status) {
        return (
            true,
            format!(
                "{label} accepted the key — `{model}` answered in {latency_ms} ms, and {listed} model{} are listed for it.",
                if listed == 1 { "" } else { "s" }
            ),
        );
    }
    (
        false,
        ai_providers::describe_http_error(label, status, body),
    )
}

/// First text out of a completion response, whatever wire format produced it.
fn first_reply_text(kind: ProviderKind, body: &str) -> Option<String> {
    let json: serde_json::Value = serde_json::from_str(body).ok()?;
    let text = match kind {
        ProviderKind::OpenAi => json
            .get("choices")?
            .as_array()?
            .first()?
            .get("message")?
            .get("content")?,
        ProviderKind::Anthropic => json.get("content")?.as_array()?.first()?.get("text")?,
        ProviderKind::Google => json
            .get("candidates")?
            .as_array()?
            .first()?
            .get("content")?
            .get("parts")?
            .as_array()?
            .first()?
            .get("text")?,
    };
    let text = text.as_str()?.trim();
    if text.is_empty() {
        return None;
    }
    Some(text.chars().take(200).collect())
}

/// Strip the `provider/` prefix the settings UI stores model ids with.
fn strip_provider_prefix(id: &str, model: &str) -> String {
    let prefix = format!("{}/", id.trim());
    model
        .trim()
        .strip_prefix(&prefix)
        .unwrap_or(model.trim())
        .to_string()
}

/// Model to test a connection with when the caller did not name one: the first
/// model the user enabled for it, else the app default when it belongs to it.
fn saved_model(provider_id: &str) -> Option<String> {
    let config = ai_providers::get_config()?;
    let id = provider_id.trim();
    let entry = config
        .providers
        .iter()
        .find(|p| p.id.eq_ignore_ascii_case(id))?;
    if let Some(model) = entry.models.first() {
        let slug = strip_provider_prefix(&entry.id, model);
        if !slug.is_empty() {
            return Some(slug);
        }
    }
    let default = config.default_model.trim();
    let (prefix, rest) = default.split_once('/')?;
    if prefix.eq_ignore_ascii_case(&entry.id) && !rest.is_empty() {
        return Some(rest.to_string());
    }
    None
}

/// Send one tiny completion through the same wire the agent uses.
///
/// The model-list probe proves a key is valid; this proves a *completion* works:
/// the wire format, the auth header, the connection's extra headers, and the
/// model slug. If the list probe says "key accepted" and this says "answer
/// received", a chat will work.
#[tauri::command]
pub async fn ai_check_provider(
    provider_id: String,
    kind: Option<String>,
    api_key: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
    headers: Option<HashMap<String, String>>,
    auth_style: Option<String>,
) -> Result<ProviderTestReport, AppError> {
    let mut provider = resolve_target(
        &provider_id,
        kind.as_deref(),
        api_key.as_deref(),
        base_url.as_deref(),
    )?;
    apply_diagnostic_overrides(&mut provider, headers, auth_style);
    if provider.api_key.trim().is_empty()
        && !ai_providers::is_keyless_provider_id(&provider.id)
        && !provider.auth_style.trim().eq_ignore_ascii_case("none")
    {
        return Err(AppError::Message(format!(
            "Enter an API key for {} before checking chat.",
            provider.label_or_id()
        )));
    }

    let requested = model.unwrap_or_default();
    let model = if requested.trim().is_empty() {
        saved_model(&provider_id).ok_or_else(|| {
            AppError::Message(
                "Pick a model for this connection before checking it — the check sends one real request.".to_string(),
            )
        })?
    } else {
        strip_provider_prefix(&provider_id, &requested)
    };

    let client = reqwest::Client::builder()
        .timeout(TEST_TIMEOUT)
        .build()
        .map_err(AppError::Network)?;

    let label = provider.label_or_id().to_string();
    let body = serde_json::json!({
        "model": model,
        "messages": [{ "role": "user", "content": CHECK_PROMPT }],
        "max_tokens": 24,
        "stream": false,
    });

    let started = Instant::now();
    // A stable session id: OpenCode's gateways ask every coding agent for one
    // and answer 400 without it.
    let response = crate::agent::commands::provider_wire::request(
        &client,
        &provider,
        &model,
        &body,
        false,
        Some("bettershape-connection-check"),
    )
    .send()
    .await?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    let latency_ms = started.elapsed().as_millis() as u64;

    if !status.is_success() {
        return Ok(ProviderTestReport {
            ok: false,
            status: status.as_u16(),
            message: ai_providers::describe_http_error(&label, status.as_u16(), &text),
            models: Vec::new(),
            latency_ms,
        });
    }

    let message = match first_reply_text(provider.kind, &text) {
        Some(reply) => format!("{label} answered in {latency_ms} ms: \"{reply}\"."),
        None => format!("{label} answered with {status}, but returned no text — the model may be a non-chat endpoint."),
    };
    Ok(ProviderTestReport {
        ok: true,
        status: status.as_u16(),
        message,
        models: Vec::new(),
        latency_ms,
    })
}

/// Parses and validates a bounded JSON model-catalog envelope (`{ "data": [...] }`).
fn parse_model_catalog_body(bytes: &[u8]) -> Result<serde_json::Value, AppError> {
    if bytes.len() > MAX_MODEL_CATALOG_BYTES {
        return Err(AppError::Message(
            "Model catalog payload exceeded the maximum allowed size.".to_string(),
        ));
    }
    let body: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|err| AppError::Message(format!("Invalid model catalog JSON: {err}")))?;
    if body
        .get("data")
        .and_then(serde_json::Value::as_array)
        .is_none()
    {
        return Err(AppError::Message(
            "Model catalog response did not contain a data array.".to_string(),
        ));
    }
    Ok(body)
}

/// Fetch the public OpenRouter model catalog from the Rust backend so the
/// renderer never calls an external origin directly.
#[tauri::command]
pub async fn ai_fetch_model_catalog() -> Result<serde_json::Value, AppError> {
    let client = reqwest::Client::builder()
        .timeout(TEST_TIMEOUT)
        .build()
        .map_err(AppError::Network)?;

    let mut response = client
        .get(PUBLIC_MODEL_CATALOG_URL)
        .header("Accept", "application/json")
        .send()
        .await?;

    let status = response.status();
    if !status.is_success() {
        return Err(AppError::Message(format!(
            "Model catalog endpoint answered with HTTP {}.",
            status.as_u16()
        )));
    }
    if response
        .content_length()
        .is_some_and(|len| len > MAX_MODEL_CATALOG_BYTES as u64)
    {
        return Err(AppError::Message(
            "Model catalog payload exceeded the maximum allowed size.".to_string(),
        ));
    }

    let mut buffer = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if buffer.len().saturating_add(chunk.len()) > MAX_MODEL_CATALOG_BYTES {
            return Err(AppError::Message(
                "Model catalog payload exceeded the maximum allowed size.".to_string(),
            ));
        }
        buffer.extend_from_slice(&chunk);
    }

    parse_model_catalog_body(&buffer)
}

/// True when the OS keychain can actually hold secrets on this machine.
///
/// A missing entry is the healthy answer: it proves the backend was reachable.
#[tauri::command]
pub fn ai_vault_supported() -> bool {
    // Other windows must keep using the shared authority if the keychain locks
    // after an earlier window initialized it. Logical clears still take effect.
    if crate::core::ai_vault::VAULT
        .lock()
        .map(|vault| vault.has_entries())
        .unwrap_or(false)
    {
        return true;
    }
    match keyring::Entry::new(VAULT_SERVICE, "__probe__") {
        Ok(entry) => matches!(entry.get_password(), Err(keyring::Error::NoEntry)),
        Err(_) => false,
    }
}

/// Store or clear a credential using the WebView's last observed lease.
#[tauri::command]
pub fn ai_store_key(
    provider_id: String,
    api_key: String,
    expected_revision: String,
    scope: Option<String>,
) -> Result<crate::core::ai_vault::Mutation, AppError> {
    use crate::core::ai_vault::{self, VAULT};
    let id = provider_id.trim();
    if id.is_empty() {
        return Err(AppError::Message("Provider id is required.".into()));
    }
    if !api_key.trim().is_empty()
        && scope
            .as_ref()
            .is_none_or(|value| value.is_empty() || value.len() > 16_384)
    {
        return Err(AppError::Message(
            "A credential destination is required.".into(),
        ));
    }
    let mut vault = VAULT
        .lock()
        .map_err(|_| AppError::Message("Credential coordinator unavailable.".into()))?;
    // Initialize the native lease from durable keychain state, never from the
    // submitting WebView's cached value.
    vault.read(id, || load_vault_snapshot(id))?;
    let result = vault.write_scoped(
        id,
        api_key.trim(),
        &expected_revision,
        scope.as_deref(),
        |snapshot| {
            keyring_entry(id)
                .and_then(|entry| {
                    let encoded = ai_vault::encode(snapshot)
                        .map_err(|error| AppError::Message(error.to_string()))?;
                    entry
                        .set_password(&encoded)
                        .map_err(|error| AppError::Message(error.to_string()))
                })
                .is_ok()
        },
    );
    if result.applied && result.current.api_key.is_empty() {
        if let Some(mut config) = ai_providers::get_config() {
            ai_vault::clear_config_credential(id, &mut config);
            ai_providers::set_config(config);
        }
    }
    Ok(result)
}

/// Clear the secret, retaining its non-secret generation to fence old writers.
#[tauri::command]
pub fn ai_delete_key(
    provider_id: String,
    expected_revision: String,
) -> Result<crate::core::ai_vault::Mutation, AppError> {
    ai_store_key(provider_id, String::new(), expected_revision, None)
}

fn load_vault_snapshot(id: &str) -> Result<crate::core::ai_vault::Snapshot, AppError> {
    let password = match keyring_entry(id)?.get_password() {
        Ok(value) => Some(value),
        Err(keyring::Error::NoEntry) => None,
        Err(error) => {
            return Err(AppError::Message(format!(
                "Could not read the OS keychain: {error}"
            )))
        }
    };
    crate::core::ai_vault::decode(id, password.as_deref()).map_err(|_| {
        AppError::Message("Stored credential record is invalid; refusing to overwrite it.".into())
    })
}

/// Include empty entries: every caller needs the lease for a missing/cleared key.
#[tauri::command]
pub fn ai_load_keys(
    provider_ids: Vec<String>,
) -> Result<Vec<crate::core::ai_vault::ReadResult>, AppError> {
    let mut vault = crate::core::ai_vault::VAULT
        .lock()
        .map_err(|_| AppError::Message("Credential coordinator unavailable.".into()))?;
    Ok(provider_ids
        .into_iter()
        .filter(|id| !id.trim().is_empty())
        .map(|id| {
            let id = id.trim();
            vault.read_result(id, || load_vault_snapshot(id))
        })
        .collect())
}

fn keyring_entry(provider_id: &str) -> Result<keyring::Entry, AppError> {
    keyring::Entry::new(VAULT_SERVICE, provider_id)
        .map_err(|error| AppError::Message(format!("The OS keychain is unavailable: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openai_style_model_lists_are_flattened() {
        let body = r#"{"object":"list","data":[{"id":"gpt-5"},{"id":"gpt-4.1"},{"id":"gpt-5"}]}"#;
        assert_eq!(
            collect_models(ProviderKind::OpenAi, body),
            vec!["gpt-4.1".to_string(), "gpt-5".to_string()]
        );
    }

    #[test]
    fn google_models_drop_the_prefix_and_non_chat_entries() {
        let body = r#"{"models":[
            {"name":"models/gemini-2.5-pro","supportedGenerationMethods":["generateContent","countTokens"]},
            {"name":"models/text-embedding-004","supportedGenerationMethods":["embedContent"]},
            {"name":"models/gemini-2.5-flash","supportedGenerationMethods":["generateContent"]}
        ]}"#;
        assert_eq!(
            collect_models(ProviderKind::Google, body),
            vec!["gemini-2.5-flash".to_string(), "gemini-2.5-pro".to_string()]
        );
    }

    #[test]
    fn malformed_bodies_yield_no_models() {
        assert!(collect_models(ProviderKind::OpenAi, "<html>nope</html>").is_empty());
        assert!(collect_models(ProviderKind::Anthropic, "{}").is_empty());
    }

    #[test]
    fn unsaved_connections_can_still_be_tested() {
        // An id no test configures resolves from the arguments instead.
        let target = resolve_target(
            "diag-connection-only",
            Some("openai"),
            Some("local-key"),
            Some("http://127.0.0.1:11434/v1/"),
        )
        .expect("target");
        assert_eq!(target.base_url, "http://127.0.0.1:11434/v1");
        assert_eq!(target.api_key, "local-key");
        assert_eq!(target.kind, ProviderKind::OpenAi);

        // A base URL without a scheme is rejected before any request is made.
        assert!(resolve_target(
            "diag-connection-only",
            Some("openai"),
            None,
            Some("127.0.0.1:11434")
        )
        .is_err());
        assert!(resolve_target("  ", Some("openai"), None, None).is_err());
    }

    #[test]
    fn reply_text_is_read_from_every_wire() {
        let openai = r#"{"choices":[{"message":{"role":"assistant","content":"pong"}}]}"#;
        assert_eq!(
            first_reply_text(ProviderKind::OpenAi, openai),
            Some("pong".to_string())
        );

        let anthropic = r#"{"content":[{"type":"text","text":"pong"}],"stop_reason":"end_turn"}"#;
        assert_eq!(
            first_reply_text(ProviderKind::Anthropic, anthropic),
            Some("pong".to_string())
        );

        let google = r#"{"candidates":[{"content":{"parts":[{"text":"pong"}]}}]}"#;
        assert_eq!(
            first_reply_text(ProviderKind::Google, google),
            Some("pong".to_string())
        );

        // A 200 with no text (tool call, empty stream) is not a reply.
        assert_eq!(
            first_reply_text(ProviderKind::OpenAi, r#"{"choices":[]}"#),
            None
        );
        assert_eq!(first_reply_text(ProviderKind::OpenAi, "not json"), None);
    }

    #[test]
    fn model_ids_lose_their_provider_prefix() {
        assert_eq!(
            strip_provider_prefix("nvidia", "nvidia/deepseek-ai/deepseek-r1"),
            "deepseek-ai/deepseek-r1"
        );
        assert_eq!(strip_provider_prefix("nvidia", "plain-slug"), "plain-slug");
        assert_eq!(strip_provider_prefix("nvidia", "  nvidia/x  "), "x");
    }

    #[test]
    fn a_keyless_model_list_is_not_mistaken_for_a_working_key() {
        // `/models` answers anonymously on OpenCode's gateways, so the test has
        // to rely on the live probe. A refusal keeps the provider failing and
        // the gateway's own reason is what the user sees.
        let (ok, message) = opencode_probe_verdict(
            "OpenCode Zen",
            403,
            r#"{"error":{"type":"FreeTierError","message":"OpenCode's free tier can only be used from within OpenCode."}}"#,
            "ling-3.1-flash-free",
            89,
            12,
        );
        assert!(!ok);
        assert!(message.contains("opencode.ai/console"), "{message}");

        let (ok, message) = opencode_probe_verdict(
            "OpenCode Zen",
            200,
            r#"{"choices":[{"message":{"content":"pong"}}]}"#,
            "ling-3.1-flash-free",
            89,
            431,
        );
        assert!(ok);
        assert!(message.contains("ling-3.1-flash-free"), "{message}");
        assert!(message.contains("431"), "{message}");
        assert!(message.contains("89 models"), "{message}");

        // A Go subscription that is missing answers 401 with its own wording.
        let (ok, message) = opencode_probe_verdict(
            "OpenCode Go",
            401,
            r#"{"error":{"type":"server_error","message":"Upstream request failed: Go requires a credential"}}"#,
            "longcat-2.5-preview-free",
            23,
            9,
        );
        assert!(!ok);
        assert!(message.contains("opencode.ai/console"), "{message}");
    }

    #[test]
    fn anthropic_kind_is_mapped_from_the_argument() {
        assert_eq!(kind_from_str(Some("Anthropic")), ProviderKind::Anthropic);
        assert_eq!(kind_from_str(Some("google")), ProviderKind::Google);
        assert_eq!(kind_from_str(None), ProviderKind::OpenAi);
    }

    #[test]
    fn diagnostic_overrides_preserve_none_auth_style_for_unsaved_providers() {
        let mut target = resolve_target(
            "diag-local-gateway",
            Some("openai"),
            None,
            Some("http://127.0.0.1:8080/v1"),
        )
        .expect("target");
        let mut hdrs = HashMap::new();
        hdrs.insert(" X-Custom ".to_string(), " ok ".to_string());
        apply_diagnostic_overrides(&mut target, Some(hdrs), Some(" None ".to_string()));
        assert_eq!(target.auth_style, "none");
        let custom = target.headers.get("X-Custom").map(String::as_str);
        assert_eq!(custom, Some("ok"));
    }

    #[test]
    fn model_catalog_body_validation_bounds_and_checks_data_envelope() {
        let valid = parse_model_catalog_body(br#"{"data":[{"id":"openai/gpt-4o-mini"}]}"#)
            .expect("valid catalog envelope");
        assert_eq!(
            valid
                .get("data")
                .and_then(serde_json::Value::as_array)
                .map(Vec::len),
            Some(1)
        );
        assert!(parse_model_catalog_body(br#"{"models":[]}"#).is_err());
        assert!(parse_model_catalog_body(b"not-json").is_err());
        let oversized = vec![b' '; MAX_MODEL_CATALOG_BYTES + 1];
        assert!(parse_model_catalog_body(&oversized).is_err());
    }
}
