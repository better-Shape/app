//! Provider wire formats.
//!
//! The agent harness is written against OpenAI's chat-completions shape (it
//! accumulates `choices[0].delta` chunks and `role: "tool"` history). This
//! module translates that shape in two directions so Anthropic and Google
//! models can be driven natively:
//!
//! * `to_provider_body`   — OpenAI request body → provider request body
//! * `request`            — provider-correct URL + auth headers
//! * `normalize_sse_event`— provider stream event → OpenAI-shaped chunk
//! * `normalize_completion`— provider response → OpenAI-shaped completion

use std::collections::HashMap;

use reqwest::Client;
use serde_json::{json, Map, Value};

use crate::core::ai_providers::{
    anthropic_endpoint, embeddings_endpoint, effort_budget, google_endpoint, openai_endpoint,
    ProviderKind, ResolvedProvider,
};

/// Per-stream bookkeeping for providers whose deltas don't carry tool indexes.
#[derive(Debug, Default)]
pub struct WireState {
    /// Anthropic content-block index → agent tool slot index.
    tool_slots: HashMap<u64, usize>,
    /// Next tool slot to hand out.
    next_tool: usize,
}

impl WireState {
    pub fn new() -> Self {
        Self::default()
    }

    fn slot_for_block(&mut self, block: u64) -> usize {
        if let Some(slot) = self.tool_slots.get(&block) {
            return *slot;
        }
        let slot = self.next_tool;
        self.next_tool += 1;
        self.tool_slots.insert(block, slot);
        slot
    }

    fn next_slot(&mut self) -> usize {
        let slot = self.next_tool;
        self.next_tool += 1;
        slot
    }
}

fn str_field<'a>(value: &'a Value, path: &[&str]) -> Option<&'a str> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_str()
}

fn json_string(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn text_of_content(content: &Value) -> String {
    if let Some(text) = content.as_str() {
        return text.to_string();
    }
    if let Some(parts) = content.as_array() {
        return parts
            .iter()
            .filter_map(|part| part.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join("\n");
    }
    String::new()
}

// ---------------------------------------------------------------------------
// Request building
// ---------------------------------------------------------------------------

/// Provider-correct request for one completion call.
pub fn request(
    client: &Client,
    provider: &ResolvedProvider,
    model: &str,
    body: &Value,
    stream: bool,
) -> reqwest::RequestBuilder {
    let converted = to_provider_body(provider.kind, body);
    match provider.kind {
        ProviderKind::OpenAi => client
            .post(openai_endpoint(provider))
            .header("Authorization", format!("Bearer {}", provider.api_key))
            .header("Content-Type", "application/json")
            .json(&converted),
        ProviderKind::Anthropic => client
            .post(anthropic_endpoint(provider))
            .header("x-api-key", provider.api_key.clone())
            .header("anthropic-version", "2023-06-01")
            .header("Content-Type", "application/json")
            .json(&converted),
        ProviderKind::Google => client
            .post(google_endpoint(provider, model, stream))
            .header("x-goog-api-key", provider.api_key.clone())
            .header("Content-Type", "application/json")
            .json(&converted),
    }
}

/// Embeddings request (OpenAI wire only — the only mainstream embeddings API
/// among the supported providers).
pub fn embeddings_request(
    client: &Client,
    provider: &ResolvedProvider,
    model: &str,
    inputs: &[String],
    dimensions: Option<u32>,
) -> reqwest::RequestBuilder {
    let mut body = json!({ "model": model, "input": inputs });
    if let Some(dimensions) = dimensions {
        body["dimensions"] = json!(dimensions);
    }
    client
        .post(embeddings_endpoint(provider))
        .header("Authorization", format!("Bearer {}", provider.api_key))
        .header("Content-Type", "application/json")
        .json(&body)
}

/// OpenAI request body → the provider's own shape.
pub fn to_provider_body(kind: ProviderKind, body: &Value) -> Value {
    match kind {
        ProviderKind::OpenAi => body.clone(),
        ProviderKind::Anthropic => openai_to_anthropic(body),
        ProviderKind::Google => openai_to_google(body),
    }
}

fn reasoning_enabled(body: &Value) -> bool {
    match body.get("reasoning") {
        Some(Value::Object(map)) => {
            if map.get("enabled") == Some(&json!(false)) {
                return false;
            }
            if map.get("exclude") == Some(&json!(true)) && map.len() == 1 {
                return false;
            }
            true
        }
        Some(Value::Bool(false)) => false,
        _ => false,
    }
}

fn reasoning_budget(body: &Value, fallback: u32) -> u32 {
    let effort = body
        .get("reasoning")
        .and_then(|r| r.get("effort"))
        .and_then(|e| e.as_str());
    if let Some(explicit) = body
        .get("reasoning")
        .and_then(|r| r.get("max_tokens"))
        .and_then(|m| m.as_u64())
    {
        return explicit as u32;
    }
    effort_budget(effort, fallback)
}

fn supports_thinking(model: &str, kind: ProviderKind) -> bool {
    let m = model.to_ascii_lowercase();
    match kind {
        ProviderKind::Anthropic => {
            m.contains("claude") && !m.contains("claude-3") && !m.contains("haiku-3")
        }
        ProviderKind::Google => m.contains("gemini-2.5") || m.contains("gemini-3"),
        ProviderKind::OpenAi => false,
    }
}

/// Anthropic wants `[{"role": "user", "content": [{"type": "text", …}]}]`.
fn openai_to_anthropic(body: &Value) -> Value {
    let messages = body
        .get("messages")
        .and_then(|m| m.as_array())
        .cloned()
        .unwrap_or_default();
    let tools = body
        .get("tools")
        .and_then(|t| t.as_array())
        .cloned()
        .unwrap_or_default();
    let model = body.get("model").and_then(|m| m.as_str()).unwrap_or("");
    let max_tokens = body
        .get("max_tokens")
        .and_then(|m| m.as_u64())
        .unwrap_or(8192);

    let mut system = String::new();
    let mut converted: Vec<Value> = Vec::new();

    for message in &messages {
        let role = message
            .get("role")
            .and_then(|r| r.as_str())
            .unwrap_or("user");
        match role {
            "system" | "developer" => {
                let text = text_of_content(message.get("content").unwrap_or(&Value::Null));
                if !text.trim().is_empty() {
                    if !system.is_empty() {
                        system.push_str("\n\n");
                    }
                    system.push_str(&text);
                }
            }
            "tool" => {
                let block = json!({
                    "type": "tool_result",
                    "tool_use_id": message.get("tool_call_id").and_then(|v| v.as_str()).unwrap_or(""),
                    "content": text_of_content(message.get("content").unwrap_or(&Value::Null)),
                });
                push_anthropic(&mut converted, "user", block);
            }
            "assistant" => {
                let mut blocks: Vec<Value> = Vec::new();
                let text = text_of_content(message.get("content").unwrap_or(&Value::Null));
                if !text.is_empty() {
                    blocks.push(json!({ "type": "text", "text": text }));
                }
                if let Some(calls) = message.get("tool_calls").and_then(|t| t.as_array()) {
                    for call in calls {
                        let name = str_field(call, &["function", "name"]).unwrap_or("");
                        if name.is_empty() {
                            continue;
                        }
                        let input = call
                            .get("function")
                            .and_then(|f| f.get("arguments"))
                            .map(parse_arguments)
                            .unwrap_or_else(|| json!({}));
                        blocks.push(json!({
                            "type": "tool_use",
                            "id": call.get("id").and_then(|v| v.as_str()).unwrap_or("call_0"),
                            "name": name,
                            "input": input,
                        }));
                    }
                }
                if blocks.is_empty() {
                    continue;
                }
                push_anthropic_blocks(&mut converted, "assistant", blocks);
            }
            _ => {
                let blocks = openai_content_to_anthropic(message.get("content").unwrap_or(&Value::Null));
                if blocks.is_empty() {
                    continue;
                }
                push_anthropic_blocks(&mut converted, "user", blocks);
            }
        }
    }

    let mut out = Map::new();
    out.insert("model".to_string(), json!(model));
    out.insert("max_tokens".to_string(), json!(max_tokens));
    out.insert("messages".to_string(), json!(converted));
    out.insert("stream".to_string(), json!(body.get("stream") == Some(&json!(true))));
    if !system.trim().is_empty() {
        // Cache the (large, stable) system prompt across a turn's round-trips.
        out.insert(
            "system".to_string(),
            json!([{ "type": "text", "text": system, "cache_control": { "type": "ephemeral" } }]),
        );
    }
    if !tools.is_empty() {
        let converted_tools: Vec<Value> = tools
            .iter()
            .filter_map(|tool| {
                let name = str_field(tool, &["function", "name"])
                    .or_else(|| tool.get("name").and_then(|n| n.as_str()))?;
                let description = str_field(tool, &["function", "description"]).unwrap_or("");
                let parameters = tool
                    .get("function")
                    .and_then(|f| f.get("parameters"))
                    .cloned()
                    .unwrap_or_else(|| json!({ "type": "object", "properties": {} }));
                Some(json!({
                    "name": name,
                    "description": description,
                    "input_schema": parameters,
                }))
            })
            .collect();
        if !converted_tools.is_empty() {
            out.insert("tools".to_string(), json!(converted_tools));
            out.insert("tool_choice".to_string(), json!({ "type": "auto" }));
        }
    }
    if reasoning_enabled(body) && supports_thinking(model, ProviderKind::Anthropic) {
        let budget = reasoning_budget(body, 4096).clamp(1024, max_tokens.saturating_sub(1024).max(1024) as u32);
        out.insert(
            "thinking".to_string(),
            json!({ "type": "enabled", "budget_tokens": budget }),
        );
    }

    Value::Object(out)
}

fn push_anthropic(messages: &mut Vec<Value>, role: &str, block: Value) {
    push_anthropic_blocks(messages, role, vec![block]);
}

/// Append blocks, merging into the previous message when the role repeats
/// (Anthropic expects alternating turns, and parallel tool results must share
/// one user turn).
fn push_anthropic_blocks(messages: &mut Vec<Value>, role: &str, blocks: Vec<Value>) {
    if let Some(last) = messages.last_mut() {
        if last.get("role").and_then(|r| r.as_str()) == Some(role) {
            if let Some(content) = last.get_mut("content").and_then(|c| c.as_array_mut()) {
                content.extend(blocks);
                return;
            }
        }
    }
    messages.push(json!({ "role": role, "content": blocks }));
}

fn openai_content_to_anthropic(content: &Value) -> Vec<Value> {
    if let Some(text) = content.as_str() {
        if text.is_empty() {
            return vec![];
        }
        return vec![json!({ "type": "text", "text": text })];
    }
    let Some(parts) = content.as_array() else {
        return vec![];
    };
    let mut blocks = Vec::new();
    for part in parts {
        match part.get("type").and_then(|t| t.as_str()) {
            Some("text") => {
                if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                    blocks.push(json!({ "type": "text", "text": text }));
                }
            }
            Some("image_url") => {
                let url = str_field(part, &["image_url", "url"]).unwrap_or("");
                if let Some(block) = anthropic_image_block(url) {
                    blocks.push(block);
                }
            }
            _ => {
                if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                    blocks.push(json!({ "type": "text", "text": text }));
                }
            }
        }
    }
    blocks
}

fn anthropic_image_block(url: &str) -> Option<Value> {
    if let Some(rest) = url.strip_prefix("data:") {
        let (media_type, data) = rest.split_once(";base64,")?;
        return Some(json!({
            "type": "image",
            "source": { "type": "base64", "media_type": media_type, "data": data },
        }));
    }
    if url.starts_with("http://") || url.starts_with("https://") {
        return Some(json!({
            "type": "image",
            "source": { "type": "url", "url": url },
        }));
    }
    None
}

fn parse_arguments(raw: &Value) -> Value {
    match raw {
        Value::String(text) => serde_json::from_str(text).unwrap_or_else(|_| json!({})),
        other => other.clone(),
    }
}

/// Google's `contents` array with `parts`, plus a separate `systemInstruction`.
fn openai_to_google(body: &Value) -> Value {
    let messages = body
        .get("messages")
        .and_then(|m| m.as_array())
        .cloned()
        .unwrap_or_default();
    let tools = body
        .get("tools")
        .and_then(|t| t.as_array())
        .cloned()
        .unwrap_or_default();
    let model = body.get("model").and_then(|m| m.as_str()).unwrap_or("");
    let max_tokens = body
        .get("max_tokens")
        .and_then(|m| m.as_u64())
        .unwrap_or(8192);

    let mut system = String::new();
    // tool_call_id → function name, so functionResponse turns can be labelled.
    let mut call_names: HashMap<String, String> = HashMap::new();
    let mut contents: Vec<Value> = Vec::new();

    for message in &messages {
        let role = message
            .get("role")
            .and_then(|r| r.as_str())
            .unwrap_or("user");
        match role {
            "system" | "developer" => {
                let text = text_of_content(message.get("content").unwrap_or(&Value::Null));
                if !text.trim().is_empty() {
                    if !system.is_empty() {
                        system.push_str("\n\n");
                    }
                    system.push_str(&text);
                }
            }
            "assistant" => {
                let mut parts: Vec<Value> = Vec::new();
                let text = text_of_content(message.get("content").unwrap_or(&Value::Null));
                if !text.is_empty() {
                    parts.push(json!({ "text": text }));
                }
                if let Some(calls) = message.get("tool_calls").and_then(|t| t.as_array()) {
                    for call in calls {
                        let name = str_field(call, &["function", "name"]).unwrap_or("");
                        if name.is_empty() {
                            continue;
                        }
                        if let Some(id) = call.get("id").and_then(|v| v.as_str()) {
                            call_names.insert(id.to_string(), name.to_string());
                        }
                        let args = call
                            .get("function")
                            .and_then(|f| f.get("arguments"))
                            .map(parse_arguments)
                            .unwrap_or_else(|| json!({}));
                        parts.push(json!({ "functionCall": { "name": name, "args": args } }));
                    }
                }
                if parts.is_empty() {
                    continue;
                }
                push_google(&mut contents, "model", parts);
            }
            "tool" => {
                let id = message
                    .get("tool_call_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let name = call_names.get(id).cloned().unwrap_or_else(|| {
                    message
                        .get("name")
                        .and_then(|n| n.as_str())
                        .unwrap_or("tool")
                        .to_string()
                });
                let text = text_of_content(message.get("content").unwrap_or(&Value::Null));
                push_google(
                    &mut contents,
                    "user",
                    vec![json!({
                        "functionResponse": { "name": name, "response": { "result": text } }
                    })],
                );
            }
            _ => {
                let parts = openai_content_to_google(message.get("content").unwrap_or(&Value::Null));
                if parts.is_empty() {
                    continue;
                }
                push_google(&mut contents, "user", parts);
            }
        }
    }

    let mut out = Map::new();
    out.insert("contents".to_string(), json!(contents));
    if !system.trim().is_empty() {
        out.insert(
            "systemInstruction".to_string(),
            json!({ "parts": [{ "text": system }] }),
        );
    }
    if !tools.is_empty() {
        let declarations: Vec<Value> = tools
            .iter()
            .filter_map(|tool| {
                let name = str_field(tool, &["function", "name"])
                    .or_else(|| tool.get("name").and_then(|n| n.as_str()))?;
                let description = str_field(tool, &["function", "description"]).unwrap_or("");
                let parameters = tool
                    .get("function")
                    .and_then(|f| f.get("parameters"))
                    .cloned()
                    .unwrap_or_else(|| json!({ "type": "object", "properties": {} }));
                Some(json!({
                    "name": name,
                    "description": description,
                    "parameters": sanitize_schema(&parameters),
                }))
            })
            .collect();
        if !declarations.is_empty() {
            out.insert("tools".to_string(), json!([{ "functionDeclarations": declarations }]));
        }
    }

    let mut generation = Map::new();
    generation.insert("maxOutputTokens".to_string(), json!(max_tokens));
    if reasoning_enabled(body) && supports_thinking(model, ProviderKind::Google) {
        let budget = reasoning_budget(body, 4096);
        generation.insert("thinkingConfig".to_string(), json!({ "thinkingBudget": budget }));
    }
    out.insert("generationConfig".to_string(), Value::Object(generation));

    Value::Object(out)
}

fn push_google(contents: &mut Vec<Value>, role: &str, parts: Vec<Value>) {
    if let Some(last) = contents.last_mut() {
        if last.get("role").and_then(|r| r.as_str()) == Some(role) {
            if let Some(existing) = last.get_mut("parts").and_then(|p| p.as_array_mut()) {
                existing.extend(parts);
                return;
            }
        }
    }
    contents.push(json!({ "role": role, "parts": parts }));
}

fn openai_content_to_google(content: &Value) -> Vec<Value> {
    if let Some(text) = content.as_str() {
        if text.is_empty() {
            return vec![];
        }
        return vec![json!({ "text": text })];
    }
    let Some(parts) = content.as_array() else {
        return vec![];
    };
    let mut out = Vec::new();
    for part in parts {
        match part.get("type").and_then(|t| t.as_str()) {
            Some("text") => {
                if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                    out.push(json!({ "text": text }));
                }
            }
            Some("image_url") => {
                let url = str_field(part, &["image_url", "url"]).unwrap_or("");
                if let Some(rest) = url.strip_prefix("data:") {
                    if let Some((mime, data)) = rest.split_once(";base64,") {
                        out.push(json!({
                            "inlineData": { "mimeType": mime, "data": data }
                        }));
                    }
                } else if url.starts_with("http://") || url.starts_with("https://") {
                    out.push(json!({
                        "fileData": { "mimeType": "image/png", "fileUri": url }
                    }));
                }
            }
            _ => {
                if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                    out.push(json!({ "text": text }));
                }
            }
        }
    }
    out
}

/// Gemini rejects a few JSON-Schema keywords that OpenAI accepts.
fn sanitize_schema(schema: &Value) -> Value {
    match schema {
        Value::Object(map) => {
            let mut out = Map::new();
            for (key, value) in map {
                if matches!(
                    key.as_str(),
                    "$schema" | "additionalProperties" | "strict" | "definitions" | "$defs"
                ) {
                    continue;
                }
                out.insert(key.clone(), sanitize_schema(value));
            }
            Value::Object(out)
        }
        Value::Array(items) => Value::Array(items.iter().map(sanitize_schema).collect()),
        other => other.clone(),
    }
}

// ---------------------------------------------------------------------------
// Response normalization
// ---------------------------------------------------------------------------

fn stop_reason_anthropic(reason: &str) -> String {
    match reason {
        "end_turn" | "stop_sequence" | "pause_turn" => "stop",
        "tool_use" => "tool_calls",
        "max_tokens" => "length",
        "refusal" => "content_filter",
        other => other,
    }
    .to_string()
}

fn stop_reason_google(reason: &str) -> String {
    match reason.to_ascii_uppercase().as_str() {
        "STOP" => "stop",
        "MAX_TOKENS" => "length",
        "SAFETY" | "RECITATION" | "BLOCKLIST" | "PROHIBITED_CONTENT" => "content_filter",
        other => &other.to_ascii_lowercase(),
    }
    .to_string()
}

/// Provider stream event → OpenAI-shaped chunk understood by `stream_chat`.
pub fn normalize_sse_event(kind: ProviderKind, event: Value, state: &mut WireState) -> Value {
    match kind {
        ProviderKind::OpenAi => event,
        ProviderKind::Anthropic => anthropic_event_to_chunk(&event, state),
        ProviderKind::Google => google_event_to_chunk(&event, state),
    }
}

fn anthropic_event_to_chunk(event: &Value, state: &mut WireState) -> Value {
    if let Some(error) = event.get("error") {
        let message = error
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Anthropic stream error");
        return json!({ "error": { "message": message } });
    }

    match event.get("type").and_then(|t| t.as_str()).unwrap_or("") {
        "message_start" => {
            let input = event
                .get("message")
                .and_then(|m| m.get("usage"))
                .and_then(|u| u.get("input_tokens"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            json!({ "usage": { "prompt_tokens": input } })
        }
        "content_block_start" => {
            let block = event.get("content_block").cloned().unwrap_or_default();
            match block.get("type").and_then(|t| t.as_str()) {
                Some("tool_use") => {
                    let index = state.slot_for_block(
                        event.get("index").and_then(|i| i.as_u64()).unwrap_or(0),
                    );
                    json!({
                        "choices": [{
                            "delta": {
                                "tool_calls": [{
                                    "index": index,
                                    "id": block.get("id").and_then(|v| v.as_str()).unwrap_or(""),
                                    "type": "function",
                                    "function": {
                                        "name": block.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                                        "arguments": "",
                                    },
                                }],
                            },
                        }],
                    })
                }
                _ => json!({}),
            }
        }
        "content_block_delta" => {
            let delta = event.get("delta").cloned().unwrap_or_default();
            match delta.get("type").and_then(|t| t.as_str()).unwrap_or("") {
                "text_delta" => json!({
                    "choices": [{ "delta": {
                        "content": delta.get("text").and_then(|v| v.as_str()).unwrap_or(""),
                    }}],
                }),
                "thinking_delta" => json!({
                    "choices": [{ "delta": {
                        "reasoning": delta.get("thinking").and_then(|v| v.as_str()).unwrap_or(""),
                    }}],
                }),
                "input_json_delta" => {
                    let index = state.slot_for_block(
                        event.get("index").and_then(|i| i.as_u64()).unwrap_or(0),
                    );
                    json!({
                        "choices": [{
                            "delta": {
                                "tool_calls": [{
                                    "index": index,
                                    "function": {
                                        "arguments": delta
                                            .get("partial_json")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or(""),
                                    },
                                }],
                            },
                        }],
                    })
                }
                _ => json!({}),
            }
        }
        "message_delta" => {
            let mut chunk = Map::new();
            if let Some(reason) = str_field(event, &["delta", "stop_reason"]) {
                chunk.insert(
                    "choices".to_string(),
                    json!([{ "delta": {}, "finish_reason": stop_reason_anthropic(reason) }]),
                );
            }
            if let Some(output) = event
                .get("usage")
                .and_then(|u| u.get("output_tokens"))
                .and_then(|v| v.as_u64())
            {
                chunk.insert("usage".to_string(), json!({ "completion_tokens": output }));
            }
            Value::Object(chunk)
        }
        _ => json!({}),
    }
}

fn google_event_to_chunk(event: &Value, state: &mut WireState) -> Value {
    if let Some(error) = event.get("error") {
        let message = error
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Google stream error");
        return json!({ "error": { "message": message } });
    }

    let mut chunk = Map::new();
    if let Some(usage) = event.get("usageMetadata") {
        let mut usage_out = Map::new();
        if let Some(prompt) = usage.get("promptTokenCount").and_then(|v| v.as_u64()) {
            usage_out.insert("prompt_tokens".to_string(), json!(prompt));
        }
        if let Some(candidates) = usage.get("candidatesTokenCount").and_then(|v| v.as_u64()) {
            usage_out.insert("completion_tokens".to_string(), json!(candidates));
        }
        if !usage_out.is_empty() {
            chunk.insert("usage".to_string(), Value::Object(usage_out));
        }
    }

    let candidate = event.get("candidates").and_then(|c| c.get(0));
    let mut delta = Map::new();
    let mut finish: Option<String> = None;

    if let Some(candidate) = candidate {
        if let Some(parts) = candidate
            .get("content")
            .and_then(|c| c.get("parts"))
            .and_then(|p| p.as_array())
        {
            let mut tool_calls: Vec<Value> = Vec::new();
            let mut text = String::new();
            let mut reasoning = String::new();
            for part in parts {
                if let Some(part_text) = part.get("text").and_then(|t| t.as_str()) {
                    if part.get("thought").and_then(|t| t.as_bool()) == Some(true) {
                        reasoning.push_str(part_text);
                    } else {
                        text.push_str(part_text);
                    }
                    continue;
                }
                if let Some(call) = part.get("functionCall") {
                    let name = call.get("name").and_then(|n| n.as_str()).unwrap_or("");
                    if name.is_empty() {
                        continue;
                    }
                    let index = state.next_slot();
                    tool_calls.push(json!({
                        "index": index,
                        "id": format!("call_{}", index),
                        "type": "function",
                        "function": {
                            "name": name,
                            "arguments": call
                                .get("args")
                                .map(json_string)
                                .unwrap_or_else(|| "{}".to_string()),
                        },
                    }));
                }
            }
            if !text.is_empty() {
                delta.insert("content".to_string(), json!(text));
            }
            if !reasoning.is_empty() {
                delta.insert("reasoning".to_string(), json!(reasoning));
            }
            if !tool_calls.is_empty() {
                delta.insert("tool_calls".to_string(), json!(tool_calls));
            }
        }
        if let Some(reason) = candidate.get("finishReason").and_then(|r| r.as_str()) {
            if !reason.is_empty() && reason != "FINISH_REASON_UNSPECIFIED" {
                finish = Some(stop_reason_google(reason));
            }
        }
    }

    if !delta.is_empty() || finish.is_some() {
        let mut choice = Map::new();
        choice.insert("delta".to_string(), Value::Object(delta));
        if let Some(finish) = finish {
            choice.insert("finish_reason".to_string(), json!(finish));
        }
        chunk.insert("choices".to_string(), json!([Value::Object(choice)]));
    }

    Value::Object(chunk)
}

/// Provider response → OpenAI-shaped completion (`choices[0].message` + usage).
pub fn normalize_completion(kind: ProviderKind, json: Value) -> Value {
    match kind {
        ProviderKind::OpenAi => json,
        ProviderKind::Anthropic => {
            if json.get("error").is_some() {
                return json;
            }
            let mut text = String::new();
            let mut tool_calls: Vec<Value> = Vec::new();
            if let Some(blocks) = json.get("content").and_then(|c| c.as_array()) {
                for block in blocks {
                    match block.get("type").and_then(|t| t.as_str()) {
                        Some("text") => {
                            if let Some(t) = block.get("text").and_then(|t| t.as_str()) {
                                text.push_str(t);
                            }
                        }
                        Some("tool_use") => {
                            let id = block.get("id").and_then(|v| v.as_str()).unwrap_or("call_0");
                            tool_calls.push(json!({
                                "id": id,
                                "type": "function",
                                "function": {
                                    "name": block.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                                    "arguments": block
                                        .get("input")
                                        .map(json_string)
                                        .unwrap_or_else(|| "{}".to_string()),
                                },
                            }));
                        }
                        _ => {}
                    }
                }
            }
            json!({
                "choices": [{
                    "message": {
                        "role": "assistant",
                        "content": text,
                        "tool_calls": tool_calls,
                    },
                    "finish_reason": json
                        .get("stop_reason")
                        .and_then(|r| r.as_str())
                        .map(stop_reason_anthropic)
                        .unwrap_or_else(|| "stop".to_string()),
                }],
                "usage": {
                    "prompt_tokens": json.get("usage").and_then(|u| u.get("input_tokens")).and_then(|v| v.as_u64()).unwrap_or(0),
                    "completion_tokens": json.get("usage").and_then(|u| u.get("output_tokens")).and_then(|v| v.as_u64()).unwrap_or(0),
                },
            })
        }
        ProviderKind::Google => {
            if json.get("error").is_some() {
                return json;
            }
            let mut text = String::new();
            let mut tool_calls: Vec<Value> = Vec::new();
            if let Some(parts) = json
                .get("candidates")
                .and_then(|c| c.get(0))
                .and_then(|c| c.get("content"))
                .and_then(|c| c.get("parts"))
                .and_then(|p| p.as_array())
            {
                let mut index = 0usize;
                for part in parts {
                    if let Some(part_text) = part.get("text").and_then(|t| t.as_str()) {
                        text.push_str(part_text);
                    }
                    if let Some(call) = part.get("functionCall") {
                        let name = call.get("name").and_then(|n| n.as_str()).unwrap_or("");
                        if name.is_empty() {
                            continue;
                        }
                        tool_calls.push(json!({
                            "id": format!("call_{}", index),
                            "type": "function",
                            "function": {
                                "name": name,
                                "arguments": call.get("args").map(json_string).unwrap_or_else(|| "{}".to_string()),
                            },
                        }));
                        index += 1;
                    }
                }
            }
            json!({
                "choices": [{
                    "message": {
                        "role": "assistant",
                        "content": text,
                        "tool_calls": tool_calls,
                    },
                    "finish_reason": json
                        .get("candidates")
                        .and_then(|c| c.get(0))
                        .and_then(|c| c.get("finishReason"))
                        .and_then(|r| r.as_str())
                        .map(stop_reason_google)
                        .unwrap_or_else(|| "stop".to_string()),
                }],
                "usage": {
                    "prompt_tokens": json.get("usageMetadata").and_then(|u| u.get("promptTokenCount")).and_then(|v| v.as_u64()).unwrap_or(0),
                    "completion_tokens": json.get("usageMetadata").and_then(|u| u.get("candidatesTokenCount")).and_then(|v| v.as_u64()).unwrap_or(0),
                },
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anthropic_body_splits_system_and_merges_tool_results() {
        let openai = json!({
            "model": "claude-sonnet-4.5",
            "max_tokens": 4096,
            "messages": [
                {"role": "system", "content": "be helpful"},
                {"role": "user", "content": "list files"},
                {"role": "assistant", "content": "", "tool_calls": [
                    {"id": "a1", "type": "function", "function": {"name": "ls", "arguments": "{\"path\":\".\"}"}}
                ]},
                {"role": "tool", "tool_call_id": "a1", "content": "a.txt"},
                {"role": "tool", "tool_call_id": "a2", "content": "b.txt"}
            ],
            "tools": [{"type": "function", "function": {"name": "ls", "description": "list", "parameters": {"type": "object"}}}],
            "stream": true
        });

        let body = to_provider_body(ProviderKind::Anthropic, &openai);
        assert_eq!(body["system"][0]["text"], "be helpful");
        let messages = body["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[0]["role"], "user");
        assert_eq!(messages[1]["content"][0]["type"], "tool_use");
        assert_eq!(messages[1]["content"][0]["input"]["path"], ".");
        // Both tool results share one user turn.
        assert_eq!(messages[2]["role"], "user");
        assert_eq!(messages[2]["content"].as_array().unwrap().len(), 2);
        assert_eq!(body["tools"][0]["input_schema"]["type"], "object");
        assert_eq!(body["stream"], true);
    }

    #[test]
    fn anthropic_tool_use_streams_into_openai_deltas() {
        let mut state = WireState::new();
        let start = json!({
            "type": "content_block_start",
            "index": 0,
            "content_block": {"type": "tool_use", "id": "toolu_1", "name": "read_file"}
        });
        let chunk = normalize_sse_event(ProviderKind::Anthropic, start, &mut state);
        assert_eq!(chunk["choices"][0]["delta"]["tool_calls"][0]["function"]["name"], "read_file");
        assert_eq!(chunk["choices"][0]["delta"]["tool_calls"][0]["index"], 0);

        let delta = json!({
            "type": "content_block_delta",
            "index": 0,
            "delta": {"type": "input_json_delta", "partial_json": "{\"path\":"}
        });
        let chunk = normalize_sse_event(ProviderKind::Anthropic, delta, &mut state);
        assert_eq!(
            chunk["choices"][0]["delta"]["tool_calls"][0]["function"]["arguments"],
            "{\"path\":"
        );
        assert_eq!(chunk["choices"][0]["delta"]["tool_calls"][0]["index"], 0);
    }

    #[test]
    fn anthropic_text_and_stop_map_across() {
        let mut state = WireState::new();
        let text = json!({
            "type": "content_block_delta",
            "index": 0,
            "delta": {"type": "text_delta", "text": "hello"}
        });
        let chunk = normalize_sse_event(ProviderKind::Anthropic, text, &mut state);
        assert_eq!(chunk["choices"][0]["delta"]["content"], "hello");

        let end = json!({
            "type": "message_delta",
            "delta": {"stop_reason": "tool_use"},
            "usage": {"output_tokens": 12}
        });
        let chunk = normalize_sse_event(ProviderKind::Anthropic, end, &mut state);
        assert_eq!(chunk["choices"][0]["finish_reason"], "tool_calls");
        assert_eq!(chunk["usage"]["completion_tokens"], 12);
    }

    #[test]
    fn google_body_uses_contents_and_declarations() {
        let openai = json!({
            "model": "gemini-2.5-pro",
            "max_tokens": 2048,
            "messages": [
                {"role": "system", "content": "be terse"},
                {"role": "user", "content": "hi"},
                {"role": "assistant", "content": "", "tool_calls": [
                    {"id": "call_0", "type": "function", "function": {"name": "ls", "arguments": "{\"path\":\".\"}"}}
                ]},
                {"role": "tool", "tool_call_id": "call_0", "content": "a.txt"}
            ],
            "tools": [{"type": "function", "function": {"name": "ls", "description": "list", "parameters": {"type": "object", "additionalProperties": false}}}]
        });

        let body = to_provider_body(ProviderKind::Google, &openai);
        assert_eq!(body["systemInstruction"]["parts"][0]["text"], "be terse");
        let contents = body["contents"].as_array().unwrap();
        assert_eq!(contents[0]["role"], "user");
        assert_eq!(contents[1]["role"], "model");
        assert_eq!(contents[1]["parts"][0]["functionCall"]["name"], "ls");
        assert_eq!(contents[2]["parts"][0]["functionResponse"]["name"], "ls");
        assert!(body["tools"][0]["functionDeclarations"][0]["parameters"]
            .get("additionalProperties")
            .is_none());
        assert_eq!(body["generationConfig"]["maxOutputTokens"], 2048);
    }

    #[test]
    fn google_function_calls_become_tool_call_deltas() {
        let mut state = WireState::new();
        let event = json!({
            "candidates": [{
                "content": {"parts": [{"functionCall": {"name": "grep", "args": {"q": "x"}}}]},
                "finishReason": "STOP"
            }],
            "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 3}
        });
        let chunk = normalize_sse_event(ProviderKind::Google, event, &mut state);
        let call = &chunk["choices"][0]["delta"]["tool_calls"][0];
        assert_eq!(call["function"]["name"], "grep");
        assert_eq!(call["id"], "call_0");
        assert_eq!(chunk["choices"][0]["finish_reason"], "stop");
        assert_eq!(chunk["usage"]["prompt_tokens"], 10);
    }

    #[test]
    fn openai_wire_is_untouched() {
        let body = json!({"model": "gpt-5", "messages": [{"role": "user", "content": "hi"}]});
        assert_eq!(to_provider_body(ProviderKind::OpenAi, &body), body);
        let mut state = WireState::new();
        let chunk = json!({"choices": [{"delta": {"content": "x"}}]});
        assert_eq!(
            normalize_sse_event(ProviderKind::OpenAi, chunk.clone(), &mut state),
            chunk
        );
    }

    #[test]
    fn completions_normalize_to_openai_shape() {
        let anthropic = json!({
            "content": [
                {"type": "text", "text": "done"},
                {"type": "tool_use", "id": "toolu_9", "name": "ls", "input": {"path": "."}}
            ],
            "stop_reason": "tool_use",
            "usage": {"input_tokens": 5, "output_tokens": 7}
        });
        let out = normalize_completion(ProviderKind::Anthropic, anthropic);
        assert_eq!(out["choices"][0]["message"]["content"], "done");
        assert_eq!(out["choices"][0]["message"]["tool_calls"][0]["function"]["name"], "ls");
        assert_eq!(out["choices"][0]["finish_reason"], "tool_calls");
        assert_eq!(out["usage"]["completion_tokens"], 7);

        let google = json!({
            "candidates": [{"content": {"parts": [{"text": "hi"}]}, "finishReason": "MAX_TOKENS"}],
            "usageMetadata": {"promptTokenCount": 2, "candidatesTokenCount": 4}
        });
        let out = normalize_completion(ProviderKind::Google, google);
        assert_eq!(out["choices"][0]["message"]["content"], "hi");
        assert_eq!(out["choices"][0]["finish_reason"], "length");
        assert_eq!(out["usage"]["prompt_tokens"], 2);
    }
}
