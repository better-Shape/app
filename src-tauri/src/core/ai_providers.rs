//! Bring-your-own-key provider registry.
//!
//! BetterShape talks to the user's own model providers. The frontend owns the
//! (non-secret) provider settings and pushes them here with `set_ai_config`
//! whenever they change; this module is the single source of truth the agent
//! uses to resolve `provider/model` ids into a concrete endpoint + credentials.
//!
//! Supported wire formats:
//! - `openai`      — OpenAI Chat Completions (`/chat/completions`)
//! - `anthropic`   — Anthropic Messages (`/v1/messages`)
//! - `google`      — Google Gemini `generateContent` / `streamGenerateContent`
//!
//! Everything else (OpenRouter, xAI, DeepSeek, Groq, Mistral, Ollama, LM Studio,
//! vLLM, …) speaks the OpenAI wire format and only differs by base URL.

use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

use serde::{Deserialize, Serialize};

use crate::core::error::AppError;

/// Wire format the provider speaks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderKind {
    OpenAi,
    Anthropic,
    Google,
}

impl ProviderKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::OpenAi => "openai",
            Self::Anthropic => "anthropic",
            Self::Google => "google",
        }
    }
}

/// One configured provider connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderEntry {
    /// Stable id used as the model prefix (`openai/gpt-5`, `custom/llama3`).
    pub id: String,
    pub kind: ProviderKind,
    /// Human label for errors and logs.
    #[serde(default)]
    pub label: String,
    /// API key. Empty means "not configured" and the provider is skipped.
    #[serde(default)]
    pub api_key: String,
    /// Base URL *without* a trailing slash. Wire-format paths are appended.
    #[serde(default)]
    pub base_url: String,
    /// Model ids the user enabled for this provider (used for capability picks).
    #[serde(default)]
    pub models: Vec<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

/// Web-search backend for the agent's `web_search` tool.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchConfig {
    /// `tavily` | `brave` | `none`.
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub api_key: String,
}

/// Composio account used by the plugins tool (user's own Composio key).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposioConfig {
    #[serde(default)]
    pub api_key: String,
    /// Stable id Composio uses to scope connected accounts.
    #[serde(default)]
    pub user_id: String,
}

/// Full provider configuration pushed from the frontend.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderConfig {
    #[serde(default)]
    pub providers: Vec<ProviderEntry>,
    /// Model used for `auto` (titles, captions, subagents, quick decisions).
    #[serde(default)]
    pub default_model: String,
    /// Embedding model for the semantic codebase index (OpenAI wire only).
    #[serde(default)]
    pub embedding_model: String,
    #[serde(default)]
    pub search: SearchConfig,
    #[serde(default)]
    pub composio: ComposioConfig,
}

impl AiProviderConfig {
    /// Semantic embeddings are on when an OpenAI-wire provider has a key.
    pub fn embeddings_enabled(&self) -> bool {
        self.providers
            .iter()
            .any(|p| p.kind == ProviderKind::OpenAi && p.enabled && !p.api_key.trim().is_empty())
    }

    fn find(&self, id: &str) -> Option<&ProviderEntry> {
        self.providers
            .iter()
            .find(|p| p.id.eq_ignore_ascii_case(id))
    }

    fn first_usable(&self) -> Option<&ProviderEntry> {
        self.providers
            .iter()
            .find(|p| p.enabled && !p.api_key.trim().is_empty())
    }
}

static CONFIG: OnceLock<RwLock<Option<AiProviderConfig>>> = OnceLock::new();

fn store() -> &'static RwLock<Option<AiProviderConfig>> {
    CONFIG.get_or_init(|| RwLock::new(None))
}

/// Replace the active configuration (called from the `set_ai_config` command).
pub fn set_config(config: AiProviderConfig) {
    if let Ok(mut guard) = store().write() {
        *guard = Some(config);
    }
}

/// Current configuration, if the frontend has pushed one this session.
pub fn get_config() -> Option<AiProviderConfig> {
    store().read().ok().and_then(|guard| guard.clone())
}

/// Model id used for `auto`, or empty when nothing is configured.
pub fn default_model() -> String {
    get_config()
        .map(|c| c.default_model.trim().to_string())
        .unwrap_or_default()
}

/// A provider resolved for one concrete request.
#[derive(Debug, Clone)]
pub struct ResolvedProvider {
    pub id: String,
    pub kind: ProviderKind,
    pub label: String,
    pub api_key: String,
    pub base_url: String,
}

impl ResolvedProvider {
    /// Model slug as the provider expects it (prefix stripped).
    pub fn label_or_id(&self) -> &str {
        if self.label.trim().is_empty() {
            &self.id
        } else {
            &self.label
        }
    }
}

/// Aliases that map model prefixes onto configured provider ids.
fn alias_provider_id(prefix: &str) -> &str {
    match prefix {
        "google-ai" | "gemini" | "googleai" => "google",
        "x-ai" | "xai" => "xai",
        "azure" | "azure-openai" | "chatgpt" => "openai",
        "together" | "togetherai" => "together",
        "fireworks" | "fireworksai" => "fireworks",
        "moonshot" | "moonshotai" => "moonshot",
        "z-ai" | "zai" | "zhipu" | "glm" => "zai",
        "alibaba" | "dashscope" => "qwen",
        "lmstudio" | "lm-studio" | "ollama" | "vllm" | "localhost" => "custom",
        other => other,
    }
}

fn default_base_url(kind: ProviderKind) -> &'static str {
    match kind {
        ProviderKind::OpenAi => "https://api.openai.com/v1",
        ProviderKind::Anthropic => "https://api.anthropic.com",
        ProviderKind::Google => "https://generativelanguage.googleapis.com",
    }
}

/// Effective base URL: user override, else the wire format's default.
pub fn base_url_for(provider: &ProviderEntry) -> String {
    let trimmed = provider.base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        default_base_url(provider.kind).to_string()
    } else {
        trimmed.to_string()
    }
}

fn no_provider_error() -> AppError {
    AppError::Message(
        "No model provider is configured. Add an API key in Settings → Providers, then try again."
            .to_string(),
    )
}

fn missing_key_error(provider: &ProviderEntry) -> AppError {
    AppError::Message(format!(
        "'{}' has no API key. Add one in Settings → Providers.",
        if provider.label.trim().is_empty() {
            &provider.id
        } else {
            &provider.label
        }
    ))
}

fn from_entry(entry: &ProviderEntry) -> ResolvedProvider {
    ResolvedProvider {
        id: entry.id.clone(),
        kind: entry.kind,
        label: if entry.label.trim().is_empty() {
            entry.id.clone()
        } else {
            entry.label.clone()
        },
        api_key: entry.api_key.trim().to_string(),
        base_url: base_url_for(entry),
    }
}

/// Split `anthropic/claude-sonnet-4.5` into `("anthropic", "claude-sonnet-4.5")`.
/// Nested ids (`openrouter/anthropic/…`) keep the remainder intact.
fn split_model(model: &str) -> (Option<&str>, &str) {
    match model.split_once('/') {
        Some((prefix, rest)) if !prefix.is_empty() && !rest.is_empty() => (Some(prefix), rest),
        _ => (None, model),
    }
}

/// Resolve a model id to a provider + the provider-native model slug.
///
/// Rules, in order:
/// 1. `auto` (and the legacy `openrouter/auto`) → the configured default model.
/// 2. `prefix/rest` where `prefix` (or one of its aliases) is a configured provider.
/// 3. Otherwise the first usable provider, with the whole string as the model.
pub fn resolve_model(model: &str) -> Result<(ResolvedProvider, String), AppError> {
    let config = get_config().unwrap_or_default();
    let requested = model.trim();
    let requested = if requested.is_empty() {
        "auto"
    } else {
        requested
    };

    if requested == "auto" {
        let default = config.default_model.trim();
        if default.is_empty() {
            // Fall back to the first enabled provider if the user never picked a
            // default model, so a single-key setup still works out of the box.
            let provider = config.first_usable().ok_or_else(no_provider_error)?;
            return Ok((from_entry(provider), String::new()));
        }
        let (resolved, slug) = resolve_model(default)?;
        return Ok((resolved, slug));
    }

    let (prefix, rest) = split_model(requested);
    if let Some(prefix) = prefix {
        let id = alias_provider_id(prefix);
        if let Some(entry) = config.find(id) {
            if !entry.enabled {
                return Err(AppError::Message(format!(
                    "Provider '{}' is turned off. Enable it in Settings → Providers.",
                    entry.id
                )));
            }
            if entry.api_key.trim().is_empty() {
                return Err(missing_key_error(entry));
            }
            return Ok((from_entry(entry), rest.to_string()));
        }
    }

    let provider = config.first_usable().ok_or_else(no_provider_error)?;
    Ok((from_entry(provider), requested.to_string()))
}

/// Provider used for auxiliary calls (titles, captions, summaries, decisions).
pub fn resolve_default() -> Result<(ResolvedProvider, String), AppError> {
    resolve_model("auto")
}

/// Provider + model used for codebase embeddings, when one is configured.
/// Embeddings need an OpenAI-compatible `/embeddings` endpoint, so OpenRouter,
/// OpenAI, and any custom OpenAI-wire endpoint all work; Anthropic and Google
/// do not expose a compatible API and are skipped.
pub fn embeddings_target() -> Option<(ResolvedProvider, String)> {
    let config = get_config()?;
    if !config.embeddings_enabled() {
        return None;
    }
    let candidate = config
        .providers
        .iter()
        .filter(|p| p.kind == ProviderKind::OpenAi && p.enabled && !p.api_key.trim().is_empty())
        .min_by_key(|p| match p.id.as_str() {
            "openai" => 0,
            "openrouter" => 1,
            _ => 2,
        })?;
    let model = if !config.embedding_model.trim().is_empty() {
        config.embedding_model.trim().to_string()
    } else if candidate.id.eq_ignore_ascii_case("openrouter") {
        "openai/text-embedding-3-small".to_string()
    } else {
        "text-embedding-3-small".to_string()
    };
    Some((from_entry(candidate), model))
}

/// Provider used for media generation (images/audio). OpenAI-wire only, since
/// that is the wire format with image and speech endpoints.
pub fn media_target() -> Option<ResolvedProvider> {
    let config = get_config()?;
    let provider = config
        .providers
        .iter()
        .filter(|p| p.kind == ProviderKind::OpenAi && p.enabled && !p.api_key.trim().is_empty())
        .min_by_key(|p| match p.id.as_str() {
            "openai" => 0,
            "openrouter" => 1,
            _ => 2,
        })?;
    Some(from_entry(provider))
}

/// Best-effort vision model id for describing attached images.
/// Prefers an explicitly enabled vision-capable model, else the default model.
pub fn vision_model() -> String {
    let config = get_config().unwrap_or_default();
    for provider in &config.providers {
        if !provider.enabled || provider.api_key.trim().is_empty() {
            continue;
        }
        for model in &provider.models {
            let lower = model.to_ascii_lowercase();
            if lower.contains("vision")
                || lower.contains("-vl")
                || lower.contains("gemini")
                || lower.contains("gpt-4o")
                || lower.contains("gpt-4.1")
                || lower.contains("gpt-5")
                || lower.contains("claude")
                || lower.contains("grok")
            {
                return model.clone();
            }
        }
    }
    config.default_model.trim().to_string()
}

/// The user's own web-search credentials.
pub fn search_config() -> SearchConfig {
    get_config().map(|c| c.search).unwrap_or_default()
}

/// The user's own Composio credentials.
pub fn composio_config() -> ComposioConfig {
    get_config().map(|c| c.composio).unwrap_or_default()
}

/// True when the given model id can be routed without hitting the network.
pub fn can_resolve(model: &str) -> bool {
    resolve_model(model).is_ok()
}

/// Base URLs are user supplied; make sure they are absolute http(s).
pub fn normalize_base_url(raw: &str, kind: ProviderKind) -> Result<String, String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Ok(default_base_url(kind).to_string());
    }
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err("Base URL must start with http:// or https://".to_string());
    }
    Ok(trimmed.to_string())
}

/// Chat-completions endpoint for OpenAI-wire providers.
pub fn openai_endpoint(resolved: &ResolvedProvider) -> String {
    format!("{}/chat/completions", resolved.base_url)
}

/// Messages endpoint for Anthropic-wire providers.
pub fn anthropic_endpoint(resolved: &ResolvedProvider) -> String {
    format!("{}/v1/messages", resolved.base_url)
}

/// Gemini endpoint for one model (`{base}/v1beta/models/{model}:streamGenerateContent`).
pub fn google_endpoint(resolved: &ResolvedProvider, model: &str, stream: bool) -> String {
    let method = if stream {
        "streamGenerateContent"
    } else {
        "generateContent"
    };
    let suffix = if stream { "?alt=sse" } else { "" };
    format!(
        "{}/v1beta/models/{}:{}{}",
        resolved.base_url, model, method, suffix
    )
}

/// Embeddings endpoint for OpenAI-wire providers.
pub fn embeddings_endpoint(resolved: &ResolvedProvider) -> String {
    format!("{}/embeddings", resolved.base_url)
}

/// Reasoning effort (`low` | `high` | `ultra` | `max` | `super`) → token budget.
pub fn effort_budget(effort: Option<&str>, fallback: u32) -> u32 {
    match effort.map(|s| s.trim().to_ascii_lowercase()).as_deref() {
        Some("super") => 32768,
        Some("max") | Some("ultra") | Some("xhigh") => 24576,
        Some("high") | Some("medium") => 16384,
        Some("low") | Some("fast") | Some("") | None => fallback,
        _ => fallback,
    }
}

/// Human-readable summary used in logs + error messages.
pub fn describe(config: &AiProviderConfig) -> String {
    let mut parts: HashMap<&str, usize> = HashMap::new();
    for provider in &config.providers {
        if provider.enabled && !provider.api_key.trim().is_empty() {
            *parts.entry(provider.kind.as_str()).or_insert(0) += 1;
        }
    }
    let mut keys: Vec<&str> = parts.keys().copied().collect();
    keys.sort_unstable();
    keys.join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config_with(providers: Vec<ProviderEntry>, default_model: &str) -> AiProviderConfig {
        AiProviderConfig {
            providers,
            default_model: default_model.to_string(),
            ..Default::default()
        }
    }

    fn entry(id: &str, kind: ProviderKind, key: &str) -> ProviderEntry {
        ProviderEntry {
            id: id.to_string(),
            kind,
            label: id.to_string(),
            api_key: key.to_string(),
            base_url: String::new(),
            models: Vec::new(),
            enabled: true,
        }
    }

    #[test]
    fn resolves_prefixed_ids() {
        set_config(config_with(
            vec![
                entry("openai", ProviderKind::OpenAi, "sk-test"),
                entry("anthropic", ProviderKind::Anthropic, "sk-ant"),
                entry("google", ProviderKind::Google, "goog-key"),
            ],
            "anthropic/claude-sonnet-4.5",
        ));

        let (provider, model) = resolve_model("openai/gpt-5").unwrap();
        assert_eq!(provider.id, "openai");
        assert_eq!(model, "gpt-5");
        assert_eq!(provider.base_url, "https://api.openai.com/v1");

        // Aliases land on the configured provider.
        let (provider, model) = resolve_model("gemini/gemini-2.5-pro").unwrap();
        assert_eq!(provider.id, "google");
        assert_eq!(model, "gemini-2.5-pro");

        // Unknown prefixes fall back to the first usable provider.
        let (provider, model) = resolve_model("mystery/model-x").unwrap();
        assert_eq!(provider.id, "openai");
        assert_eq!(model, "mystery/model-x");

        // `auto` follows the configured default model.
        let (provider, model) = resolve_model("auto").unwrap();
        assert_eq!(provider.id, "anthropic");
        assert_eq!(model, "claude-sonnet-4.5");
    }

    #[test]
    fn missing_key_is_an_error() {
        set_config(config_with(
            vec![entry("openai", ProviderKind::OpenAi, "")],
            "",
        ));
        assert!(resolve_model("openai/gpt-5").is_err());
        assert!(resolve_model("auto").is_err());
    }

    #[test]
    fn unconfigured_setup_errors_clearly() {
        set_config(AiProviderConfig::default());
        let err = resolve_model("auto").unwrap_err().to_string();
        assert!(err.contains("Settings"));
    }

    #[test]
    fn endpoints_follow_the_wire_format() {
        let openai = ResolvedProvider {
            id: "openai".into(),
            kind: ProviderKind::OpenAi,
            label: "OpenAI".into(),
            api_key: "k".into(),
            base_url: "https://api.openai.com/v1".into(),
        };
        assert_eq!(
            openai_endpoint(&openai),
            "https://api.openai.com/v1/chat/completions"
        );

        let anthropic = ResolvedProvider {
            kind: ProviderKind::Anthropic,
            base_url: "https://api.anthropic.com".into(),
            ..openai.clone()
        };
        assert_eq!(
            anthropic_endpoint(&anthropic),
            "https://api.anthropic.com/v1/messages"
        );

        let google = ResolvedProvider {
            kind: ProviderKind::Google,
            base_url: "https://generativelanguage.googleapis.com".into(),
            ..openai.clone()
        };
        assert_eq!(
            google_endpoint(&google, "gemini-2.5-pro", true),
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse"
        );
    }

    #[test]
    fn effort_maps_to_budgets() {
        assert_eq!(effort_budget(Some("super"), 4096), 32768);
        assert_eq!(effort_budget(Some("ultra"), 4096), 24576);
        assert_eq!(effort_budget(Some("low"), 4096), 4096);
        assert_eq!(effort_budget(None, 4096), 4096);
    }
}
