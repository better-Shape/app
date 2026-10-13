use serde_json::{json, Value};

use crate::agent::media_stash;

use super::dispatch::{ToolCtx, ToolOutcome};

pub async fn tool_generate_svg(args: &Value, ctx: &ToolCtx<'_>) -> ToolOutcome {
    generate_media("svg", args, ctx).await
}

pub async fn tool_generate_image(args: &Value, ctx: &ToolCtx<'_>) -> ToolOutcome {
    generate_media("image", args, ctx).await
}

pub async fn tool_generate_audio(args: &Value, ctx: &ToolCtx<'_>) -> ToolOutcome {
    generate_media("audio", args, ctx).await
}

pub async fn tool_edit_image(args: &Value, ctx: &ToolCtx<'_>) -> ToolOutcome {
    generate_media("edit", args, ctx).await
}

async fn generate_media(kind: &str, args: &Value, ctx: &ToolCtx<'_>) -> ToolOutcome {
    let prompt = args
        .get("prompt")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if prompt.is_empty() {
        return fail(kind, "prompt is required.", false);
    }
    let tag = match kind {
        "svg" => "generated_svg",
        "audio" => "generated_audio",
        _ => "generated_image",
    };
    ctx.emit_ui_token(&format!("<{tag}>"));

    let target = crate::core::ai_providers::media_target();
    let Some(provider) = target else {
        ctx.emit_ui_token(&format!("</{tag}>\n"));
        return fail(
            kind,
            "Image and audio generation need an OpenAI-compatible key. Add one in Settings → Providers.",
            true,
        );
    };

    let generated = match kind {
        "audio" => generate_audio(&provider, prompt, args).await,
        "svg" => generate_svg(&provider, prompt).await,
        "edit" => match resolve_reference_image(args, ctx).await {
            Ok(image) => generate_image_edit(&provider, prompt, &image).await,
            Err(e) => {
                ctx.emit_ui_token(&format!("</{tag}>\n"));
                return fail(kind, &e, true);
            }
        },
        _ => generate_image(&provider, prompt).await,
    };

    let (data_url, mime, bytes) = match generated {
        Ok(value) => value,
        Err(e) => {
            ctx.emit_ui_token(&format!("</{tag}>\n"));
            return fail(kind, &e, true);
        }
    };

    let media_id = media_stash::stash_bytes(
        &bytes,
        &mime,
        kind,
        ctx.conversation_id.as_deref(),
        Some(prompt),
        None,
    )
    .ok()
    .map(|e| e.id);
    let id_attr = media_id
        .as_ref()
        .map(|id| format!(" media_id=\"{id}\""))
        .unwrap_or_default();

    ctx.emit_ui_token(&format!("{data_url}</{tag}>\n"));
    let label = match kind {
        "svg" => "SVG",
        "audio" => "audio clip",
        "edit" => "edited image",
        _ => "image",
    };
    let id_note = media_id
        .as_ref()
        .map(|id| format!("\nmedia_id: {id} (already stashed locally — use save_media with media_id; never ask the user to download first)"))
        .unwrap_or_default();
    let result = format!(
        "Generated {label} with {} (your own API key). Preview is in the chat UI. Do not dump binary/markup unless they asked. Only write it into the project with `save_media` if they asked to save or use it as a file.{id_note}",
        provider.label_or_id()
    );
    ToolOutcome {
        tool_result: result,
        ui_chunk: format!("\n<{tag}{id_attr}>{data_url}</{tag}>\n"),
        side_effect: None,
    }
}

type GeneratedMedia = (String, String, Vec<u8>);

fn data_url(mime: &str, bytes: &[u8]) -> String {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    format!("data:{mime};base64,{b64}")
}

fn decode_image_payload(data: &Value) -> Result<GeneratedMedia, String> {
    let item = data
        .get("data")
        .and_then(|d| d.as_array())
        .and_then(|arr| arr.first())
        .ok_or_else(|| "The image provider returned no image.".to_string())?;
    if let Some(b64) = item.get("b64_json").and_then(|v| v.as_str()) {
        use base64::Engine;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| format!("Could not decode the generated image: {e}"))?;
        return Ok((
            data_url("image/png", &bytes),
            "image/png".to_string(),
            bytes,
        ));
    }
    if let Some(url) = item.get("url").and_then(|v| v.as_str()) {
        return Ok((url.to_string(), "image/png".to_string(), Vec::new()));
    }
    Err("The image provider returned an unexpected payload.".to_string())
}

async fn generate_image(
    provider: &crate::core::ai_providers::ResolvedProvider,
    prompt: &str,
) -> Result<GeneratedMedia, String> {
    let client = reqwest::Client::new();
    let url = format!(
        "{}/images/generations",
        provider.base_url.trim_end_matches('/')
    );
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", provider.api_key))
        .json(&json!({
            "model": "gpt-image-1",
            "prompt": prompt,
            "n": 1,
            "size": "1024x1024",
        }))
        .send()
        .await
        .map_err(|e| format!("Image request failed: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "Image error {status}: {}",
            text.chars().take(300).collect::<String>()
        ));
    }
    let data: Value = serde_json::from_str(&text)
        .map_err(|e| format!("Could not read the image response: {e}"))?;
    let (mut data_url_out, mime, bytes) = decode_image_payload(&data)?;
    if bytes.is_empty() {
        let fetched = fetch_remote(&client, &data_url_out).await?;
        data_url_out = data_url(&fetched.0, &fetched.1);
        return Ok((data_url_out, fetched.0, fetched.1));
    }
    let _ = mime;
    Ok((data_url_out, mime, bytes))
}

async fn generate_image_edit(
    provider: &crate::core::ai_providers::ResolvedProvider,
    prompt: &str,
    image_data_url: &str,
) -> Result<GeneratedMedia, String> {
    let (mime, decoded) = media_stash::decode_data_url(image_data_url)
        .map_err(|_| "The reference image could not be read.".to_string())?;
    let ext = match mime.as_str() {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/webp" => "webp",
        _ => "png",
    };
    let part = reqwest::multipart::Part::bytes(decoded)
        .file_name(format!("image.{ext}"))
        .mime_str(&mime)
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new()
        .part("image", part)
        .text("prompt", prompt.to_string())
        .text("model", "gpt-image-1")
        .text("n", "1")
        .text("size", "1024x1024");

    let client = reqwest::Client::new();
    let url = format!("{}/images/edits", provider.base_url.trim_end_matches('/'));
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", provider.api_key))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Image edit request failed: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "Image edit error {status}: {}",
            text.chars().take(300).collect::<String>()
        ));
    }
    let data: Value = serde_json::from_str(&text)
        .map_err(|e| format!("Could not read the image response: {e}"))?;
    let (data_url_out, _, bytes) = decode_image_payload(&data)?;
    if bytes.is_empty() {
        let fetched = fetch_remote(&client, &data_url_out).await?;
        return Ok((data_url(&fetched.0, &fetched.1), fetched.0, fetched.1));
    }
    Ok((data_url_out, "image/png".to_string(), bytes))
}

async fn generate_audio(
    provider: &crate::core::ai_providers::ResolvedProvider,
    prompt: &str,
    args: &Value,
) -> Result<GeneratedMedia, String> {
    let voice = args
        .get("voice")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("alloy");
    let client = reqwest::Client::new();
    let url = format!("{}/audio/speech", provider.base_url.trim_end_matches('/'));
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", provider.api_key))
        .json(&json!({
            "model": "gpt-4o-mini-tts",
            "voice": voice,
            "input": prompt,
            "response_format": "mp3",
        }))
        .send()
        .await
        .map_err(|e| format!("Audio request failed: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!(
            "Audio error {status}: {}",
            text.chars().take(300).collect::<String>()
        ));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Could not read the audio response: {e}"))?
        .to_vec();
    if bytes.is_empty() {
        return Err("The audio provider returned an empty clip.".to_string());
    }
    let url_out = data_url("audio/mpeg", &bytes);
    Ok((url_out, "audio/mpeg".to_string(), bytes))
}

/// SVG is text — the user's chat model draws it.
async fn generate_svg(
    provider: &crate::core::ai_providers::ResolvedProvider,
    prompt: &str,
) -> Result<GeneratedMedia, String> {
    let _ = provider;
    let prompt = format!(
        "Create an SVG for this request. Reply with the SVG document only — no markdown fence, no commentary.\n\n{prompt}"
    );
    let svg = crate::agent::commands::streaming::quick_complete(&prompt, "svg", 4000)
        .await
        .map_err(|e| e.to_string())?;
    let svg = strip_code_fence(&svg);
    if !svg.contains("<svg") {
        return Err("The model did not return SVG markup.".to_string());
    }
    let bytes = svg.as_bytes().to_vec();
    let url_out = data_url("image/svg+xml", &bytes);
    Ok((url_out, "image/svg+xml".to_string(), bytes))
}

fn strip_code_fence(text: &str) -> String {
    let trimmed = text.trim();
    let Some(rest) = trimmed.strip_prefix("```") else {
        return trimmed.to_string();
    };
    let rest = rest.trim_start_matches(|c: char| c.is_ascii_alphanumeric() || c == '+' || c == '-');
    let rest = rest.trim_start_matches(['\r', '\n']);
    rest.strip_suffix("```").unwrap_or(rest).trim().to_string()
}

async fn fetch_remote(client: &reqwest::Client, url: &str) -> Result<(String, Vec<u8>), String> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Could not download the generated media: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "Could not download the generated media ({})",
            resp.status()
        ));
    }
    let mime = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/png")
        .to_string();
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?.to_vec();
    Ok((mime, bytes))
}

async fn resolve_reference_image(args: &Value, ctx: &ToolCtx<'_>) -> Result<String, String> {
    if let Some(id) = args
        .get("media_id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let entry = media_stash::get(id).ok_or_else(|| format!("Unknown media_id '{id}'."))?;
        let bytes = std::fs::read(&entry.path).map_err(|e| e.to_string())?;
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
        return Ok(format!("data:{};base64,{b64}", entry.mime));
    }
    if let Some(att) = args
        .get("attachment")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if let Some(entry) = media_stash::find_by_name(att) {
            let bytes = std::fs::read(&entry.path).map_err(|e| e.to_string())?;
            use base64::Engine;
            let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
            return Ok(format!("data:{};base64,{b64}", entry.mime));
        }
        // Fall through: files::find_attached may be used by save_media; for edit we scan history below.
        let history = ctx
            .agent_state
            .history
            .lock()
            .map_err(|_| "Could not read chat history.".to_string())?;
        let needle = att.to_ascii_lowercase();
        for msg in history.iter().rev() {
            if let Some(data) = extract_data_url_named(&msg.content, &needle) {
                let _ = media_stash::stash_data_url(
                    &data,
                    "image",
                    ctx.conversation_id.as_deref(),
                    None,
                    Some(att),
                );
                return Ok(data);
            }
        }
        return Err(format!("No attached/generated image named '{att}'."));
    }
    if let Some(path) = args
        .get("path")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let abs = crate::agent::security::paths::validate_read_path(path, ctx.project_path)
            .map_err(|e| e.to_string())?;
        let bytes = std::fs::read(&abs).map_err(|e| e.to_string())?;
        let mime = mime_from_path(&abs);
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
        return Ok(format!("data:{mime};base64,{b64}"));
    }
    Err("Pass media_id, attachment, or path for the image to edit.".to_string())
}

fn extract_data_url_named(content: &str, needle: &str) -> Option<String> {
    for tag in [
        "attached_image",
        "attached_asset",
        "generated_image",
        "generated_svg",
    ] {
        let open = format!("<{tag}");
        let close = format!("</{tag}>");
        let mut rest = content;
        while let Some(start) = rest.find(&open) {
            let after = &rest[start..];
            let Some(end_attrs) = after.find('>') else {
                break;
            };
            let attrs = &after[..end_attrs];
            let name = attrs
                .split("name=\"")
                .nth(1)
                .and_then(|s| s.split('"').next())
                .unwrap_or("");
            let body_start = start + end_attrs + 1;
            let Some(rel_end) = rest[body_start..].find(&close) else {
                break;
            };
            let body = rest[body_start..body_start + rel_end].trim();
            if name.eq_ignore_ascii_case(needle) || needle.is_empty() {
                if body.starts_with("data:") || body.starts_with("http") {
                    return Some(body.to_string());
                }
            }
            rest = &rest[body_start + rel_end + close.len()..];
        }
    }
    None
}

fn mime_from_path(path: &std::path::Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "svg" => "image/svg+xml",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "image/png",
    }
}

fn fail(kind: &str, message: &str, already_streamed_card: bool) -> ToolOutcome {
    let name = match kind {
        "svg" => "generate_svg",
        "audio" => "generate_audio",
        "edit" => "edit_image",
        _ => "generate_image",
    };
    let configured = !message.to_ascii_lowercase().contains("not configured");
    let extra = if configured {
        String::new()
    } else {
        " Generation is unavailable. Tell the user that. Do not retry generate_svg, generate_image, generate_audio, or edit_image. Do not create, edit, or write media files as a substitute. Asking to generate media is not asking for a project file."
            .to_string()
    };
    let ui = if already_streamed_card {
        String::new()
    } else {
        format!("\n<tool_result>\n[{name}] ERROR: {message}\n</tool_result>\n")
    };
    ToolOutcome {
        tool_result: format!("ERROR: {message}.{extra}"),
        ui_chunk: ui,
        side_effect: None,
    }
}
