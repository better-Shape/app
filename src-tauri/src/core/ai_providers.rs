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
    /// The endpoint answers without an API key: local runtimes (Ollama, LM
    /// Studio, vLLM) and gateways with a free tier. Without this the app could
    /// not route to a keyless connection at all.
    #[serde(default)]
    pub keyless: bool,
    /// Extra headers to send with every request to this provider. Gateways put
    /// attribution or their own tokens here; the frontend merges the preset's
    /// defaults in before pushing the config.
    #[serde(default)]
    pub headers: HashMap<String, String>,
    /// Header the key travels in: `bearer` | `api-key` | `x-api-key` |
    /// `x-goog-api-key` | `none`. Empty means "whatever this wire format
    /// normally does".
    #[serde(default)]
    pub auth_style: String,
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
            .any(|p| p.kind == ProviderKind::OpenAi && entry_usable(p))
    }

    fn find(&self, id: &str) -> Option<&ProviderEntry> {
        self.providers
            .iter()
            .find(|p| p.id.eq_ignore_ascii_case(id))
    }

    fn first_usable(&self) -> Option<&ProviderEntry> {
        self.providers.iter().find(|p| entry_usable(p))
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

/// Serializes tests that rewrite the process-global provider config.
///
/// Every module that calls [`set_config`] in a test takes this lock, so a test
/// asserting on `resolve_model` never observes another test's providers.
#[cfg(test)]
pub(crate) fn config_test_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Model id used for `auto`, or empty when nothing is configured.
pub fn default_model() -> String {
    get_config()
        .map(|c| c.default_model.trim().to_string())
        .unwrap_or_default()
}

/// Ids of the providers the app can route to right now, in configuration order.
pub fn configured_provider_ids() -> Vec<String> {
    get_config()
        .map(|config| {
            config
                .providers
                .iter()
                .filter(|p| entry_usable(p))
                .map(|p| p.id.clone())
                .collect()
        })
        .unwrap_or_default()
}

/// One configured connection by id, for diagnostics (settings test buttons).
///
/// Unlike [`resolve_model`] this does not require a key: a connection the user
/// just typed in still needs to be testable, and a keyless local runtime is a
/// legitimate configuration.
pub fn provider_by_id(id: &str) -> Option<ResolvedProvider> {
    let config = get_config()?;
    config.find(id.trim()).map(from_entry)
}

/// A provider resolved for one concrete request.
#[derive(Debug, Clone)]
pub struct ResolvedProvider {
    pub id: String,
    pub kind: ProviderKind,
    pub label: String,
    pub api_key: String,
    pub base_url: String,
    /// Connection headers, merged over the app's defaults.
    pub headers: HashMap<String, String>,
    /// `"api-key"`, `"x-api-key"`, `"bearer"`, `"none"`, or empty for the wire
    /// format's default.
    pub auth_style: String,
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
///
/// Mirrors the settings registry: every alias here exists because another client
/// (or an older build) writes that prefix for the same connection. Unknown
/// prefixes fall through unchanged, so a self-hosted gateway that serves
/// namespaced slugs still receives them intact.
fn alias_provider_id(prefix: &str) -> &str {
    match prefix {
        "google-ai" | "gemini" | "googleai" => "google",
        "x-ai" => "xai",
        "azureopenai" | "azure-openai" => "azure",
        "together" | "togetherai" | "together-ai" => "together",
        "fireworks" | "fireworksai" | "fireworks-ai" => "fireworks",
        "moonshot" | "moonshotai" | "kimi" => "moonshot",
        "z-ai" | "zhipu" | "zhipuai" | "glm" => "zai",
        "alibaba" | "dashscope" => "qwen",
        "opencode" | "opencode-zen" => "zen",
        "opencode-zen-messages" => "zen-messages",
        // Go is its own gateway with its own base URL and key, not the Zen slot.
        "opencode-go" => "zen-go",
        "nvidia-nim" | "nim" => "nvidia",
        "llm-gateway" | "llmgtwy" => "llmgateway",
        "cf-workers-ai" | "cloudflare-workers-ai" => "cloudflare",
        "cf-gateway" | "cloudflare-ai-gateway" => "cloudflare-gateway",
        "aigateway" | "vercel-ai-gateway" => "vercel",
        "kilocode" | "kilo-code" => "kilo",
        "digital-ocean" | "gradient-ai" => "digitalocean",
        "lm-studio" => "lmstudio",
        "veniceai" => "venice",
        "minimaxi" => "minimax",
        // Anything pointing at a machine of the user's own is the custom slot.
        "local" | "localhost" => "custom",
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

/// Nothing to put in the request's `model` field.
///
/// Sending an empty slug makes providers answer with an opaque "model not
/// found"; naming the fix in Settings is more useful.
fn no_model_selected_error() -> AppError {
    AppError::Message(
        "No model is selected. Pick one under Settings → Providers (or add model ids for your custom endpoint), then try again."
            .to_string(),
    )
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
        headers: entry.headers.clone(),
        auth_style: entry.auth_style.trim().to_ascii_lowercase(),
    }
}

/// True when a configured entry can serve a request.
///
/// Keyless connections (local runtimes, free tiers) are usable without a key;
/// everything else needs one before it can be routed to.
pub fn entry_usable(entry: &ProviderEntry) -> bool {
    entry.enabled && (entry.keyless || !entry.api_key.trim().is_empty())
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
            // default model, so a single-key setup still works out of the box —
            // but every request needs a model name, so take the first id the
            // connection declares, and say so when it declares none.
            let provider = config.first_usable().ok_or_else(no_provider_error)?;
            let model = provider
                .models
                .iter()
                .map(|model| model.trim())
                .find(|model| !model.is_empty())
                .ok_or_else(no_model_selected_error)?;
            let prefix = format!("{}/", provider.id);
            let model = model.strip_prefix(&prefix).unwrap_or(model);
            return Ok((from_entry(provider), model.to_string()));
        }
        let (resolved, slug) = resolve_model(default)?;
        return Ok((resolved, slug));
    }

    // `openrouter/auto` was the hosted router's own id. A user who configured
    // an OpenRouter key still gets the real server-side router; without one the
    // string is a legacy alias for `auto` rather than a model no provider can
    // serve.
    if requested.eq_ignore_ascii_case("openrouter/auto") && config.find("openrouter").is_none() {
        return resolve_model("auto");
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
            if !entry_usable(entry) {
                return Err(missing_key_error(entry));
            }
            return Ok((from_entry(entry), rest.to_string()));
        }
    }

    let provider = config.first_usable().ok_or_else(no_provider_error)?;
    // Rule 3: nobody claims the prefix, so the *whole* string is the model. A
    // self-hosted gateway serving namespaced ids (`qwen/qwen3-coder`) needs the
    // prefix; stripping it here would send a model that does not exist.
    if requested.is_empty() {
        return Err(no_model_selected_error());
    }
    Ok((from_entry(provider), requested.to_string()))
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
        .filter(|p| p.kind == ProviderKind::OpenAi && entry_usable(p))
        .min_by_key(|p| match p.id.as_str() {
            "openai" => 0,
            "openrouter" => 1,
            _ => 2,
        })?;
    let model = if !config.embedding_model.trim().is_empty() {
        config.embedding_model.trim().to_string()
    } else if candidate.id.eq_ignore_ascii_case("openrouter") {
        "openai/text-embedding-3-small".to_string()
    } else if candidate.id.eq_ignore_ascii_case("openai") {
        "text-embedding-3-small".to_string()
    } else {
        // Only OpenAI and OpenRouter are known to serve OpenAI's embedding model.
        // Guessing it for any other OpenAI-wire provider (Groq, xAI, DeepSeek, a
        // local runtime) made the indexer hammer an endpoint that cannot answer.
        return None;
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
        .filter(|p| p.kind == ProviderKind::OpenAi && entry_usable(p))
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
        if !entry_usable(provider) {
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

/// What every outbound model request says it is.
///
/// Providers and gateways read the user agent to tell clients apart (the
/// OpenCode Console, for example, identifies members by it), and some reject
/// requests that arrive with none. `bettershape/<version>` is the honest form of
/// that contract — it names this app and its version, exactly like the clients
/// these gateways were built against.
pub fn user_agent() -> String {
    format!("bettershape/{}", env!("CARGO_PKG_VERSION"))
}

/// True for OpenCode's gateways (Zen, Zen Messages, Go).
///
/// Their docs ask every coding agent to identify itself with its own user agent
/// and to send a stable per-conversation id in `x-opencode-session`, which they
/// use for routing and prompt caching. Third-party clients that do both are
/// listed as validated; without the session header the Go endpoint answers 400.
pub fn is_opencode_gateway(provider: &ResolvedProvider) -> bool {
    provider.base_url.contains("opencode.ai")
}

/// A conversation id shaped for a header: printable token characters only.
pub fn session_id(conversation_id: Option<&str>) -> Option<String> {
    let cleaned: String = conversation_id?
        .trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        .take(96)
        .collect();
    (!cleaned.is_empty()).then_some(cleaned)
}

/// What the user should do about an OpenCode gateway refusal.
///
/// The gateways answer with their own error types; a generic "403" line hides
/// the one action that fixes it.
fn opencode_advice(status: u16, body: &str) -> Option<&'static str> {
    let lower = body.to_ascii_lowercase();
    if lower.contains("freetiererror") {
        return Some(
            "OpenCode's free models are free for OpenCode accounts, but the gateway refuses traffic it cannot attribute. Add your OpenCode Console API key (opencode.ai/console) under Settings \u{2192} Providers \u{2192} OpenCode Zen, or take the Go subscription for the same models with a monthly allowance.",
        );
    }
    if status == 401
        && (lower.contains("missing api key")
            || lower.contains("requires a credential")
            || lower.contains("autherr"))
    {
        return Some(
            "OpenCode Zen and Go need your own API key: copy it from opencode.ai/console and paste it in Settings \u{2192} Providers \u{2192} OpenCode Zen.",
        );
    }
    None
}

/// Header carrying the API key for this connection, or `None` for keyless
/// endpoints and `auth_style: none`.
///
/// `auth_style` is what makes non-standard gateways routable without special
/// cases: Azure wants `api-key`, Anthropic-compatible endpoints want `x-api-key`,
/// and a self-hosted server behind its own proxy wants nothing at all.
pub fn auth_header(provider: &ResolvedProvider) -> Option<(&'static str, String)> {
    let key = provider.api_key.trim();
    if key.is_empty() {
        return None;
    }
    let name = match provider.auth_style.as_str() {
        "api-key" => "api-key",
        "x-api-key" => "x-api-key",
        "x-goog-api-key" => "x-goog-api-key",
        "bearer" => "Authorization",
        "none" => return None,
        _ => match provider.kind {
            ProviderKind::Anthropic => "x-api-key",
            // Google's Generative Language API looks for its own header name.
            ProviderKind::Google => "x-goog-api-key",
            ProviderKind::OpenAi => "Authorization",
        },
    };
    let value = if name == "Authorization" {
        format!("Bearer {key}")
    } else {
        key.to_string()
    };
    Some((name, value))
}

/// Header map for one model request: app identification, then the connection's
/// own headers (which win), then the key — unless a connection header already
/// carries that name.
pub fn request_headers(provider: &ResolvedProvider) -> reqwest::header::HeaderMap {
    request_headers_for(provider, None)
}

/// Headers for one request.
///
/// `session` is the conversation id when the caller has one. Only OpenCode's
/// gateways get the extra identification: it is what their docs ask of every
/// coding agent, and it keeps traffic attributable to this app rather than
/// pretending to be OpenCode.
pub fn request_headers_for(
    provider: &ResolvedProvider,
    session: Option<&str>,
) -> reqwest::header::HeaderMap {
    let mut map = reqwest::header::HeaderMap::new();
    if let Ok(value) = reqwest::header::HeaderValue::from_str(&user_agent()) {
        map.insert(reqwest::header::USER_AGENT, value.clone());
        map.insert(
            reqwest::header::HeaderName::from_static("x-bettershape-client"),
            value,
        );
    }
    for (name, value) in &provider.headers {
        // The body is always JSON, so a user-supplied content type or length
        // would fight the serializer.
        let name = name.trim();
        if name.is_empty()
            || name.eq_ignore_ascii_case("content-type")
            || name.eq_ignore_ascii_case("content-length")
        {
            continue;
        }
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        let (Ok(name), Ok(value)) = (
            reqwest::header::HeaderName::from_bytes(name.as_bytes()),
            reqwest::header::HeaderValue::from_str(value),
        ) else {
            continue;
        };
        map.insert(name, value);
    }
    if is_opencode_gateway(provider) {
        if let Some(id) = session_id(session) {
            if let Ok(value) = reqwest::header::HeaderValue::from_str(&id) {
                map.insert(
                    reqwest::header::HeaderName::from_static("x-opencode-session"),
                    value,
                );
            }
        }
        map.insert(
            reqwest::header::HeaderName::from_static("x-opencode-client"),
            reqwest::header::HeaderValue::from_static("bettershape"),
        );
    }
    if let Some((name, value)) = auth_header(provider) {
        if !map.contains_key(name) {
            if let (Ok(name), Ok(value)) = (
                reqwest::header::HeaderName::from_bytes(name.as_bytes()),
                reqwest::header::HeaderValue::from_str(&value),
            ) {
                map.insert(name, value);
            }
        }
    }
    map
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

/// True when a provider status is worth retrying (rate limits, transient 5xx).
pub fn is_retryable_status(status: u16) -> bool {
    matches!(status, 408 | 409 | 425 | 429) || (500..=599).contains(&status)
}

/// `Retry-After` header (seconds form) → a wait we are willing to honour.
///
/// Providers also send an HTTP-date; treating that as "no hint" keeps the retry
/// immediate rather than sleeping until an unparsed date.
pub fn retry_after_secs(raw: Option<&str>) -> Option<u64> {
    let value = raw?.trim();
    let secs: u64 = value.parse().ok()?;
    // A provider asking for minutes means something is wrong beyond this turn;
    // report it instead of blocking the UI.
    if secs == 0 || secs > 60 {
        return None;
    }
    Some(secs)
}

/// What the user should do about an HTTP failure, by status.
fn status_advice(status: u16) -> &'static str {
    match status {
        400 => {
            "The request was rejected. If the message mentions tools, pick a tool-capable model."
        }
        401 => "The API key was rejected. Check the key in Settings → Providers.",
        402 => "The provider account is out of credit or over its quota.",
        403 => "The key is valid but lacks access to this model or endpoint.",
        404 => "The model or endpoint was not found. Models are routed by their `provider/model` prefix, and the rest is sent to that provider unchanged.",
        407 => "A proxy in front of the provider is asking for authentication.",
        413 => "The request was too large. Start a new chat or lower the context setting.",
        422 => "The provider rejected the request body (often an unsupported parameter).",
        429 => "Rate limit or quota reached. Wait a moment, or switch models.",
        500..=599 => "The provider had a server error. Retrying usually works.",
        _ => "The provider rejected the request.",
    }
}

/// Actionable one-liner for a non-2xx provider response: what happened, what to
/// do, where it was routed, then a trimmed slice of the provider's own message.
pub fn describe_http_error(label: &str, status: u16, body: &str) -> String {
    let advice = opencode_advice(status, body).unwrap_or_else(|| status_advice(status));
    let mut message = format!("{label} API error {status} — {advice}");
    let routed = configured_provider_ids();
    if !routed.is_empty() {
        message.push_str(&format!("\nEnabled providers: {}.", routed.join(", ")));
    }
    let detail: String = body.trim().chars().take(600).collect();
    if !detail.is_empty() {
        message.push_str(&format!("\nProvider said: {detail}"));
    }
    message
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
        if entry_usable(provider) {
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
            keyless: false,
            headers: HashMap::new(),
            auth_style: String::new(),
        }
    }

    /// A keyless connection: the shape local runtimes and free tiers push.
    fn keyless_entry(id: &str, kind: ProviderKind) -> ProviderEntry {
        ProviderEntry {
            keyless: true,
            ..entry(id, kind, "")
        }
    }

    /// The active configuration is process-global; every test that rewrites it
    /// takes the shared lock so they never observe each other's providers.
    fn config_lock() -> std::sync::MutexGuard<'static, ()> {
        super::config_test_lock()
    }

    #[test]
    fn resolves_prefixed_ids() {
        let _guard = config_lock();
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
        let _guard = config_lock();
        set_config(config_with(
            vec![entry("openai", ProviderKind::OpenAi, "")],
            "",
        ));
        assert!(resolve_model("openai/gpt-5").is_err());
        assert!(resolve_model("auto").is_err());
    }

    #[test]
    fn unconfigured_setup_errors_clearly() {
        let _guard = config_lock();
        set_config(AiProviderConfig::default());
        let err = resolve_model("auto").unwrap_err().to_string();
        assert!(err.contains("Settings"));
    }

    #[test]
    fn provider_aliases_land_on_the_configured_connection() {
        let _guard = config_lock();
        set_config(config_with(
            vec![
                entry("zen", ProviderKind::OpenAi, "oc_sk_x"),
                entry("zen-go", ProviderKind::OpenAi, "oc_sk_x"),
                entry("nvidia", ProviderKind::OpenAi, "nvapi-x"),
                entry("azure", ProviderKind::OpenAi, "az-key"),
                entry("moonshot", ProviderKind::OpenAi, "sk-x"),
            ],
            "",
        ));

        for (requested, expected) in [
            ("opencode/kimi-k2.6", "zen"),
            ("nvidia-nim/deepseek-ai/deepseek-r1", "nvidia"),
            ("azure-openai/gpt-5", "azure"),
            ("kimi/kimi-k2-0905-preview", "moonshot"),
        ] {
            let (provider, _) = resolve_model(requested).unwrap();
            assert_eq!(provider.id, expected, "{requested}");
        }

        // Go is a separate gateway, so its models must not land on the Zen slot.
        assert_eq!(alias_provider_id("opencode-go"), "zen-go");
        assert_eq!(alias_provider_id("opencode-zen"), "zen");
        let (provider, model) = resolve_model("opencode-go/deepseek-v4-pro").unwrap();
        assert_eq!(provider.id, "zen-go");
        assert_eq!(model, "deepseek-v4-pro");

        // A prefix nobody configured still resolves to the first usable provider
        // with the whole string as the slug, which is what self-hosted gateways
        // serving namespaced ids rely on.
        let (provider, model) = resolve_model("qwen/qwen3-coder").unwrap();
        assert_eq!(provider.id, "zen");
        assert_eq!(model, "qwen/qwen3-coder");
    }

    #[test]
    fn keyless_providers_route_without_a_key() {
        let _guard = config_lock();
        set_config(config_with(
            vec![keyless_entry("ollama", ProviderKind::OpenAi)],
            "ollama/qwen2.5-coder:7b",
        ));

        let (provider, model) = resolve_model("auto").unwrap();
        assert_eq!(provider.id, "ollama");
        assert_eq!(model, "qwen2.5-coder:7b");
        assert_eq!(configured_provider_ids(), vec!["ollama".to_string()]);

        let (provider, model) = resolve_model("ollama/llama3.2:3b").unwrap();
        assert_eq!(provider.id, "ollama");
        assert_eq!(model, "llama3.2:3b");

        // Disabling the connection takes it out of rotation again.
        let mut disabled = keyless_entry("ollama", ProviderKind::OpenAi);
        disabled.enabled = false;
        set_config(config_with(vec![disabled], ""));
        assert!(configured_provider_ids().is_empty());
        assert!(resolve_model("auto").is_err());
    }

    #[test]
    fn a_keyless_provider_that_is_turned_off_is_not_usable() {
        let entry = ProviderEntry {
            enabled: false,
            ..keyless_entry("lmstudio", ProviderKind::OpenAi)
        };
        assert!(!entry_usable(&entry));
    }

    #[test]
    fn auth_styles_choose_the_header() {
        let base = ResolvedProvider {
            id: "azure".into(),
            kind: ProviderKind::OpenAi,
            label: "Azure".into(),
            api_key: "az-key".into(),
            base_url: "https://example.openai.azure.com/openai/v1".into(),
            headers: HashMap::new(),
            auth_style: String::new(),
        };
        // Wire default: bearer.
        assert_eq!(
            auth_header(&base),
            Some(("Authorization", "Bearer az-key".to_string()))
        );

        let api_key_style = ResolvedProvider {
            auth_style: "api-key".into(),
            ..base.clone()
        };
        assert_eq!(
            auth_header(&api_key_style),
            Some(("api-key", "az-key".to_string()))
        );

        // `none` sends no credentials even when a key is present.
        let no_auth = ResolvedProvider {
            auth_style: "none".into(),
            ..base.clone()
        };
        assert_eq!(auth_header(&no_auth), None);

        // Anthropic and Google carry the raw key in their own headers.
        let anthropic = ResolvedProvider {
            kind: ProviderKind::Anthropic,
            ..base.clone()
        };
        assert_eq!(
            auth_header(&anthropic),
            Some(("x-api-key", "az-key".to_string()))
        );
        let google = ResolvedProvider {
            kind: ProviderKind::Google,
            ..base.clone()
        };
        assert_eq!(
            auth_header(&google),
            Some(("x-goog-api-key", "az-key".to_string()))
        );

        // A keyless connection has nothing to send.
        let keyless = ResolvedProvider {
            api_key: String::new(),
            ..base
        };
        assert_eq!(auth_header(&keyless), None);
    }

    #[test]
    fn opencode_gateways_get_the_session_header_their_docs_require() {
        let provider = ResolvedProvider {
            id: "zen".into(),
            kind: ProviderKind::OpenAi,
            label: "OpenCode Zen".into(),
            api_key: "oc_sk_x".into(),
            base_url: "https://opencode.ai/inference/v1".into(),
            headers: HashMap::new(),
            auth_style: String::new(),
        };

        // A conversation id travels as-is; a client name is attached, and our
        // own user agent is what goes out (never OpenCode's).
        let map = request_headers_for(&provider, Some("chat-42"));
        assert_eq!(map.get("x-opencode-session").unwrap(), "chat-42");
        assert_eq!(map.get("x-opencode-client").unwrap(), "bettershape");
        assert!(map
            .get(reqwest::header::USER_AGENT)
            .unwrap()
            .to_str()
            .unwrap()
            .starts_with("bettershape/"));

        // Junk is dropped rather than sent as a broken header.
        let map = request_headers_for(&provider, Some("   "));
        assert!(map.get("x-opencode-session").is_none());
        let map = request_headers_for(&provider, Some("a\nb\tc"));
        assert_eq!(map.get("x-opencode-session").unwrap(), "abc");

        // Other providers never see the OpenCode headers.
        let other = ResolvedProvider {
            base_url: "https://api.openai.com/v1".into(),
            ..provider.clone()
        };
        let map = request_headers_for(&other, Some("chat-42"));
        assert!(map.get("x-opencode-session").is_none());
        assert!(map.get("x-opencode-client").is_none());
    }

    #[test]
    fn opencode_refusals_name_the_fix() {
        let free = describe_http_error(
            "Zen",
            403,
            "{\"error\":{\"type\":\"FreeTierError\",\"message\":\"OpenCode's free tier can only be used from within OpenCode.\"}}",
        );
        assert!(free.contains("Settings"), "{free}");
        assert!(free.contains("opencode.ai/console"), "{free}");

        let unauthorized = describe_http_error(
            "Zen",
            401,
            "{\"error\":{\"type\":\"AuthError\",\"message\":\"Missing API key.\"}}",
        );
        assert!(
            unauthorized.contains("opencode.ai/console"),
            "{unauthorized}"
        );

        // Anything else keeps the generic advice.
        let generic = describe_http_error("Zen", 429, "{\"error\":\"slow down\"}");
        assert!(generic.contains("Rate limit"), "{generic}");
    }

    #[test]
    fn request_headers_merge_identification_and_connection_values() {
        let mut headers = HashMap::new();
        headers.insert(
            "HTTP-Referer".to_string(),
            "https://example.test/".to_string(),
        );
        // Blank values and body-controlled headers never reach the wire.
        headers.insert("X-Title".to_string(), "   ".to_string());
        headers.insert("Content-Type".to_string(), "text/plain".to_string());
        let provider = ResolvedProvider {
            id: "nvidia".into(),
            kind: ProviderKind::OpenAi,
            label: "NVIDIA NIM".into(),
            api_key: "nvapi-x".into(),
            base_url: "https://integrate.api.nvidia.com/v1".into(),
            headers,
            auth_style: String::new(),
        };

        let map = request_headers(&provider);
        assert_eq!(
            map.get(reqwest::header::USER_AGENT).unwrap(),
            user_agent().as_str()
        );
        assert_eq!(
            map.get("x-bettershape-client").unwrap(),
            user_agent().as_str()
        );
        assert_eq!(map.get("HTTP-Referer").unwrap(), "https://example.test/");
        assert!(map.get("X-Title").is_none());
        assert_eq!(
            map.get(reqwest::header::CONTENT_TYPE),
            None,
            "the serializer owns the content type"
        );
        assert_eq!(
            map.get(reqwest::header::AUTHORIZATION).unwrap(),
            "Bearer nvapi-x"
        );

        // A connection that names the auth header itself wins over the key field.
        let mut override_headers = HashMap::new();
        override_headers.insert(
            "Authorization".to_string(),
            "Bearer gateway-token".to_string(),
        );
        let overridden = ResolvedProvider {
            headers: override_headers,
            ..provider
        };
        let map = request_headers(&overridden);
        assert_eq!(
            map.get(reqwest::header::AUTHORIZATION).unwrap(),
            "Bearer gateway-token"
        );
    }

    #[test]
    fn endpoints_follow_the_wire_format() {
        let openai = ResolvedProvider {
            id: "openai".into(),
            kind: ProviderKind::OpenAi,
            label: "OpenAI".into(),
            api_key: "k".into(),
            base_url: "https://api.openai.com/v1".into(),
            headers: HashMap::new(),
            auth_style: String::new(),
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

    #[test]
    fn empty_model_slug_is_reported_not_sent() {
        let _guard = config_lock();
        set_config(config_with(
            vec![entry("custom", ProviderKind::OpenAi, "k")],
            "",
        ));
        // No default model and no prefix: there is nothing to put in `model`.
        let err = resolve_model("auto").unwrap_err().to_string();
        assert!(err.contains("No model is selected"), "{err}");

        // An unknown bare name is still passed through — some gateways name
        // models after nothing in particular — but a prefixed id with an empty
        // slug is a configuration mistake, not a model.
        let (provider, slug) = resolve_model("mystery-model").unwrap();
        assert_eq!(provider.id, "custom");
        assert_eq!(slug, "mystery-model");

        set_config(config_with(
            vec![entry("custom", ProviderKind::OpenAi, "k")],
            "custom/llama3",
        ));
        let (_, slug) = resolve_model("auto").unwrap();
        assert_eq!(slug, "llama3");
    }

    #[test]
    fn only_known_embedding_providers_get_a_default_model() {
        let _guard = config_lock();
        set_config(config_with(
            vec![entry("groq", ProviderKind::OpenAi, "k")],
            "groq/llama-3.3-70b-versatile",
        ));
        assert!(embeddings_target().is_none());

        set_config(config_with(
            vec![entry("openai", ProviderKind::OpenAi, "k")],
            "openai/gpt-5",
        ));
        let (_, model) = embeddings_target().expect("openai embeds");
        assert_eq!(model, "text-embedding-3-small");

        // A user-chosen model is honoured on any OpenAI-wire provider.
        let mut config = config_with(
            vec![entry("groq", ProviderKind::OpenAi, "k")],
            "groq/llama-3.3-70b-versatile",
        );
        config.embedding_model = "nomic-embed-text".to_string();
        set_config(config);
        let (provider, model) = embeddings_target().expect("explicit model");
        assert_eq!(provider.id, "groq");
        assert_eq!(model, "nomic-embed-text");
    }

    #[test]
    fn retry_advice_covers_rate_limits_and_auth() {
        assert!(is_retryable_status(429));
        assert!(is_retryable_status(503));
        assert!(!is_retryable_status(400));
        assert!(!is_retryable_status(401));
        assert_eq!(retry_after_secs(Some(" 7 ")), Some(7));
        assert_eq!(retry_after_secs(Some("120")), None);
        assert_eq!(
            retry_after_secs(Some("Wed, 21 Oct 2026 07:28:00 GMT")),
            None
        );
    }

    #[test]
    fn http_errors_name_the_fix_and_the_route() {
        let _guard = config_lock();
        set_config(config_with(
            vec![entry("openai", ProviderKind::OpenAi, "k")],
            "openai/gpt-5",
        ));
        let message = describe_http_error("OpenAI", 401, "{\"error\":{\"message\":\"bad key\"}}");
        assert!(message.contains("OpenAI API error 401"), "{message}");
        assert!(message.contains("Settings → Providers"), "{message}");
        assert!(message.contains("Enabled providers: openai"), "{message}");
        assert!(message.contains("bad key"), "{message}");
    }
}
