mod exit_status;
mod preview_readiness;

use preview_readiness::PreviewReadiness;

use crate::core::error::AppError;
use crate::core::session_ownership::{ownership_loss, ownership_loss_note, OwnershipLoss};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::ffi::{OsStr, OsString};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};
use tokio_util::sync::CancellationToken;

const SESSION_OUTPUT_CAP: usize = 512_000;
/// Finished agent sessions kept around for `read_terminal` after completion.
const MAX_FINISHED_SESSIONS: usize = 20;

/// How long the piped-session monitor waits for the pipe readers to drain before
/// it reports a finished process. Seeing the child exit does not mean its output
/// has been read yet, and a waiter that wakes on the exit signal alone would miss
/// the last of it. Bounded, because a descendant that inherited the pipe can hold
/// it open long after the tracked process exited.
const PIPE_DRAIN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionKind {
    /// Interactive shell owned by the user's terminal panel.
    UserShell,
    /// Agent command running as the direct child of a PTY (dev servers, watch tasks).
    AgentPty,
    /// Agent command running as a piped subprocess (default: builds, installs, git…).
    AgentPiped,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionSnapshot {
    pub session_id: u32,
    pub command: Option<String>,
    pub running: bool,
    pub output: String,
    pub output_chars: usize,
    /// Present once the process has exited (or was killed: -1).
    pub exit_code: Option<i32>,
    pub kind: SessionKind,
    /// Heuristic: the last output line looks like an interactive prompt while
    /// the process is still alive. Advisory only.
    pub waiting_for_input: bool,
    /// Readiness scraped from this live session's output, never a port probe.
    pub preview_url: Option<String>,
    /// Orders this snapshot against output events delivered by another IPC path.
    pub preview_revision: u64,
}

pub struct SessionMeta {
    pub output: Mutex<String>,
    pub command: Mutex<Option<String>>,
    pub running: AtomicBool,
    pub exit_code: Mutex<Option<i32>>,
    /// Signalled exactly once, when the session's process exits (or is killed).
    pub exit_notify: tokio::sync::Notify,
    pub kind: SessionKind,
    /// Only `pty_spawn_run` sessions scrape preview URLs from output.
    pub scrape_preview: AtomicBool,
    preview_ready: Mutex<PreviewReadiness>,
    pub cwd: Mutex<Option<String>>,
    /// Reader threads that are still draining this session's output. An exit is not
    /// published while one is draining: the bytes the process wrote just before it
    /// exited are still in the pipe, and a caller that woke on the exit signal would
    /// read a short buffer.
    readers: AtomicUsize,
}

impl SessionMeta {
    fn new(kind: SessionKind) -> Self {
        Self {
            output: Mutex::new(String::new()),
            command: Mutex::new(None),
            running: AtomicBool::new(true),
            exit_code: Mutex::new(None),
            exit_notify: tokio::sync::Notify::new(),
            kind,
            scrape_preview: AtomicBool::new(false),
            preview_ready: Mutex::new(PreviewReadiness::default()),
            cwd: Mutex::new(None),
            readers: AtomicUsize::new(0),
        }
    }

    /// Register a reader thread that is about to drain this session's output.
    fn begin_reading(&self) {
        self.readers.fetch_add(1, Ordering::SeqCst);
    }

    /// Deregister a reader thread that has stopped draining.
    fn end_reading(&self) {
        self.readers.fetch_sub(1, Ordering::SeqCst);
    }

    /// Whether output can still arrive after the process itself has exited.
    pub fn draining(&self) -> bool {
        self.readers.load(Ordering::SeqCst) > 0
    }

    /// Wait, up to `timeout`, for the readers that are draining this session.
    pub fn await_drains(&self, timeout: std::time::Duration) {
        exit_status::await_drains(&self.readers, timeout);
    }

    fn append_output(&self, data: &str) {
        if let Ok(mut buf) = self.output.lock() {
            buf.push_str(data);
            crate::core::bounded_text::retain_tail(&mut buf, SESSION_OUTPUT_CAP);
        }
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    pub fn exit_code(&self) -> Option<i32> {
        self.exit_code.lock().ok().and_then(|g| *g)
    }

    /// Mark the session finished and wake every waiter. Idempotent: only the
    /// first caller records the exit code.
    pub fn mark_exited(&self, code: Option<i32>) {
        if let Ok(mut slot) = self.exit_code.lock() {
            if slot.is_none() {
                *slot = Some(code.unwrap_or(-1));
            }
        }
        self.running.store(false, Ordering::SeqCst);
        self.exit_notify.notify_waiters();
    }
}

fn tail_of(text: &str, tail_chars: usize) -> String {
    let count = text.chars().count();
    if count <= tail_chars {
        return text.to_string();
    }
    text.chars().skip(count - tail_chars).collect()
}

/// Heuristic detection of an interactive prompt at the end of output.
/// Used to tell the agent/UI a command is probably waiting for input.
pub fn looks_like_input_prompt(output: &str) -> bool {
    let tail: String = tail_of(output, 400);
    let last_line = tail
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("")
        .trim()
        .to_lowercase();
    if last_line.is_empty() {
        return false;
    }
    const ENDINGS: &[&str] = &[
        "(y/n)",
        "(y/n):",
        "[y/n]",
        "[y/n]:",
        "(yes/no)",
        "(yes/no):",
        "[yes/no]",
        "password:",
        "passphrase:",
        "username:",
        "login:",
        "press any key to continue",
        "press enter to continue",
        "overwrite?",
        "are you sure?",
        "continue?",
        "proceed?",
    ];
    if ENDINGS.iter().any(|e| last_line.ends_with(e)) {
        return true;
    }
    // Inquirer-style selection prompts ("? Pick a framework › …").
    if last_line.starts_with("? ") && (last_line.contains('›') || last_line.contains("❯")) {
        return true;
    }
    false
}

pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
    meta: Arc<SessionMeta>,
}

/// Agent command running as a plain subprocess with piped stdio. Non-TTY output
/// is cleaner for the model, and process exit gives a deterministic lifecycle.
pub struct PipedSession {
    child: Arc<Mutex<Option<std::process::Child>>>,
    stdin: Mutex<Option<std::process::ChildStdin>>,
    meta: Arc<SessionMeta>,
}

enum TerminationTarget {
    Pty {
        child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
        meta: Arc<SessionMeta>,
    },
    Piped {
        child: Arc<Mutex<Option<std::process::Child>>>,
        meta: Arc<SessionMeta>,
    },
}

impl TerminationTarget {
    fn from_pty(session: &PtySession) -> Self {
        Self::Pty {
            child: session.child.clone(),
            meta: session.meta.clone(),
        }
    }

    fn from_piped(session: &PipedSession) -> Self {
        Self::Piped {
            child: session.child.clone(),
            meta: session.meta.clone(),
        }
    }

    fn meta(&self) -> &Arc<SessionMeta> {
        match self {
            Self::Pty { meta, .. } | Self::Piped { meta, .. } => meta,
        }
    }

    fn poll(&self) -> std::io::Result<Option<i32>> {
        match self {
            Self::Pty { child, .. } => child
                .try_lock()
                .map_err(|_| std::io::Error::other("Terminal child is unavailable"))?
                .try_wait()
                .map(|status| status.map(|s| s.exit_code() as i32)),
            Self::Piped { child, .. } => child
                .try_lock()
                .map_err(|_| std::io::Error::other("Terminal child is unavailable"))?
                .as_mut()
                .ok_or_else(|| std::io::Error::other("Terminal child handle missing"))?
                .try_wait()
                .map(|status| status.map(|s| s.code().unwrap_or(-1))),
        }
    }

    fn terminate(&self) -> std::io::Result<()> {
        let timeout = std::time::Duration::from_secs(2);
        match self {
            Self::Pty { child, meta } => {
                let observed = exit_status::terminate(
                    child,
                    |child| {
                        child
                            .try_wait()
                            .map(|status| status.map(|s| s.exit_code() as i32))
                    },
                    |child| child.kill(),
                    timeout,
                )?;
                // A process that had already exited when Stop arrived was not killed, so its own
                // status is reported; one this call killed keeps the cancellation marker (-1),
                // which `mark_exited` then protects from a later collected status.
                meta.mark_exited(Some(if observed.killed { -1 } else { observed.code }));
            }
            Self::Piped { child, meta } => {
                let observed = exit_status::terminate(
                    child,
                    |slot| {
                        slot.as_mut()
                            .ok_or_else(|| std::io::Error::other("Terminal child handle missing"))?
                            .try_wait()
                            .map(|status| status.map(|s| s.code().unwrap_or(-1)))
                    },
                    |slot| {
                        slot.as_mut()
                            .ok_or_else(|| std::io::Error::other("Terminal child handle missing"))?
                            .kill()
                    },
                    timeout,
                )?;
                meta.mark_exited(Some(if observed.killed { -1 } else { observed.code }));
            }
        }
        Ok(())
    }
}

/// Callbacks fired from session reader/monitor threads so the agent layer can
/// forward output to its own (command-correlated) events.
#[derive(Clone)]
pub struct AgentSessionCallbacks {
    pub on_output: Arc<dyn Fn(u32, &str) + Send + Sync>,
    pub on_exit: Arc<dyn Fn(u32, i32) + Send + Sync>,
}

#[derive(Clone)]
pub struct PtyState {
    sessions: Arc<Mutex<HashMap<u32, PtySession>>>,
    piped_sessions: Arc<Mutex<HashMap<u32, PipedSession>>>,
    session_meta: Arc<Mutex<HashMap<u32, Arc<SessionMeta>>>>,
    next_id: Arc<Mutex<u64>>,
}

static SPAWN_LOCK: std::sync::LazyLock<Mutex<()>> = std::sync::LazyLock::new(|| Mutex::new(()));

impl PtyState {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            piped_sessions: Arc::new(Mutex::new(HashMap::new())),
            session_meta: Arc::new(Mutex::new(HashMap::new())),
            next_id: Arc::new(Mutex::new(1)),
        }
    }

    pub fn kill_all_sync(&self) {
        let (targets, failures) = self.termination_targets();
        for failure in failures {
            log::warn!("Could not enumerate a terminal session: {failure}");
        }
        for (id, target) in targets {
            let result = target
                .terminate()
                .map_err(AppError::from)
                .and_then(|()| self.release_terminated(id, target.meta()));
            if let Err(error) = result {
                log::warn!("Could not terminate terminal session {id}: {error}");
            }
        }
    }

    fn termination_target(
        &self,
        id: u32,
        owner: &Arc<SessionMeta>,
    ) -> Result<Option<TerminationTarget>, AppError> {
        let target = match owner.kind {
            SessionKind::AgentPiped => self
                .piped_sessions
                .lock()?
                .get(&id)
                .map(TerminationTarget::from_piped),
            SessionKind::AgentPty | SessionKind::UserShell => self
                .sessions
                .lock()?
                .get(&id)
                .map(TerminationTarget::from_pty),
        };
        Ok(target.filter(|target| Arc::ptr_eq(target.meta(), owner)))
    }

    /// Classify why an owned session no longer has a termination target, so a
    /// failed Stop can name the actual condition instead of one blanket message.
    fn termination_target_loss(&self, id: u32, owner: &Arc<SessionMeta>) -> OwnershipLoss {
        let recorded_owner = self
            .session_meta
            .lock()
            .ok()
            .and_then(|metas| metas.get(&id).map(|current| Arc::ptr_eq(current, owner)));
        ownership_loss(recorded_owner)
    }

    /// Every session that can be terminated, plus one message per registry that could not be
    /// read. A caller that has to stop an unknown number of sessions must report the registry it
    /// could not read: a partial sweep that stays silent about the sessions it never saw is the
    /// failure mode this enumeration exists to avoid.
    fn termination_targets(&self) -> (Vec<(u32, TerminationTarget)>, Vec<String>) {
        let mut targets = Vec::new();
        let mut failures = Vec::new();
        match self.sessions.lock() {
            Ok(sessions) => targets.extend(
                sessions
                    .iter()
                    .map(|(id, session)| (*id, TerminationTarget::from_pty(session))),
            ),
            Err(error) => failures.push(format!("PTY sessions: {error}")),
        }
        match self.piped_sessions.lock() {
            Ok(sessions) => targets.extend(
                sessions
                    .iter()
                    .map(|(id, session)| (*id, TerminationTarget::from_piped(session))),
            ),
            Err(error) => failures.push(format!("piped sessions: {error}")),
        }
        (targets, failures)
    }

    fn release_terminated(&self, id: u32, owner: &Arc<SessionMeta>) -> Result<(), AppError> {
        match owner.kind {
            SessionKind::AgentPiped => {
                let removed = {
                    let mut sessions = self.piped_sessions.lock()?;
                    crate::core::session_ownership::remove_owned(
                        &mut sessions,
                        id,
                        owner,
                        |session| &session.meta,
                    )
                };
                drop(removed);
            }
            SessionKind::AgentPty | SessionKind::UserShell => {
                let removed = {
                    let mut sessions = self.sessions.lock()?;
                    crate::core::session_ownership::remove_owned(
                        &mut sessions,
                        id,
                        owner,
                        |session| &session.meta,
                    )
                };
                drop(removed);
            }
        }
        Ok(())
    }

    pub fn mark_preview_scrape(&self, id: u32) {
        if let Ok(meta_map) = self.session_meta.lock() {
            if let Some(meta) = meta_map.get(&id) {
                meta.scrape_preview.store(true, Ordering::SeqCst);
                // A fast server can print its URL before spawn returns. Retain
                // that output-owned evidence for late or reattached renderers.
                if let Ok(output) = meta.output.lock() {
                    if let Some(url) = scrape_preview_url(&output) {
                        if let Ok(mut ready) = meta.preview_ready.lock() {
                            if ready.revision == 0 {
                                let _ = ready.record(url);
                            }
                        }
                    }
                }
            }
        }
    }

    pub fn set_session_command(&self, id: u32, command: String) {
        if let Ok(meta_map) = self.session_meta.lock() {
            if let Some(meta) = meta_map.get(&id) {
                if let Ok(mut cmd) = meta.command.lock() {
                    *cmd = Some(command);
                }
            }
        }
    }

    pub fn find_running_preview(&self, cwd: &str, command: &str) -> Option<u32> {
        let want_cwd = crate::core::paths::normalize_fs_path(cwd);
        let want_cmd = normalize_run_command(command);
        let ids: Vec<u32> = self
            .session_meta
            .lock()
            .ok()?
            .iter()
            .filter(|(_, meta)| meta.scrape_preview.load(Ordering::SeqCst))
            .map(|(id, _)| *id)
            .collect();
        for id in ids {
            if self.session_is_running(id) != Some(true) {
                continue;
            }
            let Some(meta) = self.session_meta(id) else {
                continue;
            };
            let cmd = meta
                .command
                .lock()
                .ok()
                .and_then(|c| c.clone())
                .unwrap_or_default();
            let stored_cwd = meta
                .cwd
                .lock()
                .ok()
                .and_then(|c| c.clone())
                .unwrap_or_default();
            if crate::core::paths::normalize_fs_path(&stored_cwd) == want_cwd
                && normalize_run_command(&cmd) == want_cmd
            {
                return Some(id);
            }
        }
        None
    }

    pub fn session_meta(&self, id: u32) -> Option<Arc<SessionMeta>> {
        self.session_meta.lock().ok()?.get(&id).cloned()
    }

    pub fn session_is_running(&self, id: u32) -> Option<bool> {
        let meta = self.session_meta(id)?;
        if !meta.is_running() {
            return Some(false);
        }
        if let Ok(Some(target)) = self.termination_target(id, &meta) {
            match target.poll() {
                Ok(Some(code)) => {
                    // The process is gone, but its readers may still be appending the bytes it
                    // wrote last, and a session that looks finished with a short buffer loses
                    // that output. Whoever drains the pipes publishes the exit (bounded), so
                    // until then the session keeps reporting as running rather than publishing
                    // an exit the output has not caught up with.
                    if meta.draining() {
                        return Some(true);
                    }
                    target.meta().mark_exited(Some(code));
                    return Some(false);
                }
                Ok(None) => return Some(true),
                // A contended or unreadable child status is not an exit; fall through to the
                // metadata below instead of failing the read.
                Err(_) => {}
            }
        }
        // The metadata is authoritative for the running state. Neither a registry that cannot
        // be read nor a child status that cannot be polled is an exit, and "status unavailable"
        // would block reading a terminal that is still tracked and stoppable; a poisoned or
        // contended lock therefore keeps the session reported as running.
        Some(meta.is_running())
    }

    pub fn read_session_output(
        &self,
        id: u32,
        tail_chars: usize,
    ) -> Result<TerminalSessionSnapshot, AppError> {
        let meta = self
            .session_meta(id)
            .ok_or_else(|| AppError::Message(format!("Terminal session {} not found", id)))?;

        // Resolve the running state first: this is what decides whether an exit is already
        // published, and the buffer must be read after it, or a session that just finished
        // would be reported as exited with the output it had before its last bytes arrived.
        let running = self
            .session_is_running(id)
            .ok_or_else(|| AppError::Message("Terminal process status is unavailable".into()))?;

        let full_output = meta
            .output
            .lock()
            .map(|buf| buf.clone())
            .unwrap_or_default();
        let output_chars = full_output.chars().count();
        let tail = tail_chars.max(500).min(50_000);
        let output = tail_of(&full_output, tail);
        let command = meta.command.lock().ok().and_then(|c| c.clone());
        let waiting_for_input = running && looks_like_input_prompt(&full_output);
        let preview_ready = meta.preview_ready.lock()?.clone();

        Ok(TerminalSessionSnapshot {
            session_id: id,
            command,
            running,
            output,
            output_chars,
            exit_code: meta.exit_code(),
            kind: meta.kind,
            waiting_for_input,
            preview_url: if running { preview_ready.url } else { None },
            preview_revision: preview_ready.revision,
        })
    }

    pub fn list_session_snapshots(&self) -> Vec<TerminalSessionSnapshot> {
        let mut ids: Vec<u32> = self
            .session_meta
            .lock()
            .map(|m| m.keys().copied().collect())
            .unwrap_or_default();
        ids.sort_unstable();
        ids.into_iter()
            .filter_map(|id| self.read_session_output(id, 500).ok())
            .collect()
    }

    pub fn write_to_session(&self, id: u32, data: &str) -> Result<(), AppError> {
        if let Ok(mut sessions) = self.sessions.lock() {
            if let Some(session) = sessions.get_mut(&id) {
                let mut writer = session
                    .writer
                    .lock()
                    .map_err(|e| AppError::Message(format!("PTY writer lock poisoned: {e}")))?;
                writer.write_all(data.as_bytes()).map_err(AppError::Io)?;
                writer.flush().map_err(AppError::Io)?;
                return Ok(());
            }
        }
        let piped = self.piped_sessions.lock()?;
        let session = piped
            .get(&id)
            .ok_or_else(|| AppError::Message(format!("Terminal session {} not found", id)))?;
        let mut stdin_guard = session
            .stdin
            .lock()
            .map_err(|_| AppError::Message("Terminal stdin lock failed".to_string()))?;
        let stdin = stdin_guard.as_mut().ok_or_else(|| {
            AppError::Message(format!("Terminal session {} has no open stdin", id))
        })?;
        stdin.write_all(data.as_bytes()).map_err(AppError::Io)?;
        stdin.flush().map_err(AppError::Io)?;
        Ok(())
    }

    /// Wait until the session exits, `max_wait` elapses, or `cancel` fires.
    /// Returns true if the session is finished when this returns.
    pub async fn wait_for_session_exit(
        &self,
        id: u32,
        max_wait: std::time::Duration,
        cancel: &CancellationToken,
    ) -> bool {
        let Some(meta) = self.session_meta(id) else {
            return false;
        };
        let deadline = tokio::time::Instant::now() + max_wait;
        loop {
            // Subscribe before re-checking state so an exit between the check
            // and the await cannot be missed.
            let notified = meta.exit_notify.notified();
            if !meta.is_running() || self.session_is_running(id) == Some(false) {
                return true;
            }
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                return false;
            }
            // PTY exits are detected lazily by try_wait, so cap each wait slice.
            let slice = remaining.min(std::time::Duration::from_millis(500));
            tokio::select! {
                _ = notified => {}
                _ = tokio::time::sleep(slice) => {}
                _ = cancel.cancelled() => { return !meta.is_running() || self.session_is_running(id) == Some(false); }
            }
        }
    }

    fn allocate_id(&self, client_id: Option<u32>) -> Result<u32, AppError> {
        let mut next = self.next_id.lock()?;
        crate::core::session_ownership::reserve_id(&mut next, client_id)
            .ok_or_else(|| AppError::Message("Terminal session ids exhausted".to_string()))
    }

    /// Drop metadata of old finished agent sessions so the maps do not grow
    /// without bound. Live sessions and user shells are never pruned.
    fn prune_finished_sessions(&self) {
        let Ok(mut meta_map) = self.session_meta.lock() else {
            return;
        };
        let mut finished: Vec<(u32, Arc<SessionMeta>)> = meta_map
            .iter()
            .filter(|(_, m)| !m.is_running() && m.kind != SessionKind::UserShell)
            .map(|(id, meta)| (*id, meta.clone()))
            .collect();
        if finished.len() <= MAX_FINISHED_SESSIONS {
            return;
        }
        finished.sort_unstable_by_key(|(id, _)| *id);
        let remove_count = finished.len() - MAX_FINISHED_SESSIONS;
        let to_remove: Vec<_> = finished.into_iter().take(remove_count).collect();
        for (id, _) in &to_remove {
            meta_map.remove(id);
        }
        drop(meta_map);
        for (id, owner) in to_remove {
            if let Err(error) = self.release_terminated(id, &owner) {
                log::warn!("Could not prune terminal session {id}: {error}");
            }
        }
    }
}

#[derive(Clone, Serialize)]
struct PtyOutput {
    id: u32,
    data: String,
}

#[derive(Clone, Serialize)]
struct PtyExit {
    id: u32,
    exit_code: i32,
}

/// Emitted when a background `pty_spawn_run` (or TCP probe) finds a live preview URL.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewReadyEvent {
    source: &'static str,
    revision: Option<u64>,
    pub id: u32,
    pub url: String,
}

/// Pull a localhost preview URL out of **dev-server** output (Next / Vite / etc.).
/// Ignores casual mentions of localhost (curl, docs, the marketing site).
fn scrape_preview_url(text: &str) -> Option<String> {
    let lower = text.to_ascii_lowercase();
    let looks_like_listen_banner = lower.contains("local:")
        || lower.contains("network:")
        || lower.contains("local url")
        || (lower.contains("vite") && lower.contains("ready"))
        || lower.contains("compiled successfully");
    if !looks_like_listen_banner {
        return None;
    }
    const MARKERS: &[&str] = &[
        "http://localhost:",
        "http://127.0.0.1:",
        "http://0.0.0.0:",
        "https://localhost:",
        "https://127.0.0.1:",
    ];
    let mut best: Option<(usize, String)> = None;
    for marker in MARKERS {
        let mut search_from = 0;
        while let Some(rel) = lower[search_from..].find(marker) {
            let start = search_from + rel;
            let rest = &text[start..];
            let end = rest
                .find(|c: char| {
                    c.is_whitespace()
                        || c < ' '
                        || c == '\u{1b}'
                        || c == '\''
                        || c == '"'
                        || c == ')'
                        || c == ']'
                        || c == ','
                        || c == '|'
                        || c == '<'
                })
                .unwrap_or(rest.len());
            let mut raw = rest[..end].trim_end_matches(['/', '#', '?']).to_string();
            // Keep path if present; normalize host for the iframe.
            if let Ok(mut u) = url::Url::parse(&raw) {
                let host = u.host_str().unwrap_or("127.0.0.1");
                if host == "0.0.0.0" || host == "localhost" {
                    let _ = u.set_host(Some("127.0.0.1"));
                }
                raw = u.to_string();
            }
            if best.as_ref().map(|(i, _)| start >= *i).unwrap_or(true) {
                best = Some((start, raw));
            }
            search_from = start + marker.len();
        }
    }
    best.map(|(_, u)| u)
}

fn preview_probe_candidates(command: &str) -> Vec<String> {
    let mut urls = Vec::new();
    let mut add = |port: u16| {
        let u = format!("http://127.0.0.1:{port}/");
        if !urls.contains(&u) {
            urls.push(u);
        }
    };
    // Explicit --port / -p in the start command.
    let re_ports = [
        ("--port", true),
        ("-p", true),
        ("--port=", false),
        ("-p=", false),
    ];
    for (flag, spaced) in re_ports {
        if let Some(idx) = command.find(flag) {
            let after = &command[idx + flag.len()..];
            let token = if spaced {
                after.split_whitespace().next().unwrap_or("")
            } else {
                after.split_whitespace().next().unwrap_or(after)
            };
            if let Ok(port) = token.trim().parse::<u16>() {
                add(port);
            }
        }
    }
    urls
}

async fn http_preview_serves(url: &str) -> bool {
    let Ok(client) = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(2))
        .timeout(std::time::Duration::from_millis(900))
        .no_proxy()
        .build()
    else {
        return false;
    };
    match client
        .get(url)
        .header("accept", "text/html,*/*")
        .send()
        .await
    {
        Ok(res) => {
            let code = res.status().as_u16();
            // Port is accepting HTTP. 4xx is still a real server (wrong path).
            code < 500
        }
        Err(_) => false,
    }
}

async fn tcp_preview_reachable(url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(url) else {
        return false;
    };
    let host = parsed.host_str().unwrap_or("127.0.0.1");
    let port = parsed.port_or_known_default().unwrap_or(80);
    let mut addrs = vec![format!("{host}:{port}")];
    let lower = host.to_ascii_lowercase();
    if lower == "localhost" || lower == "0.0.0.0" {
        addrs.push(format!("127.0.0.1:{port}"));
    }
    for addr in addrs {
        let connect = tokio::net::TcpStream::connect(addr);
        match tokio::time::timeout(std::time::Duration::from_millis(350), connect).await {
            Ok(Ok(_)) => return true,
            _ => continue,
        }
    }
    false
}

async fn probe_preview_until_ready(app: AppHandle, id: u32, command: String) {
    let candidates = preview_probe_candidates(&command);
    if candidates.is_empty() {
        log::info!(
            "[preview] tcp probe skip id={} (no port in command; wait for this PTY's URL scrape)",
            id
        );
        return;
    }
    log::info!(
        "[preview] tcp probe start id={} candidates={:?}",
        id,
        candidates
    );
    for attempt in 0..200 {
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        for url in &candidates {
            if tcp_preview_reachable(url).await && http_preview_serves(url).await {
                log::info!(
                    "[preview] http READY id={} url={} attempt={}",
                    id,
                    url,
                    attempt
                );
                let _ = app.emit(
                    "preview-ready",
                    PreviewReadyEvent {
                        source: "probe",
                        revision: None,
                        id,
                        url: url.clone(),
                    },
                );
                return;
            }
        }
        if attempt % 20 == 0 {
            log::info!(
                "[preview] tcp still waiting id={} attempt={} ({}ms)",
                id,
                attempt,
                attempt * 250
            );
        }
    }
    log::warn!("[preview] tcp probe TIMEOUT id={} after ~50s", id);
}

#[derive(Clone, Serialize)]
pub struct ShellProfile {
    id: String,
    label: String,
    path: String,
}

fn command_exists(command: &str) -> Option<String> {
    #[cfg(windows)]
    {
        let output = std::process::Command::new("where")
            .arg(command)
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty() && std::path::Path::new(line).exists())
            .map(ToString::to_string)
    }
    #[cfg(not(windows))]
    {
        let output = std::process::Command::new("which")
            .arg(command)
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())
            .map(ToString::to_string)
    }
}

/// Dynamically find Git Bash by locating the system git executable.
///
/// Windows-only: the search is built entirely from `ProgramFiles` and
/// `bash.exe`. On POSIX there is no Git Bash to find, so the unix arm is a
/// stub and callers fall back to the system `bash`.
#[cfg(windows)]
fn find_git_bash() -> Option<String> {
    // Try environment variables first
    let prog_files =
        std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".to_string());
    let common_paths = [
        format!(r"{}\Git\bin\bash.exe", prog_files),
        format!(r"{}\Git\usr\bin\bash.exe", prog_files),
        r"C:\Program Files (x86)\Git\bin\bash.exe".to_string(),
        r"C:\Program Files (x86)\Git\usr\bin\bash.exe".to_string(),
    ];

    for path in &common_paths {
        if std::path::Path::new(path).exists() {
            return Some(path.clone());
        }
    }

    if let Ok(git_path) = crate::core::git_bin::git_executable() {
        let git_path = std::path::Path::new(git_path);
        if git_path.exists() {
            if let Some(parent) = git_path.parent() {
                let git_root = if parent
                    .file_name()
                    .map(|f| f == "cmd" || f == "bin")
                    .unwrap_or(false)
                {
                    parent.parent()
                } else {
                    Some(parent)
                };

                if let Some(root) = git_root {
                    let candidates = [
                        root.join("bin").join("bash.exe"),
                        root.join("usr").join("bin").join("bash.exe"),
                    ];
                    for path in &candidates {
                        if path.exists() {
                            return Some(path.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }
    }

    None
}

#[cfg(not(windows))]
fn find_git_bash() -> Option<String> {
    None
}

/// Name of the interactive shell to run when the frontend does not pick one.
///
/// This used to be the literal `"powershell.exe"`, which made the terminal
/// panel fail to spawn anywhere that is not Windows. Prefer the user's own
/// login shell on POSIX, and only then fall back through the usual suspects.
pub fn default_interactive_shell() -> String {
    #[cfg(windows)]
    {
        "powershell.exe".to_string()
    }
    #[cfg(not(windows))]
    {
        if let Ok(shell) = std::env::var("SHELL") {
            if !shell.trim().is_empty() {
                return shell;
            }
        }
        for candidate in ["/bin/zsh", "/bin/bash", "/usr/bin/fish", "/bin/sh"] {
            if std::path::Path::new(candidate).exists() {
                return candidate.to_string();
            }
        }
        "/bin/sh".to_string()
    }
}

pub fn pty_available_shells() -> Result<Vec<ShellProfile>, AppError> {
    let mut shells = Vec::new();

    // POSIX shells. Without this the picker offered only powershell/cmd/Git
    // Bash/WSL, so on macOS and Linux it came back empty.
    #[cfg(not(windows))]
    {
        let candidates = [
            ("zsh", "Zsh"),
            ("bash", "Bash"),
            ("fish", "Fish"),
            ("sh", "sh"),
        ];
        for (id, label) in candidates {
            if let Some(path) = command_exists(id) {
                shells.push(ShellProfile {
                    id: id.to_string(),
                    label: label.to_string(),
                    path,
                });
            }
        }
    }

    if let Some(path) = command_exists("pwsh.exe").or_else(|| command_exists("pwsh")) {
        shells.push(ShellProfile {
            id: "pwsh".to_string(),
            label: "PowerShell 7".to_string(),
            path,
        });
    }

    if let Some(path) = command_exists("powershell.exe").or_else(|| command_exists("powershell")) {
        shells.push(ShellProfile {
            id: "powershell".to_string(),
            label: "Windows PowerShell".to_string(),
            path,
        });
    }

    if let Some(path) = command_exists("cmd.exe").or_else(|| command_exists("cmd")) {
        shells.push(ShellProfile {
            id: "cmd".to_string(),
            label: "Command Prompt".to_string(),
            path,
        });
    }

    if let Some(path) = find_git_bash() {
        shells.push(ShellProfile {
            id: "gitbash".to_string(),
            label: "Git Bash".to_string(),
            path,
        });
    }

    if let Some(path) = command_exists("wsl.exe").or_else(|| command_exists("wsl")) {
        shells.push(ShellProfile {
            id: "wsl".to_string(),
            label: "WSL".to_string(),
            path,
        });
    }

    Ok(shells)
}

pub async fn pty_spawn(
    app: AppHandle,
    state: tauri::State<'_, PtyState>,
    cwd: Option<String>,
    shell: Option<String>,
    client_id: Option<u32>,
    rows: u16,
    cols: u16,
) -> Result<u32, AppError> {
    spawn_session(&app, &state, cwd, shell, client_id, rows, cols).await
}

/// Spawn a PTY session running an interactive shell (user terminal panel).
pub async fn spawn_session(
    app: &AppHandle,
    state: &PtyState,
    cwd: Option<String>,
    shell: Option<String>,
    client_id: Option<u32>,
    rows: u16,
    cols: u16,
) -> Result<u32, AppError> {
    let shell_name = shell
        .unwrap_or_else(default_interactive_shell)
        .to_lowercase();

    let cmd = if shell_name.contains("bash") || shell_name.contains("git") {
        let bash_path = find_git_bash().unwrap_or_else(|| {
            if cfg!(windows) {
                "bash.exe".to_string()
            } else {
                "bash".to_string()
            }
        });
        log::info!("Spawning Git Bash from: {}", bash_path);
        let mut builder = CommandBuilder::new(&bash_path);
        builder.arg("-l"); // --login
        builder.arg("-i"); // interactive
        builder
    } else if shell_name == "wsl" || shell_name.contains("wsl") {
        let mut wsl = CommandBuilder::new("wsl.exe");
        wsl.arg("--cd");
        wsl.arg("~");
        wsl
    } else if shell_name == "pwsh" {
        let mut ps = CommandBuilder::new("pwsh.exe");
        ps.arg("-NoLogo");
        ps.arg("-NoExit");
        ps
    } else if shell_name.contains("powershell") || shell_name.contains("pwsh") {
        let mut ps = CommandBuilder::new("powershell.exe");
        ps.arg("-NoLogo");
        ps.arg("-NoProfile");
        ps.arg("-NoExit");
        ps
    } else if shell_name.contains("cmd") {
        let mut cmd_exe = CommandBuilder::new("cmd.exe");
        cmd_exe.arg("/Q"); // quiet
        cmd_exe
    } else if cfg!(windows) {
        CommandBuilder::new(&shell_name)
    } else {
        // POSIX shells are run as login + interactive, matching the profiles
        // `pty_available_shells` offers, so rc files load and jobs control works.
        let mut posix = CommandBuilder::new(&shell_name);
        posix.arg("-l");
        posix.arg("-i");
        posix
    };

    spawn_pty_with_command(
        app,
        state,
        cmd,
        cwd,
        client_id,
        rows,
        cols,
        SessionKind::UserShell,
        None,
    )
    .await
}

/// Ensure Next/Vite-style dev servers bind on IPv4 loopback so TCP probe + iframe
/// work on Windows. Prefer `--hostname` (never bare `-H` after `--`) so shell
/// joining cannot collapse `-- -H` into the broken `---H`.
fn node_module_bin_dirs(cwd: &str) -> Vec<PathBuf> {
    let mut current = PathBuf::from(cwd);
    let mut bins = Vec::new();
    for _ in 0..8 {
        let bin = current.join("node_modules").join(".bin");
        if bin.is_dir() {
            bins.push(bin);
        }
        match current.parent() {
            Some(parent) if parent != current.as_path() => current = parent.to_path_buf(),
            _ => break,
        }
    }
    bins
}

fn common_node_bin_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let mut push_if_dir = |path: PathBuf| {
        if path.is_dir() && !dirs.contains(&path) {
            dirs.push(path);
        }
    };
    push_if_dir(PathBuf::from(r"C:\Program Files\nodejs"));
    push_if_dir(PathBuf::from(r"C:\Program Files (x86)\nodejs"));
    if let Ok(appdata) = std::env::var("APPDATA") {
        push_if_dir(PathBuf::from(appdata).join("npm"));
    }
    // Homebrew (both Apple Silicon and Intel prefixes) and the usual
    // system-wide locations. nvm/fnm/asdf are already covered by `PATH` via
    // `join_path_dirs`, so they are deliberately not hardcoded here.
    push_if_dir(PathBuf::from("/opt/homebrew/bin"));
    push_if_dir(PathBuf::from("/usr/local/bin"));
    push_if_dir(PathBuf::from("/usr/bin"));
    dirs
}

fn join_path_dirs(mut dirs: Vec<PathBuf>, existing: Option<&OsStr>) -> Option<OsString> {
    if let Some(existing) = existing {
        for dir in std::env::split_paths(existing) {
            if !dirs.contains(&dir) {
                dirs.push(dir);
            }
        }
    }
    if dirs.is_empty() {
        return existing.map(OsStr::to_os_string);
    }
    std::env::join_paths(&dirs).ok()
}

/// Keep Windows user/machine PATH from portable-pty, then prepend workspace
/// `node_modules/.bin` and common Node toolchain dirs (`pnpm`, `npm`, fnm).
fn apply_pty_path(cmd: &mut CommandBuilder, cwd: Option<&str>) {
    let mut extras = Vec::new();
    if let Some(dir) = cwd.filter(|value| !value.is_empty()) {
        extras.extend(node_module_bin_dirs(dir));
    }
    extras.extend(common_node_bin_dirs());
    let extra_count = extras.len();
    let existing = cmd.get_env("PATH").map(OsStr::to_os_string);
    match join_path_dirs(extras, existing.as_deref()) {
        Some(joined) => {
            if extra_count > 0 {
                log::info!("[pty] prepended {extra_count} Node toolchain dirs to PATH");
            }
            cmd.env("PATH", joined);
        }
        None => log::warn!("[pty] failed to join Node toolchain PATH"),
    }
}

fn with_ipv4_hostname(command: &str) -> String {
    let t = command.trim();
    let lower = t.to_ascii_lowercase();
    if lower.contains("--hostname")
        || lower.contains(" -h ")
        || lower.contains(" -h=")
        || lower.ends_with(" -h")
        || lower.contains("---h")
    {
        // Repair a previously collapsed `-- -H` → `---H`.
        if lower.contains("---h") {
            return t
                .replace("---H", "-- --hostname")
                .replace("---h", "-- --hostname");
        }
        return t.to_string();
    }
    let npm_dev = regex_is_package_dev(t);
    if npm_dev {
        return format!("{t} -- --hostname 127.0.0.1");
    }
    if lower.contains("next dev") {
        return format!("{t} --hostname 127.0.0.1");
    }
    t.to_string()
}

fn normalize_run_command(command: &str) -> String {
    with_ipv4_hostname(command.trim())
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

static PREVIEW_RUN_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn regex_is_package_dev(command: &str) -> bool {
    let lower = command.to_ascii_lowercase();
    for pm in ["npm ", "pnpm ", "yarn ", "bun "] {
        if let Some(rest) = lower.strip_prefix(pm) {
            let rest = rest.trim_start();
            if rest.starts_with("run dev") || rest.starts_with("dev") {
                return true;
            }
        }
    }
    false
}

/// Spawn an agent command as the *direct child* of a fresh PTY. Process exit ==
/// command completion, so `running`/`exit_code` are accurate — unlike the old
/// approach of writing the command into a `-NoExit` shell whose process never
/// exited. Used for dev servers / watch tasks that need a TTY and stay alive.
///
/// On Windows we use `cmd.exe /D /S /C "<cmd>"` so `npm.cmd` resolves and the
/// full command string (including `-- --hostname …`) is preserved.
pub async fn spawn_agent_pty_command(
    app: &AppHandle,
    state: &PtyState,
    command: &str,
    cwd: &str,
    callbacks: Option<AgentSessionCallbacks>,
) -> Result<u32, AppError> {
    let command = with_ipv4_hostname(command);
    log::info!(
        "[preview] spawn_agent_pty_command cwd={} cmd={:?} bytes={:?}",
        cwd,
        command,
        command.as_bytes()
    );
    let cmd = if cfg!(target_os = "windows") {
        let mut c = CommandBuilder::new("cmd.exe");
        // /D = skip AutoRun, /S = strip quotes around /C string predictably
        c.arg("/D");
        c.arg("/S");
        c.arg("/C");
        // One argument; portable_pty will quote it for CreateProcess.
        c.arg(&command);
        c
    } else {
        let mut c = CommandBuilder::new("sh");
        c.arg("-c");
        c.arg(&command);
        c
    };
    let id = spawn_pty_with_command(
        app,
        state,
        cmd,
        Some(cwd.to_string()),
        None,
        32,
        120,
        SessionKind::AgentPty,
        callbacks,
    )
    .await?;
    state.set_session_command(id, command);
    state.prune_finished_sessions();
    Ok(id)
}

/// Spawn a background run command (dev server) as the PTY child, start TCP
/// probing in Rust, and return the session id. Used by Run + Design Mode.
pub async fn pty_spawn_run(
    app: AppHandle,
    state: tauri::State<'_, PtyState>,
    cwd: String,
    command: String,
) -> Result<u32, AppError> {
    let _guard = PREVIEW_RUN_LOCK.lock().await;
    let trimmed = with_ipv4_hostname(command.trim());
    if trimmed.is_empty() {
        return Err(AppError::Message("Empty run command".into()));
    }
    let cwd = crate::core::paths::spawn_cwd(&cwd);
    if let Some(id) = state.find_running_preview(&cwd, &trimmed) {
        log::info!(
            "[preview] pty_spawn_run reuse id={} cwd={} cmd={:?}",
            id,
            cwd,
            trimmed
        );
        return Ok(id);
    }
    if let Ok(path) = std::env::var("PATH") {
        let has_node = path
            .split(';')
            .any(|p| p.to_ascii_lowercase().contains("node"));
        let prefix: String = path.chars().take(200).collect();
        log::info!(
            "[preview] pty_spawn_run PATH_has_node={} PATH~={}",
            has_node,
            prefix
        );
    } else {
        log::warn!("[preview] pty_spawn_run: PATH unset");
    }
    log::info!("[preview] pty_spawn_run cwd={} cmd={:?}", cwd, trimmed);

    let id = spawn_agent_pty_command(&app, &state, &trimmed, &cwd, None).await?;
    state.mark_preview_scrape(id);
    log::info!("[preview] pty_spawn_run spawned id={}", id);

    let app_probe = app.clone();
    let cmd_probe = trimmed.clone();
    tauri::async_runtime::spawn(async move {
        probe_preview_until_ready(app_probe, id, cmd_probe).await;
    });

    Ok(id)
}

/// Return buffered PTY output so the Terminal UI can attach late and still
/// show everything that printed while the panel was closed.
pub async fn pty_read_output(
    state: tauri::State<'_, PtyState>,
    id: u32,
    tail_chars: Option<usize>,
) -> Result<TerminalSessionSnapshot, AppError> {
    let tail = tail_chars
        .unwrap_or(SESSION_OUTPUT_CAP)
        .min(SESSION_OUTPUT_CAP);
    log::info!("[preview] pty_read_output id={} tail={}", id, tail);
    let snap = state.read_session_output(id, tail)?;
    log::info!(
        "[preview] pty_read_output id={} chars={} running={}",
        id,
        snap.output_chars,
        snap.running
    );
    Ok(snap)
}

#[allow(clippy::too_many_arguments)]
async fn spawn_pty_with_command(
    app: &AppHandle,
    state: &PtyState,
    mut cmd: CommandBuilder,
    cwd: Option<String>,
    client_id: Option<u32>,
    rows: u16,
    cols: u16,
    kind: SessionKind,
    callbacks: Option<AgentSessionCallbacks>,
) -> Result<u32, AppError> {
    let _spawn_guard = SPAWN_LOCK.lock()?;
    let id = state.allocate_id(client_id)?;
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    if let Some(ref dir) = cwd {
        if !dir.is_empty() {
            let spawn_dir = crate::core::paths::spawn_cwd(dir);
            log::info!("Setting PTY CWD to: {}", spawn_dir);
            cmd.cwd(&spawn_dir);
            apply_pty_path(&mut cmd, Some(&spawn_dir));
        } else {
            log::warn!("PTY CWD is empty string, falling back to process default");
            apply_pty_path(&mut cmd, None);
        }
    } else {
        apply_pty_path(&mut cmd, None);
    }

    cmd.env("TERM", "xterm-256color");
    cmd.env("CLAW_TERMINAL", "1");

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| AppError::Message(e.to_string()))?;
    let writer = Arc::new(Mutex::new(
        pair.master
            .take_writer()
            .map_err(|e| AppError::Message(e.to_string()))?,
    ));

    let meta = Arc::new(SessionMeta::new(kind));
    if let Some(ref dir) = cwd {
        if !dir.is_empty() {
            if let Ok(mut slot) = meta.cwd.lock() {
                *slot = Some(crate::core::paths::spawn_cwd(dir));
            }
        }
    }

    let child;
    {
        let mut sessions = state.sessions.lock()?;
        let mut meta_map = state.session_meta.lock()?;
        if sessions.contains_key(&id) || meta_map.contains_key(&id) {
            return Err(AppError::Message(
                "Terminal session id is already in use".to_string(),
            ));
        }
        child = Arc::new(Mutex::new(
            pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?,
        ));
        meta_map.insert(id, meta.clone());
        sessions.insert(
            id,
            PtySession {
                master: pair.master,
                writer: writer.clone(),
                child: child.clone(),
                meta: meta.clone(),
            },
        );
    }

    // portable-pty 0.9 ConPTY uses PSEUDOCONSOLE_INHERIT_CURSOR: it emits
    // ESC[6n (DSR) on startup and blocks the child until the host replies
    // with ESC[1;1R (CPR). Without this reply, npm never starts — the only
    // output is those 4 bytes. See microsoft/terminal#1810, turborepo#11816.
    #[cfg(windows)]
    {
        if let Ok(mut w) = writer.lock() {
            match w.write_all(b"\x1b[1;1R") {
                Ok(()) => {
                    let _ = w.flush();
                    log::info!("[pty] ConPTY DSR reply ESC[1;1R");
                }
                Err(e) => log::warn!("[pty] ConPTY DSR reply failed: {e}"),
            }
        }
    }

    // Reader thread: stream PTY output to the terminal panel (and agent callbacks).
    //
    // The drain is registered here, before the thread is scheduled: a child that exits
    // immediately must not be reported as finished while the reader it needs in order to
    // publish its last output has not started yet.
    //
    // Nothing else may end this drain. A Stop publishes the session's own status (see
    // `terminate`) and leaves this loop alone: ending it early - it used to check a session
    // cancellation token at the top of every iteration - drops the bytes the process had
    // already written but the reader had not read yet, which is the tail of a stopped
    // command's output. The loop ends at end of file or on a read error, which is what a
    // killed child produces once its last writer is gone; a descendant that keeps the PTY
    // open keeps this reader blocked, and that is the documented boundary for process trees
    // rather than a reason to discard output.
    meta.begin_reading();
    let session_id = id;
    let app_for_thread = app.clone();
    #[allow(unused_variables)]
    let writer_for_reader = writer;
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    #[cfg(windows)]
                    if buf[..n].windows(4).any(|w| w == b"\x1b[6n") {
                        if let Ok(mut w) = writer_for_reader.lock() {
                            let _ = w.write_all(b"\x1b[1;1R");
                            let _ = w.flush();
                            log::info!("[pty] ConPTY reactive DSR reply id={}", session_id);
                        }
                    }
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    meta.append_output(&data);
                    if meta.scrape_preview.load(Ordering::SeqCst) {
                        let preview: String = data.chars().take(160).collect();
                        let hex: Vec<String> = buf[..n.min(32)]
                            .iter()
                            .map(|b| format!("{b:02x}"))
                            .collect();
                        log::info!(
                            "[preview] pty {} out ({}b) hex={} text={}",
                            session_id,
                            n,
                            hex.join(" "),
                            preview.replace('\n', "\\n").replace('\r', "\\r")
                        );
                        if let Some(url) = scrape_preview_url(&data) {
                            let revision = meta
                                .preview_ready
                                .lock()
                                .ok()
                                .and_then(|mut ready| ready.record(url.clone()));
                            log::info!("[preview] pty {} scraped url {}", session_id, url);
                            crate::agent::tools::page_shot::remember_preview_url(&url);
                            if let Some(revision) = revision {
                                let _ = app_for_thread.emit(
                                    "preview-ready",
                                    PreviewReadyEvent {
                                        source: "output",
                                        revision: Some(revision),
                                        id: session_id,
                                        url,
                                    },
                                );
                            }
                        }
                    }
                    if let Some(cb) = &callbacks {
                        (cb.on_output)(session_id, &data);
                    }
                    let _ = app_for_thread.emit(
                        "pty-output",
                        PtyOutput {
                            id: session_id,
                            data,
                        },
                    );
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }
        // The pipe is drained: from here the exit this thread publishes describes a
        // complete buffer.
        meta.end_reading();
        let observed = exit_status::wait_for_exit(&child, |child| {
            child
                .try_wait()
                .map(|status| status.map(|status| status.exit_code() as i32))
        });
        let observed = match observed {
            Ok(code) => code,
            Err(error) => {
                log::warn!("Could not collect PTY exit status for session {session_id}: {error}");
                return;
            }
        };
        meta.mark_exited(Some(observed));
        // A concurrent explicit Stop may already have recorded cancellation.
        let exit_code = meta.exit_code().unwrap_or(-1);
        if let Some(cb) = &callbacks {
            (cb.on_exit)(session_id, exit_code);
        }
        let _ = app_for_thread.emit(
            "pty-exit",
            PtyExit {
                id: session_id,
                exit_code,
            },
        );
    });

    Ok(id)
}

/// Spawn an agent command as a piped subprocess registered as a terminal session.
/// This is the default engine for one-shot commands: clean non-TTY output for the
/// model, deterministic exit codes, and the same session tools (read/wait/kill)
/// as PTY sessions.
pub fn spawn_piped_session(
    state: &PtyState,
    command: &str,
    cwd: &str,
    callbacks: Option<AgentSessionCallbacks>,
) -> Result<u32, AppError> {
    use std::process::{Command as StdCommand, Stdio};

    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = StdCommand::new("powershell");
        c.args(["-NoProfile", "-NonInteractive", "-Command", command]);
        c
    } else {
        let mut c = StdCommand::new("sh");
        c.args(["-c", command]);
        c
    };

    #[cfg(windows)]
    crate::core::process::hide_console(&mut cmd);
    crate::core::process::apply_trusted_binary_env(&mut cmd);

    let id = state.allocate_id(None)?;
    let mut piped = state.piped_sessions.lock()?;
    let mut meta_map = state.session_meta.lock()?;
    if piped.contains_key(&id) || meta_map.contains_key(&id) {
        return Err(AppError::Message(
            "Terminal session id is already in use".to_string(),
        ));
    }

    let mut child = cmd
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Message(format!("Failed to spawn command: {}", e)))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdin = child.stdin.take();

    let meta = Arc::new(SessionMeta::new(SessionKind::AgentPiped));
    if let Ok(mut cmd_slot) = meta.command.lock() {
        *cmd_slot = Some(command.to_string());
    }
    let child_slot = Arc::new(Mutex::new(Some(child)));

    meta_map.insert(id, meta.clone());
    piped.insert(
        id,
        PipedSession {
            child: child_slot.clone(),
            stdin: Mutex::new(stdin),
            meta: meta.clone(),
        },
    );
    drop(meta_map);
    drop(piped);

    // Reader threads: drain pipes into the session buffer + callbacks. The
    // monitor below waits for them before it reports the exit, so a finished
    // process is not announced while its last output is still in the pipe.
    for pipe in [stdout.map(PipeSource::Out), stderr.map(PipeSource::Err)]
        .into_iter()
        .flatten()
    {
        let meta_r = meta.clone();
        let cb = callbacks.clone();
        meta.begin_reading();
        thread::spawn(move || {
            let mut reader: Box<dyn Read + Send> = match pipe {
                PipeSource::Out(o) => Box::new(o),
                PipeSource::Err(e) => Box::new(e),
            };
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        meta_r.append_output(&data);
                        if let Some(cb) = &cb {
                            (cb.on_output)(id, &data);
                        }
                    }
                }
            }
            meta_r.end_reading();
        });
    }

    // Monitor thread: observe exit without holding the child lock while waiting,
    // so kill_session can always take the lock and terminate the process.
    let meta_m = meta;
    let cb_exit = callbacks;
    thread::spawn(move || loop {
        let status = {
            let Ok(mut guard) = child_slot.lock() else {
                break;
            };
            match guard.as_mut() {
                Some(child) => match child.try_wait() {
                    Ok(Some(status)) => Some(status.code().unwrap_or(-1)),
                    Ok(None) => None,
                    Err(error) => {
                        log::warn!("Could not collect piped exit status for session {id}: {error}");
                        break;
                    }
                },
                None => {
                    log::warn!("Terminal child handle missing for session {id}");
                    break;
                }
            }
        };
        if let Some(code) = status {
            // The child is gone, but its readers own the bytes it wrote last: give
            // them the chance to finish appending before the session looks
            // finished, so `exit_code`/`on_exit` never race a truncated buffer.
            meta_m.await_drains(PIPE_DRAIN_TIMEOUT);
            meta_m.mark_exited(Some(code));
            if let Some(cb) = &cb_exit {
                (cb.on_exit)(id, code);
            }
            break;
        }
        thread::sleep(std::time::Duration::from_millis(100));
    });

    state.prune_finished_sessions();
    Ok(id)
}

enum PipeSource {
    Out(std::process::ChildStdout),
    Err(std::process::ChildStderr),
}

pub async fn pty_write(
    state: tauri::State<'_, PtyState>,
    id: u32,
    data: String,
) -> Result<(), AppError> {
    {
        let mut sessions = state.sessions.lock()?;
        if let Some(session) = sessions.get_mut(&id) {
            let mut writer = session
                .writer
                .lock()
                .map_err(|e| AppError::Message(format!("PTY writer lock poisoned: {e}")))?;
            writer
                .write_all(data.as_bytes())
                .map_err(|e| AppError::Io(e))?;
            writer.flush().map_err(|e| AppError::Io(e))?;
            return Ok(());
        }
    }
    let piped = state.piped_sessions.lock()?;
    let session = piped
        .get(&id)
        .ok_or(AppError::Message("Session not found".to_string()))?;
    let mut stdin = session
        .stdin
        .lock()
        .map_err(|e| AppError::Message(format!("Piped stdin lock poisoned: {e}")))?;
    let writer = stdin
        .as_mut()
        .ok_or(AppError::Message("Session stdin is closed".to_string()))?;
    writer
        .write_all(data.as_bytes())
        .map_err(|e| AppError::Io(e))?;
    writer.flush().map_err(|e| AppError::Io(e))?;
    Ok(())
}

pub async fn pty_resize(
    state: tauri::State<'_, PtyState>,
    id: u32,
    rows: u16,
    cols: u16,
) -> Result<(), AppError> {
    let sessions = state.sessions.lock()?;
    let session = sessions
        .get(&id)
        .ok_or(AppError::Message("Session not found".to_string()))?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| AppError::Message(e.to_string()))?;
    Ok(())
}

pub async fn pty_kill(state: tauri::State<'_, PtyState>, id: u32) -> Result<(), AppError> {
    kill_session(&state, id).await
}

pub async fn kill_session(state: &PtyState, id: u32) -> Result<(), AppError> {
    let owner = state.session_meta.lock()?.get(&id).cloned();
    if let Some(owner) = owner {
        kill_owned_session(state, id, &owner).await?;
    }
    Ok(())
}

pub async fn kill_owned_session(
    state: &PtyState,
    id: u32,
    owner: &Arc<SessionMeta>,
) -> Result<(), AppError> {
    match state.termination_target(id, owner)? {
        Some(target) => terminate_and_release(state, id, target).await,
        None if owner.is_running() => Err(AppError::Message(format!(
            "Terminal ownership changed before exit could be confirmed: {}",
            ownership_loss_note(state.termination_target_loss(id, owner))
        ))),
        None => Ok(()),
    }
}

async fn terminate_and_release(
    state: &PtyState,
    id: u32,
    target: TerminationTarget,
) -> Result<(), AppError> {
    let state = state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        target.terminate()?;
        state.release_terminated(id, target.meta())
    })
    .await
    .map_err(|_| AppError::Message("Terminal cleanup could not be confirmed".to_string()))?
}

pub async fn pty_kill_all(state: tauri::State<'_, PtyState>) -> Result<(), AppError> {
    let (targets, mut failures) = state.termination_targets();
    for (id, target) in targets {
        if let Err(error) = terminate_and_release(&state, id, target).await {
            failures.push(format!("session {id}: {error}"));
        }
    }
    // Aggregate: the first failure used to be the only one reported, which hid the
    // sessions that still needed a stop.
    match crate::core::session_ownership::aggregate_cleanup_failures(failures) {
        Some(message) => Err(AppError::Message(message)),
        None => Ok(()),
    }
}

#[cfg(test)]
mod scrape_tests {
    use super::*;

    #[test]
    fn uncertain_piped_termination_keeps_both_registries_for_retry() {
        let state = PtyState::new();
        let meta = Arc::new(SessionMeta::new(SessionKind::AgentPiped));
        state.session_meta.lock().unwrap().insert(7, meta.clone());
        state.piped_sessions.lock().unwrap().insert(
            7,
            PipedSession {
                child: Arc::new(Mutex::new(None)),
                stdin: Mutex::new(None),
                meta: meta.clone(),
            },
        );
        state.kill_all_sync();
        assert!(state.piped_sessions.lock().unwrap().contains_key(&7));
        assert!(state.session_meta.lock().unwrap().contains_key(&7));
        assert!(meta.is_running());
        assert_eq!(meta.exit_code(), None);
        // A child status that cannot be polled is not an exit: the metadata stays
        // authoritative and the session keeps reporting as running.
        assert_eq!(state.session_is_running(7), Some(true));
    }

    #[test]
    fn completed_cleanup_does_not_remove_a_replacement_native_session() {
        let state = PtyState::new();
        let old = Arc::new(SessionMeta::new(SessionKind::AgentPiped));
        old.mark_exited(Some(-1));
        let replacement = Arc::new(SessionMeta::new(SessionKind::AgentPiped));
        state.piped_sessions.lock().unwrap().insert(
            7,
            PipedSession {
                child: Arc::new(Mutex::new(None)),
                stdin: Mutex::new(None),
                meta: replacement.clone(),
            },
        );
        state.release_terminated(7, &old).unwrap();
        assert!(Arc::ptr_eq(
            &state.piped_sessions.lock().unwrap().get(&7).unwrap().meta,
            &replacement
        ));
        assert!(state.termination_target(7, &old).unwrap().is_none());
        assert!(state.termination_target(7, &replacement).unwrap().is_some());
    }

    #[test]
    #[cfg(unix)]
    fn kill_all_can_release_piped_handles_even_if_the_pty_registry_is_poisoned() {
        let state = PtyState::new();
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = state.sessions.lock().unwrap();
            panic!("poison fixture");
        }));
        let mut child = std::process::Command::new("sh")
            .args(["-c", "exit 7"])
            .spawn()
            .unwrap();
        assert_eq!(child.wait().unwrap().code(), Some(7));
        let meta = Arc::new(SessionMeta::new(SessionKind::AgentPiped));
        state.session_meta.lock().unwrap().insert(7, meta.clone());
        state.piped_sessions.lock().unwrap().insert(
            7,
            PipedSession {
                child: Arc::new(Mutex::new(Some(child))),
                stdin: Mutex::new(None),
                meta: meta.clone(),
            },
        );
        state.kill_all_sync();
        assert!(!state.piped_sessions.lock().unwrap().contains_key(&7));
        assert!(!meta.is_running());
    }

    #[test]
    fn scrape_next_js_banner() {
        let t = "▲ Next.js 16.3.0 (Turbopack)\r\n- Local:         http://127.0.0.1:3000\r\n- Network:    http://127.0.0.1:3000\r\n";
        let u = scrape_preview_url(t).expect("url");
        assert!(u.contains("127.0.0.1:3000"), "{u}");
    }

    #[test]
    fn scrape_stops_at_ansi() {
        let t = "Local: http://127.0.0.1:3000\u{1b}[32mReady";
        let u = scrape_preview_url(t).expect("url");
        assert!(u.starts_with("http://127.0.0.1:3000"), "{u}");
        assert!(!u.contains('\u{1b}'), "{u}");
    }

    #[test]
    fn scrape_ignores_casual_localhost_mentions() {
        assert!(scrape_preview_url("GET http://localhost:3000/api\n").is_none());
        assert!(scrape_preview_url("open http://127.0.0.1:3000 for the website\n").is_none());
    }

    #[test]
    fn reattached_preview_snapshot_retains_output_readiness_and_revokes_it_on_exit() {
        let state = PtyState::new();
        let meta = Arc::new(SessionMeta::new(SessionKind::AgentPty));
        meta.append_output("Local: http://localhost:5173\n");
        state
            .session_meta
            .lock()
            .unwrap()
            .insert(7, Arc::clone(&meta));
        state.mark_preview_scrape(7);
        let snapshot = state.read_session_output(7, 500).unwrap();
        // `scrape_preview_url` round-trips the banner through `Url`, so the retained
        // readiness record carries the normalized host and a root-path slash, which
        // is the form the shipping baseline (`origin/main`) produces.
        assert_eq!(
            snapshot.preview_url.as_deref(),
            Some("http://127.0.0.1:5173/")
        );
        assert!(snapshot.running);
        let serialized = serde_json::to_value(snapshot).unwrap();
        assert_eq!(serialized["previewUrl"], "http://127.0.0.1:5173/");
        meta.mark_exited(Some(0));
        assert!(state
            .read_session_output(7, 500)
            .unwrap()
            .preview_url
            .is_none());
    }

    #[test]
    fn preview_snapshot_never_promotes_an_unrelated_url_mention() {
        let state = PtyState::new();
        let meta = Arc::new(SessionMeta::new(SessionKind::AgentPty));
        meta.append_output("GET http://localhost:5173/api\n");
        state.session_meta.lock().unwrap().insert(7, meta);
        state.mark_preview_scrape(7);
        assert!(state
            .read_session_output(7, 500)
            .unwrap()
            .preview_url
            .is_none());
    }

    #[test]
    fn an_unreadable_child_registry_reports_the_metadata_state_instead_of_failing() {
        let state = PtyState::new();
        state
            .session_meta
            .lock()
            .unwrap()
            .insert(7, Arc::new(SessionMeta::new(SessionKind::AgentPty)));
        let poisoned = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = state.sessions.lock().unwrap();
            panic!("test poisoned child-session lock");
        }));
        assert!(poisoned.is_err());
        // The metadata is authoritative for the running state: an unreadable registry
        // must not turn a read into an error, and it must not invent an exit either.
        let snapshot = state.read_session_output(7, 500).unwrap();
        assert!(snapshot.running);
        assert_eq!(snapshot.exit_code, None);
        // The handle stays tracked, so a later Stop can still confirm termination.
        assert!(state.session_meta.lock().unwrap().contains_key(&7));
    }

    #[test]
    fn run_commands_match_with_or_without_hostname() {
        assert_eq!(
            normalize_run_command("bun run dev"),
            normalize_run_command("bun run dev -- --hostname 127.0.0.1")
        );
    }

    #[test]
    fn pnpm_framework_script_gets_hostname() {
        let out = with_ipv4_hostname("pnpm dev:next");
        assert_eq!(out, "pnpm dev:next -- --hostname 127.0.0.1");
    }

    #[test]
    fn next_dev_gets_hostname_flag() {
        let out = with_ipv4_hostname("next dev --turbopack --port 3003");
        assert_eq!(out, "next dev --turbopack --port 3003 --hostname 127.0.0.1");
    }
}

#[cfg(test)]
mod drain_tests {
    use super::*;

    #[test]
    fn a_session_with_draining_readers_is_not_reported_as_finished() {
        let meta = Arc::new(SessionMeta::new(SessionKind::AgentPiped));
        assert!(!meta.draining());
        // A wait that has nothing to wait for must not cost anything.
        let started = std::time::Instant::now();
        meta.await_drains(std::time::Duration::from_secs(5));
        assert!(started.elapsed() < std::time::Duration::from_millis(50));
        meta.begin_reading();
        meta.begin_reading();
        assert!(meta.draining());
        let reader = meta.clone();
        thread::spawn(move || {
            thread::sleep(std::time::Duration::from_millis(20));
            reader.end_reading();
            reader.end_reading();
        });
        meta.await_drains(std::time::Duration::from_secs(5));
        assert!(!meta.draining());
    }

    #[test]
    fn a_reader_that_never_finishes_does_not_hold_the_exit_forever() {
        let meta = SessionMeta::new(SessionKind::AgentPiped);
        meta.begin_reading();
        let started = std::time::Instant::now();
        meta.await_drains(std::time::Duration::from_millis(30));
        let elapsed = started.elapsed();
        assert!(
            elapsed >= std::time::Duration::from_millis(25),
            "{elapsed:?}"
        );
        assert!(elapsed < std::time::Duration::from_secs(5), "{elapsed:?}");
    }
}

#[cfg(test)]
mod exit_tests {
    use super::*;

    #[test]
    fn native_exit_event_includes_the_renderer_status_field() {
        for code in [0, 7, -1] {
            let payload = serde_json::to_value(PtyExit {
                id: 42,
                exit_code: code,
            })
            .unwrap();
            assert_eq!(payload, serde_json::json!({ "id": 42, "exit_code": code }));
        }
    }

    #[test]
    fn an_observed_zero_exit_survives_later_cleanup() {
        let meta = SessionMeta::new(SessionKind::UserShell);
        meta.mark_exited(Some(0));
        meta.mark_exited(None);
        assert_eq!(meta.exit_code(), Some(0));
        assert!(!meta.is_running());
    }

    #[test]
    fn an_explicit_stop_is_not_replaced_by_the_collected_child_status() {
        let meta = SessionMeta::new(SessionKind::AgentPty);
        meta.mark_exited(Some(-1));
        meta.mark_exited(Some(1));
        assert_eq!(meta.exit_code(), Some(-1));
        assert!(!meta.is_running());
    }
}
