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

/// One provider key read back out of the OS keychain.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAiKey {
    pub id: String,
    pub api_key: String,
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
                keyless: false,
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

/// Probe one provider: key validity, base URL, and the models it serves.
#[tauri::command]
pub async fn ai_test_provider(
    provider_id: String,
    kind: Option<String>,
    api_key: Option<String>,
    base_url: Option<String>,
) -> Result<ProviderTestReport, AppError> {
    let provider = resolve_target(
        &provider_id,
        kind.as_deref(),
        api_key.as_deref(),
        base_url.as_deref(),
    )?;
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
    let response =
        crate::agent::commands::provider_wire::request(&client, &provider, &model, &body, false)
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

/// True when the OS keychain can actually hold secrets on this machine.
///
/// A missing entry is the healthy answer: it proves the backend was reachable.
#[tauri::command]
pub fn ai_vault_supported() -> bool {
    match keyring::Entry::new(VAULT_SERVICE, "__probe__") {
        Ok(entry) => matches!(entry.get_password(), Err(keyring::Error::NoEntry)),
        Err(_) => false,
    }
}

/// Store one provider key in the OS keychain (empty value clears it).
#[tauri::command]
pub fn ai_store_key(provider_id: String, api_key: String) -> Result<(), AppError> {
    let id = provider_id.trim();
    if id.is_empty() {
        return Err(AppError::Message("Provider id is required.".to_string()));
    }
    if api_key.trim().is_empty() {
        return ai_delete_key(id.to_string());
    }
    let entry = keyring_entry(id)?;
    entry.set_password(api_key.trim()).map_err(|error| {
        AppError::Message(format!(
            "Could not store the key in the OS keychain: {error}"
        ))
    })
}

/// Forget one provider key.
#[tauri::command]
pub fn ai_delete_key(provider_id: String) -> Result<(), AppError> {
    let id = provider_id.trim();
    if id.is_empty() {
        return Ok(());
    }
    let entry = keyring_entry(id)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        // Already gone is the desired end state.
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(AppError::Message(format!(
            "Could not remove the stored key: {error}"
        ))),
    }
}

/// Read back the requested keys (missing entries are simply omitted).
#[tauri::command]
pub fn ai_load_keys(provider_ids: Vec<String>) -> Vec<StoredAiKey> {
    let mut out: Vec<StoredAiKey> = Vec::new();
    for id in provider_ids {
        let id = id.trim();
        if id.is_empty() {
            continue;
        }
        let Ok(entry) = keyring::Entry::new(VAULT_SERVICE, id) else {
            continue;
        };
        if let Ok(secret) = entry.get_password() {
            if !secret.trim().is_empty() {
                out.push(StoredAiKey {
                    id: id.to_string(),
                    api_key: secret,
                });
            }
        }
    }
    out
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
    fn anthropic_kind_is_mapped_from_the_argument() {
        assert_eq!(kind_from_str(Some("Anthropic")), ProviderKind::Anthropic);
        assert_eq!(kind_from_str(Some("google")), ProviderKind::Google);
        assert_eq!(kind_from_str(None), ProviderKind::OpenAi);
    }
}
