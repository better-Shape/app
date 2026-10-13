//! BYOK provider configuration pushed from the frontend.
//!
//! The settings UI owns the provider list (keys, base URLs, default model).
//! It calls `set_ai_config` at startup and whenever a provider changes; every
//! Rust-side LLM call resolves its endpoint and credentials through
//! [`crate::core::ai_providers`].

use crate::core::ai_providers::{self, AiProviderConfig};
use crate::core::error::AppError;

#[tauri::command]
pub fn set_ai_config(config: AiProviderConfig) -> Result<(), AppError> {
    for provider in &config.providers {
        ai_providers::normalize_base_url(&provider.base_url, provider.kind)
            .map_err(AppError::Message)?;
    }
    ai_providers::set_config(config);
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
                .filter(|p| p.enabled && !p.api_key.trim().is_empty())
                .map(|p| p.id.clone())
                .collect()
        })
        .unwrap_or_default()
}
