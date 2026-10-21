"use client";

import React from "react";
import { TurnOrder } from "@/lib/chat/turn-order";
import { isLocalChatRequest } from "@/lib/chat/request-ownership";
import { listen } from "@tauri-apps/api/event";
import { commands } from "@/lib/backend";
import type { ChatMessage, MessageUsageStatsPayload } from "@/lib/backend/types";
import { setChatActivity } from "./chat-activity";
import { setChatGenerating } from "./generating-chats";
import { NEW_CHAT_TAB_ID } from "../ui/shell/tabs";
import { upsertTaggedBlockInContent } from "./upsert-stream-blocks";

import { parseChatStatus, type TurnPhase } from "./chat-status";
export type { TurnPhase } from "./chat-status";

function isForeignConversation(id?: string | null) {
    return Boolean(id && id.startsWith("mw-worker-"));
}

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
    /** Warm `id`'s transcript into the bounded LRU cache without changing the active view. */
    prefetchConversation: (id: string | null | undefined) => void;
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
    /** Capture ownership without retiring it. Commit only after native Stop acknowledges. */
    prepareStop: (conversationId: string | null) => {
        conversationId: string | null;
        requestId: string | null;
        turnId: string | null;
        commit: () => void;
    } | null;
    /** Retire a known cancelled or failed local owner. */
    stopLiveTurn: (conversationId?: string | null) => string | null;
    /** Leave a running turn in the background and show an empty draft. */
    startDraftChat: () => void;
    /** True while chat `id` (`null` = the draft) has a turn the frontend is tracking. */
    hasLiveTurn: (id: string | null) => boolean;
    ownsRequest: (id: string | null, requestId: string) => boolean;
    getRequestOwner: (requestId: string) => { conversationId: string | null } | null;
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

export type ChatStreamStatusState = {
    isLoading: boolean;
    viewedConversationId: string | null;
};

const defaultStatusState: ChatStreamStatusState = {
    isLoading: false,
    viewedConversationId: null,
};

const ChatStreamStatusContext = React.createContext<ChatStreamStatusState>(defaultStatusState);
const ChatStreamViewedIdContext = React.createContext<string | null>(null);

type ChatStreamGettersValue = {
    getViewedMessages: () => ChatMessage[];
};

const defaultGettersValue: ChatStreamGettersValue = {
    getViewedMessages: () => defaultState.messages,
};

const ChatStreamGettersContext = React.createContext<ChatStreamGettersValue>(defaultGettersValue);

/**
 * Turn-level state without the transcript. Streaming replaces `messages` on
 * every token; surfaces that only show a spinner or the viewed id subscribe
 * here so they do not re-render per token.
 */
export type ChatStreamMeta = Pick<
    ChatStreamState,
    | "isLoading"
    | "activityLabel"
    | "turnPhase"
    | "turnId"
    | "sendError"
    | "contextSummarized"
    | "viewedConversationId"
>;

const ChatStreamMetaContext = React.createContext<ChatStreamMeta | null>(null);

const PENDING_KEY = "__pending__";
const MAX_TRANSCRIPT_CACHE = 24;
const PREFETCH_EVENT = "bettershape-chat-prefetch";

/**
 * Speculatively warm a conversation's transcript in the bounded resident LRU cache
 * on hover/focus without requiring caller components to sit inside `ChatStreamProvider`.
 */
export const prefetchChatConversation = (id: string | null | undefined): void => {
    if (!id || id === NEW_CHAT_TAB_ID || typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(PREFETCH_EVENT, { detail: { id } }));
};

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

/** Renders the ChatStreamProvider UI component. */
export const ChatStreamProvider = ({ children }: { children: React.ReactNode }) => {
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
    // Last known transcript per conversation (bounded LRU), so a switch paints before the load lands.
    const transcriptCacheRef = React.useRef<Map<string, ChatMessage[]>>(new Map());
    const prefetchInflightRef = React.useRef<Map<string, Promise<void>>>(new Map());
    const streamFlushRafRef = React.useRef<number>(0);
    const streamFlushDirtyRef = React.useRef<boolean>(false);

    const readCachedTranscript = React.useCallback((id: string): ChatMessage[] | undefined => {
        const hit = transcriptCacheRef.current.get(id);
        if (hit !== undefined) {
            transcriptCacheRef.current.delete(id);
            transcriptCacheRef.current.set(id, hit);
        }
        return hit;
    }, []);

    const writeCachedTranscript = React.useCallback((id: string, transcript: ChatMessage[]) => {
        if (!id || id === NEW_CHAT_TAB_ID) return;
        if (transcriptCacheRef.current.has(id)) {
            transcriptCacheRef.current.delete(id);
        }
        transcriptCacheRef.current.set(id, transcript);
        while (transcriptCacheRef.current.size > MAX_TRANSCRIPT_CACHE) {
            const oldest = transcriptCacheRef.current.keys().next().value;
            if (oldest === undefined) break;
            transcriptCacheRef.current.delete(oldest);
        }
    }, []);

    const cancelPendingStreamFrame = React.useCallback(() => {
        if (streamFlushRafRef.current) {
            cancelAnimationFrame(streamFlushRafRef.current);
            streamFlushRafRef.current = 0;
        }
        streamFlushDirtyRef.current = false;
    }, []);
    const draftConversationIdRef = React.useRef<string | null>(null);
    const draftAdopterRef = React.useRef<((conversationId: string) => void) | null>(null);
    const messagesRef = React.useRef<ChatMessage[]>(messages);
    const turnIdRef = React.useRef<string | null>(null);
    const ignoredIdsRef = React.useRef<Set<string>>(new Set());
    const stoppedTurnsRef = React.useRef(new Map<string, string>());
    // Turns that already reported a Cancelled completion. A stopped turn reports twice:
    // Stop's own completion, then the turn finishing its persistence. The second one still
    // carries the transcript that turn wrote last, so it must not be dropped as stale.
    const cancelledTurnsRef = React.useRef(new Map<string, string>());
    const turnOrderRef = React.useRef(new TurnOrder());

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
            cancelPendingStreamFrame();
            // Keep the transcript on screen for the chat being left, so coming back is instant.
            if (viewingIdRef.current) {
                writeCachedTranscript(viewingIdRef.current, messagesRef.current);
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
                const transcript = id ? (cached ?? readCachedTranscript(id) ?? []) : [];
                if (id && cached) writeCachedTranscript(id, cached);
                messagesRef.current = transcript;
                applyIdle(transcript);
            }
            return seq;
        },
        [applyIdle, applyLive, cancelPendingStreamFrame, readCachedTranscript, setViewed, writeCachedTranscript],
    );

    const canStorePrefetchedTranscript = React.useCallback(
        (targetId: string) =>
            viewingIdRef.current !== targetId &&
            !liveTurnsRef.current.has(targetId) &&
            !transcriptCacheRef.current.has(targetId),
        [],
    );

    const prefetchConversation = React.useCallback(
        (id: string | null | undefined) => {
            if (!id || id === NEW_CHAT_TAB_ID || isForeignConversation(id)) return;
            if (!canStorePrefetchedTranscript(id) || prefetchInflightRef.current.has(id)) return;

            const job = commands
                .getConversationMessages(id)
                .then((history) => {
                    if (canStorePrefetchedTranscript(id)) {
                        writeCachedTranscript(id, history);
                    }
                })
                .catch(() => {
                    /* Ignore background prefetch errors */
                })
                .finally(() => {
                    prefetchInflightRef.current.delete(id);
                });
            prefetchInflightRef.current.set(id, job);
        },
        [canStorePrefetchedTranscript, writeCachedTranscript],
    );

    React.useEffect(() => {
        const onPrefetch = (e: Event) => {
            const id = (e as CustomEvent<{ id?: string }>).detail?.id;
            if (id) prefetchConversation(id);
        };
        window.addEventListener(PREFETCH_EVENT, onPrefetch as EventListener);
        return () => window.removeEventListener(PREFETCH_EVENT, onPrefetch as EventListener);
    }, [prefetchConversation]);

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
                    && gen.turnId !== null && gen.turnId !== undefined
                    && turnOrderRef.current.start(id, gen.turnId)
                ) {
                    liveTurnsRef.current.set(id, {
                        conversationId: id,
                        turnId: gen.turnId,
                        requestId: gen.requestId ?? null,
                        messages: history,
                        activityLabel: gen.activityLabel ?? "Thinking",
                        turnPhase: "thinking",
                    });
                }
                writeCachedTranscript(id, history);
                const live = liveTurnsRef.current.get(id);
                if (live) applyLive(live);
                else applyIdle(history);
                return history;
            } catch (err) {
                console.error("Failed to load chat messages:", err);
                return null;
            }
        },
        [applyIdle, applyLive, isCurrentView, writeCachedTranscript],
    );

    const bootstrapFromBackend = React.useCallback(async () => {
        if (viewChosenRef.current) return;
        const cid = await commands.getCurrentConversationId().catch(() => null);
        if (viewChosenRef.current) return;
        const seq = showViewInternal(cid);
        await reloadViewedMessages(seq);
    }, [reloadViewedMessages, showViewInternal]);

    const stopLiveTurn = React.useCallback((conversationId?: string | null) => {
        const id = conversationId === undefined ? viewingIdRef.current : conversationId;
        const requestId = liveTurnsRef.current.get(id ?? PENDING_KEY)?.requestId ?? null;
        if (id) {
            ignoredIdsRef.current.add(id);
            const stoppedTurn = liveTurnsRef.current.get(id)?.turnId;
            if (stoppedTurn) {
                stoppedTurnsRef.current.set(id, stoppedTurn);
                turnOrderRef.current.finish(id, stoppedTurn);
            }
            liveTurnsRef.current.delete(id);
            setChatGenerating(id, false);
            setChatActivity(id, "cancelled");
        } else {
            // A draft has no conversation id yet, so the generating mark `useSyncChatGenerating`
            // sets is keyed by the new-chat tab. Nothing was admitted natively, so no
            // completion event will arrive to clear it: without this, the close guard keeps
            // treating the app as generating after the user stopped the draft.
            liveTurnsRef.current.delete(PENDING_KEY);
            setChatGenerating(NEW_CHAT_TAB_ID, false);
        }
        if (viewingIdRef.current === id) {
            turnIdRef.current = null;
            setIsLoading(false);
            setActivityLabel(null);
            setTurnPhase("cancelled");
            setTurnId(null);
        }
        return requestId;
    }, []);

    const prepareStop = React.useCallback((conversationId: string | null) => {
        const captured = liveTurnsRef.current.get(conversationId ?? PENDING_KEY);
        if (!captured) return null;
        return {
            conversationId: captured.conversationId,
            requestId: captured.requestId ?? null,
            turnId: captured.turnId,
            commit: () => {
                // A draft may bind while Stop waits. Follow its request, never the selected tab.
                for (const [key, live] of liveTurnsRef.current) {
                    if (live === captured || (captured.requestId && live.requestId === captured.requestId)) {
                        stopLiveTurn(key === PENDING_KEY ? null : key);
                        return;
                    }
                }
            },
        };
    }, [stopLiveTurn]);

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
            if (conversationId) {
                ignoredIdsRef.current.delete(conversationId);
                stoppedTurnsRef.current.delete(conversationId);
            }
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
            promise.then((fn) => {
                if (disposed) fn();
                else unlisteners.push(fn);
            }).catch(() => undefined);
        };

        const turnOrder = turnOrderRef.current;

        /** The draft's turn now has a real conversation id: bind it (and the draft queue). */
        const bindDraft = (conversationId: string) => {
            draftConversationIdRef.current = conversationId;
            draftAdopterRef.current?.(conversationId);
        };

        /** Resolve a scoped turn owner; accept legacy unscoped events only when exactly one live turn exists. */
        const resolveLiveKey = (conversationId?: string | null) => {
            if (conversationId) return liveTurnsRef.current.has(conversationId) ? conversationId : null;
            // Legacy unscoped events are only safe when exactly one turn exists.
            // The selected tab does not identify which background agent emitted one.
            if (liveTurnsRef.current.size === 1) return liveTurnsRef.current.keys().next().value ?? null;
            return null;
        };

        const resolveLiveOwner = (conversationId?: string | null, turnId?: string) => {
            const key = resolveLiveKey(conversationId);
            if (!key || ignoredIdsRef.current.has(key)) return null;
            const live = liveTurnsRef.current.get(key);
            if (!live || (turnId && turnId !== live.turnId)) return null;
            return { key, live };
        };

        /** Apply updates only to an admitted matching turn, updating its activity independently of which conversation is visible. */
        const patchLive = (conversationId: string | null | undefined, update: (live: LiveTurn) => void, turnId?: string) => {
            const owner = resolveLiveOwner(conversationId, turnId);
            if (!owner) return;
            const { key, live } = owner;
            update(live);
            setChatGenerating(live.conversationId, true);
            setChatActivity(live.conversationId, live.turnPhase);
            const shown = viewingIdRef.current
                ? viewingIdRef.current === live.conversationId
                : key === PENDING_KEY;
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
                const eventRequestId = event.payload?.requestId ?? null;
                const pending = liveTurnsRef.current.get(PENDING_KEY);
                if (isLocalChatRequest(eventRequestId)
                    && pending?.requestId !== eventRequestId
                    && (!convId || liveTurnsRef.current.get(convId)?.requestId !== eventRequestId)) return;
                if (isForeignConversation(convId) || !tid || !turnOrder.start(convId ?? PENDING_KEY, tid)) return;
                if (convId && stoppedTurnsRef.current.get(convId) === tid) return;
                if (convId) {
                    stoppedTurnsRef.current.delete(convId);
                    cancelledTurnsRef.current.delete(convId);
                }
                setChatActivity(convId, "thinking");
                const startedModel = event.payload?.model;
                const usedAuto = event.payload?.usedAuto;
                if (convId) {
                    setChatGenerating(convId, true);
                    setChatGenerating(NEW_CHAT_TAB_ID, false);
                    ignoredIdsRef.current.delete(convId);
                }
                // Only the send that opened the draft may bind it. The draft's turn has no chat
                // id until this event, so the request id is the only link between the two. Any
                // other chat that starts meanwhile keeps its own transcript and leaves the draft alone.
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
                    requestId: eventRequestId,
                    messages: snapshot,
                    activityLabel: "Thinking",
                    turnPhase: "thinking",
                });
                if (bindsDraft && convId) bindDraft(convId);
                const stayOnThisTurn = adoptsView || viewingIdRef.current === convId;
                if (stayOnThisTurn) {
                    cancelPendingStreamFrame();
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
                    const key = resolveLiveKey(meta?.conversationId);
                    if (!key) return;
                    const convId = key === PENDING_KEY ? null : key;
                    if (convId && ignoredIdsRef.current.has(convId)) return;
                    const current = liveTurnsRef.current.get(key);
                    if (!current || (meta?.turnId && meta.turnId !== current.turnId)) return;

                    if (meta?.turnId) current.turnId = meta.turnId;
                    current.messages = appendAssistantChunk(current.messages, chunk);
                    setChatGenerating(current.conversationId, true);
                    setChatActivity(current.conversationId, current.turnPhase);

                    const shown = viewingIdRef.current
                        ? viewingIdRef.current === current.conversationId
                        : key === PENDING_KEY;
                    if (!shown) return;

                    messagesRef.current = current.messages;

                    // Leading-edge 0ms paint on first token of a frame; coalesce sub-frame bursts onto rAF.
                    if (!streamFlushRafRef.current && typeof requestAnimationFrame === "function") {
                        setMessages(current.messages);
                        setIsLoading(true);
                        setActivityLabel(current.activityLabel);
                        setTurnPhase(current.turnPhase);
                        setTurnId(current.turnId);
                        streamFlushDirtyRef.current = false;
                        streamFlushRafRef.current = requestAnimationFrame(() => {
                            streamFlushRafRef.current = 0;
                            if (!streamFlushDirtyRef.current) return;
                            streamFlushDirtyRef.current = false;
                            const activeKey = viewingIdRef.current ?? PENDING_KEY;
                            const activeLive = liveTurnsRef.current.get(activeKey);
                            if (activeLive) {
                                messagesRef.current = activeLive.messages;
                                setMessages(activeLive.messages);
                                setIsLoading(true);
                                setActivityLabel(activeLive.activityLabel);
                                setTurnPhase(activeLive.turnPhase);
                                setTurnId(activeLive.turnId);
                            }
                        });
                    } else if (!streamFlushRafRef.current) {
                        setMessages(current.messages);
                        setIsLoading(true);
                        setActivityLabel(current.activityLabel);
                        setTurnPhase(current.turnPhase);
                        setTurnId(current.turnId);
                    } else {
                        streamFlushDirtyRef.current = true;
                    }
                },
            ),
        );

        register(
            listen<{
                stats?: MessageUsageStatsPayload;
                model?: string;
                error?: string;
                conversationId?: string;
                turnId?: string;
                content?: string;
            }>("chat_complete", (event) => {
                const { stats, model, error, conversationId, content, turnId } =
                    event.payload ?? {};
                if (isForeignConversation(conversationId)) return;
                const targetKey = conversationId ?? PENDING_KEY;
                if (turnId) turnOrder.finish(targetKey, turnId);
                const current = liveTurnsRef.current.get(targetKey);
                if (conversationId && turnId && stoppedTurnsRef.current.get(conversationId) === turnId) {
                    stoppedTurnsRef.current.delete(conversationId);
                    cancelledTurnsRef.current.set(conversationId, turnId);
                    // Stop removed the live owner, but its saved transcript still belongs to
                    // this exact turn. Never refresh over a replacement optimistic send.
                    if (!current && viewingIdRef.current === conversationId) reloadViewedMessages().catch(() => undefined);
                    return;
                }
                if (conversationId && turnId && !current && cancelledTurnsRef.current.get(conversationId) === turnId) {
                    // The cancelled turn is finishing its own persistence, after Stop already
                    // released the UI. Its transcript is the one it just wrote, so resync to
                    // it — still never over a replacement optimistic send (`!current`).
                    if (viewingIdRef.current === conversationId) reloadViewedMessages().catch(() => undefined);
                    return;
                }
                if (turnId && turnId !== current?.turnId) return;
                if (!conversationId ? viewingIdRef.current === null : viewingIdRef.current === conversationId) {
                    if (streamFlushDirtyRef.current && current) {
                        messagesRef.current = current.messages;
                        setMessages(current.messages);
                    }
                    cancelPendingStreamFrame();
                }
                setChatActivity(conversationId, error === "Cancelled" ? "cancelled" : error ? "failed" : "completed", error);
                if (!error && stats) {
                    import("@/lib/chat/last-turn-usage").then(({ setLastTurnUsage }) => {
                        setLastTurnUsage({
                            tokens: stats.tokens ?? ((stats.inputTokens ?? 0) + (stats.outputTokens ?? 0)),
                            inputTokens: stats.inputTokens,
                            usedAuto: stats.usedAuto,
                        });
                    }).catch(() => undefined);
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
                const shown = Boolean(conversationId) && viewingIdRef.current === conversationId;
                if (!shown) {
                    if (conversationId) {
                        import("@/lib/sidebar/chat-list-meta").then(({ markChatUnread }) => {
                            markChatUnread(conversationId);
                        }).catch(() => undefined);
                    }
                    if (!error) {
                        import("@/lib/notifications/desktop").then(({ showDesktopNotification }) =>
                            showDesktopNotification("generationComplete", "BetterShape", "Generation finished"),
                        ).catch(() => undefined);
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
                    import("@/lib/notifications/desktop").then(({ showDesktopNotification }) =>
                        showDesktopNotification("generationComplete", "BetterShape", "Generation finished"),
                    ).catch(() => undefined);
                }
                // Cancelled turns are persisted server-side — resync so Stop
                // doesn't leave a wiped/empty assistant bubble.
                if (error === "Cancelled") {
                    if (conversationId && turnId) cancelledTurnsRef.current.set(conversationId, turnId);
                    reloadViewedMessages().catch(() => undefined);
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
                        commands.cleanupDesignSandbox().catch(() => undefined);
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
            import("@/lib/notifications/desktop").then(({ showDesktopNotification }) =>
                showDesktopNotification("approvalRequired", title, body),
            ).catch(() => undefined);
        };

        register(
            listen<{
                id?: string;
                conversationId?: string;
                turnId?: string;
                command?: string;
                reason?: string;
                safety?: string;
            }>("agent-command-pending", (event) => {
                const cmd = event.payload?.command?.trim() || "Command";
                const reason = event.payload?.reason?.trim();
                patchLive(event.payload?.conversationId, (live) => {
                    live.turnPhase = "awaiting_approval";
                    live.activityLabel = "Waiting for approval";
                }, event.payload?.turnId);
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
                conversationId?: string;
                turnId?: string;
                file?: string;
                reason?: string;
            }>("agent-edit-pending", (event) => {
                const file = event.payload?.file?.trim() || "file";
                const reason = event.payload?.reason?.trim();
                patchLive(event.payload?.conversationId, (live) => {
                    live.turnPhase = "awaiting_approval";
                    live.activityLabel = "Waiting for edit approval";
                }, event.payload?.turnId);
                notifyApprovalOsOnly(
                    event.payload?.id,
                    "Edit approval required",
                    reason ? `${file}: ${reason}` : file,
                );
            }),
        );

        register(
            listen<{ id?: string; conversationId?: string; turnId?: string }>("agent-ask-pending", (event) => {
                patchLive(event.payload?.conversationId, (live) => {
                    live.turnPhase = "awaiting_input";
                    live.activityLabel = "Waiting for your answers";
                }, event.payload?.turnId);
            }),
        );

        // Clear sticky approval labels once the user resolves the gate.
        const approvalResolutions = [
            ["agent-command-resolved", "running_command", "Running command"],
            ["agent-edit-resolved", "editing", "Editing file"],
        ] as const;
        for (const [eventName, approvedPhase, approvedLabel] of approvalResolutions) {
            register(
                listen<{ id?: string; approved?: boolean; conversationId?: string; turnId?: string }>(
                    eventName,
                    (event) => {
                        const payload = event.payload;
                        patchLive(
                            payload.conversationId,
                            (live) => {
                                live.turnPhase =
                                    payload.approved === false ? "thinking" : approvedPhase;
                                live.activityLabel =
                                    payload.approved === false ? "Thinking" : approvedLabel;
                            },
                            payload.turnId,
                        );
                    },
                ),
            );
        }

        register(
            listen<{ phase?: string; tool?: string; label?: string; conversationId?: string; turnId?: string }>("chat_status", (event) => {
                const { phase, tool, label, conversationId, turnId } = event.payload ?? {};
                if (isForeignConversation(conversationId)) return;
                const status = parseChatStatus({ phase, tool, label });
                if (!status) return;
                patchLive(conversationId, (live) => {
                    if (status.phase) live.turnPhase = status.phase;
                    if (status.label) live.activityLabel = status.label;
                }, turnId);
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

        bootstrapFromBackend().catch(() => undefined);

        return () => {
            disposed = true;
            cancelPendingStreamFrame();
            unlisteners.forEach((fn) => fn());
        };
    }, [bootstrapFromBackend, cancelPendingStreamFrame, reloadViewedMessages, setViewed]);

    const getViewedConversationId = React.useCallback(() => viewingIdRef.current, []);
    const getViewedMessages = React.useCallback(() => messagesRef.current, []);
    const getDraftConversationId = React.useCallback(() => draftConversationIdRef.current, []);

    const statusValue = React.useMemo<ChatStreamStatusState>(
        () => ({ isLoading, viewedConversationId }),
        [isLoading, viewedConversationId],
    );
    const gettersValue = React.useMemo<ChatStreamGettersValue>(
        () => ({ getViewedMessages }),
        [getViewedMessages],
    );
    const hasLiveTurn = React.useCallback(
        (id: string | null) => liveTurnsRef.current.has(id ?? PENDING_KEY),
        [],
    );

    const getRequestOwner = React.useCallback((requestId: string) => {
        for (const live of liveTurnsRef.current.values()) {
            if (live.requestId === requestId) return { conversationId: live.conversationId };
        }
        return null;
    }, []);

    const ownsRequest = React.useCallback((id: string | null, requestId: string) =>
        liveTurnsRef.current.get(id ?? PENDING_KEY)?.requestId === requestId, []);

    const meta = React.useMemo<ChatStreamMeta>(
        () => ({
            isLoading,
            activityLabel,
            turnPhase,
            turnId,
            sendError,
            contextSummarized,
            viewedConversationId,
        }),
        [isLoading, activityLabel, turnPhase, turnId, sendError, contextSummarized, viewedConversationId],
    );

    const actions = React.useMemo(
        () => ({
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
            prepareStop,
            startDraftChat,
            hasLiveTurn,
            prefetchConversation,
            ownsRequest,
            getRequestOwner,
        }),
        [
            getViewedConversationId,
            getDraftConversationId,
            showConversation,
            isCurrentView,
            reloadViewedMessages,
            bootstrapFromBackend,
            setDraftAdopter,
            appendUserOptimistic,
            stopLiveTurn,
            prepareStop,
            startDraftChat,
            hasLiveTurn,
            prefetchConversation,
            ownsRequest,
            getRequestOwner,
        ],
    );

    const value = React.useMemo<ChatStreamContextValue>(
        () => ({ ...meta, messages, ...actions }),
        [meta, messages, actions],
    );

    return (
        <ChatStreamGettersContext.Provider value={gettersValue}>
            <ChatStreamViewedIdContext.Provider value={viewedConversationId}>
                <ChatStreamStatusContext.Provider value={statusValue}>
                    <ChatStreamMetaContext.Provider value={meta}>
                        <ChatStreamContext.Provider value={value}>{children}</ChatStreamContext.Provider>
                    </ChatStreamMetaContext.Provider>
                </ChatStreamStatusContext.Provider>
            </ChatStreamViewedIdContext.Provider>
        </ChatStreamGettersContext.Provider>
    );
};

/** Use chat stream. */
export const useChatStream = () => {
    const ctx = React.useContext(ChatStreamContext);
    if (!ctx) {
        throw new Error("useChatStream must be used within ChatStreamProvider");
    }
    return ctx;
};

/** Safe variant for editor surfaces that may render outside ChatStreamProvider (e.g. popout). */
export const useChatStreamOptional = (): ChatStreamState => {
    const ctx = React.useContext(ChatStreamContext);
    return ctx ?? defaultState;
};

/** Subscribe only to `{ isLoading, viewedConversationId }` (never re-renders on `chat_token`). */
export const useChatStreamStatus = (): ChatStreamStatusState => {
    return React.useContext(ChatStreamStatusContext);
};

/** Subscribe only to `viewedConversationId` (never re-renders on `chat_token` or `isLoading`). */
export const useViewedConversationId = (): string | null => {
    return React.useContext(ChatStreamViewedIdContext);
};

/** Static getter accessors that never trigger context re-renders. */
export function useChatStreamGetters(): ChatStreamGettersValue {
    return React.useContext(ChatStreamGettersContext);
}

/** Turn-level state that does not change per streamed token. */
export function useChatStreamMeta(): ChatStreamMeta {
    const ctx = React.useContext(ChatStreamMetaContext);
    return ctx ?? defaultState;
}
