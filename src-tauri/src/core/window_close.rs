/// These application windows own editor recovery and/or credential drafts.
/// Native close must wait for their renderer's explicit `destroy()` decision,
/// even before JavaScript has registered its close-request listener.
pub fn requires_close_consent(label: &str) -> bool {
    matches!(
        label,
        "main" | "settings" | "onboarding" | "branch" | "git" | "stats"
    ) || label.starts_with("popout-")
        || label.starts_with("preview-")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protects_application_windows_before_renderer_registration() {
        for label in [
            "main",
            "settings",
            "onboarding",
            "branch",
            "git",
            "stats",
            "popout-editor",
            "preview-project",
        ] {
            assert!(requires_close_consent(label), "{label}");
        }
    }

    #[test]
    fn does_not_trap_unmanaged_windows() {
        for label in [
            "",
            "browser",
            "inspector",
            "settings-other",
            "popout",
            "preview",
        ] {
            assert!(!requires_close_consent(label), "{label}");
        }
    }
}
