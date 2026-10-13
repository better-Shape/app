//! BYOK provider configuration pushed from the frontend.
//!
//! The settings UI owns the provider list (keys, base URLs, default model).
//! It calls `set_ai_config` at startup and whenever a provider changes; every
//! Rust-side LLM call resolves its endpoint and credentials through
//! [`crate::core::ai_providers`].

use crate::core::ai_providers::{self, AiProviderConfig};
use crate::core::error::AppError;

/// Auth header styles the wire layer understands. Anything else would be
/// silently ignored, so it is rejected where the user can still fix it.
const AUTH_STYLES: &[&str] = &["bearer", "api-key", "x-api-key", "x-goog-api-key", "none"];

#[tauri::command]
pub fn set_ai_config(config: AiProviderConfig) -> Result<(), AppError> {
    for provider in &config.providers {
        ai_providers::normalize_base_url(&provider.base_url, provider.kind)
            .map_err(AppError::Message)?;
        let style = provider.auth_style.trim().to_ascii_lowercase();
        if !style.is_empty() && !AUTH_STYLES.contains(&style.as_str()) {
            return Err(AppError::Message(format!(
                "'{}' has an unknown auth style '{}'. Use one of: {}.",
                provider.id,
                provider.auth_style,
                AUTH_STYLES.join(", ")
            )));
        }
        for (name, value) in &provider.headers {
            // A bad header name or value would make reqwest drop the whole
            // request, which reads as a network failure. Fail loudly instead.
            let clean_name = name.trim();
            if clean_name.is_empty() {
                return Err(AppError::Message(format!(
                    "'{}' has a header with an empty name.",
                    provider.id
                )));
            }
            if reqwest::header::HeaderName::from_bytes(clean_name.as_bytes()).is_err() {
                return Err(AppError::Message(format!(
                    "'{}' has an invalid header name '{}'.",
                    provider.id, clean_name
                )));
            }
            if reqwest::header::HeaderValue::from_str(value.trim()).is_err() {
                return Err(AppError::Message(format!(
                    "'{}' has an invalid value for header '{}'.",
                    provider.id, clean_name
                )));
            }
        }
    }
    let summary = ai_providers::describe(&config);
    ai_providers::set_config(config);
    crate::agent::commands::logging::info("ai", &format!("Providers configured: {summary}"));
    Ok(())
}

/// Current configuration (keys included) — used by the settings UI to verify
/// what Rust actually holds after a push.
#[tauri::command]
pub fn get_ai_config() -> AiProviderConfig {
    ai_providers::get_config().unwrap_or_default()
}

/// Which providers can serve a request right now.
#[tauri::command]
pub fn ai_provider_status() -> Vec<String> {
    ai_providers::get_config()
        .map(|config| {
            config
                .providers
                .iter()
                .filter(|p| ai_providers::entry_usable(p))
                .map(|p| p.id.clone())
                .collect()
        })
        .unwrap_or_default()
}
