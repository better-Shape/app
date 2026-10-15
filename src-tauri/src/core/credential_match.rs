/// Public defaults are supplied by the native preset registry, never the renderer.
pub(crate) fn matches_credential_value(
    stored: &str,
    stored_scope: Option<&str>,
    requested: &str,
    requested_scope: &str,
    public_default: Option<&str>,
) -> bool {
    (stored == requested && (requested.is_empty() || stored_scope == Some(requested_scope)))
        || (stored.is_empty() && public_default == Some(requested))
}

#[cfg(test)]
mod tests {
    use super::matches_credential_value as matches;

    #[test]
    fn cleared_override_can_restore_only_its_exact_public_default() {
        assert!(matches(
            "",
            None,
            "BetterShape",
            "scope",
            Some("BetterShape")
        ));
        assert!(!matches(
            "",
            None,
            "old-secret",
            "scope",
            Some("BetterShape")
        ));
        assert!(!matches(
            "",
            None,
            "bettershape",
            "scope",
            Some("BetterShape")
        ));
        assert!(!matches("", None, "BetterShape", "scope", None));
    }

    #[test]
    fn defaults_never_bypass_a_nonempty_binding_or_its_scope() {
        assert!(!matches(
            "secret",
            Some("scope"),
            "BetterShape",
            "scope",
            Some("BetterShape")
        ));
        assert!(!matches(
            "BetterShape",
            Some("old"),
            "BetterShape",
            "new",
            Some("BetterShape")
        ));
        assert!(!matches(
            "BetterShape",
            None,
            "BetterShape",
            "scope",
            Some("BetterShape")
        ));
        assert!(matches(
            "secret",
            Some("scope"),
            "secret",
            "scope",
            Some("BetterShape")
        ));
    }

    #[test]
    fn keys_and_services_without_public_defaults_retain_exact_binding_checks() {
        assert!(matches("", Some("old"), "", "new", None));
        assert!(matches("key", Some("scope"), "key", "scope", None));
        assert!(!matches("key", Some("scope"), "other", "scope", None));
        assert!(!matches("key", Some("old"), "key", "new", None));
        assert!(!matches("", None, "key", "scope", None));
    }
}
