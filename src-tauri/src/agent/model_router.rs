/// Model routing and family classification for the agent harness.
///
/// BetterShape is bring-your-own-key: model ids are `provider/model`
/// (`openai/gpt-5`, `anthropic/claude-sonnet-4.5`, `google/gemini-2.5-pro`,
/// `openrouter/…`, `custom/…`). `auto` resolves at request time to the user's
/// configured default model — never to a hardcoded vendor slug.
///
/// Families drive per-model prompt overlays and tool shapes (Cursor-style harness
/// customization): OpenAI-trained models prefer apply_patch; Anthropic/DeepSeek
/// prefer SEARCH/REPLACE string edits.

/// Auto selection id. Resolves to the configured default model.
pub const AUTO_MODEL: &str = "auto";

/// Provider family used to select prompts and edit tools.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ModelFamily {
    Anthropic,
    OpenAi,
    DeepSeek,
    Google,
    XAi,
    ZAi,
    Qwen,
    Other,
}

impl ModelFamily {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Anthropic => "anthropic",
            Self::OpenAi => "openai",
            Self::DeepSeek => "deepseek",
            Self::Google => "google",
            Self::XAi => "xai",
            Self::ZAi => "zai",
            Self::Qwen => "qwen",
            Self::Other => "other",
        }
    }

    /// OpenAI / Codex-style models use `apply_patch` instead of `edit_file`.
    pub fn uses_apply_patch(self) -> bool {
        matches!(self, Self::OpenAi)
    }
}

/// Normalize a user-facing model id while keeping the provider prefix intact.
pub fn normalize_model(model: &str) -> String {
    if is_auto_selection(model) {
        AUTO_MODEL.to_string()
    } else {
        model.trim().to_string()
    }
}

/// Provider-native slug for a selection id (Auto → the configured default model).
/// Falls back to the raw id when nothing is configured yet.
pub fn concrete_model(model: &str) -> String {
    if let Ok((_, slug)) = crate::core::ai_providers::resolve_model(model) {
        if !slug.trim().is_empty() {
            return slug;
        }
    }
    normalize_model(model)
}

#[allow(dead_code)]
pub fn normalize_model_with_images(model: &str, has_images: bool) -> String {
    let _ = has_images;
    // Auto always stays on the same model. Images are captioned separately
    // when the selected model is text-only.
    normalize_model(model)
}

pub fn is_auto_selection(model: &str) -> bool {
    matches!(model.trim(), "auto" | "openrouter/auto")
}

/// Model id for the in-editor single-file rewrite (the user's default model).
pub fn editor_rewrite_model() -> &'static str {
    AUTO_MODEL
}

#[allow(dead_code)]
pub fn mode_wants_vision(mode: &str) -> bool {
    matches!(
        mode.trim().to_ascii_lowercase().as_str(),
        "visual" | "design" | "code" | "review" | "agent"
    )
}

/// True when content has an `<attached_image>` tag that carries a `data:` URL.
pub fn content_has_images(content: &str) -> bool {
    let Some(start) = content.find("<attached_image") else {
        return false;
    };
    content[start..].contains("data:")
}

pub fn model_accepts_images(model: &str) -> bool {
    let m = model.trim().to_ascii_lowercase();
    if m.is_empty() {
        return false;
    }
    // Auto follows whatever the user configured as the default model.
    if is_auto_selection(&m) {
        return model_accepts_images(&concrete_model(&m));
    }
    if m.contains("vision") || m.contains("vl") || m.contains("omni") {
        return true;
    }
    m.starts_with("google/")
        || m.starts_with("anthropic/")
        || m.starts_with("openai/")
        || m.starts_with("x-ai/")
        || m.starts_with("qwen/")
        || m.contains("gemini")
        || m.contains("claude")
        || m.contains("gpt-4")
        || m.contains("gpt-5")
}

/// Classify a normalized OpenRouter model slug into a harness family.
pub fn model_family(model: &str) -> ModelFamily {
    let m = model.trim().to_ascii_lowercase();
    if m.is_empty() {
        return ModelFamily::Other;
    }

    // Provider prefix (openrouter style: `anthropic/claude-…`).
    if let Some((provider, rest)) = m.split_once('/') {
        match provider {
            "anthropic" => return ModelFamily::Anthropic,
            "openai" | "openai-compatible" | "chatgpt" | "azure" | "azure-openai" => {
                return ModelFamily::OpenAi;
            }
            "deepseek" => return ModelFamily::DeepSeek,
            "google" | "google-ai" | "gemini" => return ModelFamily::Google,
            "x-ai" | "xai" => return ModelFamily::XAi,
            "z-ai" | "zai" | "zhipu" | "glm" => return ModelFamily::ZAi,
            "qwen" | "alibaba" => return ModelFamily::Qwen,
            // Some routers nest: `openrouter/openai/gpt-…` — rare; check rest.
            _ if rest.starts_with("openai/") || rest.starts_with("gpt-") => {
                return ModelFamily::OpenAi;
            }
            _ if rest.starts_with("anthropic/") || rest.starts_with("claude") => {
                return ModelFamily::Anthropic;
            }
            _ if rest.starts_with("deepseek") => return ModelFamily::DeepSeek,
            _ if rest.starts_with("gemini") || rest.starts_with("google/") => {
                return ModelFamily::Google;
            }
            _ if rest.starts_with("glm") || rest.starts_with("z-ai/") => {
                return ModelFamily::ZAi;
            }
            _ if rest.starts_with("qwen") => return ModelFamily::Qwen,
            _ => {}
        }
    }

    // Bare / alias ids without a provider prefix.
    if m.starts_with("gpt-")
        || m.starts_with("chatgpt")
        || m.starts_with("o1")
        || m.starts_with("o3")
        || m.starts_with("o4")
        || m.contains("codex")
    {
        return ModelFamily::OpenAi;
    }
    if m.starts_with("claude") {
        return ModelFamily::Anthropic;
    }
    if m.starts_with("deepseek") {
        return ModelFamily::DeepSeek;
    }
    if m.starts_with("gemini") {
        return ModelFamily::Google;
    }
    if m.starts_with("grok") {
        return ModelFamily::XAi;
    }
    if m.starts_with("glm") {
        return ModelFamily::ZAi;
    }
    if m.starts_with("qwen") {
        return ModelFamily::Qwen;
    }

    ModelFamily::Other
}

/// Mid-chat switch hint when the previous turn used a different family.
pub fn mid_chat_switch_hint(previous: ModelFamily, current: ModelFamily) -> Option<String> {
    if previous == current {
        return None;
    }
    let edit_note = if current.uses_apply_patch() {
        "Your edit tool is `apply_patch` (*** Begin Patch format). Ignore any prior SEARCH/REPLACE or `edit_file` calls in this chat history — those tools are not in your current tool set."
    } else {
        "Your edit tool is `edit_file` with SEARCH/REPLACE blocks. Ignore any prior `apply_patch` calls in this chat history — that tool is not in your current tool set."
    };
    Some(format!(
        "\n<model_switch>\nYou are taking over mid-chat from a {prev} family model. Only use tools in your current tool list. Do not call tools that appear only in earlier transcript history.\n{edit_note}\n</model_switch>\n",
        prev = previous.as_str(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_auto() {
        assert_eq!(normalize_model("auto"), AUTO_MODEL);
        assert_eq!(normalize_model("openrouter/auto"), AUTO_MODEL);
        assert_eq!(
            normalize_model("anthropic/claude-sonnet-4"),
            "anthropic/claude-sonnet-4"
        );
        assert_eq!(normalize_model_with_images("auto", true), AUTO_MODEL);
        assert_eq!(normalize_model_with_images("auto", false), AUTO_MODEL);
        assert_eq!(normalize_model(" openai/gpt-5 "), "openai/gpt-5");
    }

    #[test]
    fn editor_rewrite_stays_on_auto() {
        let id = editor_rewrite_model();
        assert_eq!(id, AUTO_MODEL);
        assert!(!id.contains('/'));
    }

    #[test]
    fn classify_families() {
        assert_eq!(
            model_family("anthropic/claude-sonnet-4"),
            ModelFamily::Anthropic
        );
        assert_eq!(model_family("openai/gpt-5.1"), ModelFamily::OpenAi);
        assert_eq!(model_family("openai/gpt-5.1-codex"), ModelFamily::OpenAi);
        assert_eq!(model_family("vendor/foo-codex-bar"), ModelFamily::OpenAi);
        assert_eq!(model_family("azure/gpt-4o"), ModelFamily::OpenAi);
        assert_eq!(model_family("chatgpt-4o-latest"), ModelFamily::OpenAi);
        assert_eq!(
            model_family("deepseek/deepseek-v4-flash"),
            ModelFamily::DeepSeek
        );
        assert_eq!(model_family("google/gemini-2.5-pro"), ModelFamily::Google);
        assert_eq!(model_family("x-ai/grok-3"), ModelFamily::XAi);
        assert_eq!(model_family("z-ai/glm-5.3"), ModelFamily::ZAi);
        assert_eq!(model_family("z-ai/glm-5.3-flash"), ModelFamily::ZAi);
        assert_eq!(model_family("qwen/qwen3-coder-plus"), ModelFamily::Qwen);
        assert_eq!(model_family("gpt-4o"), ModelFamily::OpenAi);
        assert_eq!(model_family("claude-3-5-sonnet"), ModelFamily::Anthropic);
        assert_eq!(model_family("some-vendor/mystery"), ModelFamily::Other);
    }

    #[test]
    fn apply_patch_only_openai() {
        assert!(ModelFamily::OpenAi.uses_apply_patch());
        assert!(!ModelFamily::Anthropic.uses_apply_patch());
        assert!(!ModelFamily::DeepSeek.uses_apply_patch());
    }

    #[test]
    fn switch_hint_when_families_differ() {
        assert!(mid_chat_switch_hint(ModelFamily::DeepSeek, ModelFamily::OpenAi).is_some());
        assert!(mid_chat_switch_hint(ModelFamily::OpenAi, ModelFamily::OpenAi).is_none());
    }

    #[test]
    fn auto_with_images_keeps_the_configured_model() {
        assert_eq!(normalize_model_with_images("auto", true), AUTO_MODEL);
        assert!(model_accepts_images("google/gemini-2.5-flash"));
        assert!(content_has_images(
            "see <attached_image name=\"x.png\">data:image/png;base64,aa</attached_image>"
        ));
        assert!(!content_has_images("plain text"));
    }

    #[test]
    fn vision_models_are_not_rejected_as_text_only() {
        assert!(model_accepts_images("deepseek/deepseek-vl2"));
        assert!(!model_accepts_images("deepseek/deepseek-chat"));
        assert!(!model_accepts_images("deepseek/deepseek-chat "));
    }

    #[test]
    fn path_only_attachment_is_not_image_content() {
        assert!(!content_has_images(
            "<attached_image name=\"demo.png\">/images/demo/pricing.png</attached_image>"
        ));
        assert!(!content_has_images("<attached_image></attached_image>"));
        assert!(!content_has_images(
            "data:image/png;base64,aa then later <attached_image>path.png</attached_image>"
        ));
    }

    #[test]
    fn modes_with_screenshot_tool_keep_the_selected_model() {
        assert!(mode_wants_vision("code"));
        assert!(mode_wants_vision("Visual"));
        assert!(mode_wants_vision("design"));
        assert!(mode_wants_vision("review"));
        assert!(mode_wants_vision("agent"));
        assert!(!mode_wants_vision("ask"));
        assert!(!mode_wants_vision("plan"));
        assert_eq!(
            normalize_model_with_images("auto", mode_wants_vision("code")),
            AUTO_MODEL
        );
        assert_eq!(
            normalize_model_with_images("auto", mode_wants_vision("ask")),
            AUTO_MODEL
        );
    }
}
