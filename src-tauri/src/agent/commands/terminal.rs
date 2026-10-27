/// Agent terminal command execution.
///
/// Every command runs as a *terminal session* (see `commands::pty`):
///   * Piped subprocess by default — clean non-TTY output, deterministic exit.
///   * Direct-child PTY for dev servers / watch tasks that need a TTY.
///
/// `run_agent_command` blocks for a bounded foreground window streaming output
/// to the UI; if the command is still running at the deadline it converts to a
/// background session (it is NOT killed) and the caller gets the session id.
/// Completion is detected from the actual command process, so `read_terminal`
/// and `wait` report accurate `running` / `exit_code` state — the model never
/// has to guess from output text.
///
/// Two event channels are emitted:
///   * `bettershape-terminal-ai-action` — legacy payloads for the terminal panel.
///   * `agent-terminal-stream`   — command-correlated events for the chat UI's
///     live output card: `{ commandId, sessionId, kind, ... }`.
use std::sync::Arc;
use std::time::Duration;

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};

use crate::agent::models::{AgentState, TerminalOwner};
use crate::commands::pty::{self, AgentSessionCallbacks, PtyState};

use super::logging;

/// Foreground window before a still-running command converts to background.
pub const FOREGROUND_WINDOW_SECS: u64 = 25;
/// Dev servers return quickly — just long enough to catch instant failures.
pub const DEV_SERVER_CONFIRM_SECS: u64 = 3;

/// Output returned to the model is clipped to this many characters.
const MODEL_OUTPUT_CAP: usize = 50_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandExecutionMode {
    /// One-shot command (build, install, test, git…): piped subprocess.
    OneShot,
    /// Long-lived interactive process (dev server, watcher): PTY child.
    DevServer,
}

/// Classify how a command should be executed. Only genuinely long-lived
/// processes belong in `DevServer`; installs and builds are one-shot commands
/// that simply take a while — they run piped with a foreground window and
/// convert to background if slow.
pub fn classify_command(command: &str) -> CommandExecutionMode {
    let lower = command.trim().to_lowercase();
    const DEV_SERVER_PATTERNS: &[&str] = &[
        " run dev",
        "next dev",
        "nuxt dev",
        "npm start",
        "yarn dev",
        "pnpm dev",
        "bun dev",
        "yarn start",
        "pnpm start",
        " --watch",
        "cargo watch",
        "nodemon",
        "webpack serve",
        "vite dev",
        "vite serve",
        "turbo dev",
        "astro dev",
        "remix dev",
        "tauri dev",
        "storybook dev",
        "docker compose up",
        "docker-compose up",
    ];
    // `vite` alone (no subcommand) starts a dev server.
    if lower == "vite" || lower.starts_with("vite ") && !lower.contains("build") {
        return CommandExecutionMode::DevServer;
    }
    if DEV_SERVER_PATTERNS.iter().any(|p| lower.contains(p)) {
        CommandExecutionMode::DevServer
    } else {
        CommandExecutionMode::OneShot
    }
}

/// Remove ANSI escape sequences (CSI / OSC / single-char escapes) so PTY output
/// is readable for the model and in chat history.
pub fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            if c != '\r' {
                out.push(c);
            }
            continue;
        }
        match chars.peek() {
            // CSI: ESC [ ... final byte in @-~
            Some('[') => {
                chars.next();
                for n in chars.by_ref() {
                    if ('\u{40}'..='\u{7e}').contains(&n) {
                        break;
                    }
                }
            }
            // OSC: ESC ] ... terminated by BEL or ESC \
            Some(']') => {
                chars.next();
                let mut prev_esc = false;
                for n in chars.by_ref() {
                    if n == '\u{7}' || (prev_esc && n == '\\') {
                        break;
                    }
                    prev_esc = n == '\u{1b}';
                }
            }
            // Two-character escapes (ESC ( B etc.) and stray escapes.
            Some(_) => {
                chars.next();
            }
            None => {}
        }
    }
    out
}

pub struct AgentCommandResult {
    pub session_id: u32,
    /// True when the command finished inside the foreground window.
    pub completed: bool,
    pub exit_code: Option<i32>,
    /// Cleaned output (full on completion, tail when backgrounded).
    pub output: String,
    /// True only when the command is confirmed stopped. A cancellation whose
    /// kill could not be confirmed reports `false` and keeps the session
    /// tracked, so the caller shows the command as still backgrounded with the
    /// failure text instead of claiming a live process finished.
    pub cancelled: bool,
}

/// Emits a legacy terminal panel action event.
fn emit_panel_event(app: &AppHandle, payload: serde_json::Value) {
    let _ = app.emit("bettershape-terminal-ai-action", payload);
}

/// Emits a command-correlated chat terminal stream event.
fn emit_chat_stream(app: &AppHandle, payload: serde_json::Value) {
    let _ = app.emit("agent-terminal-stream", payload);
}

/// Builds the `agent-terminal-stream` exit payload, tagging `cancelled` when stopped or killed.
fn build_exit_stream_payload(
    command_id: &str,
    session_id: u32,
    exit_code: i32,
    cancelled: bool,
) -> serde_json::Value {
    if cancelled {
        json!({
            "commandId": command_id,
            "sessionId": session_id,
            "kind": "exit",
            "exitCode": exit_code,
            "cancelled": true,
        })
    } else {
        json!({
            "commandId": command_id,
            "sessionId": session_id,
            "kind": "exit",
            "exitCode": exit_code,
        })
    }
}

/// Appends `data` to the bounded prompt buffer and returns `true` on the first input prompt.
fn take_prompt_wait_signal(
    output_buf: &std::sync::Mutex<String>,
    waiting_emitted: &std::sync::atomic::AtomicBool,
    data: &str,
) -> bool {
    let Ok(mut buf) = output_buf.lock() else {
        return false;
    };
    buf.push_str(data);
    crate::core::bounded_text::retain_tail(&mut buf, 8_000);
    if waiting_emitted.load(std::sync::atomic::Ordering::Relaxed) {
        return false;
    }
    let matched = pty::looks_like_input_prompt(&strip_ansi(&buf));
    if matched {
        waiting_emitted.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    matched
}

/// Forwards output chunks to the terminal panel and `pty-output` when mirroring is enabled.
fn forward_panel_output(app: &AppHandle, enabled: bool, session_id: u32, data: &str) {
    if !enabled {
        return;
    }
    let panel = json!({ "type": "data", "data": data.replace('\n', "\r\n") });
    emit_panel_event(app, panel);
    let out = json!({ "id": session_id, "data": data });
    let _ = app.emit("pty-output", out);
}

/// Forwards exit status to the terminal panel and `pty-exit` when mirroring is enabled.
fn forward_panel_exit(app: &AppHandle, enabled: bool, session_id: u32, exit_code: i32) {
    if !enabled {
        return;
    }
    let finish = json!({ "type": "finish", "exitCode": exit_code });
    emit_panel_event(app, finish);
    let exit = json!({ "id": session_id, "exit_code": exit_code });
    let _ = app.emit("pty-exit", exit);
}

/// Returns `true` when session exit came from user turn cancellation.
fn is_session_exit_cancelled(owner: &TerminalOwner) -> bool {
    owner.cancel.is_cancelled()
}

/// Constructs output and exit callbacks linking a PTY or piped session to chat stream events.
fn make_callbacks(
    app: &AppHandle,
    command_id: &str,
    forward_panel_data: bool,
    owner: Arc<TerminalOwner>,
) -> AgentSessionCallbacks {
    let app_out = app.clone();
    let app_exit = app.clone();
    let cmd_id_out = command_id.to_string();
    let cmd_id_exit = command_id.to_string();
    let output_buf = Arc::new(std::sync::Mutex::new(String::new()));
    let waiting_emitted = Arc::new(std::sync::atomic::AtomicBool::new(false));
    AgentSessionCallbacks {
        on_output: Arc::new(move |session_id, data| {
            emit_chat_stream(
                &app_out,
                json!({
                    "commandId": cmd_id_out,
                    "sessionId": session_id,
                    "kind": "data",
                    "data": data,
                }),
            );
            if take_prompt_wait_signal(&output_buf, &waiting_emitted, data) {
                emit_chat_stream(
                    &app_out,
                    json!({
                        "commandId": cmd_id_out,
                        "sessionId": session_id,
                        "kind": "waiting_for_input",
                    }),
                );
            }
            forward_panel_output(&app_out, forward_panel_data, session_id, data);
        }),
        on_exit: Arc::new(move |session_id, exit_code| {
            let cancelled = is_session_exit_cancelled(&owner);
            if let Some(state) = app_exit.try_state::<AgentState>() {
                state.unregister_session(session_id, &owner);
            }
            emit_chat_stream(
                &app_exit,
                build_exit_stream_payload(&cmd_id_exit, session_id, exit_code, cancelled),
            );
            forward_panel_exit(&app_exit, forward_panel_data, session_id, exit_code);
        }),
    }
}

/// Run a command as a terminal session with a bounded foreground window.
pub async fn run_agent_command(
    command: &str,
    cwd: &str,
    app: &AppHandle,
    pty_state: &PtyState,
    agent_state: &AgentState,
    owner: Arc<TerminalOwner>,
    command_id: &str,
) -> AgentCommandResult {
    let cancel = &owner.cancel;
    let mode = classify_command(command);
    logging::info(
        "terminal",
        &format!("Running ({:?}): {} (cwd={})", mode, command, cwd),
    );

    let (session_id, is_pty) = match mode {
        CommandExecutionMode::DevServer => {
            let callbacks = make_callbacks(app, command_id, false, owner.clone());
            match pty::spawn_agent_pty_command(app, pty_state, command, cwd, Some(callbacks)).await
            {
                Ok(id) => (id, true),
                Err(e) => return spawn_failure(app, command_id, command, e.to_string()),
            }
        }
        CommandExecutionMode::OneShot => {
            let callbacks = make_callbacks(app, command_id, true, owner.clone());
            match pty::spawn_piped_session(pty_state, command, cwd, Some(callbacks)) {
                Ok(id) => (id, false),
                Err(e) => return spawn_failure(app, command_id, command, e.to_string()),
            }
        }
    };

    agent_state.register_session(
        session_id,
        owner.clone(),
        pty_state.session_meta(session_id),
    );

    emit_chat_stream(
        app,
        json!({
            "commandId": command_id,
            "sessionId": session_id,
            "kind": "start",
            "command": command,
        }),
    );

    let window = match mode {
        CommandExecutionMode::DevServer => Duration::from_secs(DEV_SERVER_CONFIRM_SECS),
        CommandExecutionMode::OneShot => Duration::from_secs(FOREGROUND_WINDOW_SECS),
    };

    let finished = pty_state
        .wait_for_session_exit(session_id, window, cancel)
        .await;

    if cancel.is_cancelled() {
        if let Err(error) = agent_state
            .kill_registered_session(pty_state, session_id, &owner)
            .await
        {
            let output =
                format!("Could not confirm that the command stopped. {error}. Retry Stop.");
            emit_chat_stream(
                app,
                json!({
                    "commandId": command_id,
                    "sessionId": session_id,
                    "kind": "data",
                    "data": output,
                }),
            );
            return AgentCommandResult {
                session_id,
                completed: false,
                exit_code: None,
                output,
                cancelled: false,
            };
        }
        agent_state.unregister_session(session_id, &owner);
        emit_panel_event(
            app,
            json!({ "type": "finish", "exitCode": -1, "cancelled": true }),
        );
        emit_chat_stream(
            app,
            json!({
                "commandId": command_id,
                "sessionId": session_id,
                "kind": "exit",
                "exitCode": -1,
                "cancelled": true,
            }),
        );
        return AgentCommandResult {
            session_id,
            completed: false,
            exit_code: Some(-1),
            output: "[Command cancelled by user]".to_string(),
            cancelled: true,
        };
    }

    let snapshot = pty_state
        .read_session_output(session_id, MODEL_OUTPUT_CAP)
        .ok();
    let raw_output = snapshot
        .as_ref()
        .map(|s| s.output.clone())
        .unwrap_or_default();
    let output = if is_pty {
        strip_ansi(&raw_output)
    } else {
        raw_output
    };
    let exit_code = snapshot.as_ref().and_then(|s| s.exit_code);

    if finished {
        agent_state.unregister_session(session_id, &owner);
        logging::info(
            "terminal",
            &format!(
                "Command finished in foreground: exit={:?}, {} chars",
                exit_code,
                output.len()
            ),
        );
        AgentCommandResult {
            session_id,
            completed: true,
            exit_code,
            output,
            cancelled: false,
        }
    } else {
        // Still running: hand it to the background. Deliberately NOT killed —
        // the session keeps streaming and `wait`/`read_terminal` track it.
        // Keep session registered so Stop can still kill it.
        // Open a real terminal tab now so the user can read it and close it.
        emit_panel_event(
            app,
            json!({
                "type": "start",
                "command": command,
                "cwd": cwd,
                "interactive": true,
                "sessionId": session_id,
                "commandId": command_id,
            }),
        );
        emit_chat_stream(
            app,
            json!({
                "commandId": command_id,
                "sessionId": session_id,
                "kind": "background",
            }),
        );
        logging::info(
            "terminal",
            &format!("Command moved to background session {}", session_id),
        );
        AgentCommandResult {
            session_id,
            completed: false,
            exit_code: None,
            output,
            cancelled: false,
        }
    }
}

fn spawn_failure(
    app: &AppHandle,
    command_id: &str,
    command: &str,
    err: String,
) -> AgentCommandResult {
    let msg = format!("Failed to spawn command: {}", err);
    logging::error("terminal", &msg);
    emit_chat_stream(
        app,
        json!({
            "commandId": command_id,
            "kind": "exit",
            "exitCode": -1,
            "data": msg,
            "command": command,
        }),
    );
    AgentCommandResult {
        session_id: 0,
        completed: true,
        exit_code: Some(-1),
        output: msg,
        cancelled: false,
    }
}

/// Format a completed command result for the model.
pub fn format_command_result(result: &AgentCommandResult) -> String {
    if result.cancelled {
        return "[Command cancelled by user]".to_string();
    }
    let mut out = clip(&result.output, MODEL_OUTPUT_CAP);
    match result.exit_code {
        Some(0) => {
            if out.trim().is_empty() {
                out = "[Command completed with exit code 0]".to_string();
            }
        }
        Some(code) => {
            out.push_str(&format!("\n[Exit code: {}]", code));
        }
        None => {}
    }
    out
}

/// Format a backgrounded command result for the model.
pub fn format_background_result(result: &AgentCommandResult, command: &str) -> String {
    let tail = clip_tail(&result.output, 2_000);
    format!(
        "Command is still running after {}s and moved to background terminal session {}.\n\
         Command: {}\n\
         Output so far:\n{}\n\n\
         Next step: call `wait` with session_id={} — it returns as soon as the command finishes \
         (or when the wait window ends). Only dev servers/watchers run indefinitely; do not kill \
         or restart them, and do not re-run this command.",
        FOREGROUND_WINDOW_SECS, result.session_id, command, tail, result.session_id
    )
}

fn clip(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_string();
    }
    let head: String = text.chars().take(limit).collect();
    format!(
        "{}... [truncated, {} chars total]",
        head,
        text.chars().count()
    )
}

fn clip_tail(text: &str, limit: usize) -> String {
    let count = text.chars().count();
    if count <= limit {
        return text.to_string();
    }
    let tail: String = text.chars().skip(count - limit).collect();
    format!("[…{} earlier chars omitted]\n{}", count - limit, tail)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_dev_servers() {
        assert_eq!(
            classify_command("npm run dev"),
            CommandExecutionMode::DevServer
        );
        assert_eq!(
            classify_command("pnpm dev"),
            CommandExecutionMode::DevServer
        );
        assert_eq!(
            classify_command("cargo watch -x check"),
            CommandExecutionMode::DevServer
        );
        assert_eq!(classify_command("vite"), CommandExecutionMode::DevServer);
        assert_eq!(
            classify_command("docker compose up"),
            CommandExecutionMode::DevServer
        );
    }

    #[test]
    fn classify_one_shot_builds_and_installs() {
        // Installs/builds are one-shot: bounded foreground, then background.
        assert_eq!(
            classify_command("npm install"),
            CommandExecutionMode::OneShot
        );
        assert_eq!(classify_command("npm ci"), CommandExecutionMode::OneShot);
        assert_eq!(
            classify_command("cargo build --release"),
            CommandExecutionMode::OneShot
        );
        assert_eq!(
            classify_command("cargo test"),
            CommandExecutionMode::OneShot
        );
        assert_eq!(
            classify_command("git status"),
            CommandExecutionMode::OneShot
        );
        assert_eq!(
            classify_command("vite build"),
            CommandExecutionMode::OneShot
        );
        assert_eq!(
            classify_command("npx create-next-app --yes ."),
            CommandExecutionMode::OneShot
        );
    }

    #[test]
    fn strip_ansi_removes_csi_and_osc() {
        assert_eq!(strip_ansi("\u{1b}[32mgreen\u{1b}[0m text"), "green text");
        assert_eq!(strip_ansi("\u{1b}]0;title\u{7}body"), "body");
        assert_eq!(strip_ansi("plain"), "plain");
        assert_eq!(strip_ansi("a\r\nb"), "a\nb");
        assert_eq!(strip_ansi("\u{1b}[2K\u{1b}[1Gnpm install"), "npm install");
    }

    /// Verifies `build_exit_stream_payload` sets `cancelled: true` only for stopped sessions.
    #[test]
    fn exit_stream_payload_marks_cancelled_only_when_stopped() {
        let stopped = build_exit_stream_payload("cmd-1", 7, -1, true);
        assert_eq!(stopped.get("cancelled"), Some(&json!(true)));
        let failed = build_exit_stream_payload("cmd-2", 7, 1, false);
        assert_eq!(failed.get("cancelled"), None);
    }
}
