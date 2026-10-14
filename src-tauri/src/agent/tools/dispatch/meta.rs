//! Plan, todos, finish, design, and MCP tools.

use base64::Engine;
use serde_json::{json, Value};
use tauri::{Emitter, Manager};

use std::collections::HashMap;

use crate::agent::models::{DesignPickConcept, PendingAsk, PendingDesignPick};
use crate::agent::tools::page_shot;
use crate::commands::preview_render;
use crate::mcp::McpServerConfig;

use super::common::{
    blocked_outcome, cleanup_pending_ask, cleanup_pending_design_pick, clip, error_outcome,
    escape_todo_content, escape_xml_attr, escape_xml_preview_source, escape_xml_text, get_str,
    is_read_only_mode, wait_for_ask_answer, wait_for_design_pick,
};
use super::{SideEffect, ToolCtx, ToolOutcome};

pub(super) async fn tool_mcp_search(args: &Value, ctx: &ToolCtx<'_>) -> ToolOutcome {
    let Some(mcp_state) = ctx.mcp_state else {
        return error_outcome("mcp_search", "MCP is not configured.");
    };
    let query = args.get("query").and_then(|v| v.as_str()).unwrap_or("");
    let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(6) as usize;
    match mcp_state.search_catalog(query, limit) {
        Ok(text) => ToolOutcome {
            tool_result: text.clone(),
            ui_chunk: format!(
                "\n<tool_result>\n[mcp_search]\n{}\n</tool_result>\n",
                escape_xml_text(&clip(&text, 1500))
            ),
            side_effect: None,
        },
        Err(e) => error_outcome("mcp_search", &e),
    }
}

pub(super) async fn tool_mcp_call_named(args: &Value, ctx: &ToolCtx<'_>) -> ToolOutcome {
    let name = match get_str(args, "name") {
        Ok(name) => name,
        Err(e) => return error_outcome("mcp_call", &e),
    };
    let arguments = args.get("arguments").cloned().unwrap_or_else(|| json!({}));
    let args_json = serde_json::to_string(&arguments).unwrap_or_else(|_| "{}".into());
    tool_mcp_call(&name, &args_json, ctx).await
}

pub(super) async fn tool_mcp_call(name: &str, args_json: &str, ctx: &ToolCtx<'_>) -> ToolOutcome {
    let Some(mcp_state) = ctx.mcp_state else {
        return error_outcome(name, "MCP is not configured.");
    };
    match mcp_state.call_tool(name, args_json) {
        Ok(text) => ToolOutcome {
            tool_result: clip(&text, 12000),
            ui_chunk: format!(
                "\n<tool_result>\n[MCP {}]\n{}\n</tool_result>\n",
                name,
                escape_xml_text(&clip(&text, 2000))
            ),
            side_effect: None,
        },
        Err(e) => error_outcome(name, &e),
    }
}
/// Placeholder result for `compact_context`.
///
/// The real pass needs the whole round recorded and cannot run inside
/// `futures::join_all`, so `run_turn` executes it right after the round and
/// overwrites this message with the outcome. Anything still visible here means
/// the pass never ran.
pub(super) fn tool_compact_context(_args: &Value, _ctx: &ToolCtx<'_>) -> ToolOutcome {
    ToolOutcome {
        tool_result: "Compaction did not run. Continue the task, and retry later if the context still feels heavy.".into(),
        ui_chunk: String::new(),
        side_effect: None,
    }
}

/// Build a server config from `mcp_manage` arguments. `existing` fills gaps on
/// update so a partial patch does not silently wipe fields.
fn mcp_config_from_args(
    args: &Value,
    existing: Option<&McpServerConfig>,
) -> Result<McpServerConfig, String> {
    use crate::mcp::{McpAuthType, McpTransport};

    let id = args
        .get("name")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(crate::mcp::admin::slug)
        .or_else(|| existing.map(|c| c.id.clone()))
        .ok_or_else(|| "`name` is required (the server id, e.g. \"playwright\").".to_string())?;

    let url = args
        .get("url")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| existing.and_then(|c| c.url.clone()));

    let command = args
        .get("command")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| {
            existing
                .map(|c| c.command.clone())
                .filter(|c| !c.is_empty())
        })
        .unwrap_or_default();

    let transport = match args.get("transport").and_then(|v| v.as_str()) {
        Some("http") => McpTransport::Http,
        Some("stdio") => McpTransport::Stdio,
        _ => match existing {
            Some(c) => c.transport.clone(),
            None if url.is_some() && command.is_empty() => McpTransport::Http,
            None if !command.is_empty() => McpTransport::Stdio,
            None => {
                if url.is_some() {
                    McpTransport::Http
                } else {
                    return Err(
                        "Pass either `command` (stdio) or `url` (http) so BetterShape knows how to reach the server."
                            .to_string(),
                    );
                }
            }
        },
    };

    let auth = match args.get("auth").and_then(|v| v.as_str()) {
        Some("oauth") => McpAuthType::Oauth,
        Some("none") => McpAuthType::None,
        _ => match existing {
            Some(c) => c.auth.clone(),
            None if url.is_some() => McpAuthType::Oauth,
            None => McpAuthType::None,
        },
    };

    let string_list = |value: Option<&Value>| -> Vec<String> {
        value
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    };
    let string_map = |value: Option<&Value>| -> HashMap<String, String> {
        value
            .and_then(|v| v.as_object())
            .map(|obj| {
                obj.iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                    .collect()
            })
            .unwrap_or_default()
    };

    let name = args
        .get("name")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            existing
                .map(|c| c.name.clone())
                .unwrap_or_else(|| id.clone())
        });

    Ok(McpServerConfig {
        id,
        name,
        transport,
        command,
        args: if args.get("args").is_some() {
            string_list(args.get("args"))
        } else {
            existing.map(|c| c.args.clone()).unwrap_or_default()
        },
        env: if args.get("env").is_some() {
            string_map(args.get("env"))
        } else {
            existing.map(|c| c.env.clone()).unwrap_or_default()
        },
        url,
        auth,
        headers: if args.get("headers").is_some() {
            string_map(args.get("headers"))
        } else {
            existing.map(|c| c.headers.clone()).unwrap_or_default()
        },
        enabled: args
            .get("enabled")
            .and_then(|v| v.as_bool())
            .or_else(|| existing.map(|c| c.enabled))
            .unwrap_or(true),
        disabled_tools: if args.get("disabledTools").is_some() {
            string_list(args.get("disabledTools"))
        } else {
            existing
                .map(|c| c.disabled_tools.clone())
                .unwrap_or_default()
        },
        oauth_client_id: args
            .get("oauthClientId")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .or_else(|| existing.and_then(|c| c.oauth_client_id.clone())),
        skill_hint: existing.and_then(|c| c.skill_hint.clone()),
    })
}

/// Ask before a model-supplied executable is written to `mcp.json` and
/// launched. Same card as `run_terminal`, same escape hatch: the turn policy
/// can say "stop asking".
async fn approve_stdio_server(cfg: &McpServerConfig, ctx: &ToolCtx<'_>) -> Result<(), String> {
    use crate::agent::models::{AutoRunMode, PendingCommand};

    let policy = ctx
        .agent_state
        .turn_policy_for(ctx.conversation_id.as_deref());
    if policy.auto_run_mode == AutoRunMode::Always {
        return Ok(());
    }

    let cmd_id = format!("cmd-{}", uuid::Uuid::new_v4());
    let preview = if cfg.args.is_empty() {
        cfg.command.clone()
    } else {
        format!("{} {}", cfg.command, cfg.args.join(" "))
    };
    let pending = PendingCommand {
        id: cmd_id.clone(),
        command: preview.clone(),
        safety: "needs_approval".to_string(),
        reason: format!("Starts the MCP server '{}' as a local process.", cfg.id),
        action: None,
        payload: None,
    };
    if let Ok(mut pendings) = ctx.agent_state.pending_commands.lock() {
        pendings.insert(cmd_id.clone(), pending.clone());
    }
    // Same shape as `run_terminal`'s card: the body's first line is the
    // command the chat renders, followed by why it is waiting.
    let _ = ctx.emit_ui_token(format!(
        "\n<terminal_command status=\"pending\" id=\"{}\" mcp=\">{}\nAwaiting approval: {}</terminal_command>\n",
        cmd_id, preview, pending.reason
    ));
    ctx.emit_scoped_event("agent-command-pending", json!(pending));
    ctx.emit_status(json!({ "phase": "approval", "label": "Waiting for approval" }));

    let decision = super::common::wait_for_command_decision(&cmd_id, ctx).await;
    super::common::cleanup_pending_command(&cmd_id, ctx);
    if !matches!(decision, super::common::ApprovalDecision::Cancelled) {
        super::common::emit_command_resolved(
            ctx,
            &cmd_id,
            matches!(decision, super::common::ApprovalDecision::Approved),
        );
    }
    match decision {
        super::common::ApprovalDecision::Approved => Ok(()),
        super::common::ApprovalDecision::Rejected => Err(format!(
            "'{}' was not approved. Nothing was written or started. Ask the user first if it should run.",
            preview
        )),
        super::common::ApprovalDecision::Cancelled => {
            Err("The turn was cancelled while waiting for approval.".to_string())
        }
    }
}

fn mcp_status_word(status: &crate::mcp::McpServerStatus) -> &'static str {
    match status {
        crate::mcp::McpServerStatus::Connected => "connected",
        crate::mcp::McpServerStatus::NeedsAuth => "needs sign-in",
        crate::mcp::McpServerStatus::Error => "error",
        crate::mcp::McpServerStatus::Disabled => "disabled",
    }
}

/// `mcp_manage` — create, edit, test, and manage MCP servers.
pub(super) async fn tool_mcp_manage(args: &Value, ctx: &ToolCtx<'_>) -> ToolOutcome {
    use crate::mcp::admin;

    let Some(mcp_state) = ctx.mcp_state else {
        return error_outcome("mcp_manage", "MCP is not configured.");
    };
    let action = args
        .get("action")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let name = args
        .get("name")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let save = args.get("save").and_then(|v| v.as_bool()).unwrap_or(true);

    let fail = |msg: String| -> ToolOutcome {
        // Surface validation/config problems as plain errors: the model is
        // expected to fix its arguments and retry, not to give up.
        error_outcome("mcp_manage", &msg)
    };

    let file_servers = || admin::load_servers().unwrap_or_default();

    /// Announce that the server list changed so open Settings/pickers refresh.
    fn announce(ctx: &ToolCtx<'_>, action: &str, id: Option<&str>) {
        let _ = ctx
            .app_handle
            .emit("mcp-servers-changed", json!({ "action": action, "id": id }));
    }

    match action.as_str() {
        "list" => {
            let configs = mcp_state.configs_snapshot();
            let statuses = mcp_state.get_status().unwrap_or_default();
            let file_ids: Vec<String> = file_servers().into_iter().map(|s| s.id).collect();
            if configs.is_empty() {
                return ToolOutcome {
                    tool_result: format!(
                        "No MCP servers configured. mcp.json: {}. Add one with mcp_manage action:add, or search the registry first (action:registry).",
                        admin::config_path()
                            .map(|p| p.to_string_lossy().to_string())
                            .unwrap_or_else(|_| "unknown path".into())
                    ),
                    ui_chunk: "\n<tool_result>\n[mcp_manage]\nNo MCP servers configured.\n</tool_result>\n".into(),
                    side_effect: None,
                };
            }
            let mut text = format!("MCP servers ({}):\n", configs.len());
            for cfg in &configs {
                let status = statuses.iter().find(|s| s.id == cfg.id);
                let word = status
                    .map(|s| mcp_status_word(&s.status))
                    .unwrap_or("not connected");
                let tools = status.map(|s| s.tool_count).unwrap_or(0);
                let origin = if file_ids.contains(&cfg.id) {
                    "mcp.json"
                } else {
                    "settings"
                };
                text.push_str(&format!(
                    "\n- {} [{}] — {} — {} tool(s){}",
                    cfg.id,
                    origin,
                    word,
                    tools,
                    if cfg.transport == crate::mcp::McpTransport::Http {
                        format!(" — {}", admin::describe_target(cfg))
                    } else {
                        String::new()
                    }
                ));
                if let Some(err) = status.and_then(|s| s.error.as_deref()) {
                    text.push_str(&format!("\nerror: {err}"));
                }
                let disabled = &cfg.disabled_tools;
                if !disabled.is_empty() {
                    text.push_str(&format!("\ndisabled tools: {}", disabled.join(", ")));
                }
            }
            ToolOutcome {
                tool_result: text.clone(),
                ui_chunk: format!(
                    "\n<tool_result>\n[mcp_manage]\n{}\n</tool_result>\n",
                    escape_xml_text(&clip(&text, 1500))
                ),
                side_effect: None,
            }
        }

        "add" | "update" => {
            let is_add = action == "add";
            // The file keys servers by slug, so "Playwright MCP" and
            // "playwright-mcp" are the same entry.
            let slug = name.as_deref().map(admin::slug);
            let existing = slug
                .as_deref()
                .and_then(|id| admin::load_server(id).ok().flatten());
            if is_add {
                if let Some(id) = slug.as_deref() {
                    if let Ok(Some(_)) = admin::load_server(id) {
                        return fail(format!(
                            "'{id}' already exists. Use action:update to change it, or action:remove first."
                        ));
                    }
                }
            } else if existing.is_none() {
                return fail(format!(
                    "'{}' is not configured. Use action:add first (or action:list to see servers).",
                    name.unwrap_or_default()
                ));
            }
            let cfg = match mcp_config_from_args(args, existing.as_ref()) {
                Ok(cfg) => cfg,
                Err(e) => return fail(e),
            };
            if let Err(e) = admin::validate(&cfg) {
                return fail(e);
            }
            // A stdio server is a program this machine will run on every
            // launch. The user answers for it unless auto-run is on.
            let starts_a_process = cfg.transport == crate::mcp::McpTransport::Stdio
                && (is_add
                    || existing
                        .as_ref()
                        .map(|old| old.command != cfg.command || old.args != cfg.args)
                        .unwrap_or(true));
            if starts_a_process {
                if let Err(e) = approve_stdio_server(&cfg, ctx).await {
                    return fail(e);
                }
            }
            if save {
                if let Err(e) = admin::upsert(&cfg) {
                    return fail(format!("Could not write mcp.json: {e}"));
                }
            }
            let entry = match mcp_state.upsert_server(cfg.clone()) {
                Ok(entry) => entry,
                Err(e) => return fail(format!("Server saved, but connecting failed: {e}")),
            };
            announce(ctx, if is_add { "add" } else { "update" }, Some(&cfg.id));
            let tools = mcp_state.tools_for_server(&cfg.id).unwrap_or_default();
            let mut text = format!(
                "{} '{}' ({}).\nstatus: {}\ntarget: {}{}",
                if is_add { "Added" } else { "Updated" },
                cfg.id,
                if save { "written to mcp.json" } else { "runtime only" },
                mcp_status_word(&entry.status),
                admin::describe_target(&cfg),
                if save {
                    String::new()
                } else {
                    "\nnot saved: pass save:true to keep it after restart".to_string()
                }
            );
            if let Some(err) = &entry.error {
                text.push_str(&format!("\nerror: {err}"));
            }
            if !tools.is_empty() {
                text.push_str(&format!(
                    "\ntools now callable via mcp_search/mcp_call: {}",
                    tools
                        .iter()
                        .take(12)
                        .map(|t| t.qualified_name.clone())
                        .collect::<Vec<_>>()
                        .join(", ")
                ));
            }
            ToolOutcome {
                tool_result: text.clone(),
                ui_chunk: format!(
                    "\n<tool_result>\n[mcp_manage]\n{}\n</tool_result>\n",
                    escape_xml_text(&clip(&text, 1800))
                ),
                side_effect: None,
            }
        }

        "remove" => {
            let Some(id) = name else {
                return fail("`name` is required for action:remove.".to_string());
            };
            let in_file = file_servers().iter().any(|s| s.id == id);
            let removed_file = if in_file {
                match admin::remove(&id) {
                    Ok(v) => v,
                    Err(e) => return fail(format!("Could not write mcp.json: {e}")),
                }
            } else {
                false
            };
            let removed_live = mcp_state.remove_server(&id).unwrap_or(false);
            if !removed_file && !removed_live {
                if in_file {
                    // File entry was gone by the time we removed it — still fine.
                } else {
                    return fail(format!(
                        "'{id}' is not in mcp.json or the running list. Note: servers added through Settings are removed in Settings → MCP."
                    ));
                }
            }
            // A Settings server is only disconnected for this session, and it
            // keeps its token: the sign-in would otherwise be needed again.
            if removed_file {
                let _ = crate::mcp::credentials::delete_token(&id);
            }
            announce(ctx, "remove", Some(&id));
            let text = if removed_file {
                format!("Removed '{id}' from mcp.json and disconnected it.")
            } else {
                format!(
                    "Disconnected '{id}' for this session. It is a Settings server, so remove it there to make it permanent."
                )
            };
            ToolOutcome {
                tool_result: text.clone(),
                ui_chunk: format!(
                    "\n<tool_result>\n[mcp_manage]\n{}\n</tool_result>\n",
                    escape_xml_text(&text)
                ),
                side_effect: None,
            }
        }

        "enable" | "disable" => {
            let Some(id) = name else {
                return fail(format!("`name` is required for action:{action}."));
            };
            let enable = action == "enable";
            let in_file = file_servers().iter().any(|s| s.id == id);
            if in_file {
                match admin::set_enabled(&id, enable) {
                    Ok(true) => {}
                    Ok(false) => return fail(format!("'{id}' is not in mcp.json.")),
                    Err(e) => return fail(format!("Could not write mcp.json: {e}")),
                }
            }
            let Some(mut cfg) = admin::load_server(&id)
                .ok()
                .flatten()
                .or_else(|| mcp_state.configs_snapshot().into_iter().find(|c| c.id == id))
            else {
                return fail(format!("'{id}' is not configured."));
            };
            cfg.enabled = enable;
            match mcp_state.upsert_server(cfg) {
                Ok(_) => {}
                Err(e) => return fail(e),
            }
            announce(ctx, action.as_str(), Some(&id));
            let text = format!(
                "'{id}' {}.{}",
                if enable { "enabled and reconnected" } else { "disabled — its tools are no longer offered" },
                if in_file {
                    ""
                } else {
                    " This server comes from Settings; the change lasts until the app reloads it."
                }
            );
            ToolOutcome {
                tool_result: text.clone(),
                ui_chunk: format!(
                    "\n<tool_result>\n[mcp_manage]\n{}\n</tool_result>\n",
                    escape_xml_text(&text)
                ),
                side_effect: None,
            }
        }

        "restart" => {
            let Some(id) = name else {
                return fail("`name` is required for action:restart.".to_string());
            };
            match mcp_state.restart_server(&id) {
                Ok(entry) => {
                    let tools = mcp_state.tools_for_server(&id).unwrap_or_default();
                    let text = format!(
                        "Reconnected '{}'. status: {}, {} tool(s){}",
                        id,
                        mcp_status_word(&entry.status),
                        tools.len(),
                        entry
                            .error
                            .as_deref()
                            .map(|e| format!("\nerror: {e}"))
                            .unwrap_or_default()
                    );
                    announce(ctx, "restart", Some(&id));
                    ToolOutcome {
                        tool_result: text.clone(),
                        ui_chunk: format!(
                            "\n<tool_result>\n[mcp_manage]\n{}\n</tool_result>\n",
                            escape_xml_text(&clip(&text, 1200))
                        ),
                        side_effect: None,
                    }
                }
                Err(e) => fail(format!("Could not restart '{id}': {e}")),
            }
        }

        "test" => {
            // Either test an existing server by name, or a full config passed
            // inline (`save:false` = validate without keeping it).
            let cfg = if let Some(id) = name.as_deref() {
                let existing = admin::load_server(id).ok().flatten().or_else(|| {
                    mcp_state
                        .configs_snapshot()
                        .into_iter()
                        .find(|c| c.id == id)
                });
                match existing {
                    Some(existing) => match mcp_config_from_args(args, Some(&existing)) {
                        Ok(cfg) => cfg,
                        Err(e) => return fail(e),
                    },
                    None if args.get("command").is_some() || args.get("url").is_some() => {
                        match mcp_config_from_args(args, None) {
                            Ok(cfg) => cfg,
                            Err(e) => return fail(e),
                        }
                    }
                    None => return fail(format!("'{id}' is not configured.")),
                }
            } else {
                match mcp_config_from_args(args, None) {
                    Ok(cfg) => cfg,
                    Err(e) => return fail(e),
                }
            };

            // Testing a stdio server runs it. A command the model just invented
            // gets the same approval as adding one.
            if cfg.transport == crate::mcp::McpTransport::Stdio
                && admin::load_server(&cfg.id).ok().flatten().is_none()
            {
                if let Err(e) = approve_stdio_server(&cfg, ctx).await {
                    return fail(e);
                }
            }

            let report = admin::test_config(&cfg);
            let mut text = format!(
                "test '{}' ({}): {}\n{}",
                cfg.id,
                admin::describe_target(&cfg),
                report.status,
                if report.ok {
                    format!(
                        "{} tool(s) in {}ms{}",
                        report.tool_count,
                        report.latency_ms,
                        if report.tools.is_empty() {
                            String::new()
                        } else {
                            format!(": {}", report.tools.join(", "))
                        }
                    )
                } else {
                    report.error.clone().unwrap_or_default()
                }
            );
            if report.ok && report.tool_count == 0 {
                text.push_str("\nThe handshake worked but the server published no tools. Often it needs authentication or is a resources-only server.");
            }
            // `save:true` (the default) means "keep it if the test passes".
            if report.ok && save {
                match admin::upsert(&cfg) {
                    Ok(_) => {
                        let _ = mcp_state.upsert_server(cfg.clone());
                        announce(ctx, "add", Some(&cfg.id));
                        text.push_str("\nSaved to mcp.json and connected.");
                    }
                    Err(e) => text.push_str(&format!("\nThe test passed but saving failed: {e}")),
                }
            } else if report.ok && !save {
                text.push_str("\nNot saved: it runs only for this session until save:true.");
            }
            if report.status == "needs_auth" {
                text.push_str(&format!(
                    "\nNext: mcp_manage action:auth name:{} (the user approves in the browser).",
                    cfg.id
                ));
            }
            ToolOutcome {
                tool_result: text.clone(),
                ui_chunk: format!(
                    "\n<tool_result>\n[mcp_manage]\n{}\n</tool_result>\n",
                    escape_xml_text(&clip(&text, 1800))
                ),
                side_effect: None,
            }
        }

        "tools" => {
            let Some(id) = name else {
                return fail("`name` is required for action:tools.".to_string());
            };
            let tools = match mcp_state.tools_for_server(&id) {
                Ok(tools) => tools,
                Err(e) => return fail(e),
            };
            if tools.is_empty() {
                let status = mcp_state.get_status().unwrap_or_default();
                let word = status
                    .iter()
                    .find(|s| s.id == id)
                    .map(|s| mcp_status_word(&s.status))
                    .unwrap_or("not connected");
                let text = format!(
                    "'{id}' exposes no tools right now (status: {word}). If it needs sign-in: mcp_manage action:auth name:{id}."
                );
                return ToolOutcome {
                    tool_result: text.clone(),
                    ui_chunk: format!(
                        "\n<tool_result>\n[mcp_manage]\n{}\n</tool_result>\n",
                        escape_xml_text(&text)
                    ),
                    side_effect: None,
                };
            }
            let mut text = format!("'{}' tools ({}):", id, tools.len());
            for tool in &tools {
                let schema = serde_json::to_string(&tool.input_schema).unwrap_or_else(|_| "{}".into());
                let schema = if schema.chars().count() > 900 {
                    let head: String = schema.chars().take(900).collect();
                    format!("{head}…")
                } else {
                    schema
                };
                text.push_str(&format!(
                    "\n\n{} — {}\nargs: {}",
                    tool.qualified_name,
                    tool.description.trim(),
                    schema
                ));
            }
            ToolOutcome {
                tool_result: text.clone(),
                ui_chunk: format!(
                    "\n<tool_result>\n[mcp_manage]\n{}\n</tool_result>\n",
                    escape_xml_text(&clip(&text, 2000))
                ),
                side_effect: None,
            }
        }

        "auth" => {
            let Some(id) = name else {
                return fail("`name` is required for action:auth.".to_string());
            };
            let Some(cfg) = mcp_state.configs_snapshot().into_iter().find(|c| c.id == id) else {
                return fail(format!("'{id}' is not configured."));
            };
            if cfg.transport != crate::mcp::McpTransport::Http {
                return fail(format!("'{id}' is a stdio server — it authenticates through its own env vars."));
            }
            // The flow opens the browser and waits for the loopback callback.
            // Running it in the background keeps the agent turn responsive; the
            // user approves when they are ready and the server reconnects.
            let app = ctx.app_handle.clone();
            let id_for_task = id.clone();
            let url = cfg.url.clone().unwrap_or_default();
            let client_id = cfg.oauth_client_id.clone();
            tauri::async_runtime::spawn(async move {
                // `start_oauth` lives outside `McpState`, so the long-running
                // browser wait does not hold the state lock.
                let result =
                    crate::mcp::start_oauth(&id_for_task, &url, client_id.as_deref()).await;
                let ok = result.is_ok();
                let error = result.err();
                if ok {
                    if let Some(state) = app.try_state::<crate::mcp::McpState>() {
                        let _ = state.restart_server(&id_for_task);
                    }
                }
                let _ = app.emit(
                    "mcp-servers-changed",
                    json!({ "action": "auth", "id": id_for_task, "ok": ok, "error": error }),
                );
            });
            let text = format!(
                "Opened the browser to sign in to '{id}'. Approve there; the server connects automatically when the redirect finishes. Meanwhile you can keep working, and call mcp_search in a moment to use its tools."
            );
            ToolOutcome {
                tool_result: text.clone(),
                ui_chunk: format!(
                    "\n<tool_result>\n[mcp_manage]\n{}\n</tool_result>\n",
                    escape_xml_text(&text)
                ),
                side_effect: None,
            }
        }

        "registry" => {
            let query = args
                .get("query")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let limit = args
                .get("limit")
                .and_then(|v| v.as_u64())
                .unwrap_or(8) as usize;
            match crate::mcp::registry::search(&query, limit).await {
                Ok(results) => {
                    let text = crate::mcp::registry::render_results(&query, &results);
                    ToolOutcome {
                        tool_result: text.clone(),
                        ui_chunk: format!(
                            "\n<tool_result>\n[mcp_manage]\n{}\n</tool_result>\n",
                            escape_xml_text(&clip(&text, 2000))
                        ),
                        side_effect: None,
                    }
                }
                Err(e) => fail(format!(
                    "Registry search failed: {e}\nIf the registry is unreachable, configure the server manually from its docs (command/args for local, url for remote)."
                )),
            }
        }

        other => fail(format!(
            "Unknown action '{other}'. Use: list, add, update, remove, enable, disable, restart, test, tools, auth, registry."
        )),
    }
}

pub(super) fn tool_save_plan(args: &Value, ctx: &ToolCtx<'_>) -> ToolOutcome {
    if !ctx.mode.eq_ignore_ascii_case("plan") {
        return blocked_outcome("save_plan", "save_plan is only available in Plan mode.");
    }
    if ctx.project_path.is_empty() {
        return error_outcome("save_plan", "No project is open.");
    }
    let title = match get_str(args, "title") {
        Ok(s) => s,
        Err(e) => return error_outcome("save_plan", &e),
    };
    let content = match get_str(args, "content") {
        Ok(s) => s,
        Err(e) => return error_outcome("save_plan", &e),
    };
    let mut todos: Vec<String> = args
        .get("todos")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default();
    if todos.is_empty() {
        todos = extract_todo_labels(&content);
    }
    if todos.is_empty() {
        return error_outcome(
            "save_plan",
            "Pass a `todos` array of checklist items (kept outside the markdown). Example: [\"Add login route\", \"Wire session\"].",
        );
    }
    let checklist = format!(
        "## Todos\n{}",
        todos
            .iter()
            .map(|t| format!("- [ ] {t}"))
            .collect::<Vec<_>>()
            .join("\n")
    );
    if let Err(e) = validate_plan_todos_section(&checklist) {
        return error_outcome("save_plan", &e);
    }
    let body = strip_todos_section(&content);
    let file_body = format_plan_file(&body, &todos);
    let slug = slugify_plan_title(&title);
    if slug.is_empty() {
        return error_outcome(
            "save_plan",
            "title must contain at least one alphanumeric character.",
        );
    }
    let Some(abs_dir) = plan_storage_dir(ctx.project_path) else {
        return error_outcome("save_plan", "Could not resolve the app data directory.");
    };
    if let Err(e) = std::fs::create_dir_all(&abs_dir) {
        return error_outcome(
            "save_plan",
            &format!("Failed to create plans directory: {}", e),
        );
    }
    let abs_path = abs_dir.join(format!("{}.md", slug));
    if let Err(e) = std::fs::write(&abs_path, &file_body) {
        return error_outcome("save_plan", &format!("Failed to write plan file: {}", e));
    }
    let stored = abs_path.to_string_lossy().replace('\\', "/");
    let _ = ctx.app_handle.emit(
        "bettershape-plan-saved",
        serde_json::json!({
            "path": stored,
            "title": title,
            "absolutePath": stored,
        }),
    );
    ToolOutcome {
        tool_result: format!("Plan saved internally as {}", slug),
        ui_chunk: format!(
            "\n<plan_saved path=\"{}\" title=\"{}\"></plan_saved>\n",
            escape_xml_attr(&stored),
            escape_xml_attr(&title)
        ),
        side_effect: None,
    }
}

pub(super) fn tool_update_todos(args: &Value, ctx: &ToolCtx<'_>) -> ToolOutcome {
    if ctx.mode.eq_ignore_ascii_case("ask") || ctx.mode.eq_ignore_ascii_case("plan") {
        return blocked_outcome(
            "update_todos",
            "update_todos is only available when implementing (Code/Design/Review), not in Ask or Plan mode.",
        );
    }
    let todos = match args.get("todos").and_then(|v| v.as_array()) {
        Some(arr) if !arr.is_empty() => arr,
        _ => return error_outcome("update_todos", "todos must be a non-empty array."),
    };
    if todos.len() > 5 {
        return error_outcome(
            "update_todos",
            "Too many todos. Keep 3–5 high-level items (not a file-by-file dump). Merge related steps.",
        );
    }
    let title = args
        .get("title")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or("Todos");

    let mut ui = format!("\n<todos title=\"{}\">\n", escape_xml_attr(title));
    let mut summary_parts: Vec<String> = Vec::with_capacity(todos.len());
    let mut completed = 0usize;
    let mut in_progress = 0usize;
    let mut pending = 0usize;

    for (i, item) in todos.iter().enumerate() {
        let id = item
            .get("id")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| (i + 1).to_string());
        let content = item
            .get("content")
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty());
        let Some(content) = content else {
            return error_outcome(
                "update_todos",
                &format!("todos[{i}] is missing a non-empty content string."),
            );
        };
        let status_raw = item
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("pending")
            .trim()
            .to_ascii_lowercase();
        let status = match status_raw.as_str() {
            "completed" | "done" | "complete" => {
                completed += 1;
                "completed"
            }
            "in_progress" | "active" | "doing" => {
                in_progress += 1;
                "in_progress"
            }
            "cancelled" | "canceled" => "cancelled",
            _ => {
                pending += 1;
                "pending"
            }
        };
        ui.push_str(&format!(
            "<todo id=\"{}\" status=\"{}\">{}</todo>\n",
            escape_xml_attr(&id),
            status,
            escape_todo_content(content),
        ));
        summary_parts.push(format!("[{status}] {content}"));
    }
    ui.push_str("</todos>\n");

    // Soft-heal missing in_progress instead of hard-failing the turn.
    if in_progress == 0 && pending > 0 {
        if let Some(pos) = ui.find("status=\"pending\"") {
            ui.replace_range(
                pos..pos + "status=\"pending\"".len(),
                "status=\"in_progress\"",
            );
            in_progress = 1;
            pending = pending.saturating_sub(1);
            for part in summary_parts.iter_mut() {
                if part.starts_with("[pending]") {
                    *part = part.replacen("[pending]", "[in_progress]", 1);
                    break;
                }
            }
        }
    }

    if let Err(msg) = validate_update_todos_in_progress(in_progress, pending) {
        return error_outcome("update_todos", &msg);
    }

    let remaining = todos.len().saturating_sub(completed);
    ToolOutcome {
        tool_result: format!(
            "Todos updated: {remaining} remaining ({completed} completed, {in_progress} in progress).\n{}",
            summary_parts.join("\n")
        ),
        ui_chunk: ui,
        side_effect: None,
    }
}

fn extract_todo_labels(content: &str) -> Vec<String> {
    let mut labels = Vec::new();
    let mut in_todos = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("## ") {
            let heading = trimmed[3..].trim();
            in_todos =
                heading.eq_ignore_ascii_case("todos") || heading.eq_ignore_ascii_case("todo");
            continue;
        }
        if in_todos {
            if let Some(label) = checkbox_label(trimmed) {
                labels.push(label);
            }
        }
    }
    labels
}

fn checkbox_label(trimmed: &str) -> Option<String> {
    let lower = trimmed.to_ascii_lowercase();
    let rest = if lower.starts_with("- [ ]") {
        trimmed.get(5..)?.trim()
    } else if lower.starts_with("- [x]") {
        trimmed.get(5..)?.trim()
    } else if lower.starts_with("* [ ]") || lower.starts_with("* [x]") {
        trimmed.get(5..)?.trim()
    } else {
        return None;
    };
    if rest.is_empty() {
        None
    } else {
        Some(rest.to_string())
    }
}

fn strip_todos_section(content: &str) -> String {
    let mut out = String::new();
    let mut skip = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("## ") {
            let heading = trimmed[3..].trim();
            skip = heading.eq_ignore_ascii_case("todos") || heading.eq_ignore_ascii_case("todo");
            if skip {
                continue;
            }
        }
        if skip {
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    out.trim().to_string()
}

fn format_plan_file(body: &str, todos: &[String]) -> String {
    let lines: Vec<String> = todos.iter().map(|t| format!("- [ ] {t}")).collect();
    format!(
        "{}\n\n<!--bettershape-todos\n{}\n-->\n",
        body.trim_end(),
        lines.join("\n")
    )
}

/// Plan content must include a `## Todos` / `## Todo` section with at least one checkbox.
pub(super) fn validate_plan_todos_section(content: &str) -> Result<(), String> {
    let mut saw_todos_heading = false;
    let mut in_todos = false;
    let mut found_checkbox = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("## ") {
            let heading = trimmed[3..].trim();
            let is_todos =
                heading.eq_ignore_ascii_case("todos") || heading.eq_ignore_ascii_case("todo");
            if in_todos && !is_todos {
                break;
            }
            in_todos = is_todos;
            if is_todos {
                saw_todos_heading = true;
            }
            continue;
        }
        if in_todos && is_markdown_checkbox_line(trimmed) {
            found_checkbox = true;
            break;
        }
    }
    if !saw_todos_heading {
        return Err(
            "Plan content must include a `## Todos` section with markdown checkboxes \
             (e.g. `- [ ] Implement X`). Add that section, then call save_plan again."
                .to_string(),
        );
    }
    if !found_checkbox {
        return Err(
            "`## Todos` section must include at least one markdown checkbox line \
             (`- [ ]` or `- [x]`). Add checklist items, then call save_plan again."
                .to_string(),
        );
    }
    Ok(())
}

pub(super) fn is_markdown_checkbox_line(trimmed: &str) -> bool {
    let lower = trimmed.to_ascii_lowercase();
    lower.starts_with("- [ ]")
        || lower.starts_with("- [x]")
        || lower.starts_with("* [ ]")
        || lower.starts_with("* [x]")
}

/// While pending work remains, exactly one todo must be `in_progress`.
/// All-terminal lists (completed/cancelled only) may have zero.
pub(super) fn validate_update_todos_in_progress(
    in_progress: usize,
    pending: usize,
) -> Result<(), String> {
    if in_progress > 1 {
        return Err(format!(
            "Exactly one todo must be in_progress (got {in_progress}). \
             Keep a single active item; set the rest to pending, completed, or cancelled."
        ));
    }
    if in_progress == 0 && pending > 0 {
        return Err("Exactly one todo must be in_progress while work remains. \
             Set one pending item to in_progress (or mark all todos completed/cancelled)."
            .to_string());
    }
    Ok(())
}

pub(super) fn slugify_plan_title(title: &str) -> String {
    let raw: String = title
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    raw.split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

/// App-data directory for plans (not the user's project `.bettershape/plans`).
pub(super) fn plan_storage_dir(project_path: &str) -> Option<std::path::PathBuf> {
    let project_key: String = project_path
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .take(80)
        .collect();
    let base = dirs::data_local_dir()?;
    Some(base.join("BetterShape").join("plans").join(project_key))
}

#[cfg(test)]
mod plan_storage_tests {
    use super::*;

    #[test]
    fn plans_live_under_app_data_not_project() {
        let dir = plan_storage_dir(r"C:\Users\me\project").expect("dir");
        let as_str = dir.to_string_lossy().replace('\\', "/");
        assert!(as_str.contains("BetterShape/plans"), "{as_str}");
        assert!(!as_str.contains(".bettershape/plans"), "{as_str}");
    }
}

pub(super) async fn tool_render_design_previews(args: &Value, ctx: &ToolCtx<'_>) -> ToolOutcome {
    if !ctx.mode.eq_ignore_ascii_case("visual") && !ctx.mode.eq_ignore_ascii_case("design") {
        return blocked_outcome(
            "render_design_previews",
            "Component previews are only available in Visual mode.",
        );
    }

    let concepts = match args.get("concepts").and_then(|v| v.as_array()) {
        Some(arr) if !arr.is_empty() => arr,
        _ => {
            return error_outcome(
                "render_design_previews",
                "concepts must be a non-empty array of 1–3 component previews.",
            );
        }
    };

    if concepts.len() > 3 {
        return error_outcome(
            "render_design_previews",
            "At most 3 component examples. Split into another call only if the user asks for more after picking.",
        );
    }

    let pick_id = format!("dp-{}", uuid::Uuid::new_v4());

    ctx.emit_status(json!({
        "phase": "tool",
        "tool": "render_design_previews",
        "label": "Creating preview",
    }));

    let mut inner = String::new();
    let mut catalog: Vec<DesignPickConcept> = Vec::new();
    let mut rendered = 0usize;

    for concept in concepts.iter().take(3) {
        if ctx.cancel.is_cancelled() {
            break;
        }
        let id = concept
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let name = concept
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("Concept")
            .trim();
        let style = concept
            .get("style")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let jsx = concept
            .get("jsx")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let html = concept
            .get("html")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let (kind, source) = match (jsx, html) {
            (Some(jsx), _) => ("react", jsx),
            (_, Some(html)) => ("html", html),
            _ => continue,
        };
        if id.is_empty() {
            continue;
        }
        let width = concept
            .get("width")
            .and_then(|v| v.as_u64())
            .unwrap_or(640)
            .clamp(320, 1200) as u32;
        let height = concept
            .get("height")
            .and_then(|v| v.as_u64())
            .unwrap_or(360)
            .clamp(200, 640) as u32;

        rendered += 1;
        inner.push_str(&format!(
            r#"<design_preview id="{}" name="{}" style="{}" width="{}" height="{}" kind="{}">{}</design_preview>"#,
            escape_xml_attr(id),
            escape_xml_attr(name),
            escape_xml_attr(style),
            width,
            height,
            kind,
            escape_xml_preview_source(source),
        ));
        catalog.push(DesignPickConcept {
            id: id.to_string(),
            name: name.to_string(),
            style: style.to_string(),
        });
    }

    if rendered == 0 {
        if ctx.cancel.is_cancelled() {
            return ToolOutcome {
                tool_result: "Design preview rendering was cancelled.".to_string(),
                ui_chunk: String::new(),
                side_effect: None,
            };
        }
        return error_outcome(
            "render_design_previews",
            "No previews could be rendered. Provide valid React JSX (preferred) or HTML per concept.",
        );
    }

    if let Ok(mut guard) = ctx.agent_state.design_preview.lock() {
        guard.gate_active = true;
    }
    if let Ok(mut pendings) = ctx.agent_state.pending_design_picks.lock() {
        pendings.insert(
            pick_id.clone(),
            PendingDesignPick {
                id: pick_id.clone(),
                concepts: catalog.clone(),
            },
        );
    }

    let pending_ui = design_previews_ui(&pick_id, "pending", "", &inner);
    ctx.emit_ui_token(&pending_ui);
    ctx.emit_status(json!({ "phase": "approval", "label": "Waiting for you to pick a design" }));
    ctx.emit_scoped_event("agent-design-pick-pending", json!({ "id": pick_id }));

    let answer = wait_for_design_pick(&pick_id, ctx).await;
    cleanup_pending_design_pick(&pick_id, ctx);
    if let Ok(mut guard) = ctx.agent_state.design_preview.lock() {
        guard.gate_active = false;
    }

    let (status, selected, result) = match answer {
        None => (
            "cancelled".to_string(),
            String::new(),
            "The user stopped before picking a preview. Continue with a reasonable default and do not show the same gallery again.".to_string(),
        ),
        Some(payload) if payload == "__skipped__" => {
            (
                "skipped".to_string(),
                String::new(),
                "The user skipped these previews. Do not treat any variant as chosen. Continue only if they already asked you to implement; otherwise wait for a pick or a later @mention.".to_string(),
            )
        }
        Some(payload) => {
            let parsed: Value = serde_json::from_str(&payload).unwrap_or(json!({}));
            let concept_id = parsed
                .get("id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| payload.trim().to_string());
            let hit = catalog.iter().find(|c| c.id == concept_id);
            let name = hit.map(|c| c.name.as_str()).unwrap_or(concept_id.as_str());
            let style = hit.map(|c| c.style.as_str()).unwrap_or("");
            let tweaks = parsed.get("tweaks").cloned().unwrap_or(json!({}));
            let tweak_note = if tweaks.is_null() || tweaks == json!({}) {
                String::new()
            } else {
                format!(
                    " The user tweaked live CSS: {}.",
                    serde_json::to_string(&tweaks).unwrap_or_default()
                )
            };
            (
                "selected".to_string(),
                concept_id.clone(),
                format!(
                    "The user picked concept `{concept_id}` (`{name}` — {style}). Implement THIS variant in the project files. Do not re-render previews unless they ask for more options.{tweak_note}"
                ),
            )
        }
    };

    let ui = design_previews_ui(&pick_id, &status, &selected, &inner);
    ctx.emit_ui_token(&ui);
    ToolOutcome {
        tool_result: result,
        ui_chunk: ui,
        side_effect: None,
    }
}

fn design_previews_ui(id: &str, status: &str, selected: &str, inner: &str) -> String {
    format!(
        "\n<design_previews id=\"{}\" status=\"{}\" selected=\"{}\">{}</design_previews>\n",
        escape_xml_attr(id),
        escape_xml_attr(status),
        escape_xml_attr(selected),
        inner
    )
}

pub(super) async fn tool_screenshot_page(args: &Value, ctx: &ToolCtx<'_>) -> ToolOutcome {
    if is_read_only_mode(ctx.mode) {
        return blocked_outcome(
            "screenshot_page",
            "Screenshots are not taken in Ask or Plan mode.",
        );
    }
    let url_arg = args.get("url").and_then(|v| v.as_str());
    let path_arg = args.get("path").and_then(|v| v.as_str());
    let resolved = match page_shot::resolve_page_url(url_arg, path_arg) {
        Ok(u) => u,
        Err(e) => return error_outcome("screenshot_page", &e),
    };

    let captured = preview_render::capture_page_preview(
        ctx.app_handle.clone(),
        resolved.clone(),
        Some(1280),
        Some(720),
    )
    .await;

    match captured {
        Ok(shot) => {
            let bytes = match std::fs::read(&shot.png_path) {
                Ok(b) if !b.is_empty() => b,
                Ok(_) => {
                    return error_outcome("screenshot_page", "Capture wrote an empty image.");
                }
                Err(e) => {
                    return error_outcome(
                        "screenshot_page",
                        &format!("Could not read captured image: {e}"),
                    );
                }
            };
            let (mime, name) = if bytes.len() >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 {
                ("image/jpeg", "page.jpg")
            } else {
                ("image/png", "page.png")
            };
            let data_url = format!(
                "data:{mime};base64,{}",
                base64::engine::general_purpose::STANDARD.encode(&bytes)
            );
            let tag = page_shot::attached_image_tag(name, mime, &data_url);
            ToolOutcome {
                tool_result: format!(
                    "Captured {resolved} ({mime}, {}x{}). The image is for the user reply and — when this model supports vision — in the next user message for you to inspect. Do not paste the image yourself. Do not take another shot this turn unless you changed a different route. Build Error overlays, blank/white pages, or broken layout mean the work is not done.",
                    shot.width, shot.height
                ),
                ui_chunk: String::new(),
                side_effect: Some(SideEffect::PageScreenshot { tag }),
            }
        }
        Err(e) => error_outcome(
            "screenshot_page",
            &format!(
                "Could not capture {resolved}: {e}. Skip screenshots if the preview is not a website or is not running."
            ),
        ),
    }
}

pub(super) async fn tool_inspect_runtime(args: &Value, ctx: &ToolCtx<'_>) -> ToolOutcome {
    if is_read_only_mode(ctx.mode) {
        return blocked_outcome(
            "inspect_runtime",
            "Runtime inspect is not available in Ask or Plan mode.",
        );
    }
    let kind = crate::agent::tools::runtime_inspect::detect_runtime_kind(ctx.project_path);
    if !kind.inspectable() {
        return error_outcome(
            "inspect_runtime",
            &crate::agent::tools::runtime_inspect::unsupported_message(&kind),
        );
    }
    let url_arg = args.get("url").and_then(|v| v.as_str());
    let path_arg = args.get("path").and_then(|v| v.as_str());
    let resolved =
        match crate::agent::tools::runtime_inspect::resolve_inspect_url(url_arg, path_arg) {
            Ok(u) => u,
            Err(e) => return error_outcome("inspect_runtime", &e),
        };

    let report = match crate::agent::tools::runtime_inspect::inspect_url(&resolved).await {
        Ok(r) => r,
        Err(e) => {
            return error_outcome(
                "inspect_runtime",
                &format!(
                    "Could not attach DevTools to {resolved}: {e}. Start the local preview or app (Electron/Tauri/Wails), or pass a loopback url."
                ),
            );
        }
    };
    let summary = report.lines().take(3).collect::<Vec<_>>().join(" · ");
    let ui = format!(
        "\n<inspect_runtime url=\"{}\" kind=\"{}\">\n{}\n</inspect_runtime>\n",
        escape_xml_attr(&resolved),
        escape_xml_attr(kind.label()),
        escape_xml_text(&clip(&summary, 240)),
    );
    ToolOutcome {
        tool_result: clip(&format!("Runtime kind: {}\n{report}", kind.label()), 8000),
        ui_chunk: ui,
        side_effect: None,
    }
}

fn questions_ui(id: &str, status: &str, questions: &Value, answers: Option<&Value>) -> String {
    let payload = json!({
        "questions": questions,
        "answers": answers,
    });
    let body = payload
        .to_string()
        .replace("</questions>", "</questions\u{200B}>");
    format!(
        "\n<questions id=\"{}\" status=\"{}\">\n{}\n</questions>\n",
        escape_xml_attr(id),
        escape_xml_attr(status),
        body
    )
}

fn normalize_questions(raw: &Value) -> Result<Value, String> {
    let arr = raw
        .as_array()
        .ok_or_else(|| "questions must be an array".to_string())?;
    if arr.is_empty() || arr.len() > 6 {
        return Err("Ask 1–6 questions at a time.".to_string());
    }
    let mut out = Vec::new();
    for (i, q) in arr.iter().enumerate() {
        let prompt = q
            .get("prompt")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| format!("Question {} needs a prompt.", i + 1))?;
        let options = q
            .get("options")
            .and_then(|v| v.as_array())
            .ok_or_else(|| format!("Question {} needs options.", i + 1))?;
        if options.len() < 2 || options.len() > 8 {
            return Err(format!("Question {} must have 2–8 options.", i + 1));
        }
        let id = q
            .get("id")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("q{}", i + 1));
        let mut opts = Vec::new();
        for (j, opt) in options.iter().enumerate() {
            let label = opt
                .get("label")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| format!("Question {} option {} needs a label.", i + 1, j + 1))?;
            let oid = opt
                .get("id")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .unwrap_or_else(|| format!("{}", j + 1));
            opts.push(json!({
                "id": oid,
                "label": label,
                "recommended": opt.get("recommended").and_then(|v| v.as_bool()).unwrap_or(false),
            }));
        }
        out.push(json!({
            "id": id,
            "prompt": prompt,
            "allowMultiple": q.get("allow_multiple").and_then(|v| v.as_bool()).unwrap_or(false),
            "options": opts,
        }));
    }
    Ok(Value::Array(out))
}

pub(super) async fn tool_ask_user(args: &Value, ctx: &ToolCtx<'_>) -> ToolOutcome {
    let questions = match args.get("questions") {
        Some(v) => match normalize_questions(v) {
            Ok(q) => q,
            Err(e) => return error_outcome("ask_user", &e),
        },
        None => return error_outcome("ask_user", "questions is required."),
    };

    let ask_id = format!("ask-{}", uuid::Uuid::new_v4());
    let pending = PendingAsk {
        id: ask_id.clone(),
        questions_json: questions.to_string(),
    };
    if let Ok(mut pendings) = ctx.agent_state.pending_asks.lock() {
        pendings.insert(ask_id.clone(), pending);
    }

    let pending_ui = questions_ui(&ask_id, "pending", &questions, None);
    ctx.emit_ui_token(&pending_ui);
    ctx.emit_status(json!({ "phase": "approval", "label": "Waiting for your answers" }));
    ctx.emit_scoped_event("agent-ask-pending", json!({ "id": ask_id }));

    let answer = wait_for_ask_answer(&ask_id, ctx).await;
    cleanup_pending_ask(&ask_id, ctx);

    match answer {
        None => {
            let ui = questions_ui(&ask_id, "cancelled", &questions, None);
            ctx.emit_ui_token(&ui);
            ToolOutcome {
                tool_result: "The user skipped these questions or stopped the turn. Continue with a reasonable default and do not ask the same questions again.".to_string(),
                ui_chunk: ui,
                side_effect: None,
            }
        }
        Some(payload) if payload == "__skipped__" => {
            let ui = questions_ui(&ask_id, "skipped", &questions, None);
            ctx.emit_ui_token(&ui);
            ToolOutcome {
                tool_result: "The user skipped these questions. Continue with a reasonable default and do not ask the same questions again.".to_string(),
                ui_chunk: ui,
                side_effect: None,
            }
        }
        Some(payload) => {
            let answers: Value = serde_json::from_str(&payload).unwrap_or(json!({}));
            let ui = questions_ui(&ask_id, "answered", &questions, Some(&answers));
            ctx.emit_ui_token(&ui);
            ToolOutcome {
                tool_result: format!(
                    "The user answered:\n{}",
                    serde_json::to_string_pretty(&answers).unwrap_or(payload)
                ),
                ui_chunk: ui,
                side_effect: None,
            }
        }
    }
}

pub(super) fn tool_finish(args: &Value) -> ToolOutcome {
    let summary = args
        .get("summary")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let ui_chunk = match &summary {
        Some(s) if !s.trim().is_empty() => format!("\n{}\n", s),
        _ => String::new(),
    };
    ToolOutcome {
        tool_result: "Turn finished.".to_string(),
        ui_chunk,
        side_effect: Some(SideEffect::Finished { summary }),
    }
}

pub(super) fn design_gate_blocks_tool(name: &str, ctx: &ToolCtx<'_>) -> bool {
    if !ctx.agent_state.design_gate_blocks_writes() {
        return false;
    }
    matches!(
        name,
        "run_terminal"
            | "create_file"
            | "edit_file"
            | "apply_patch"
            | "create_directory"
            | "delete_file"
            | "rename_file"
            | "save_plan"
    )
}

#[cfg(test)]
mod tests {
    use super::{validate_plan_todos_section, validate_update_todos_in_progress};

    #[test]
    fn plan_todos_requires_heading_and_checkbox() {
        assert!(validate_plan_todos_section("# Plan\n\nNo checklist.").is_err());
        assert!(validate_plan_todos_section("## Todos\n\nJust text.").is_err());
        assert!(
            validate_plan_todos_section("## Overview\n\n## Todos\n\n- [ ] Do the thing\n").is_ok()
        );
        assert!(validate_plan_todos_section("## Todo\n\n- [x] Done already\n").is_ok());
        // Checkbox under a later section does not count.
        assert!(validate_plan_todos_section(
            "## Todos\n\nNotes only.\n\n## Steps\n\n- [ ] Ignored\n"
        )
        .is_err());
    }

    #[test]
    fn update_todos_requires_exactly_one_in_progress_while_pending() {
        assert!(validate_update_todos_in_progress(1, 2).is_ok());
        assert!(validate_update_todos_in_progress(1, 0).is_ok());
        // All terminal (no pending): zero in_progress allowed.
        assert!(validate_update_todos_in_progress(0, 0).is_ok());
        assert!(validate_update_todos_in_progress(0, 1).is_err());
        assert!(validate_update_todos_in_progress(2, 0).is_err());
        assert!(validate_update_todos_in_progress(3, 1).is_err());
    }
}
