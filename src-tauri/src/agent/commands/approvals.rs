//! Stop turn, apply edit, terminal/edit approvals.
use super::history;
use super::journals;
use super::logging;
use crate::agent::models::AgentState;
use crate::app_state::AppState;
use crate::commands::preview_render::PreviewCaptureState;
use crate::core::error::AppError;
use tauri::{Emitter, Manager};

#[tauri::command]
pub async fn stop_chat_message(
    conversation_id: Option<String>,
    client_request_id: Option<String>,
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentState>,
    pty_state: tauri::State<'_, crate::commands::pty::PtyState>,
) -> Result<(), AppError> {
    // Reserve cancellation even when the send has not reached admission yet.
    // A request-scoped stop never falls back to an unrelated current chat.
    let conversation_id = if let Some(ref request_id) = client_request_id {
        let recorded = state.request_cancellations.lock()?.cancel(request_id);
        if !recorded {
            return Err(AppError::Message("Invalid chat request id".to_string()));
        }
        let active = state
            .in_flight
            .lock()?
            .values()
            .find(|turn| turn.request_id.as_deref() == Some(request_id.as_str()))
            .and_then(|turn| turn.conversation_id.clone());
        let Some(active) = active else {
            return Ok(());
        };
        Some(active)
    } else {
        conversation_id
    };
    // Stop ends only the chat it was pressed in. Other chats that are still generating
    // keep running. With no id, it falls back to the live chat.
    let live_id = state
        .current_conversation_id
        .lock()
        .map_err(|e| AppError::Poison(e.to_string()))?
        .clone();
    let target = conversation_id
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| live_id.clone());
    let Some(target) = target else {
        return Ok(());
    };

    // Keep replacement admission blocked until all asynchronous Stop cleanup
    // finishes, even if the cancelled run releases its slot sooner.
    let Some(_stop_guard) = state.begin_stop(&target, client_request_id.as_deref()) else {
        return Ok(());
    };
    let is_live = live_id.as_deref() == Some(target.as_str());
    let already_cancelled = state
        .conversation_cancel_token(&target)
        .map(|token| token.is_cancelled())
        .unwrap_or(false);
    if !state.is_generating_conversation(&target) {
        // Idle / launch remounts used to call stop and still abort captures +
        // kill PTYs below, which tore down WebView2 frames and reloaded the UI.
        return Ok(());
    }
    if already_cancelled {
        logging::debug("chat", "Stop ignored — generation already stopping");
        return Ok(());
    }

    // Cancel first so waiters observe Stop instead of a fake Reject (which
    // used to look like accepted edits were undone).
    if let Some(token) = state.conversation_cancel_token(&target) {
        token.cancel();
    }
    logging::info("chat", "Stop requested by user");
    // The browser session, preview capture, and terminals belong to the chat on screen.
    // Tearing them down for a background chat would break whichever chat is live.
    if is_live {
        crate::agent::tools::browse::stop_session();
        let _ = app.emit(
            "agent-browse",
            serde_json::json!({"id": "live", "status": "stopped"}),
        );
    }
    if is_live {
        // Approval prompts carry no chat id; only the chat on screen can own them.
        state.dismiss_unresolved_approvals();
    }

    let project_path = state.current_project.lock().ok().and_then(|p| p.clone());
    let aborted = {
        let turn_id = state.in_flight_for(&target).map(|f| f.turn_id);
        if let Some(ref project) = project_path {
            crate::commands::stats::bump_event(project, "chat_stops");
        }
        if let Some(ref tid) = turn_id {
            journals::save_turn_journal(&journals::TurnJournal {
                conversation_id: target.clone(),
                turn_id: tid.clone(),
                project_path: project_path.clone(),
                status: "interrupted".to_string(),
                updated_at: history::now_f64(),
                subagent_ids: Vec::new(),
                note: Some("Stopped by user".to_string()),
            });
        }
        turn_id.map(|tid| (tid, target.clone()))
    };

    // Commit streamed text into the chat's own record before releasing the turn, so Stop
    // never wipes the bubble the user was reading.
    if is_live {
        if let Ok(mut merged) = state.history_for_persistence() {
            if let Some(last) = merged.last_mut() {
                if last.role == "assistant" && last.content.contains("<browse_session") {
                    last.content = crate::agent::tools::browse::seal_browse_markup(&last.content);
                }
            }
            if let Ok(mut hist) = state.history.lock() {
                *hist = merged;
            }
        }
        if let Some(path) = project_path.as_deref() {
            let _ = history::save_current_conversation(&state, path);
        }
    } else if let Some(path) = project_path.as_deref() {
        // Background chat: its partial text goes to its stored record, not the live chat.
        // Save into the chat's own project, which can differ from the active one.
        if let Some((owner, conv)) = history::find_conversation_by_id(&target, Some(path)) {
            let merged =
                state.merge_in_flight_into_history_for(conv.history, Some(target.as_str()));
            let _ =
                history::upsert_conversation_snapshot(&state, &owner, &target, &conv.title, merged);
        }
    }
    // The in-flight slot is NOT released here. The cancelled turn still unwinds and clears its
    // own slot when it finishes (`clear_in_flight_if`). Freeing it now let a new send start
    // while the old turn was still running in the same chat.

    if let Some((turn_id, conv_id)) = aborted {
        let _ = app.emit(
            "chat_complete",
            serde_json::json!({
                "turnId": turn_id,
                "conversationId": conv_id,
                "error": "Cancelled",
            }),
        );
    }

    // Abort any in-flight design-preview capture and give the frontend
    // capture host a moment to tear down its offscreen iframe *before* we
    // kill the PTY. Doing this concurrently raced WebView2 teardown against
    // process teardown and surfaced as "invalid window handle" on Windows.
    if is_live {
        app.state::<PreviewCaptureState>()
            .abort_and_drain(&app, "Preview capture cancelled")
            .await;
    }
    state.kill_cancelled_terminals(&pty_state).await;
    Ok(())
}

#[tauri::command]
pub async fn apply_file_edit(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    path: String,
    original: String,
    replacement: String,
) -> Result<(), AppError> {
    logging::info("edit", &format!("Manual apply_file_edit: path={}", path));
    let proj_path = state.0.lock()?.project_path.clone().unwrap_or_default();
    let abs_path = if std::path::Path::new(&path).is_absolute() {
        path.clone()
    } else {
        std::path::Path::new(&proj_path)
            .join(&path)
            .to_string_lossy()
            .into_owned()
    };
    if !proj_path.is_empty() {
        crate::agent::security::paths::resolve_safe_path(&path, &proj_path)?;
    } else {
        crate::agent::security::paths::assert_ipc_path_allowed(&abs_path)?;
    }

    // For manual edits from the UI we use a deterministic full-overwrite path: if the
    // caller provided an `original` block we honour it (search-and-replace), otherwise
    // we treat `replacement` as the full new content. No LLM round-trip needed.
    let current = tokio::fs::read_to_string(&abs_path)
        .await
        .unwrap_or_default();
    let new_content = if original.trim().is_empty() {
        replacement
    } else {
        current.replacen(&original, &replacement, 1)
    };

    if let Some(parent) = std::path::Path::new(&abs_path).parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }
    crate::domain::filesystem::service::save_file(app.clone(), abs_path.clone(), new_content)
        .await?;
    let _ = app.emit("bettershape-file-edited", abs_path);
    Ok(())
}

/// Record the user's approval. Execution happens inside the agent turn's
/// waiting tool call (same session engine, streaming, and cancel token as
/// auto-approved commands). The old design executed the command *here* and the
/// tool-side waiter timed out after 120s — a slow approval plus a slow command
/// told the model "rejected, do NOT retry" while the command actually ran.
#[tauri::command]
pub fn approve_terminal_command(
    id: String,
    state: tauri::State<'_, AgentState>,
) -> Result<String, AppError> {
    logging::info("terminal", &format!("Command approved: {}", id));
    if !state.pending_commands.lock()?.contains_key(&id) {
        return Err(AppError::Message(
            "Command not found or already processed".to_string(),
        ));
    }
    state.command_decisions.lock()?.insert(id, true);
    Ok("approved".to_string())
}

#[tauri::command]
pub fn reject_terminal_command(
    id: String,
    state: tauri::State<'_, AgentState>,
) -> Result<(), AppError> {
    logging::info("terminal", &format!("Command rejected: {}", id));
    state.command_decisions.lock()?.insert(id.clone(), false);
    state.pending_commands.lock()?.remove(&id);
    Ok(())
}

/// Approve or reject a staged file edit (edit-approval mode). The waiting
/// `edit_file` / `create_file` tool call writes the file on approval.
#[tauri::command]
pub fn resolve_edit_approval(
    id: String,
    approved: bool,
    state: tauri::State<'_, AgentState>,
) -> Result<(), AppError> {
    logging::info(
        "editing",
        &format!(
            "Edit {}: {}",
            if approved { "approved" } else { "rejected" },
            id
        ),
    );
    if !state.pending_edits.lock()?.contains_key(&id) {
        return Err(AppError::Message(
            "Edit not found or already processed".to_string(),
        ));
    }
    state.edit_decisions.lock()?.insert(id.clone(), approved);
    if !approved {
        state.pending_edits.lock()?.remove(&id);
    }
    Ok(())
}

/// Record the user's click-through answers for a pending `ask_user` tool call.
#[tauri::command]
pub fn answer_ask_user(
    id: String,
    answers: String,
    skipped: Option<bool>,
    state: tauri::State<'_, AgentState>,
) -> Result<(), AppError> {
    if !state.pending_asks.lock()?.contains_key(&id) {
        return Err(AppError::Message(
            "Question set not found or already answered".to_string(),
        ));
    }
    let payload = if skipped.unwrap_or(false) {
        "__skipped__".to_string()
    } else {
        answers
    };
    state.ask_answers.lock()?.insert(id, payload);
    Ok(())
}

/// Record the chosen concept for a pending `render_design_previews` gallery.
#[tauri::command]
pub fn select_design_preview(
    id: String,
    concept_id: Option<String>,
    skipped: Option<bool>,
    tweaks: Option<String>,
    state: tauri::State<'_, AgentState>,
) -> Result<(), AppError> {
    let pending = state.pending_design_picks.lock()?;
    let Some(pick) = pending.get(&id) else {
        return Err(AppError::Message(
            "Design preview not found or already chosen".to_string(),
        ));
    };
    let payload = if skipped.unwrap_or(false) {
        "__skipped__".to_string()
    } else {
        let cid = concept_id.unwrap_or_default();
        let trimmed = cid.trim().to_string();
        if trimmed.is_empty() {
            return Err(AppError::Message("Pick a concept id.".to_string()));
        }
        let known = pick
            .concepts
            .iter()
            .any(|c| c.id.eq_ignore_ascii_case(&trimmed) || c.name.eq_ignore_ascii_case(&trimmed));
        if !known {
            return Err(AppError::Message(
                "That concept is not in this preview set.".to_string(),
            ));
        }
        let mut obj = serde_json::json!({ "id": trimmed });
        if let Some(raw) = tweaks {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                obj["tweaks"] = v;
            }
        }
        obj.to_string()
    };
    drop(pending);
    state.design_pick_answers.lock()?.insert(id, payload);
    Ok(())
}
