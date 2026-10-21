use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tokio_util::sync::CancellationToken;

use crate::commands::preview_render::DesignAgentOptions;

pub struct TerminalOwner {
    pub cancel: CancellationToken,
    conversation_id: Option<String>,
    request_id: Option<String>,
    native_session: OnceLock<Arc<crate::commands::pty::SessionMeta>>,
}

#[derive(Debug, Clone, Default)]
pub struct DesignPreviewState {
    pub options: Option<DesignAgentOptions>,
    pub gate_active: bool,
    pub sandbox_session_id: Option<String>,
}

/// Live component examples waiting for the user to pick one (`render_design_previews`).
#[derive(Debug, Clone)]
pub struct PendingDesignPick {
    #[allow(dead_code)]
    pub id: String,
    pub concepts: Vec<DesignPickConcept>,
}

#[derive(Debug, Clone)]
pub struct DesignPickConcept {
    pub id: String,
    pub name: String,
    pub style: String,
}

/// How the agent handles command execution approval for the current turn.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AutoRunMode {
    /// Every command asks for approval.
    Ask,
    /// Safe-listed commands run; everything else asks (default).
    #[default]
    Auto,
    /// Everything runs except hard-blocked commands (and protected classes).
    Always,
}

impl AutoRunMode {
    pub fn from_setting(value: Option<&str>) -> Self {
        match value.map(|v| v.trim().to_ascii_lowercase()).as_deref() {
            Some("ask") | Some("ask_every_time") => Self::Ask,
            Some("always") | Some("run_everything") | Some("yolo") => Self::Always,
            _ => Self::Auto,
        }
    }
}

/// Per-turn execution policy, set from user settings when the turn starts.
#[derive(Debug, Clone)]
pub struct TurnPolicy {
    pub auto_run_mode: AutoRunMode,
    /// When true, file edits/creations are staged and need user approval
    /// before they are written to disk.
    pub require_edit_approval: bool,
    /// Destructive git commands (reset/clean/restore…) always ask, even in
    /// "run everything" mode.
    pub protect_destructive_git: bool,
    /// Default approval mode for plugin_run (safest: Ask).
    pub plugin_approval_default: AutoRunMode,
    /// Per-toolkit override of plugin_approval_default.
    pub plugin_approvals: HashMap<String, AutoRunMode>,
    /// Disabled Composio slugs per toolkit.
    pub plugin_disabled_actions: HashMap<String, Vec<String>>,
    /// Workflow-preapproved plugin slugs (`toolkit:slug` and/or slug).
    pub plugin_auto_allow: HashSet<String>,
}

impl Default for TurnPolicy {
    fn default() -> Self {
        Self {
            auto_run_mode: AutoRunMode::Auto,
            require_edit_approval: false,
            protect_destructive_git: true,
            plugin_approval_default: AutoRunMode::Ask,
            plugin_approvals: HashMap::new(),
            plugin_disabled_actions: HashMap::new(),
            plugin_auto_allow: HashSet::new(),
        }
    }
}

/// A file edit staged for user approval (content is held by the waiting tool
/// call; this is the bookkeeping the UI needs to resolve it).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PendingEdit {
    pub id: String,
    pub path: String,
    pub is_new_file: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MessageStats {
    pub time_ms: f64,
    pub cost: f64,
    pub tokens: usize,
    pub input_tokens: usize,
    pub output_tokens: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub used_auto: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_breakdown: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    pub timestamp: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stats: Option<MessageStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub feedback: Option<String>,
    /// Kept in history for the model, omitted from the visible thread (fork prefix).
    #[serde(default)]
    pub hidden: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub history: Vec<ChatMessage>,
    pub project_path: String,
    pub timestamp: f64,
    /// Set when the user renames the chat. Auto titles leave it alone.
    #[serde(default)]
    pub title_locked: bool,
    /// User turns recorded when the title was last accepted.
    #[serde(default)]
    pub title_anchor_turns: u32,
    /// Hidden from the sidebar; still opens from the command palette.
    #[serde(default)]
    pub archived: bool,
    /// Conversation surface. Legacy `"multiwork"` values are treated as `"chat"`.
    #[serde(default = "default_conversation_kind")]
    pub kind: String,
    /// Rolling compaction summary for this conversation's older turns. Persisted
    /// so reopening a long chat does not re-send the whole raw history.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// How many messages from the start of `history` that summary covers. Saved
    /// with it: without the boundary the summary cannot be applied again.
    #[serde(default)]
    pub summary_fold_end: usize,
}

fn default_conversation_kind() -> String {
    "chat".to_string()
}

/// Click-through questions the agent is waiting on (`ask_user`).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PendingAsk {
    pub id: String,
    pub questions_json: String,
}

/// Represents a terminal command proposed by the AI that needs user approval.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PendingCommand {
    pub id: String,
    pub command: String,
    pub safety: String,
    pub reason: String,
    /// Turn identity for the transient approval chrome; omitted by legacy callers.
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "turnId")]
    pub turn_id: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "conversationId"
    )]
    pub conversation_id: Option<String>,
    /// When set, approval runs this internal action instead of a shell command.
    /// e.g. `"git_commit"` with `payload` = commit message.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InFlightTurn {
    pub turn_id: String,
    #[serde(default)]
    pub request_id: Option<String>,
    #[serde(default)]
    pub conversation_id: Option<String>,
    pub partial_content: String,
    pub started_at: f64,
    pub activity_label: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatGenerationState {
    pub is_generating: bool,
    #[serde(default)]
    pub request_id: Option<String>,
    pub turn_id: Option<String>,
    pub conversation_id: Option<String>,
    pub partial_content: Option<String>,
    pub activity_label: Option<String>,
}

/// Pre-edit snapshot of a single file, captured the first time a turn touches it.
/// `original_content: None` means the file did not exist before the turn (it was
/// created), so restoring means deleting it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileSnapshot {
    pub path: String,
    pub original_content: Option<String>,
}

/// All file snapshots captured for edits made starting at a given chat history
/// index (the index of the user message that kicked off the turn).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TurnCheckpoint {
    pub message_index: usize,
    pub files: Vec<FileSnapshot>,
}

/// Record the pre-edit content of `path` for the turn at `message_index`, once per file.
/// Shared by the live chat's list and by a background chat's file on disk.
pub fn record_into_checkpoints(
    checkpoints: &mut Vec<TurnCheckpoint>,
    message_index: usize,
    path: &str,
    original_content: Option<String>,
) {
    let entry = checkpoints
        .iter_mut()
        .find(|c| c.message_index == message_index);
    match entry {
        Some(cp) => {
            if cp.files.iter().any(|f| f.path == path) {
                return;
            }
            cp.files.push(FileSnapshot {
                path: path.to_string(),
                original_content,
            });
        }
        None => checkpoints.push(TurnCheckpoint {
            message_index,
            files: vec![FileSnapshot {
                path: path.to_string(),
                original_content,
            }],
        }),
    }
}

pub struct AgentState {
    pub history: Mutex<Vec<ChatMessage>>,
    pub title: Mutex<Option<String>>,
    /// User renamed this chat. Automatic titles must not replace it.
    pub title_locked: AtomicBool,
    /// User-message count when the title was last chosen. Retitle waits for ten more.
    pub title_anchor_turns: Mutex<u32>,
    pub current_project: Mutex<Option<String>>,
    pub conversations: Mutex<HashMap<String, Vec<Conversation>>>,
    pub current_conversation_id: Mutex<Option<String>>,
    /// Active coding conversation kind (`chat`).
    pub conversation_kind: Mutex<Option<String>>,
    pub cancellation_token: Mutex<CancellationToken>,
    /// Per-conversation cancel tokens so Stop only ends the chat you are looking at.
    pub cancel_tokens: Mutex<HashMap<String, CancellationToken>>,
    /// In-flight agent terminal session ids for stop/cancel (supports concurrent background jobs).
    active_terminals: Mutex<HashMap<u32, Arc<TerminalOwner>>>,
    /// Terminal commands awaiting user approval.
    pub pending_commands: Mutex<HashMap<String, PendingCommand>>,
    /// User decisions for pending commands: id -> approved. The waiting tool
    /// call consumes the decision and (on approval) executes the command.
    pub command_decisions: Mutex<HashMap<String, bool>>,
    /// File edits awaiting user approval.
    pub pending_edits: Mutex<HashMap<String, PendingEdit>>,
    /// User decisions for pending edits: id -> approved.
    pub edit_decisions: Mutex<HashMap<String, bool>>,
    /// `ask_user` prompts waiting for click-through answers.
    pub pending_asks: Mutex<HashMap<String, PendingAsk>>,
    /// JSON answers (or `"__skipped__"`) keyed by ask id.
    pub ask_answers: Mutex<HashMap<String, String>>,
    /// Component preview sets waiting for a pick (`render_design_previews`).
    pub pending_design_picks: Mutex<HashMap<String, PendingDesignPick>>,
    /// Chosen concept id (or `"__skipped__"`) keyed by pick id.
    pub design_pick_answers: Mutex<HashMap<String, String>>,
    /// Execution policy for the active turn (auto-run mode, edit approval).
    pub turn_policy: Mutex<TurnPolicy>,
    /// Per-conversation policy so a second chat does not change the first turn's approvals.
    pub turn_policies: Mutex<HashMap<String, TurnPolicy>>,
    /// Input/output tokens per in-flight turn id.
    pub turn_meter: Mutex<HashMap<String, (usize, usize)>>,
    /// Compressed summary of older chat turns when history grows long.
    pub history_summary: Mutex<Option<String>>,
    /// Compaction bookkeeping: pass history, circuit breaker, backoff.
    pub compaction: Mutex<crate::agent::commands::compaction::CompactionState>,
    /// Files the session read or wrote, newest first. Re-attached after a fold.
    pub recent_files: Mutex<Vec<crate::agent::commands::compaction::RecentFile>>,
    /// Partial assistant turns keyed by conversation id. Several chats can run at once.
    pub in_flight: Mutex<HashMap<String, InFlightTurn>>,
    pub request_cancellations: Mutex<crate::core::turn_order::RequestCancellations>,
    stopping_conversations: Mutex<HashSet<String>>,
    /// Debounce timestamp for persisting in-flight partial content.
    pub in_flight_last_save: Mutex<f64>,
    /// Design-mode preview gate and temporary React sandbox session.
    pub design_preview: Mutex<DesignPreviewState>,
    /// Pre-edit file snapshots for the active conversation, keyed by the chat
    /// history index of the user turn that produced them. Restoring a checkpoint
    /// replays these (most recent first) back onto disk.
    pub file_checkpoints: Mutex<Vec<TurnCheckpoint>>,
    /// Message index each chat's turn started at (keyed by chat id).
    pub turn_checkpoint_index: Mutex<HashMap<String, usize>>,
    /// When true, `list_chats` / `read_chat` tools are offered to the model.
    pub chat_memory_enabled: AtomicBool,
    /// Ephemeral chat: history is not written to disk.
    pub incognito: AtomicBool,
    /// User-allowed model ids for `spawn_subagent` (never inherit the parent chat model).
    pub subagent_models: Mutex<Vec<String>>,
    /// Fallback when spawn omits model or the requested id is not allowed.
    pub subagent_default_model: Mutex<String>,
}

impl Default for AgentState {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentState {
    pub fn new() -> Self {
        Self {
            history: Mutex::new(Vec::new()),
            title: Mutex::new(None),
            title_locked: AtomicBool::new(false),
            title_anchor_turns: Mutex::new(0),
            current_project: Mutex::new(None),
            conversations: Mutex::new(HashMap::new()),
            current_conversation_id: Mutex::new(None),
            conversation_kind: Mutex::new(None),
            cancellation_token: Mutex::new(CancellationToken::new()),
            cancel_tokens: Mutex::new(HashMap::new()),
            active_terminals: Mutex::new(HashMap::new()),
            pending_commands: Mutex::new(HashMap::new()),
            command_decisions: Mutex::new(HashMap::new()),
            pending_edits: Mutex::new(HashMap::new()),
            edit_decisions: Mutex::new(HashMap::new()),
            pending_asks: Mutex::new(HashMap::new()),
            ask_answers: Mutex::new(HashMap::new()),
            pending_design_picks: Mutex::new(HashMap::new()),
            design_pick_answers: Mutex::new(HashMap::new()),
            turn_policy: Mutex::new(TurnPolicy::default()),
            turn_policies: Mutex::new(HashMap::new()),
            turn_meter: Mutex::new(HashMap::new()),
            history_summary: Mutex::new(None),
            compaction: Mutex::new(crate::agent::commands::compaction::CompactionState::default()),
            recent_files: Mutex::new(Vec::new()),
            in_flight: Mutex::new(HashMap::new()),
            stopping_conversations: Mutex::new(HashSet::new()),
            request_cancellations: Mutex::new(
                crate::core::turn_order::RequestCancellations::default(),
            ),
            in_flight_last_save: Mutex::new(0.0),
            design_preview: Mutex::new(DesignPreviewState::default()),
            file_checkpoints: Mutex::new(Vec::new()),
            turn_checkpoint_index: Mutex::new(HashMap::new()),
            chat_memory_enabled: AtomicBool::new(false),
            incognito: AtomicBool::new(false),
            subagent_models: Mutex::new(vec!["auto".to_string()]),
            subagent_default_model: Mutex::new("auto".to_string()),
        }
    }

    /// Drop the compaction summary and its bookkeeping. Used when a chat is
    /// cleared, replaced, or forked — a summary must never leak between chats.
    pub fn reset_compaction(&self) {
        if let Ok(mut guard) = self.history_summary.lock() {
            *guard = None;
        }
        if let Ok(mut guard) = self.compaction.lock() {
            guard.reset();
        }
        if let Ok(mut guard) = self.recent_files.lock() {
            guard.clear();
        }
    }

    /// The rolling summary currently applied to older turns.
    pub fn current_summary(&self) -> Option<String> {
        self.history_summary.lock().ok().and_then(|g| g.clone())
    }

    /// Replace the rolling summary (used when restoring a saved conversation).
    pub fn set_current_summary(&self, summary: Option<String>) {
        if let Ok(mut guard) = self.history_summary.lock() {
            *guard = summary;
        }
    }

    /// Restore a saved summary together with the span it covers.
    pub fn restore_summary(&self, summary: Option<String>, fold_end: usize) {
        let covered = if summary.is_some() { fold_end } else { 0 };
        self.set_current_summary(summary);
        if let Ok(mut guard) = self.compaction.lock() {
            guard.summary_fold_end = covered;
        }
    }

    /// How many leading messages the stored summary already covers.
    pub fn summary_fold_end(&self) -> usize {
        self.compaction
            .lock()
            .map(|g| g.summary_fold_end)
            .unwrap_or(0)
    }

    pub fn incognito(&self) -> bool {
        self.incognito.load(Ordering::SeqCst)
    }

    pub fn set_incognito(&self, enabled: bool) {
        self.incognito.store(enabled, Ordering::SeqCst);
    }

    pub fn chat_memory_enabled(&self) -> bool {
        self.chat_memory_enabled.load(Ordering::SeqCst)
    }

    pub fn set_chat_memory_enabled(&self, enabled: bool) {
        self.chat_memory_enabled.store(enabled, Ordering::SeqCst);
    }

    /// Claim this conversation's in-flight slot. Another chat may already be running.
    pub fn try_begin_in_flight(&self, turn_id: String, conversation_id: Option<String>) -> bool {
        self.claim_in_flight(conversation_id, None, || Some(turn_id))
            .is_some()
    }

    pub fn try_begin_ordered_turn(
        &self,
        conversation_id: String,
        request_id: Option<String>,
    ) -> Option<String> {
        self.claim_in_flight(Some(conversation_id), request_id, || {
            Some(format!(
                "{}:{}",
                crate::core::turn_order::next_turn_sequence()?,
                uuid::Uuid::new_v4()
            ))
        })
    }

    fn claim_in_flight(
        &self,
        conversation_id: Option<String>,
        request_id: Option<String>,
        make_id: impl FnOnce() -> Option<String>,
    ) -> Option<String> {
        let key = conversation_id.filter(|s| !s.is_empty())?;
        crate::core::turn_order::admit(
            &self.in_flight,
            &self.stopping_conversations,
            key.clone(),
            || {
                let turn_id = make_id()?;
                let turn = InFlightTurn {
                    turn_id: turn_id.clone(),
                    request_id,
                    conversation_id: Some(key),
                    partial_content: String::new(),
                    started_at: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_secs_f64())
                        .unwrap_or(0.0),
                    activity_label: None,
                };
                Some((turn_id, turn))
            },
        )
    }

    pub fn begin_stop(
        &self,
        conversation_id: &str,
        request_id: Option<&str>,
    ) -> Option<crate::core::turn_order::StopGuard<'_>> {
        crate::core::turn_order::begin_stop(
            &self.in_flight,
            &self.stopping_conversations,
            conversation_id,
            |turn| request_id.is_none() || request_id == turn.request_id.as_deref(),
        )
    }

    pub fn begin_exclusive_cleanup(
        &self,
        conversation_id: &str,
    ) -> Option<crate::core::turn_order::StopGuard<'_>> {
        crate::core::turn_order::begin_exclusive_cleanup(
            &self.stopping_conversations,
            conversation_id,
        )
    }

    pub fn request_is_cancelled(&self, request_id: Option<&str>) -> bool {
        request_id.is_some_and(|id| {
            self.request_cancellations
                .lock()
                .map(|state| state.is_cancelled(id))
                .unwrap_or(true)
        })
    }

    pub fn any_in_flight(&self) -> bool {
        self.in_flight
            .lock()
            .map(|g| !g.is_empty())
            .unwrap_or(false)
    }

    pub fn in_flight_contains_turn(&self, turn_id: &str) -> bool {
        self.in_flight
            .lock()
            .map(|g| g.values().any(|f| f.turn_id == turn_id))
            .unwrap_or(false)
    }

    /// Fresh cancel token for one conversation. Stop cancels only that chat.
    pub fn begin_cancel_token(&self, conversation_id: &str) -> CancellationToken {
        let token = CancellationToken::new();
        if let Ok(mut map) = self.cancel_tokens.lock() {
            map.insert(conversation_id.to_string(), token.clone());
        }
        if let Ok(mut current) = self.cancellation_token.lock() {
            *current = token.clone();
        }
        token
    }

    pub fn conversation_cancel_token(&self, conversation_id: &str) -> Option<CancellationToken> {
        self.cancel_tokens
            .lock()
            .ok()
            .and_then(|m| m.get(conversation_id).cloned())
    }

    #[allow(dead_code)]
    pub fn begin_in_flight(&self, turn_id: String, conversation_id: Option<String>) {
        let _ = self.try_begin_in_flight(turn_id, conversation_id);
    }

    pub fn set_in_flight_activity_label(
        &self,
        conversation_id: Option<&str>,
        turn_id: Option<&str>,
        label: Option<&str>,
    ) {
        if let Ok(mut guard) = self.in_flight.lock() {
            // An unscoped legacy event is safe only with a single live turn.
            // The currently viewed conversation does not identify its sender.
            let target = conversation_id.map(str::to_owned).or_else(|| {
                if guard.len() == 1 {
                    guard.keys().next().cloned()
                } else {
                    None
                }
            });
            if let Some(in_flight) = target.and_then(|key| guard.get_mut(&key)) {
                if turn_id.is_some_and(|id| id != in_flight.turn_id) {
                    return;
                }
                in_flight.activity_label = label.map(str::to_owned);
            }
        }
    }

    pub fn append_in_flight(
        &self,
        chunk: &str,
        activity_label: Option<&str>,
        project_path: Option<&str>,
        conversation_id: Option<&str>,
    ) {
        let (should_save, owner_conv_id, title_snapshot, partial_snapshot) = {
            let mut guard = match self.in_flight.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            let key = conversation_id
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .or_else(|| {
                    if guard.len() == 1 {
                        guard.keys().next().cloned()
                    } else {
                        None
                    }
                });
            let Some(key) = key else {
                return;
            };
            let Some(in_flight) = guard.get_mut(&key) else {
                return;
            };
            in_flight.partial_content.push_str(chunk);
            if let Some(label) = activity_label {
                in_flight.activity_label = Some(label.to_string());
            }
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs_f64())
                .unwrap_or(0.0);
            let last_ts = self.in_flight_last_save.lock().map(|l| *l).unwrap_or(0.0);
            let should_save = now - last_ts > 12.0;
            (
                should_save,
                in_flight.conversation_id.clone(),
                self.title.lock().ok().and_then(|t| t.clone()),
                in_flight.partial_content.clone(),
            )
        };
        if !should_save {
            return;
        }
        if let Some(path) = project_path {
            let current_id = self
                .current_conversation_id
                .lock()
                .ok()
                .and_then(|g| g.clone());
            let owns_live = owner_conv_id.is_some() && owner_conv_id == current_id;
            if owns_live {
                let _ = crate::agent::commands::history::save_current_conversation_checkpoint(
                    self, path,
                );
            } else if let Some(conv_id) = owner_conv_id.as_deref() {
                // Background turn: persist partial onto the owning conversation only.
                let mut hist = {
                    let convs = self.conversations.lock().ok();
                    convs
                        .as_ref()
                        .and_then(|map| map.get(path))
                        .and_then(|list| list.iter().find(|c| c.id == conv_id))
                        .map(|c| c.history.clone())
                        .unwrap_or_default()
                };
                if hist.is_empty() {
                    // Fall back to live history only when it still belongs to this turn's chat.
                    if current_id.as_deref() == Some(conv_id) {
                        hist = self.history.lock().map(|h| h.clone()).unwrap_or_default();
                    }
                }
                if !hist.is_empty() {
                    hist = Self::merge_partial_into_history(hist, &partial_snapshot, None);
                    let stored_title = {
                        let convs = self.conversations.lock().ok();
                        convs
                            .as_ref()
                            .and_then(|map| map.get(path))
                            .and_then(|list| list.iter().find(|c| c.id == conv_id))
                            .map(|c| c.title.clone())
                    };
                    let title = stored_title
                        .or(title_snapshot)
                        .unwrap_or_else(|| "Untitled".to_string());
                    let _ = crate::agent::commands::history::upsert_conversation_snapshot(
                        self, path, conv_id, &title, hist,
                    );
                }
            }
        }
        if let Ok(mut last) = self.in_flight_last_save.lock() {
            *last = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs_f64())
                .unwrap_or(0.0);
        }
    }

    pub fn clear_in_flight_if(&self, turn_id: &str) {
        if let Ok(mut guard) = self.in_flight.lock() {
            guard.retain(|_, flight| flight.turn_id != turn_id);
        }
    }

    pub fn in_flight_snapshot(&self) -> Option<InFlightTurn> {
        let current = self
            .current_conversation_id
            .lock()
            .ok()
            .and_then(|g| g.clone())?;
        self.in_flight
            .lock()
            .ok()
            .and_then(|g| g.get(&current).cloned())
    }

    pub fn history_for_persistence(
        &self,
    ) -> Result<Vec<ChatMessage>, crate::core::error::AppError> {
        let base = self.history.lock()?.clone();
        let current_id = self.current_conversation_id.lock()?.clone();
        Ok(self.merge_in_flight_into_history_for(base, current_id.as_deref()))
    }

    pub fn merge_in_flight_into_history(&self, history: Vec<ChatMessage>) -> Vec<ChatMessage> {
        let current_id = self
            .current_conversation_id
            .lock()
            .ok()
            .and_then(|g| g.clone());
        self.merge_in_flight_into_history_for(history, current_id.as_deref())
    }

    pub fn merge_in_flight_into_history_for(
        &self,
        history: Vec<ChatMessage>,
        conversation_id: Option<&str>,
    ) -> Vec<ChatMessage> {
        let Some(viewing) = conversation_id else {
            return history;
        };
        let Some(in_flight) = self
            .in_flight
            .lock()
            .ok()
            .and_then(|g| g.get(viewing).cloned())
        else {
            return history;
        };
        Self::merge_partial_into_history(
            history,
            &in_flight.partial_content,
            Some(in_flight.started_at),
        )
    }

    fn merge_partial_into_history(
        mut history: Vec<ChatMessage>,
        partial: &str,
        started_at: Option<f64>,
    ) -> Vec<ChatMessage> {
        if partial.is_empty() {
            return history;
        }
        if let Some(last) = history.last_mut() {
            if last.role == "assistant" {
                last.content = partial.to_string();
                return history;
            }
        }
        history.push(ChatMessage {
            role: "assistant".to_string(),
            content: partial.to_string(),
            timestamp: started_at.unwrap_or_else(|| {
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs_f64())
                    .unwrap_or(0.0)
            }),
            stats: None,
            model: None,
            feedback: None,
            hidden: false,
        });
        history
    }

    /// In-flight turn for one specific conversation (not whichever chat is live).
    pub fn in_flight_for(&self, conversation_id: &str) -> Option<InFlightTurn> {
        self.in_flight
            .lock()
            .ok()
            .and_then(|g| g.get(conversation_id).cloned())
    }

    /// Generation state for `conversation_id`, or for the live chat when `None`.
    pub fn generation_state_for(&self, conversation_id: Option<&str>) -> ChatGenerationState {
        let snapshot = match conversation_id {
            Some(id) => self.in_flight_for(id),
            None => self.in_flight_snapshot(),
        };
        match snapshot {
            Some(f) => ChatGenerationState {
                is_generating: true,
                request_id: f.request_id,
                turn_id: Some(f.turn_id),
                conversation_id: f.conversation_id,
                partial_content: Some(f.partial_content),
                activity_label: f.activity_label,
            },
            None => ChatGenerationState {
                is_generating: false,
                request_id: None,
                turn_id: None,
                conversation_id: None,
                partial_content: None,
                activity_label: None,
            },
        }
    }

    pub fn reset_turn_meter(&self, turn_id: &str) {
        if let Ok(mut meter) = self.turn_meter.lock() {
            meter.insert(turn_id.to_string(), (0, 0));
        }
    }

    pub fn record_turn_usage(
        &self,
        turn_id: Option<&str>,
        input_tokens: usize,
        output_tokens: usize,
    ) {
        let Some(id) = turn_id.filter(|s| !s.is_empty()) else {
            return;
        };
        if let Ok(mut meter) = self.turn_meter.lock() {
            let entry = meter.entry(id.to_string()).or_insert((0, 0));
            entry.0 += input_tokens;
            entry.1 += output_tokens;
        }
    }

    pub fn turn_meter_totals(&self, turn_id: &str) -> (usize, usize) {
        self.turn_meter
            .lock()
            .ok()
            .and_then(|m| m.get(turn_id).copied())
            .unwrap_or((0, 0))
    }

    /// Index of the "current turn" for checkpoint purposes: the position of the
    /// most recently pushed user message in chat history.
    pub fn current_turn_index(&self) -> usize {
        self.history
            .lock()
            .map(|h| h.len().saturating_sub(1))
            .unwrap_or(0)
    }

    /// Record the pre-edit content of `path` the first time it is touched by the
    /// turn starting at `message_index`. Subsequent edits to the same file within
    /// the same turn are no-ops (we only ever want the *original* state).
    pub fn record_file_checkpoint(
        &self,
        message_index: usize,
        path: &str,
        original_content: Option<String>,
    ) {
        if let Ok(mut checkpoints) = self.file_checkpoints.lock() {
            record_into_checkpoints(&mut checkpoints, message_index, path, original_content);
        }
    }

    /// Note the message index a chat's turn started at, so its checkpoints can be filed under
    /// the right message even when that chat is not the live one.
    pub fn set_turn_checkpoint_index(&self, conversation_id: &str, message_index: usize) {
        if let Ok(mut map) = self.turn_checkpoint_index.lock() {
            map.insert(conversation_id.to_string(), message_index);
        }
    }

    pub fn turn_checkpoint_index_for(&self, conversation_id: &str) -> Option<usize> {
        self.turn_checkpoint_index
            .lock()
            .ok()
            .and_then(|map| map.get(conversation_id).copied())
    }

    pub fn file_checkpoints_snapshot(&self) -> Vec<TurnCheckpoint> {
        self.file_checkpoints
            .lock()
            .map(|c| c.clone())
            .unwrap_or_default()
    }

    pub fn replace_file_checkpoints(&self, checkpoints: Vec<TurnCheckpoint>) {
        if let Ok(mut guard) = self.file_checkpoints.lock() {
            *guard = checkpoints;
        }
    }

    pub fn clear_file_checkpoints(&self) {
        if let Ok(mut guard) = self.file_checkpoints.lock() {
            guard.clear();
        }
    }

    /// Remove and return every file snapshot captured at or after `message_index`,
    /// deduplicated so the earliest (closest to the true "before" state) snapshot
    /// wins per path. Used by `restore_checkpoint` to roll files back alongside
    /// chat history.
    pub fn take_checkpoints_from(&self, message_index: usize) -> Vec<FileSnapshot> {
        let Ok(mut checkpoints) = self.file_checkpoints.lock() else {
            return Vec::new();
        };
        let mut affected: Vec<TurnCheckpoint> = Vec::new();
        checkpoints.retain(|cp| {
            if cp.message_index >= message_index {
                affected.push(cp.clone());
                false
            } else {
                true
            }
        });
        affected.sort_by_key(|cp| cp.message_index);

        let mut seen = std::collections::HashSet::new();
        let mut result = Vec::new();
        for cp in affected {
            for f in cp.files {
                if seen.insert(f.path.clone()) {
                    result.push(f);
                }
            }
        }
        result
    }

    pub fn terminal_owner(
        &self,
        cancel: CancellationToken,
        conversation_id: Option<&str>,
        turn_id: Option<&str>,
    ) -> Arc<TerminalOwner> {
        let request_id = conversation_id
            .and_then(|id| self.in_flight_for(id))
            .filter(|turn| turn_id == Some(turn.turn_id.as_str()))
            .and_then(|turn| turn.request_id);
        Arc::new(TerminalOwner {
            cancel,
            conversation_id: conversation_id.map(str::to_owned),
            request_id,
            native_session: OnceLock::new(),
        })
    }

    pub fn register_session(
        &self,
        id: u32,
        owner: Arc<TerminalOwner>,
        native_session: Option<Arc<crate::commands::pty::SessionMeta>>,
    ) {
        if let Some(native_session) = native_session {
            let _ = owner.native_session.set(native_session);
        }
        if let Ok(mut sessions) = self.active_terminals.lock() {
            sessions.insert(id, owner);
        }
    }

    pub fn unregister_session(&self, id: u32, owner: &Arc<TerminalOwner>) {
        let removed = self.active_terminals.lock().ok().and_then(|mut sessions| {
            crate::core::session_ownership::remove_owned(&mut sessions, id, owner, |current| {
                current
            })
        });
        drop(removed);
    }

    fn cancelled_terminals(
        &self,
        conversation_id: Option<&str>,
        request_id: Option<&str>,
    ) -> Result<Vec<(u32, Arc<TerminalOwner>)>, crate::core::error::AppError> {
        Ok(self
            .active_terminals
            .lock()?
            .iter()
            .filter(|(_, owner)| {
                owner.cancel.is_cancelled()
                    && conversation_id.is_none_or(|id| owner.conversation_id.as_deref() == Some(id))
                    && request_id.is_none_or(|id| owner.request_id.as_deref() == Some(id))
            })
            .map(|(id, owner)| (*id, owner.clone()))
            .collect())
    }

    /// Stop one tracked terminal through the native handle it was registered
    /// with. Registration stores the handle as an `Option`, because a command
    /// that exits immediately can be unregistered before this window registers
    /// it at all; lacking a handle then means "nothing to stop" rather than a
    /// bug. When a handle is missing here the session is still tracked, so
    /// stopping is refused instead of guessing at a process: the caller keeps
    /// the session and can retry Stop once ownership is readable again.
    pub async fn kill_registered_session(
        &self,
        pty_state: &crate::commands::pty::PtyState,
        id: u32,
        owner: &Arc<TerminalOwner>,
    ) -> Result<(), crate::core::error::AppError> {
        let native = owner.native_session.get().ok_or_else(|| {
            crate::core::error::AppError::Message(
                "Terminal ownership is unavailable; refusing to stop an unidentified process"
                    .to_string(),
            )
        })?;
        crate::commands::pty::kill_owned_session(pty_state, id, native).await
    }

    async fn kill_tracked_terminals(
        &self,
        pty_state: &crate::commands::pty::PtyState,
        sessions: Vec<(u32, Arc<TerminalOwner>)>,
    ) -> Result<(), crate::core::error::AppError> {
        // Report every session that survived, not just the first: a partial
        // cleanup that names one failure hides the others the user must retry.
        let mut failures = Vec::new();
        for (id, owner) in sessions {
            match self.kill_registered_session(pty_state, id, &owner).await {
                Ok(()) => self.unregister_session(id, &owner),
                Err(error) => failures.push(format!("session {id}: {error}")),
            }
        }
        match crate::core::session_ownership::aggregate_cleanup_failures(failures) {
            Some(message) => Err(crate::core::error::AppError::Message(message)),
            None => Ok(()),
        }
    }

    pub async fn kill_cancelled_terminals(
        &self,
        pty_state: &crate::commands::pty::PtyState,
        conversation_id: Option<&str>,
        request_id: Option<&str>,
    ) -> Result<(), crate::core::error::AppError> {
        self.kill_tracked_terminals(
            pty_state,
            self.cancelled_terminals(conversation_id, request_id)?,
        )
        .await
    }

    pub async fn retry_cancelled_terminals(
        &self,
        pty_state: &crate::commands::pty::PtyState,
        conversation_id: Option<&str>,
        request_id: Option<&str>,
    ) -> Result<(), crate::core::error::AppError> {
        let sessions = self.cancelled_terminals(conversation_id, request_id)?;
        // A Stop for the lane owns capture teardown until its guard drops
        // (`kill_terminals_for_conversation` walks the same registry), so a
        // retry must not run concurrently with it. Checking that and then
        // killing would leave a window for a Stop to claim the lane after the
        // check, so the lanes are *claimed* instead: `claim_lanes` takes every
        // lane the retry is about to touch or refuses all of them, and the
        // guards keep replacement admission out until the kills are done. That
        // is lane-scoped rather than request-scoped, deliberately: the guard
        // only records the conversation, and lane admission already refuses a
        // new turn while the guard is held, so the only traffic this can hold
        // back is a retry for an older request. Such a retry stays tracked and
        // succeeds once cleanup finishes, while killing during an unrelated
        // teardown could race the same session registry. Blocking is the safe
        // direction.
        let mut lanes: Vec<String> = sessions
            .iter()
            .filter_map(|(_, owner)| owner.conversation_id.clone())
            .collect();
        lanes.sort_unstable();
        lanes.dedup();
        let Some(claims) = crate::core::turn_order::claim_lanes(
            &self.stopping_conversations,
            lanes.iter().map(String::as_str),
        ) else {
            return Err(crate::core::error::AppError::Message(
                "Command cleanup is still running. Retry Stop when it finishes.".to_string(),
            ));
        };
        let cleanup = self.kill_tracked_terminals(pty_state, sessions).await;
        drop(claims);
        cleanup
    }

    pub async fn kill_terminals_for_conversation(
        &self,
        pty_state: &crate::commands::pty::PtyState,
        conversation_id: &str,
    ) -> Result<(), crate::core::error::AppError> {
        let sessions: Vec<_> = self
            .active_terminals
            .lock()?
            .iter()
            .filter(|(_, owner)| owner.conversation_id.as_deref() == Some(conversation_id))
            .map(|(id, owner)| (*id, owner.clone()))
            .collect();
        for (_, owner) in &sessions {
            owner.cancel.cancel();
        }
        self.kill_tracked_terminals(pty_state, sessions).await
    }

    /// Stop a lane's terminals, wait for the aborted turn to unwind, then sweep
    /// again. The second sweep is not redundant: a command can register a
    /// terminal while the first sweep (or the turn's own teardown) is running,
    /// and `wait_for_turn_cleanup` only observes the turn it was given.
    pub async fn kill_terminals_for_conversation_exhaustive(
        &self,
        pty_state: &crate::commands::pty::PtyState,
        conversation_id: &str,
        aborted_turn_id: Option<&str>,
    ) -> Result<(), crate::core::error::AppError> {
        self.kill_terminals_for_conversation(pty_state, conversation_id)
            .await?;
        self.wait_for_turn_cleanup(conversation_id, aborted_turn_id)
            .await?;
        self.kill_terminals_for_conversation(pty_state, conversation_id)
            .await
    }

    pub async fn wait_for_turn_cleanup(
        &self,
        conversation_id: &str,
        turn_id: Option<&str>,
    ) -> Result<(), crate::core::error::AppError> {
        let Some(turn_id) = turn_id else {
            return Ok(());
        };
        let started = std::time::Instant::now();
        loop {
            let still_running = self
                .in_flight
                .lock()?
                .get(conversation_id)
                .is_some_and(|turn| turn.turn_id == turn_id);
            if !still_running {
                return Ok(());
            }
            if started.elapsed() >= std::time::Duration::from_secs(5) {
                return Err(crate::core::error::AppError::Message(
                    "The previous turn is still stopping. Retry when it finishes.".to_string(),
                ));
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
    }

    pub fn set_turn_policy(&self, policy: TurnPolicy) {
        if let Ok(mut guard) = self.turn_policy.lock() {
            *guard = policy;
        }
    }

    pub fn turn_policy(&self) -> TurnPolicy {
        self.turn_policy
            .lock()
            .map(|g| g.clone())
            .unwrap_or_default()
    }

    pub fn set_turn_policy_for(&self, conversation_id: &str, policy: TurnPolicy) {
        if let Ok(mut map) = self.turn_policies.lock() {
            map.insert(conversation_id.to_string(), policy.clone());
        }
        self.set_turn_policy(policy);
    }

    pub fn reset_title_meta(&self) {
        self.title_locked.store(false, Ordering::Relaxed);
        if let Ok(mut anchor) = self.title_anchor_turns.lock() {
            *anchor = 0;
        }
    }

    pub fn title_meta(&self) -> (bool, u32) {
        let locked = self.title_locked.load(Ordering::Relaxed);
        let anchor = self.title_anchor_turns.lock().map(|g| *g).unwrap_or(0);
        (locked, anchor)
    }

    pub fn set_title_meta(&self, locked: bool, anchor: u32) {
        self.title_locked.store(locked, Ordering::Relaxed);
        if let Ok(mut guard) = self.title_anchor_turns.lock() {
            *guard = anchor;
        }
    }

    pub fn turn_policy_for(&self, conversation_id: Option<&str>) -> TurnPolicy {
        if let Some(id) = conversation_id.filter(|s| !s.is_empty()) {
            if let Ok(map) = self.turn_policies.lock() {
                if let Some(policy) = map.get(id) {
                    return policy.clone();
                }
            }
        }
        self.turn_policy()
    }

    /// Clear approval bookkeeping from a previous turn so stale decisions can
    /// never resolve a new pending item.
    pub fn clear_pending_approvals(&self) {
        if let Ok(mut g) = self.pending_commands.lock() {
            g.clear();
        }
        if let Ok(mut g) = self.command_decisions.lock() {
            g.clear();
        }
        if let Ok(mut g) = self.pending_edits.lock() {
            g.clear();
        }
        if let Ok(mut g) = self.edit_decisions.lock() {
            g.clear();
        }
        if let Ok(mut g) = self.pending_asks.lock() {
            g.clear();
        }
        if let Ok(mut g) = self.ask_answers.lock() {
            g.clear();
        }
    }

    /// Drop unresolved approval waiters on Stop without wiping Accept/Reject
    /// decisions that already landed (those should still apply).
    pub fn dismiss_unresolved_approvals(&self) {
        if let Ok(mut g) = self.pending_commands.lock() {
            g.clear();
        }
        if let Ok(mut g) = self.pending_edits.lock() {
            g.clear();
        }
        if let Ok(mut g) = self.pending_asks.lock() {
            g.clear();
        }
        if let Ok(mut g) = self.pending_design_picks.lock() {
            g.clear();
        }
    }

    pub fn begin_design_turn(&self, _options: Option<DesignAgentOptions>, _user_message: &str) {
        // Visual mode: never hard-gate writes. Previews are opt-in via the tool when
        // the user asks to see a component first; otherwise the agent implements directly.
        if let Ok(mut guard) = self.design_preview.lock() {
            guard.options = None;
            guard.gate_active = false;
        }
        let _ = self.ensure_design_sandbox_session();
    }

    pub fn design_gate_blocks_writes(&self) -> bool {
        self.design_preview
            .lock()
            .map(|g| g.gate_active)
            .unwrap_or(false)
    }

    #[allow(dead_code)]
    pub fn design_visual_previews_enabled(&self) -> bool {
        self.design_preview
            .lock()
            .ok()
            .and_then(|g| g.options.as_ref().map(|o| o.visual_previews))
            .unwrap_or(false)
    }

    pub fn clear_design_preview_state(&self) {
        if let Ok(mut guard) = self.design_preview.lock() {
            if let Some(session_id) = guard.sandbox_session_id.take() {
                crate::commands::design_sandbox::cleanup_session(&session_id);
            }
            *guard = DesignPreviewState::default();
        }
        crate::commands::preview_render::cleanup_preview_dir();
    }

    pub fn ensure_design_sandbox_session(&self) -> String {
        if let Ok(mut guard) = self.design_preview.lock() {
            if guard.sandbox_session_id.is_none() {
                guard.sandbox_session_id = Some(uuid::Uuid::new_v4().to_string());
            }
            return guard.sandbox_session_id.clone().unwrap_or_default();
        }
        uuid::Uuid::new_v4().to_string()
    }

    #[allow(dead_code)]
    pub fn design_sandbox_session_id(&self) -> Option<String> {
        self.design_preview
            .lock()
            .ok()
            .and_then(|g| g.sandbox_session_id.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn activity_labels_belong_to_the_emitting_turn_not_the_selected_chat() {
        let state = AgentState::new();
        state.begin_in_flight("turn-a".into(), Some("a".into()));
        state.begin_in_flight("turn-b".into(), Some("b".into()));
        state.set_in_flight_activity_label(Some("a"), Some("turn-a"), Some("Waiting for approval"));
        state.set_in_flight_activity_label(Some("a"), Some("old-turn"), Some("Stale"));
        state.set_in_flight_activity_label(None, None, Some("Ambiguous"));
        assert_eq!(
            state.in_flight_for("a").unwrap().activity_label.as_deref(),
            Some("Waiting for approval")
        );
        assert_ne!(
            state.in_flight_for("b").unwrap().activity_label.as_deref(),
            Some("Waiting for approval")
        );
        assert_ne!(
            state.in_flight_for("b").unwrap().activity_label.as_deref(),
            Some("Ambiguous")
        );
    }

    #[test]
    fn auto_run_mode_from_setting_aliases() {
        assert_eq!(AutoRunMode::from_setting(Some("ask")), AutoRunMode::Ask);
        assert_eq!(
            AutoRunMode::from_setting(Some("ask_every_time")),
            AutoRunMode::Ask
        );
        assert_eq!(
            AutoRunMode::from_setting(Some("always")),
            AutoRunMode::Always
        );
        assert_eq!(
            AutoRunMode::from_setting(Some("run_everything")),
            AutoRunMode::Always
        );
        assert_eq!(AutoRunMode::from_setting(Some("auto")), AutoRunMode::Auto);
        assert_eq!(AutoRunMode::from_setting(None), AutoRunMode::Auto);
    }

    #[test]
    fn turn_policy_can_flip_mid_turn_fields() {
        let mut policy = TurnPolicy::default();
        policy.auto_run_mode = AutoRunMode::from_setting(Some("ask"));
        policy.require_edit_approval = true;
        policy.protect_destructive_git = false;
        assert_eq!(policy.auto_run_mode, AutoRunMode::Ask);
        assert!(policy.require_edit_approval);
        assert!(!policy.protect_destructive_git);
    }
}

#[cfg(test)]
mod admission_order_tests {
    use super::*;

    #[test]
    fn stop_selects_cancelled_command_owners_and_their_children_only() {
        let state = AgentState::new();
        let cancelled = CancellationToken::new();
        let other = CancellationToken::new();
        let first = state.terminal_owner(cancelled.clone(), Some("a"), None);
        let second = state.terminal_owner(cancelled.child_token(), Some("a"), None);
        let third = state.terminal_owner(other.clone(), Some("b"), None);
        state.register_session(1, first.clone(), None);
        state.register_session(2, second.clone(), None);
        state.register_session(3, third, None);
        cancelled.cancel();
        let mut stopped: Vec<_> = state
            .cancelled_terminals(Some("a"), None)
            .unwrap()
            .into_iter()
            .map(|(id, _)| id)
            .collect();
        stopped.sort_unstable();
        assert_eq!(stopped, vec![1, 2]);
        assert_eq!(state.active_terminals.lock().unwrap().len(), 3);
        assert!(!other.is_cancelled());
        assert_eq!(state.cancelled_terminals(Some("a"), None).unwrap().len(), 2);
        state.unregister_session(1, &first);
        state.unregister_session(2, &second);
        assert!(state
            .cancelled_terminals(Some("a"), None)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn a_late_terminal_exit_cannot_unregister_a_replacement() {
        let state = AgentState::new();
        let first = state.terminal_owner(CancellationToken::new(), Some("a"), None);
        let replacement = state.terminal_owner(CancellationToken::new(), Some("a"), None);
        state.register_session(1, first.clone(), None);
        state.register_session(1, replacement.clone(), None);
        state.unregister_session(1, &first);
        assert!(Arc::ptr_eq(
            state.active_terminals.lock().unwrap().get(&1).unwrap(),
            &replacement
        ));
    }

    #[test]
    fn terminal_cleanup_is_scoped_to_the_original_request_after_the_turn_exits() {
        let state = AgentState::new();
        let first = state
            .try_begin_ordered_turn("a".into(), Some("window:a:1".into()))
            .unwrap();
        let cancelled = CancellationToken::new();
        let owner = state.terminal_owner(cancelled.clone(), Some("a"), Some(&first));
        state.register_session(1, owner, None);
        cancelled.cancel();
        state.clear_in_flight_if(&first);
        assert_eq!(
            state
                .cancelled_terminals(Some("a"), Some("window:a:1"))
                .unwrap()
                .len(),
            1
        );
        assert!(state
            .cancelled_terminals(Some("b"), Some("window:a:1"))
            .unwrap()
            .is_empty());
        assert!(state
            .cancelled_terminals(Some("a"), Some("window:a:2"))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn stop_cleanup_blocks_replacement_admission_until_it_finishes() {
        let state = AgentState::new();
        let first = state
            .try_begin_ordered_turn("a".into(), Some("owner:a:1".into()))
            .unwrap();
        assert_eq!(
            state.generation_state_for(Some("a")).request_id.as_deref(),
            Some("owner:a:1")
        );
        let stopping = state.begin_stop("a", Some("owner:a:1")).unwrap();
        state.clear_in_flight_if(&first);
        assert!(state
            .try_begin_ordered_turn("a".into(), Some("owner:a:2".into()))
            .is_none());
        drop(stopping);
        let second = state
            .try_begin_ordered_turn("a".into(), Some("owner:a:2".into()))
            .unwrap();
        assert!(
            second.split(':').next().unwrap().parse::<u64>().unwrap()
                > first.split(':').next().unwrap().parse::<u64>().unwrap()
        );
        assert!(state.begin_stop("a", Some("owner:a:1")).is_none());
    }
}
