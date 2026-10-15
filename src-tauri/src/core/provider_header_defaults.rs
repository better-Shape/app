use std::collections::HashMap;
use std::sync::LazyLock;

pub(super) static PUBLIC_HEADER_DEFAULTS: LazyLock<HashMap<String, HashMap<String, String>>> =
    LazyLock::new(|| {
        serde_json::from_str(include_str!(
            "../../../lib/ai/provider-default-headers.json"
        ))
        .expect("compiled public provider header defaults must be valid")
    });

pub(crate) fn public_header_default(provider: &str, name: &str) -> Option<&'static str> {
    PUBLIC_HEADER_DEFAULTS
        .get(provider)?
        .iter()
        .find(|(header, _)| header.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.as_str())
}
