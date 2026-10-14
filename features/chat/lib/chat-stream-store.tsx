"use client";

import React from "react";
import { listen } from "@tauri-apps/api/event";
import { commands } from "@/lib/backend";
import type { ChatMessage } from "@/lib/backend/types";
import { setChatActivity } from "./chat-activity";
import { setChatGenerating } from "./generating-chats";
import { NEW_CHAT_TAB_ID } from "../ui/shell/tabs";
import { upsertTaggedBlockInContent } from "./upsert-stream-blocks";

function isForeignConversation(id?: string | null) {
    return Boolean(id && id.startsWith("mw-worker-"));
}

const TOOL_LABELS: Record<string, string> = {
    read_file: "Reading file",
    list_dir: "Listing directory",
    grep: "Searching",
    search_files: "Finding files",
    search_codebase: "Searching codebase",
    codebase_overview: "Mapping codebase",
    edit_file: "Editing file",
    run_terminal: "Running command",
    wait: "Waiting",
    read_terminal: "Reading terminal",
    list_terminals: "Listing terminals",
    inspect_runtime: "Inspecting page",
    ask_user: "Asking a question",
    render_design_previews: "Creating preview",
    update_todos: "Updating todos",
    save_plan: "Saving plan",
};

/** Explicit turn phase driven by Rust events — keeps chrome from lying. */
export type TurnPhase =
    | "idle"
    | "thinking"
    | "tool"
    | "awaiting_approval"
    | "awaiting_input"
    | "waiting"
    | "running_command"
    | "editing"
    | "completed"
    | "failed"
    | "cancelled";

export type ChatStreamState = {
    isLoading: boolean;
    messages: ChatMessage[];
    activityLabel: string | null;
    turnPhase: TurnPhase;
    turnId: string | null;
    sendError: string | null;
    /** Older turns were folded into a model-facing summary (Cursor-style). */
    contextSummarized: boolean;
    /** The conversation on screen. `null` is the draft (New Chat). */
    viewedConversationId: string | null;
};

/** A turn the frontend is tracking, keyed by conversation id (or the draft key). */
type LiveTurn = {
    conversationId: string | null;
    turnId: string | null;
    messages: ChatMessage[];
    activityLabel: string | null;
    turnPhase: TurnPhase;
    /** Client id of the send that opened a draft turn. Echoed back by `chat_started`. */
    requestId?: string | null;
};

type ChatStreamContextValue = ChatStreamState & {
    setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
    setSendError: React.Dispatch<React.SetStateAction<string | null>>;
    setContextSummarized: React.Dispatch<React.SetStateAction<boolean>>;
    /** Synchronous read of the conversation on screen (no render lag). */
    getViewedConversationId: () => string | null;
    /** Conversation id of the draft's turn once it has started (for Stop from the draft). */
    getDraftConversationId: () => string | null;
    /**
     * Put `id` on screen right now (`null` = draft). Returns a view token; a later load is
     * applied only while its token is still current.
     */
    showConversation: (id: string | null, cached?: ChatMessage[]) => number;
    /** True while `seq` is still the view the user asked for. */
    isCurrentView: (seq: number) => boolean;
    /** Load the transcript of the conversation on screen. Returns it, or null if superseded. */
    reloadViewedMessages: (seq?: number) => Promise<ChatMessage[] | null>;
    /** Adopt the backend's current chat on first mount, unless the user already chose one. */
    bootstrapFromBackend: () => Promise<void>;
    /** Called when a draft's turn is bound to its real conversation id. */
    setDraftAdopter: (fn: ((conversationId: string) => void) | null) => void;
    /** Show the user's message in the chat it was sent to (not necessarily the one on screen). */
    appendUserOptimistic: (
        userMsg: string,
        conversationId: string | null,
        requestId?: string | null,
    ) => void;
    /** Instantly drop the live-turn spinner so Stop does not wait on the stream. */
    stopLiveTurn: () => void;
    /** Leave a running turn in the background and show an empty draft. */
    startDraftChat: () => void;
    /** True while chat `id` (`null` = the draft) has a turn the frontend is tracking. */
    hasLiveTurn: (id: string | null) => boolean;
};

const defaultState: ChatStreamState = {
    isLoading: false,
    messages: [],
    activityLabel: null,
    turnPhase: "idle",
    turnId: null,
    sendError: null,
    contextSummarized: false,
    viewedConversationId: null,
};

const ChatStreamContext = React.createContext<ChatStreamContextValue | null>(null);

const PENDING_KEY = "__pending__";

function appendAssistantChunk(prev: ChatMessage[], chunk: string): ChatMessage[] {
    const latest = prev[prev.length - 1];
    if (latest && latest.role === "assistant") {
        const updated = [...prev];
        updated[updated.length - 1] = {
            ...latest,
            content: upsertTaggedBlockInContent(latest.content, chunk),
        };
        return updated;
    }
    return [
        ...prev,
        { role: "assistant", content: chunk, timestamp: Date.now() / 1000 },
    ];
}

function phaseFromTool(tool: string | undefined): TurnPhase {
    if (tool === "ask_user") return "awaiting_input";
    if (tool === "wait") return "waiting";
    if (tool === "run_terminal") return "running_command";
    if (tool === "edit_file" || tool === "create_file") return "editing";
    return "tool";
}

function labelForPhase(phase: TurnPhase, tool?: string, label?: string): string | null {
    if (label?.trim()) return label.trim();
    switch (phase) {
        case "awaiting_input":
            return "Waiting for your answers";
        case "waiting":
            return "Waiting";
        case "thinking":
            return "Thinking";
        case "awaiting_approval":
            return "Waiting for approval";
        case "running_command":
            return "Running command";
        case "editing":
            return "Editing file";
        case "tool":
            if (tool) {
                const pretty = TOOL_LABELS[tool] ?? tool.replace(/_/g, " ");
                return pretty.charAt(0).toUpperCase() + pretty.slice(1);
            }
            return "Working";
        default:
            return null;
    }
}

export function ChatStreamProvider({ children }: { children: React.ReactNode }) {
    const [isLoading, setIsLoading] = React.useState(defaultState.isLoading);
    const [messages, setMessages] = React.useState<ChatMessage[]>(defaultState.messages);
    const [activityLabel, setActivityLabel] = React.useState<string | null>(null);
    const [turnPhase, setTurnPhase] = React.useState<TurnPhase>("idle");
    const [turnId, setTurnId] = React.useState<string | null>(null);
    const [sendError, setSendError] = React.useState<string | null>(null);
    const [contextSummarized, setContextSummarized] = React.useState(false);
    const [viewedConversationId, setViewedConversationIdState] = React.useState<string | null>(null);

    // The conversation on screen is decided only by user intent (open, switch, New Chat,
    // the first turn of a draft). It is never copied from the backend's current pointer,
    // which can name a different chat than the one the user is looking at.
    const viewingIdRef = React.useRef<string | null>(null);
    // Set once the user (or a restored tab) picks a view. Bootstrap must not override it.
    const viewChosenRef = React.useRef(false);
    // Bumped on every view change, so a slow load for an earlier view is discarded.
    const viewSeqRef = React.useRef(0);
    const liveTurnsRef = React.useRef<Map<string, LiveTurn>>(new Map());
    // Last known transcript per conversation, so a switch paints before the load lands.
    const transcriptCacheRef = React.useRef<Map<string, ChatMessage[]>>(new Map());
    const draftConversationIdRef = React.useRef<string | null>(null);
    const draftAdopterRef = React.useRef<((conversationId: string) => void) | null>(null);
    const messagesRef = React.useRef<ChatMessage[]>(messages);
    const turnIdRef = React.useRef<string | null>(null);
    const ignoredIdsRef = React.useRef<Set<string>>(new Set());

    React.useEffect(() => {
        messagesRef.current = messages;
    }, [messages]);

    React.useEffect(() => {
        turnIdRef.current = turnId;
    }, [turnId]);

    const setViewed = React.useCallback((id: string | null) => {
        viewingIdRef.current = id;
        setViewedConversationIdState(id);
    }, []);

    const applyLive = React.useCallback((live: LiveTurn) => {
        setChatGenerating(live.conversationId, true);
        setChatActivity(live.conversationId, live.turnPhase);
        turnIdRef.current = live.turnId;
        setMessages(live.messages);
        setIsLoading(true);
        setTurnId(live.turnId);
        setActivityLabel(live.activityLabel);
        setTurnPhase(live.turnPhase);
    }, []);

    const applyIdle = React.useCallback((transcript: ChatMessage[]) => {
        turnIdRef.current = null;
        setMessages(transcript);
        setIsLoading(false);
        setTurnId(null);
        setActivityLabel(null);
        setTurnPhase("idle");
    }, []);

    const showViewInternal = React.useCallback(
        (id: string | null, cached?: ChatMessage[]): number => {
            // Keep the transcript on screen for the chat being left, so coming back is instant.
            if (viewingIdRef.current) {
                transcriptCacheRef.current.set(viewingIdRef.current, messagesRef.current);
            }
            const seq = ++viewSeqRef.current;
            setViewed(id);
            const live = liveTurnsRef.current.get(id ?? PENDING_KEY);
            // Update the ref now, not after the next render: a send issued right after a switch
            // must read the chat being shown, not the one that was on screen before.
            if (live) {
                messagesRef.current = live.messages;
                applyLive(live);
            } else {
                const transcript = id ? (cached ?? transcriptCacheRef.current.get(id) ?? []) : [];
                messagesRef.current = transcript;
                applyIdle(transcript);
            }
            return seq;
        },
        [applyIdle, applyLive, setViewed],
    );

    const showConversation = React.useCallback(
        (id: string | null, cached?: ChatMessage[]): number => {
            viewChosenRef.current = true;
            return showViewInternal(id, cached);
        },
        [showViewInternal],
    );

    const isCurrentView = React.useCallback((seq: number) => viewSeqRef.current === seq, []);

    const reloadViewedMessages = React.useCallback(
        async (seq?: number): Promise<ChatMessage[] | null> => {
            const id = viewingIdRef.current;
            if (!id) return null;
            const mySeq = seq ?? viewSeqRef.current;
            try {
                const [history, gen] = await Promise.all([
                    commands.getConversationMessages(id),
                    commands.getChatGenerationState(id),
                ]);
                if (!isCurrentView(mySeq) || viewingIdRef.current !== id) return null;
                // A turn running in this chat (for example after a window reload) becomes live here.
                if (
                    gen.isGenerating
                    && gen.conversationId === id
                    && !liveTurnsRef.current.has(id)
                    && !ignoredIdsRef.current.has(id)
                ) {
                    liveTurnsRef.current.set(id, {
                        conversationId: id,
                        turnId: gen.turnId ?? null,
                        messages: history,
                        activityLabel: gen.activityLabel ?? "Thinking",
                        turnPhase: "thinking",
                    });
                }
                transcriptCacheRef.current.set(id, history);
                const live = liveTurnsRef.current.get(id);
                if (live) applyLive(live);
                else applyIdle(history);
                return history;
            } catch (err) {
                console.error("Failed to load chat messages:", err);
                return null;
            }
        },
        [applyIdle, applyLive, isCurrentView],
    );

    const bootstrapFromBackend = React.useCallback(async () => {
        if (viewChosenRef.current) return;
        const cid = await commands.getCurrentConversationId().catch(() => null);
        if (viewChosenRef.current) return;
        const seq = showViewInternal(cid);
        await reloadViewedMessages(seq);
    }, [reloadViewedMessages, showViewInternal]);

    const stopLiveTurn = React.useCallback(() => {
        const id = viewingIdRef.current;
        if (id) {
            ignoredIdsRef.current.add(id);
            liveTurnsRef.current.delete(id);
            setChatGenerating(id, false);
            setChatActivity(id, "cancelled");
        } else {
            liveTurnsRef.current.delete(PENDING_KEY);
        }
        turnIdRef.current = null;
        setIsLoading(false);
        setActivityLabel(null);
        setTurnPhase("cancelled");
        setTurnId(null);
    }, []);

    const appendUserOptimistic = React.useCallback(
        (userMsg: string, conversationId: string | null, requestId?: string | null) => {
            const optimisticTs = Date.now() / 1000;
            const onScreen = viewingIdRef.current === conversationId;
            const key = conversationId ?? PENDING_KEY;
            const base =
                liveTurnsRef.current.get(key)?.messages
                ?? (onScreen
                    ? messagesRef.current
                    : conversationId
                      ? transcriptCacheRef.current.get(conversationId)
                      : undefined)
                ?? [];
            const next = [
                ...base,
                { role: "user" as const, content: userMsg, timestamp: optimisticTs },
                { role: "assistant" as const, content: "", timestamp: optimisticTs + 0.001 },
            ];
            if (conversationId) ignoredIdsRef.current.delete(conversationId);
            liveTurnsRef.current.set(key, {
                conversationId,
                turnId: null,
                messages: next,
                activityLabel: "Thinking",
                turnPhase: "thinking",
                requestId: requestId ?? null,
            });
            if (onScreen) {
                setMessages(next);
                setIsLoading(true);
                setTurnPhase("thinking");
                setActivityLabel("Thinking");
            }
        },
        [],
    );

    const setDraftAdopter = React.useCallback((fn: ((conversationId: string) => void) | null) => {
        draftAdopterRef.current = fn;
    }, []);

    const startDraftChat = React.useCallback(() => {
        showConversation(null);
    }, [showConversation]);

    React.useEffect(() => {
        let disposed = false;
        const unlisteners: (() => void)[] = [];
        const register = (promise: Promise<() => void>) => {
            void promise.then((fn) => {
                if (disposed) fn();
                else unlisteners.push(fn);
            });
        };

        const finishedTurns = new Set<string>();

        /** The draft's turn now has a real conversation id: bind it (and the draft queue). */
        const bindDraft = (conversationId: string) => {
            draftConversationIdRef.current = conversationId;
            draftAdopterRef.current?.(conversationId);
        };

        const resolveLiveKey = (conversationId?: string | null) => {
            if (conversationId) return liveTurnsRef.current.has(conversationId) ? conversationId : null;
            // Legacy unscoped events are only safe when exactly one turn exists.
            // The selected tab does not identify which background agent emitted one.
            if (liveTurnsRef.current.size === 1) return liveTurnsRef.current.keys().next().value ?? null;
            return null;
        };

        const patchLive = (conversationId: string | null | undefined, update: (live: LiveTurn) => void) => {
            const key = resolveLiveKey(conversationId);
            if (!key || ignoredIdsRef.current.has(key)) return;
            const live = liveTurnsRef.current.get(key);
            if (!live) return;
            update(live);
            setChatGenerating(live.conversationId, true);
            setChatActivity(live.conversationId, live.turnPhase);
            const shown =
                (viewingIdRef.current && viewingIdRef.current === live.conversationId) ||
                (!viewingIdRef.current && key === PENDING_KEY);
            if (shown) {
                setMessages(live.messages);
                setIsLoading(true);
                setActivityLabel(live.activityLabel);
                setTurnPhase(live.turnPhase);
                setTurnId(live.turnId);
            }
        };

        register(
            listen<{
                turnId?: string;
                conversationId?: string;
                requestId?: string;
                model?: string;
                usedAuto?: boolean;
            }>("chat_started", (event) => {
                const tid = event.payload?.turnId ?? null;
                const convId = event.payload?.conversationId ?? null;
                if (isForeignConversation(convId) || (tid && finishedTurns.has(tid))) return;
                setChatActivity(convId, "thinking");
                const startedModel = event.payload?.model;
                const usedAuto = event.payload?.usedAuto;
                if (convId) {
                    setChatGenerating(convId, true);
                    setChatGenerating(NEW_CHAT_TAB_ID, false);
                    ignoredIdsRef.current.delete(convId);
                }
                const pending = liveTurnsRef.current.get(PENDING_KEY);
                // Only the send that opened the draft may bind it. The draft's turn has no chat
                // id until this event, so the request id is the only link between the two. Any
                // other chat that starts meanwhile keeps its own transcript and leaves the draft alone.
                const eventRequestId = event.payload?.requestId ?? null;
                const bindsDraft = Boolean(
                    pending && convId && pending.requestId && eventRequestId === pending.requestId,
                );
                const adoptsView = bindsDraft && viewingIdRef.current === null;
                const existing = bindsDraft
                    ? pending
                    : (convId && liveTurnsRef.current.get(convId)) || undefined;
                const base =
                    existing?.messages
                    ?? (viewingIdRef.current === convId
                        ? messagesRef.current
                        : (convId && transcriptCacheRef.current.get(convId)) || []);
                let snapshot = base;
                if (startedModel) {
                    const latest = snapshot[snapshot.length - 1];
                    if (latest?.role === "assistant") {
                        snapshot = [
                            ...snapshot.slice(0, -1),
                            {
                                ...latest,
                                model: startedModel,
                                stats: {
                                    ...latest.stats,
                                    usedAuto: usedAuto ?? latest.stats?.usedAuto,
                                },
                            },
                        ];
                    }
                }
                const key = convId || PENDING_KEY;
                if (bindsDraft) liveTurnsRef.current.delete(PENDING_KEY);
                liveTurnsRef.current.set(key, {
                    conversationId: convId,
                    turnId: tid,
                    messages: snapshot,
                    activityLabel: "Thinking",
                    turnPhase: "thinking",
                });
                if (bindsDraft && convId) bindDraft(convId);
                const stayOnThisTurn = adoptsView || viewingIdRef.current === convId;
                if (stayOnThisTurn) {
                    if (adoptsView && convId) setViewed(convId);
                    turnIdRef.current = tid;
                    setIsLoading(true);
                    setSendError(null);
                    setTurnId(tid);
                    setTurnPhase("thinking");
                    setActivityLabel("Thinking");
                    setMessages(snapshot);
                }
            }),
        );

        register(
            listen<string | { chunk?: string; turnId?: string; conversationId?: string }>(
                "chat_token",
                (event) => {
                    const raw = event.payload;
                    const chunk =
                        typeof raw === "string" ? raw : typeof raw?.chunk === "string" ? raw.chunk : "";
                    if (!chunk) return;
                    const meta = typeof raw === "string" ? undefined : raw;
                    if (isForeignConversation(meta?.conversationId)) return;
                    if (meta?.turnId && finishedTurns.has(meta.turnId)) return;
                    const key = meta?.conversationId || resolveLiveKey();
                    if (!key) return;
                    const convId = key === PENDING_KEY ? null : key;
                    if (convId && ignoredIdsRef.current.has(convId)) return;
                    const current = liveTurnsRef.current.get(key);
                    if (meta?.turnId && current?.turnId && meta.turnId !== current.turnId) return;
                    if (!liveTurnsRef.current.has(key)) {
                        liveTurnsRef.current.set(key, {
                            conversationId: convId,
                            turnId: meta?.turnId ?? null,
                            messages: viewingIdRef.current === convId ? messagesRef.current : convId ? transcriptCacheRef.current.get(convId) ?? [] : [],
                            activityLabel: "Thinking",
                            turnPhase: "thinking",
                        });
                    }
                    patchLive(convId, (live) => {
                        if (meta?.turnId) live.turnId = meta.turnId;
                        live.messages = appendAssistantChunk(live.messages, chunk);
                    });
                },
            ),
        );

        register(
            listen<{
                stats?: {
                    timeMs?: number;
                    cost?: number;
                    tokens?: number;
                    inputTokens?: number;
                    outputTokens?: number;
                    usedAuto?: boolean;
                    autoPercent?: number;
                    reasoningEffort?: string;
                    mode?: string;
                    latencyMs?: number;
                    contextBreakdown?: Record<string, number> | null;
                };
                model?: string;
                error?: string;
                conversationId?: string;
                turnId?: string;
                content?: string;
            }>("chat_complete", (event) => {
                const { stats, model, error, conversationId, content, turnId } =
                    event.payload ?? {};
                if (isForeignConversation(conversationId)) return;
                if (turnId) finishedTurns.add(turnId);
                const current = conversationId ? liveTurnsRef.current.get(conversationId) : undefined;
                if (turnId && current?.turnId && turnId !== current.turnId) return;
                setChatActivity(conversationId, error === "Cancelled" ? "cancelled" : error ? "failed" : "completed", error);
                if (!error && stats) {
                    void import("@/lib/chat/last-turn-usage").then(({ setLastTurnUsage }) => {
                        setLastTurnUsage({
                            tokens: stats.tokens ?? ((stats.inputTokens ?? 0) + (stats.outputTokens ?? 0)),
                            inputTokens: stats.inputTokens,
                            usedAuto: stats.usedAuto,
                        });
                    });
                }
                if (conversationId) {
                    setChatGenerating(conversationId, false);
                    ignoredIdsRef.current.delete(conversationId);
                    liveTurnsRef.current.delete(conversationId);
                    if (draftConversationIdRef.current === conversationId) {
                        draftConversationIdRef.current = null;
                    }
                } else {
                    liveTurnsRef.current.delete(PENDING_KEY);
                }
                setChatGenerating(NEW_CHAT_TAB_ID, false);
                const shown = !!conversationId && viewingIdRef.current === conversationId;
                if (!shown) {
                    if (conversationId) {
                        void import("@/lib/sidebar/chat-list-meta").then(({ markChatUnread }) => {
                            markChatUnread(conversationId);
                        });
                    }
                    if (!error) {
                        void import("@/lib/notifications/desktop").then(({ showDesktopNotification }) =>
                            showDesktopNotification("generationComplete", "BetterShape", "Generation finished"),
                        );
                    }
                    return;
                }
                turnIdRef.current = null;
                setIsLoading(false);
                setActivityLabel(null);
                setTurnPhase(
                    error === "Cancelled" ? "cancelled" : error ? "failed" : "completed",
                );
                setTurnId(null);
                if (error && error !== "Cancelled") {
                    setSendError(error);
                } else if (!error) {
                    void import("@/lib/notifications/desktop").then(({ showDesktopNotification }) =>
                        showDesktopNotification("generationComplete", "BetterShape", "Generation finished"),
                    );
                }
                // Cancelled turns are persisted server-side — resync so Stop
                // doesn't leave a wiped/empty assistant bubble.
                if (error === "Cancelled") {
                    void reloadViewedMessages();
                    return;
                }
                setMessages((prev) => {
                    const latest = prev[prev.length - 1];
                    if (!latest || latest.role !== "assistant") return prev;
                    const updated = [...prev];
                    updated[updated.length - 1] = {
                        ...latest,
                        content: typeof content === "string" && content.length > 0 ? content : latest.content,
                        stats: stats ?? latest.stats,
                        model: model ?? latest.model,
                    };
                    // After applying a chosen design concept, remove the temp React sandbox.
                    const priorUser = prev
                        .slice(0, -1)
                        .reverse()
                        .find((m) => m.role === "user");
                    if (
                        !error &&
                        (priorUser?.content?.includes("Selected design concept") ||
                            priorUser?.content?.includes('<bettershape_action type="design_selected"'))
                    ) {
                        void commands.cleanupDesignSandbox();
                    }
                    return updated;
                });
            }),
        );

        // Approval alerts: OS notification only when unfocused. Focused window
        // already has in-chat approval cards — no sticky in-app toasts.
        const notifiedApprovalIds = new Set<string>();
        const notifyApprovalOsOnly = (id: string | undefined, title: string, body: string) => {
            const key = id?.trim() || `${title}:${body}`;
            if (notifiedApprovalIds.has(key)) return;
            notifiedApprovalIds.add(key);
            void import("@/lib/notifications/desktop").then(({ showDesktopNotification }) =>
                showDesktopNotification("approvalRequired", title, body),
            );
        };

        register(
            listen<{
                id?: string;
                command?: string;
                reason?: string;
                safety?: string;
            }>("agent-command-pending", (event) => {
                const cmd = event.payload?.command?.trim() || "Command";
                const reason = event.payload?.reason?.trim();
                patchLive(undefined, (live) => {
                    live.turnPhase = "awaiting_approval";
                    live.activityLabel = "Waiting for approval";
                });
                notifyApprovalOsOnly(
                    event.payload?.id,
                    "Approval required",
                    reason ? `${cmd}: ${reason}` : cmd,
                );
            }),
        );

        register(
            listen<{
                id?: string;
                file?: string;
                reason?: string;
            }>("agent-edit-pending", (event) => {
                const file = event.payload?.file?.trim() || "file";
                const reason = event.payload?.reason?.trim();
                patchLive(undefined, (live) => {
                    live.turnPhase = "awaiting_approval";
                    live.activityLabel = "Waiting for edit approval";
                });
                notifyApprovalOsOnly(
                    event.payload?.id,
                    "Edit approval required",
                    reason ? `${file}: ${reason}` : file,
                );
            }),
        );

        register(
            listen<{ id?: string; conversationId?: string }>("agent-ask-pending", (event) => {
                patchLive(event.payload?.conversationId, (live) => {
                    live.turnPhase = "awaiting_input";
                    live.activityLabel = "Waiting for your answers";
                });
            }),
        );

        // Clear sticky approval labels once the user resolves the gate.
        register(
            listen<{ id?: string; approved?: boolean }>("agent-command-resolved", () => {
                patchLive(undefined, (live) => {
                    live.turnPhase = "running_command";
                    live.activityLabel = "Running command";
                });
            }),
        );
        register(
            listen<{ id?: string; approved?: boolean }>("agent-edit-resolved", () => {
                patchLive(undefined, (live) => {
                    live.turnPhase = "editing";
                    live.activityLabel = "Editing file";
                });
            }),
        );

        register(
            listen<{ phase?: string; tool?: string; label?: string; conversationId?: string }>("chat_status", (event) => {
                const { phase, tool, label, conversationId } = event.payload ?? {};
                if (isForeignConversation(conversationId)) return;
                let nextPhase: TurnPhase | null = null;
                let nextLabel: string | null = null;
                if (phase === "approval") {
                    nextPhase = label === "Waiting for your answers" ? "awaiting_input" : "awaiting_approval";
                    nextLabel = label?.trim() || "Waiting for approval";
                } else if (phase === "model") {
                    nextPhase = "thinking";
                    nextLabel = label?.trim() || "Thinking";
                } else if (phase === "tool") {
                    nextPhase = phaseFromTool(tool);
                    nextLabel = labelForPhase(nextPhase, tool, label);
                } else if (label?.trim()) {
                    nextLabel = label.trim();
                }
                if (!nextPhase && !nextLabel) return;
                patchLive(conversationId, (live) => {
                    if (nextPhase) live.turnPhase = nextPhase;
                    if (nextLabel) live.activityLabel = nextLabel;
                });
            }),
        );

        register(
            listen<{ conversationId?: string }>("chat_context_summarized", (event) => {
                const convId = event.payload?.conversationId ?? null;
                patchLive(convId, (liveTurn) => {
                    liveTurn.activityLabel = "Summarizing context";
                });
                if (!convId || viewingIdRef.current === convId) setContextSummarized(true);
            }),
        );

        void bootstrapFromBackend();

        return () => {
            disposed = true;
            unlisteners.forEach((fn) => fn());
        };
    }, [bootstrapFromBackend, reloadViewedMessages, setViewed]);

    const getViewedConversationId = React.useCallback(() => viewingIdRef.current, []);
    const getDraftConversationId = React.useCallback(() => draftConversationIdRef.current, []);
    const hasLiveTurn = React.useCallback(
        (id: string | null) => liveTurnsRef.current.has(id ?? PENDING_KEY),
        [],
    );

    const value: ChatStreamContextValue = {
        isLoading,
        messages,
        activityLabel,
        turnPhase,
        turnId,
        sendError,
        contextSummarized,
        viewedConversationId,
        setMessages,
        setSendError,
        setContextSummarized,
        getViewedConversationId,
        getDraftConversationId,
        showConversation,
        isCurrentView,
        reloadViewedMessages,
        bootstrapFromBackend,
        setDraftAdopter,
        appendUserOptimistic,
        stopLiveTurn,
        startDraftChat,
        hasLiveTurn,
    };

    return (
        <ChatStreamContext.Provider value={value}>{children}</ChatStreamContext.Provider>
    );
}

export function useChatStream() {
    const ctx = React.useContext(ChatStreamContext);
    if (!ctx) {
        throw new Error("useChatStream must be used within ChatStreamProvider");
    }
    return ctx;
}

/** Safe variant for editor surfaces that may render outside ChatStreamProvider (e.g. popout). */
export function useChatStreamOptional(): ChatStreamState {
    const ctx = React.useContext(ChatStreamContext);
    return ctx ?? defaultState;
}
