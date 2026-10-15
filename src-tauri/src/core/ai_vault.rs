//! Process-wide credential authority shared by every WebView.
//!
//! Mutations compare an observed revision while holding one native mutex. A
//! failed keychain write still advances the logical intent: an older window
//! must not resurrect a deletion merely because the keychain was locked.
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::ai_providers::AiProviderConfig;
use super::credential_match::matches_credential_value;

use super::provider_header_defaults::public_header_default;
#[cfg(test)]
use super::provider_header_defaults::PUBLIC_HEADER_DEFAULTS;

const RECORD_PREFIX: &str = "bettershape-vault-v1\n";

/// Legacy raw passwords remain readable; new records retain non-secret
/// generations even after a clear, so restarts cannot reuse an old lease.
pub fn decode(id: &str, password: Option<&str>) -> Result<Snapshot, serde_json::Error> {
    // The marker ends in a newline, so a raw legacy secret cannot carry it. A
    // prefixed value that does not parse is therefore a damaged managed record,
    // and the error is deliberate: falling back to the raw bytes would import a
    // truncated record as an API key and silently drop its lease identity. The
    // record stays until the user saves a new key, which writes a fresh one.
    if let Some(json) = password.and_then(|value| value.strip_prefix(RECORD_PREFIX)) {
        let mut snapshot: Snapshot = serde_json::from_str(json)?;
        snapshot.id = id.to_owned();
        snapshot.persisted = true;
        return Ok(snapshot);
    }
    Ok(Snapshot {
        id: id.to_owned(),
        api_key: password.unwrap_or_default().to_owned(),
        revision: password.map_or_else(
            || INITIAL_REVISION.to_owned(),
            |value| format!("legacy:{:x}", Sha256::digest(value.as_bytes())),
        ),
        persisted: true,
        scope: None,
    })
}

pub fn encode(snapshot: &Snapshot) -> Result<String, serde_json::Error> {
    serde_json::to_string(snapshot).map(|json| format!("{RECORD_PREFIX}{json}"))
}

pub const INITIAL_REVISION: &str = "initial";
pub static VAULT: LazyLock<Mutex<Vault>> = LazyLock::new(|| Mutex::new(Vault::default()));

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: String,
    pub api_key: String,
    pub revision: String,
    pub persisted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
}

/// Unreadable state conveys no lease and no authority to clear a local draft.
#[derive(Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum ReadResult {
    Available {
        #[serde(flatten)]
        snapshot: Snapshot,
    },
    Unavailable {
        id: String,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mutation {
    pub applied: bool,
    pub current: Snapshot,
}

#[derive(Default)]
pub struct Vault {
    entries: HashMap<String, Snapshot>,
}

impl Vault {
    pub fn has_entries(&self) -> bool {
        !self.entries.is_empty()
    }

    pub fn read<E>(
        &mut self,
        id: &str,
        load: impl FnOnce() -> Result<Snapshot, E>,
    ) -> Result<Snapshot, E> {
        if let Some(snapshot) = self.entries.get(id) {
            return Ok(snapshot.clone());
        }
        let snapshot = load()?;
        self.entries.insert(id.to_owned(), snapshot.clone());
        Ok(snapshot)
    }

    pub fn read_result<E>(
        &mut self,
        id: &str,
        load: impl FnOnce() -> Result<Snapshot, E>,
    ) -> ReadResult {
        match self.read(id, load) {
            Ok(snapshot) => ReadResult::Available { snapshot },
            Err(_) => ReadResult::Unavailable { id: id.to_owned() },
        }
    }

    #[cfg(test)]
    pub fn write(
        &mut self,
        id: &str,
        value: &str,
        expected_revision: &str,
        persist: impl FnOnce(&Snapshot) -> bool,
    ) -> Mutation {
        self.write_scoped(id, value, expected_revision, None, persist)
    }

    pub fn write_scoped(
        &mut self,
        id: &str,
        value: &str,
        expected_revision: &str,
        scope: Option<&str>,
        persist: impl FnOnce(&Snapshot) -> bool,
    ) -> Mutation {
        let current = self
            .entries
            .entry(id.to_owned())
            .or_insert_with(|| Snapshot {
                id: id.to_owned(),
                api_key: String::new(),
                revision: INITIAL_REVISION.to_owned(),
                persisted: false,
                scope: None,
            });
        if current.revision != expected_revision {
            return Mutation {
                applied: false,
                current: current.clone(),
            };
        }
        // Native, revision-validated no-op, not a WebView-local cache shortcut.
        if !value.is_empty()
            && current.api_key == value
            && current.persisted
            && current.scope.as_deref() == scope
            && current.revision != INITIAL_REVISION
        {
            return Mutation {
                applied: true,
                current: current.clone(),
            };
        }
        if value.is_empty()
            || current.api_key != value
            || current.revision == INITIAL_REVISION
            || current.scope.as_deref() != scope
        {
            current.revision = uuid::Uuid::new_v4().to_string();
        }
        current.api_key = value.to_owned();
        current.scope = scope.map(str::to_owned);
        current.persisted = persist(current);
        Mutation {
            applied: true,
            current: current.clone(),
        }
    }

    /// Reject stale credentials instead of copying a newer secret into an
    /// older window's endpoint configuration. Keys and endpoints stay paired.
    pub fn matches_config(&self, config: &AiProviderConfig) -> bool {
        let matches = |id: &str, value: &str, scope: &str, public_default: Option<&str>| {
            self.entries.get(id).is_none_or(|snapshot| {
                matches_credential_value(
                    &snapshot.api_key,
                    snapshot.scope.as_deref(),
                    value,
                    scope,
                    public_default,
                )
            })
        };
        config.providers.iter().all(|provider| {
            let scope = provider_scope(provider);
            matches(&provider.id, &provider.api_key, &scope, None)
                && provider.headers.iter().all(|(name, value)| {
                    matches(
                        &format!("header:{}:{name}", provider.id),
                        value,
                        &scope,
                        public_header_default(&provider.id, name),
                    )
                })
        }) && matches(
            "service:search",
            &config.search.api_key,
            &serde_json::json!(["search-v1", config.search.provider]).to_string(),
            None,
        ) && matches(
            "service:composio",
            &config.composio.api_key,
            &serde_json::json!(["composio-v1", config.composio.user_id]).to_string(),
            None,
        )
    }
}

pub fn provider_scope(provider: &super::ai_providers::ProviderEntry) -> String {
    serde_json::json!([
        "provider-v1",
        provider.kind.as_str(),
        provider.base_url.trim().trim_end_matches('/'),
        provider.auth_style
    ])
    .to_string()
}

/// Clearing is safe without replacing endpoint settings. A store must wait for
/// its complete, validated configuration instead of injecting a new key into
/// the previous endpoint while its frontend acknowledgement is still pending.
pub fn clear_config_credential(id: &str, config: &mut AiProviderConfig) {
    for provider in &mut config.providers {
        if provider.id == id {
            provider.api_key.clear();
        }
        for (name, value) in &mut provider.headers {
            if format!("header:{}:{name}", provider.id) == id {
                value.clear();
            }
        }
    }
    if id == "service:search" {
        config.search.api_key.clear();
    }
    if id == "service:composio" {
        config.composio.api_key.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn unreadable_is_not_an_empty_credential_or_a_cached_lease() {
        let mut vault = Vault::default();
        let unavailable = vault.read_result("key", || Err::<Snapshot, _>("locked"));
        assert_eq!(
            serde_json::to_value(unavailable).unwrap(),
            serde_json::json!({ "id": "key", "status": "unavailable" })
        );
        assert!(!vault.has_entries());
        let missing = vault.read_result("key", || decode("key", None));
        assert_eq!(
            serde_json::to_value(missing).unwrap(),
            serde_json::json!({
                "id": "key", "status": "available", "apiKey": "",
                "revision": "initial", "persisted": true
            })
        );
    }

    #[test]
    fn repeated_clear_also_fences_a_pending_reentry() {
        let mut vault = Vault::default();
        let first = vault.write("key", "", INITIAL_REVISION, |_| true).current;
        let second = vault.write("key", "", &first.revision, |_| true).current;
        assert_ne!(first.revision, second.revision);
        assert!(
            !vault
                .write("key", "late", &first.revision, |_| panic!("stale reentry"))
                .applied
        );
    }

    #[test]
    fn durable_tombstone_survives_native_restart() {
        let mut first = Vault::default();
        let old = first
            .write("key", "old", INITIAL_REVISION, |_| true)
            .current;
        let cleared = first.write("key", "", &old.revision, |_| true).current;
        let persisted = encode(&cleared).unwrap();
        let mut restarted = Vault::default();
        restarted
            .read("key", || decode("key", Some(&persisted)))
            .unwrap();
        assert!(
            !restarted
                .write("key", "old", &old.revision, |_| panic!("obsolete lease"))
                .applied
        );
    }

    #[test]
    fn clearing_an_empty_entry_fences_a_pending_first_write() {
        let mut vault = Vault::default();
        let cleared = vault.write("key", "", INITIAL_REVISION, |_| true).current;
        assert_ne!(cleared.revision, INITIAL_REVISION);
        assert!(
            !vault
                .write("key", "late", INITIAL_REVISION, |_| panic!(
                    "late first store"
                ))
                .applied
        );
    }

    #[test]
    fn reads_legacy_passwords_but_refuses_corrupt_versioned_records() {
        let legacy = decode("key", Some("legacy-secret")).unwrap();
        assert_eq!(legacy.api_key, "legacy-secret");
        assert_ne!(legacy.revision, INITIAL_REVISION);
        assert!(decode("key", Some("bettershape-vault-v1\n{broken")).is_err());
    }

    #[test]
    fn stale_window_cannot_restore_a_deleted_secret() {
        let mut vault = Vault::default();
        let old = vault
            .write("openai", "old", INITIAL_REVISION, |_| true)
            .current;
        let deleted = vault.write("openai", "", &old.revision, |_| true).current;
        let called = Cell::new(false);
        let late = vault.write("openai", "old", &old.revision, |_| {
            called.set(true);
            true
        });
        assert!(!late.applied);
        assert!(!called.get());
        assert_eq!(late.current.api_key, "");
        assert_eq!(late.current.revision, deleted.revision);
    }

    #[test]
    fn failed_deletion_also_fences_older_writes_and_can_retry() {
        let mut vault = Vault::default();
        let old = vault
            .write("key", "old", INITIAL_REVISION, |_| true)
            .current;
        let pending = vault.write("key", "", &old.revision, |_| false).current;
        assert!(!pending.persisted);
        assert!(
            !vault
                .write("key", "old", &old.revision, |_| panic!("obsolete write"))
                .applied
        );
        assert_eq!(
            vault
                .read("key", || -> Result<Snapshot, ()> {
                    panic!("logical deletion wins")
                })
                .unwrap()
                .api_key,
            ""
        );
        let retried = vault.write("key", "", &pending.revision, |_| true);
        assert!(retried.current.persisted);
        assert_ne!(retried.current.revision, pending.revision);
    }

    #[test]
    fn failed_store_preserves_latest_intent_without_claiming_durability() {
        let mut vault = Vault::default();
        let pending = vault
            .write("key", "new", INITIAL_REVISION, |_| false)
            .current;
        assert_eq!(pending.api_key, "new");
        assert!(!pending.persisted);
        assert!(
            vault
                .write("key", "new", &pending.revision, |_| true)
                .current
                .persisted
        );
    }

    #[test]
    fn unrelated_ids_do_not_conflict_and_validated_noop_skips_keychain_io() {
        let mut vault = Vault::default();
        let first = vault.write("a", "a", INITIAL_REVISION, |_| true).current;
        assert!(vault.write("b", "b", INITIAL_REVISION, |_| true).applied);
        assert!(
            vault
                .write("a", "a", &first.revision, |_| panic!(
                    "redundant keychain write"
                ))
                .applied
        );
    }

    #[test]
    fn runtime_configuration_cannot_reintroduce_cleared_service_key() {
        let mut vault = Vault::default();
        vault.write("service:search", "", INITIAL_REVISION, |_| true);
        let mut config = AiProviderConfig::default();
        config.search.api_key = "obsolete".into();
        assert!(!vault.matches_config(&config));
        clear_config_credential("service:search", &mut config);
        assert!(vault.matches_config(&config));
        assert_eq!(config.search.api_key, "");
    }
    #[test]
    fn destination_matches_shared_renderer_fixtures() {
        let fixtures: serde_json::Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/credential-scopes.json"
        ))
        .unwrap();
        for fixture in fixtures.as_array().unwrap() {
            let provider = serde_json::from_value(fixture["provider"].clone()).unwrap();
            assert_eq!(
                provider_scope(&provider),
                fixture["scope"].as_str().unwrap()
            );
        }
    }

    #[test]
    fn destination_survives_restart_and_rejects_wrong_service() {
        let scope = r#"["search-v1","brave"]"#;
        let mut first = Vault::default();
        let saved = first
            .write_scoped(
                "service:search",
                "example-key",
                INITIAL_REVISION,
                Some(scope),
                |_| true,
            )
            .current;
        let encoded = encode(&saved).unwrap();
        let mut restarted = Vault::default();
        restarted
            .read("service:search", || {
                decode("service:search", Some(&encoded))
            })
            .unwrap();
        let mut config = AiProviderConfig::default();
        config.search.provider = "brave".into();
        config.search.api_key = "example-key".into();
        assert!(restarted.matches_config(&config));
        config.search.provider = "tavily".into();
        assert!(!restarted.matches_config(&config));
    }

    #[test]
    fn destination_change_advances_revision_even_with_the_same_key() {
        let mut vault = Vault::default();
        let old = vault
            .write_scoped(
                "key",
                "example-key",
                INITIAL_REVISION,
                Some("first"),
                |_| true,
            )
            .current;
        let new = vault
            .write_scoped("key", "example-key", &old.revision, Some("second"), |_| {
                false
            })
            .current;
        assert_ne!(old.revision, new.revision);
        assert_eq!(new.scope.as_deref(), Some("second"));
        assert!(!new.persisted);
        let stale = vault.write_scoped("key", "example-key", &old.revision, Some("first"), |_| {
            panic!("stale destination")
        });
        assert!(!stale.applied);
        let retry = vault.write_scoped("key", "example-key", &new.revision, Some("second"), |_| {
            true
        });
        assert!(retry.current.persisted);
        assert_eq!(retry.current.scope.as_deref(), Some("second"));
    }

    #[test]
    fn provider_and_header_destinations_are_checked_independently() {
        let mut provider: super::super::ai_providers::ProviderEntry = serde_json::from_value(serde_json::json!({
            "id": "openai", "kind": "openai", "apiKey": "example-key", "baseUrl": "https://first.invalid/v1",
            "authStyle": "bearer", "headers": { "Authorization": "example-header" }
        })).unwrap();
        let scope = provider_scope(&provider);
        let mut vault = Vault::default();
        vault.write_scoped(
            "openai",
            "example-key",
            INITIAL_REVISION,
            Some(&scope),
            |_| true,
        );
        vault.write_scoped(
            "header:openai:Authorization",
            "example-header",
            INITIAL_REVISION,
            Some(&scope),
            |_| true,
        );
        let mut config = AiProviderConfig {
            providers: vec![provider.clone()],
            ..Default::default()
        };
        assert!(vault.matches_config(&config));
        provider.base_url = "https://second.invalid/v1".into();
        config.providers = vec![provider];
        assert!(!vault.matches_config(&config));
        let revision = vault.entries["openai"].revision.clone();
        vault.write_scoped(
            "openai",
            "example-key",
            &revision,
            Some(&provider_scope(&config.providers[0])),
            |_| true,
        );
        assert!(!vault.matches_config(&config));
    }

    fn header_config(provider: &str, name: &str, value: &str) -> AiProviderConfig {
        let mut config: AiProviderConfig = serde_json::from_value(serde_json::json!({
            "providers": [{ "id": provider, "kind": "openai", "baseUrl": "https://gateway.invalid/v1" }]
        })).unwrap();
        config.providers[0]
            .headers
            .insert(name.into(), value.into());
        config
    }

    #[test]
    fn cleared_preset_overrides_restore_public_headers_without_restoring_secrets() {
        for (provider, defaults) in PUBLIC_HEADER_DEFAULTS.iter() {
            for (name, value) in defaults {
                for persisted in [true, false] {
                    let config = header_config(provider, name, value);
                    let id = format!("header:{provider}:{name}");
                    let mut vault = Vault::default();
                    let old = vault
                        .write_scoped(
                            &id,
                            "private-override",
                            INITIAL_REVISION,
                            Some(&provider_scope(&config.providers[0])),
                            |_| true,
                        )
                        .current;
                    vault.write(&id, "", &old.revision, |_| persisted);
                    assert!(vault.matches_config(&config), "{provider}/{name}");
                    assert!(!vault.matches_config(&header_config(
                        provider,
                        name,
                        "private-override"
                    )));
                    assert!(vault.matches_config(&header_config(provider, name, "")));
                }
            }
        }
    }

    #[test]
    fn public_header_lookup_is_case_insensitive_but_values_and_provider_ids_are_exact() {
        assert_eq!(
            public_header_default("openrouter", "x-title"),
            Some("BetterShape")
        );
        assert_eq!(public_header_default("custom", "X-Title"), None);
        assert_eq!(public_header_default("openrouter", "Authorization"), None);
        for (provider, name, value) in [
            ("custom", "X-Title", "BetterShape"),
            ("openrouter", "Authorization", "BetterShape"),
            ("openrouter", "X-Title", "bettershape"),
        ] {
            let mut vault = Vault::default();
            vault.write(
                &format!("header:{provider}:{name}"),
                "",
                INITIAL_REVISION,
                |_| true,
            );
            assert!(!vault.matches_config(&header_config(provider, name, value)));
        }
    }

    #[test]
    fn public_default_does_not_replace_a_saved_header_or_bypass_its_destination() {
        for saved in ["private-override", "BetterShape"] {
            let mut vault = Vault::default();
            vault.write_scoped(
                "header:openrouter:X-Title",
                saved,
                INITIAL_REVISION,
                Some("different-scope"),
                |_| true,
            );
            assert!(!vault.matches_config(&header_config("openrouter", "X-Title", "BetterShape")));
        }
    }

    #[test]
    fn public_literals_do_not_bypass_cleared_api_keys_or_services() {
        let mut config = header_config("openrouter", "X-Title", "BetterShape");
        let mut vault = Vault::default();
        vault.write("openrouter", "", INITIAL_REVISION, |_| true);
        config.providers[0].api_key = "BetterShape".into();
        assert!(!vault.matches_config(&config));
        config.providers[0].api_key.clear();
        vault.write("service:search", "", INITIAL_REVISION, |_| true);
        config.search.api_key = "BetterShape".into();
        assert!(!vault.matches_config(&config));
        config.search.api_key.clear();
        vault.write("service:composio", "", INITIAL_REVISION, |_| true);
        config.composio.api_key = "BetterShape".into();
        assert!(!vault.matches_config(&config));
    }
}
