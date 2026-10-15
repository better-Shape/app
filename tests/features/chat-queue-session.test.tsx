/**
 * Regression: a message queued while a chat is generating must continue in that chat.
 *
 * Reported bug: sending from the queue started a *new* conversation instead of
 * continuing the current one. Root causes covered here:
 *  - the backend's "current conversation" was left unset/stale when a still-running chat
 *    was resumed, and `send_chat_message` silently starts a fresh chat in that case;
 *  - the queue drained whenever the global "generating" flag flipped, regardless of the
 *    chat on screen, and before the in-flight send had settled (dropping messages);
 *  - queued sends wiped the composer and grabbed pending attachments.
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
    initialization: vi.fn(),
    expand: vi.fn(),
    current: null as string | null,
    sent: [] as { message: string; conversationId: string | null }[],
    compacted: [] as Array<string | undefined>,
    pendingSends: [] as Array<() => void>,
    pendingRejects: [] as Array<(error: Error) => void>,
    failNextSend: false,
    nextId: 1,
    conversations: new Set<string>(["X", "Y"]),
}));

const stream = vi.hoisted(() => ({
    adopter: null as null | ((id: string) => void),
    liveConvId: null as string | null,
    api: null as null | { setIsLoading: (v: boolean) => void },
}));

vi.mock("@/lib/ai/bootstrap", () => ({ waitForAiConfiguration: backend.initialization }));
vi.mock("@/lib/backend", () => ({
    useProjectState: () => ({ project_path: "/proj" }),
    commands: {
        getCurrentConversationId: vi.fn(async () => backend.current),
        loadConversation: vi.fn(async (id: string) => {
            if (!backend.conversations.has(id)) throw new Error("Conversation not found");
            backend.current = id;
        }),
        newChat: vi.fn(async () => {
            backend.current = null;
        }),
        // The trailing argument is the chat the message belongs to (see sendMessageNow).
        sendChatMessage: vi.fn(async (...args: unknown[]) => {
            const message = args[0] as string;
            const explicit = args[15] as string | null | undefined;
            if (backend.failNextSend) {
                backend.failNextSend = false;
                throw new Error("boom");
            }
            const target = explicit || backend.current || `new-${backend.nextId++}`;
            // A draft's first turn binds to its new id (the store's chat_started does this).
            if (!explicit) stream.adopter?.(target);
            backend.current = target;
            backend.sent.push({ message, conversationId: target });
            stream.liveConvId = target;
            return new Promise<string>((resolve, reject) => {
                backend.pendingRejects.push(reject);
                backend.pendingSends.push(() => resolve("ok"));
            });
        }),
        getConversations: vi.fn(async () => []),
        getChatTitle: vi.fn(async () => "Chat"),
        getChatHistory: vi.fn(async () => []),
        getChatGenerationState: vi.fn(async () => ({ isGenerating: false })),
        stopChatMessage: vi.fn(async () => {}),
        clearChatHistory: vi.fn(async () => {}),
        compactChat: vi.fn(async (opts?: { focus?: string }) => {
            backend.compacted.push(opts?.focus);
            return {
                record: { messagesBefore: 8, messagesAfter: 3, tokensSaved: 900 },
                messages: 3,
                tokensBefore: 4000,
                tokensAfter: 1200,
                alreadySmall: false,
                error: null,
            };
        }),
    },
}));

vi.mock("@/features/chat/lib/chat-stream-store", async () => {
    const ReactModule = await import("react");
    return {
        // Callbacks are memoized like the real store; unstable identities would loop the hook's effects.
        useChatStream: () => {
            const [isLoading, setIsLoading] = ReactModule.useState(false);
            const [messages, setMessages] = ReactModule.useState<unknown[]>([]);
            const [sendError, setSendError] = ReactModule.useState<string | null>(null);
            const [contextSummarized, setContextSummarized] = ReactModule.useState(false);
            const [viewedConversationId, setViewed] = ReactModule.useState<string | null>(null);
            const viewRef = ReactModule.useRef<string | null>(null);
            const seqRef = ReactModule.useRef(0);
            stream.api = { setIsLoading };
            const getViewedConversationId = ReactModule.useCallback(() => viewRef.current, []);
            const getDraftConversationId = ReactModule.useCallback(() => null, []);
            const showConversation = ReactModule.useCallback((id: string | null) => {
                viewRef.current = id;
                setViewed(id);
                // A chat that is still generating resumes its live state; any other view is idle.
                setIsLoading(Boolean(id && stream.liveConvId === id));
                return ++seqRef.current;
            }, []);
            const isCurrentView = ReactModule.useCallback(
                (seq: number) => seqRef.current === seq,
                [],
            );
            const reloadViewedMessages = ReactModule.useCallback(async () => null, []);
            const bootstrapFromBackend = ReactModule.useCallback(async () => {}, []);
            // Mirror the real store: on mount the view adopts the backend's current chat.
            ReactModule.useEffect(() => {
                if (backend.current) showConversation(backend.current);
            }, []);
            const setDraftAdopter = ReactModule.useCallback((fn: ((id: string) => void) | null) => {
                // As in the store: binding a draft's turn also moves a draft view onto the new chat.
                stream.adopter = fn
                    ? (id: string) => {
                          const request = requests.current.get(null);
                          if (request) { requests.current.delete(null); requests.current.set(id, request); }
                          if (viewRef.current === null) {
                              viewRef.current = id;
                              setViewed(id);
                          }
                          fn(id);
                      }
                    : null;
            }, []);
            const requests = ReactModule.useRef(new Map<string | null, string>());
            const appendUserOptimistic = ReactModule.useCallback((_message: string, target: string | null, id: string) => {
                requests.current.set(target, id); setIsLoading(true);
            }, []);
            const ownsRequest = ReactModule.useCallback((target: string | null, id: string) => requests.current.get(target) === id, []);
            const getRequestOwner = ReactModule.useCallback((requestId: string) => {
                for (const [conversationId, owned] of requests.current) {
                    if (owned === requestId) return { conversationId };
                }
                return null;
            }, []);
            const stopLiveTurn = ReactModule.useCallback((target = viewRef.current) => {
                const id = requests.current.get(target) ?? null;
                requests.current.delete(target);
                if (stream.liveConvId === target) stream.liveConvId = null;
                if (viewRef.current === target) setIsLoading(false);
                return id;
            }, []);
            const prepareStop = ReactModule.useCallback((target: string | null) => {
                const requestId = requests.current.get(target) ?? null;
                if (!requestId && stream.liveConvId !== target) return null;
                return { conversationId: target, requestId, commit: () => {
                    if (requests.current.get(target) !== requestId) return;
                    requests.current.delete(target);
                    if (viewRef.current === target) setIsLoading(false);
                } };
            }, []);
            const startDraftChat = ReactModule.useCallback(() => {
                showConversation(null);
                setMessages([]);
            }, [showConversation]);
            // Same source as the view's spinner: the chat whose turn is running.
            const hasLiveTurn = ReactModule.useCallback(
                (id: string | null) => Boolean(id && stream.liveConvId === id),
                [],
            );
            return {
                hasLiveTurn,
                ownsRequest,
                getRequestOwner,
                isLoading,
                messages,
                activityLabel: null,
                turnPhase: "idle",
                turnId: null,
                sendError,
                setSendError,
                contextSummarized,
                setContextSummarized,
                setMessages,
                viewedConversationId,
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
            };
        },
    };
});

const tauriEvents = vi.hoisted(() => ({
    handlers: new Map<string, Set<(event: { payload: unknown }) => void>>(),
}));

vi.mock("@tauri-apps/api/event", () => ({
    listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
        if (!tauriEvents.handlers.has(name)) tauriEvents.handlers.set(name, new Set());
        tauriEvents.handlers.get(name)!.add(handler);
        return () => {
            tauriEvents.handlers.get(name)?.delete(handler);
        };
    }),
}));
vi.mock("@/lib/settings", () => ({
    getSettings: () => ({
        ai: {
            customRules: "",
            workflows: [],
            autoRunMode: "ask",
            requireEditApproval: false,
            protectDestructiveGit: true,
            pluginApprovalDefault: "ask",
            pluginApprovals: {},
            pluginDisabledActions: {},
            reviewAdversarialEnabled: false,
            autoApplyEdits: false,
            subagentModels: [],
            subagentDefaultModel: "auto",
            enabledModels: [],
            defaultModel: "auto",
        },
    }),
}));
vi.mock("@/lib/settings/models", () => ({
    getVisibleModels: () => [],
    resolveChatModels: (m: unknown[]) => m,
    sanitizeEnabledModels: () => [],
    subagentModelsForSend: () => ({ models: [], defaultModel: "auto" }),
}));
vi.mock("@/lib/catalog/store", () => ({
    getCatalogDefaultEnabledIds: () => [],
    getCatalogModels: () => [],
    isCatalogModelAllowed: () => true,
    useBetterShapeCatalog: () => ({ catalog: null }),
}));
vi.mock("@/lib/ai/providers", () => ({
    hasAnyUsableProvider: () => true,
}));
vi.mock("@/features/notifications", () => ({ notify: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/chat/incognito", () => ({
    isIncognitoChat: () => false,
    purgeIncognitoConversation: async () => {},
    setIncognitoChat: async () => {},
    syncIncognitoFromBackend: async () => {},
}));
vi.mock("@/lib/chat/mentions", () => ({
    buildMessageWithMentions: backend.expand,
    mentionRanges: () => [],
}));
vi.mock("@/lib/chat/continue-action", () => ({ buildPlanBuildMessage: (p: string) => p }));
vi.mock("@/lib/chat/workflows", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/chat/workflows")>();
    return {
        ...actual,
        applyWorkflows: (m: string) => m,
        matchWorkflows: () => [],
        workflowAllowKeys: () => [],
    };
});
vi.mock("@/lib/workspace/rules", () => ({
    listProjectRuleFiles: async () => [],
    loadProjectRules: async () => "",
}));
vi.mock("@/lib/workspace/trust", () => ({ isWorkspaceTrusted: () => false }));
vi.mock("@/lib/agent-preview/store", () => ({
    clearAllDesignPreviewSessions: () => {},
    trySelectPendingDesignConcept: async () => {},
}));
vi.mock("@/features/chat/ui/composer/attachments", () => ({
    createPendingAttachment: vi.fn(),
    processAttachment: vi.fn(),
}));
vi.mock("@/features/chat/ui/shell/tabs", () => ({
    NEW_CHAT_TAB_ID: "__new__",
    isEphemeralChatTabId: (id: string) => id.startsWith("__"),
}));
vi.mock("@/features/chat/ui/shell/history", () => ({ openChatHistoryMenu: () => {} }));
vi.mock("@/features/chat/ui/md/renderer", () => ({ parseMessageContent: () => [] }));
vi.mock("@/features/chat/lib/proposed-edits", () => ({
    setProposedEdit: () => {},
    getProposedEdit: () => undefined,
    clearProposedEdit: () => {},
    clearAllProposedEdits: () => {},
    setCurrentConversationId: () => {},
    markFileResolved: () => {},
    isFileResolved: () => false,
    getResolvedFiles: () => ({}),
    getResolvedContentHash: () => undefined,
    editContentHash: () => "",
    pathsEqual: (a: string, b: string) => a === b,
}));
vi.mock("@/features/chat/lib/chat-session-utils", () => ({
    resolveChatFilePath: (p: string) => p,
    syncProposedEditsFromMessages: () => {},
    groupChatMessages: () => [],
}));
vi.mock("@/features/agent/subagents/store", () => ({ resetSubagentsForParent: () => {} }));
vi.mock("@/features/chat/lib/generating-chats", () => {
    const generating = new Set<string>();
    return {
        setChatGenerating: (id: string | null | undefined, on: boolean) => {
            if (!id) return;
            if (on) generating.add(id);
            else generating.delete(id);
        },
        isChatGenerating: (id: string | null | undefined) => Boolean(id && generating.has(id)),
    };
});

import { commands } from "@/lib/backend";
import { useChatSession } from "@/features/chat/lib/use-chat-session";

type Session = ReturnType<typeof useChatSession>;

let root: Root;
let host: HTMLDivElement;
let session: Session;

function Harness({ onRender }: { onRender: (s: Session) => void }) {
    const messagesEndRef = React.useRef<HTMLDivElement>(null);
    const scrollContainerRef = React.useRef<HTMLDivElement>(null);
    const current = useChatSession(messagesEndRef, scrollContainerRef);
    React.useEffect(() => {
        onRender(current);
    });
    return null;
}

async function settle(rounds = 6) {
    for (let i = 0; i < rounds; i++) {
        await act(async () => {
            await new Promise((r) => setTimeout(r, 0));
        });
    }
}

/** Delivers a backend event to the frontend listeners, as Tauri would. */
function emitTauriEvent(name: string, payload: unknown) {
    act(() => {
        for (const handler of tauriEvents.handlers.get(name) ?? []) handler({ payload });
    });
}

/** Mirrors the backend's `chat_complete` event: the turn is over, the invoke may still be pending. */
function emitChatComplete() {
    stream.liveConvId = null;
    act(() => stream.api?.setIsLoading(false));
}

/** Mirrors the backend's `send_chat_message` invoke resolving (the turn fully returned). */
async function resolveOldestSend() {
    const resolve = backend.pendingSends.shift();
    backend.pendingRejects.shift();
    if (!resolve) throw new Error("no pending send to resolve");
    await act(async () => {
        resolve();
    });
}

/** Types into the composer and presses Enter, exactly like the user does. */
async function typeAndSend(text: string) {
    await act(async () => {
        session.setInputValue(text);
    });
    await act(async () => {
        await session.handleSendMessage();
    });
}

/**
 * Starts a turn that stays running until the test settles its invoke. The send is not
 * awaited: the promise only resolves when the whole turn returns, like the real backend.
 */
async function startTurn(text: string) {
    await act(async () => {
        session.setInputValue(text);
    });
    act(() => {
        void session.handleSendMessage();
    });
    await settle();
}

function sentMessages() {
    return backend.sent.map((s) => `${s.message}@${s.conversationId}`);
}

beforeEach(async () => {
    vi.mocked(commands.stopChatMessage).mockReset().mockResolvedValue(undefined);
    backend.initialization.mockReset().mockResolvedValue(undefined);
    backend.expand.mockReset().mockImplementation(async (message: string) => message);
    backend.current = "X";
    backend.sent = [];
    backend.compacted = [];
    backend.pendingSends = [];
    backend.pendingRejects = [];
    backend.failNextSend = false;
    backend.nextId = 1;
    stream.liveConvId = null;
    tauriEvents.handlers.clear();
    localStorage.clear();

    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
        root.render(React.createElement(Harness, { onRender: (s: Session) => { session = s; } }));
    });
    await settle();
});

afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
});

describe("queued messages continue the conversation they were queued in", () => {
    it("does not start a new chat when New Chat is clicked mid-turn, and delivers the queue to the original chat", async () => {
        expect(session.conversationId).toBe("X");

        // Turn A starts in chat X.
        await startTurn("A");
        expect(sentMessages()).toEqual(["A@X"]);

        // User types B while A is generating: it is queued for X.
        await typeAndSend("B");
        expect(session.messageQueue.map((m) => [m.content, m.conversationId])).toEqual([["B", "X"]]);

        // User starts a New Chat while A keeps running in the background.
        await act(async () => {
            await session.handleNewChat();
        });
        await settle();
        // Regression: the queued B used to fire here, into the brand-new chat.
        expect(sentMessages()).toEqual(["A@X"]);
        expect(session.messageQueue).toEqual([]); // B belongs to X, not the draft on screen

        // User switches back to chat X, which is still generating.
        await act(async () => {
            await session.handleSelectChatTab("X");
        });
        await settle();
        expect(session.conversationId).toBe("X");
        // The backend must point at X again, or the next send would start a new chat.
        expect(backend.current).toBe("X");
        expect(session.messageQueue.map((m) => m.content)).toEqual(["B"]);

        // Turn A finishes. The invoke for A is still settling when chat_complete arrives.
        emitChatComplete();
        await settle();
        expect(sentMessages()).toEqual(["A@X"]);

        await resolveOldestSend();
        await settle();
        expect(sentMessages()).toEqual(["A@X", "B@X"]);
        expect(session.messageQueue).toEqual([]);
        expect(backend.current).toBe("X");
    });

    it("a message queued after returning to a still-running chat never starts a new chat", async () => {
        await startTurn("A");
        await act(async () => {
            await session.handleNewChat();
        });
        await settle();
        await act(async () => {
            await session.handleSelectChatTab("X");
        });
        await settle();
        expect(backend.current).toBe("X");

        // Queued while A is still generating in X.
        await typeAndSend("C");

        // A finishes. Its invoke settles first, which refreshes the metadata, then the
        // idle transition reaches the queue. Before the fix this sent C into a new chat
        // ("C@new-1"), because the backend pointer had been cleared by New Chat.
        await resolveOldestSend();
        await settle();
        emitChatComplete();
        await settle();

        expect(sentMessages()).toEqual(["A@X", "C@X"]);
        expect(backend.current).toBe("X");
    });

    it("does not drop a queued message when the turn completes before the send settles", async () => {
        await startTurn("A");
        await typeAndSend("B");
        expect(session.messageQueue.map((m) => m.content)).toEqual(["B"]);

        emitChatComplete();
        await settle();
        // Still pending: nothing may be sent, and B must not be lost.
        expect(sentMessages()).toEqual(["A@X"]);
        expect(session.messageQueue.map((m) => m.content)).toEqual(["B"]);

        await resolveOldestSend();
        await settle();
        expect(sentMessages()).toEqual(["A@X", "B@X"]);
        expect(session.messageQueue).toEqual([]);
    });

    it("sending the queue leaves whatever the user is typing in the composer", async () => {
        await startTurn("A");
        await typeAndSend("B");

        emitChatComplete();
        await settle();
        act(() => {
            session.setInputValue("half-typed thought");
        });

        await resolveOldestSend();
        await settle();
        expect(sentMessages()).toEqual(["A@X", "B@X"]);
        expect(session.inputValue).toBe("half-typed thought");
    });

    it("keeps a queued message when its send fails, instead of losing it", async () => {
        await startTurn("A");
        await typeAndSend("B");

        backend.failNextSend = true;
        emitChatComplete();
        await settle();
        await resolveOldestSend();
        await settle();

        expect(sentMessages()).toEqual(["A@X"]); // B's attempt failed before reaching the backend
        expect(session.messageQueue.map((m) => [m.content, m.conversationId])).toEqual([["B", "X"]]);
    });

    it("a draft chat adopts the id of its first turn, so messages queued during it stay in that chat", async () => {
        await act(async () => {
            await session.handleNewChat();
        });
        await settle();
        expect(session.conversationId).toBeNull();

        await startTurn("first");
        const firstChat = backend.current;
        expect(firstChat).toMatch(/^new-/);
        // The backend announces the new chat's id while the draft turn runs.
        emitTauriEvent("chat_title", { title: "first", conversationId: firstChat });
        expect(sentMessages()).toEqual([`first@${firstChat}`]);

        await typeAndSend("second");
        expect(session.messageQueue.map((m) => [m.content, m.conversationId])).toEqual([
            ["second", firstChat],
        ]);

        emitChatComplete();
        await settle();
        await resolveOldestSend();
        await settle();
        expect(sentMessages()).toEqual([`first@${firstChat}`, `second@${firstChat}`]);
    });
});

describe("a build from a plan goes to the chat the plan was made in", () => {
    const buildEvent = (detail: { path: string; title?: string; conversationId?: string | null }) =>
        act(() => {
            window.dispatchEvent(new CustomEvent("bettershape-build-plan", { detail }));
        });

    it("sends the build to the named chat and moves the view there", async () => {
        expect(session.conversationId).toBe("X");
        buildEvent({ path: "/plans/p.md", title: "Plan", conversationId: "Y" });
        await settle();

        const sent = sentMessages();
        expect(sent).toHaveLength(1);
        expect(sent[0]).toContain("/plans/p.md");
        expect(sent[0].endsWith("@Y")).toBe(true);
        // The view moves to the chat the build lands in, so the user sees it happen.
        expect(session.conversationId).toBe("Y");
    });

    it("with no chat id, builds in the chat on screen", async () => {
        buildEvent({ path: "/plans/p.md", title: "Plan" });
        await settle();
        const sent = sentMessages();
        expect(sent).toHaveLength(1);
        expect(sent[0].endsWith("@X")).toBe(true);
    });

    it("queues a build for a chat that is busy, instead of dropping it", async () => {
        await startTurn("A");
        expect(sentMessages()).toEqual(["A@X"]);
        buildEvent({ path: "/plans/p.md", title: "Plan", conversationId: "X" });
        await settle();
        expect(sentMessages()).toEqual(["A@X"]);
        expect(session.messageQueue.map((m) => m.conversationId)).toEqual(["X"]);
    });
});

describe("built-in slash commands run instead of being sent as text", () => {
    it("compacts the chat when /compact is typed, with the focus passed through", async () => {
        await typeAndSend("/compact keep the failing tests");
        await settle();

        expect(backend.compacted).toEqual(["keep the failing tests"]);
        expect(sentMessages()).toEqual([]); // never reaches the model as a message
        expect(session.inputValue).toBe(""); // composer cleared, like any other send
    });

    it("still runs bare /compact, with no focus", async () => {
        await typeAndSend("/compact");
        await settle();

        expect(backend.compacted).toEqual([undefined]);
        expect(sentMessages()).toEqual([]);
    });

    it("leaves a message that merely mentions /compact alone", async () => {
        await startTurn("why is /compact not running?");
        expect(sentMessages()).toEqual(["why is /compact not running?@X"]);
        expect(backend.compacted).toEqual([]);
    });
});

it("preserves the composer and does not send while provider initialization is pending", async () => {
    let ready!: () => void;
    backend.initialization.mockImplementation(() => new Promise<void>(resolve => { ready = resolve; }));
    act(() => session.handleInputChange({ target: { value: "wait for keys" } } as React.ChangeEvent<HTMLTextAreaElement>));
    act(() => { void session.handleSendMessage(); });
    await settle();
    expect(backend.sent).toEqual([]);
    expect(session.inputValue).toBe("wait for keys");
    await act(async () => ready()); await settle();
    expect(sentMessages()).toEqual(["wait for keys@X"]);
    await resolveOldestSend();
});

it("does not send after Stop while provider initialization was pending", async () => {
    let ready!: () => void;
    backend.initialization.mockImplementation(() => new Promise<void>(resolve => { ready = resolve; }));
    act(() => session.handleInputChange({ target: { value: "keep this draft" } } as React.ChangeEvent<HTMLTextAreaElement>));
    act(() => { void session.handleSendMessage(); });
    await settle();
    await act(async () => session.handleStopMessage());
    await act(async () => ready()); await settle();
    expect(backend.sent).toEqual([]);
    expect(session.inputValue).toBe("keep this draft");
});

it("retains the running owner after Stop rejects and permits retry", async () => {
    await startTurn("running");
    vi.mocked(commands.stopChatMessage).mockRejectedValueOnce(new Error("temporary"));
    await act(async () => { await session.handleStopMessage(); });
    expect(session.isLoading).toBe(true);
    await act(async () => { await session.handleStopMessage(); });
    expect(commands.stopChatMessage).toHaveBeenCalledTimes(2);
    expect(session.isLoading).toBe(false);
    await resolveOldestSend();
});
it("restores send-now queue entries when Stop fails instead of dispatching a replacement", async () => {
    await startTurn("running");
    await typeAndSend("queued");
    const queued = session.messageQueue[0];
    vi.mocked(commands.stopChatMessage).mockRejectedValueOnce(new Error("temporary"));
    await act(async () => { await session.handleSendQueuedNow(queued.id); });
    expect(session.messageQueue.map(item => item.content)).toEqual(["queued"]);
    expect(sentMessages()).toEqual(["running@X"]);
    expect(session.isLoading).toBe(true);
    await typeAndSend("still queued");
    expect(session.messageQueue.map(item => item.content)).toEqual(["queued", "still queued"]);
    await resolveOldestSend();
});

it("holds follow-ups and reports a rejected draft send after its request binds", async () => {
    await act(async () => { await session.handleNewChat(); });
    await settle();
    await startTurn("first draft message");
    const owner = backend.current;
    expect(owner).toMatch(/^new-/);
    await typeAndSend("queued follow-up");
    expect(session.messageQueue[0]?.conversationId).toBe(owner);
    await act(async () => { backend.pendingSends.shift(); backend.pendingRejects.shift()!(new Error("bound send failed")); });
    await settle();
    expect(session.sendError).toBe("bound send failed");
    expect(session.isLoading).toBe(false);
    act(() => stream.api?.setIsLoading(false));
    await settle();
    expect(backend.sent).toHaveLength(1);
    expect(session.messageQueue.map(item => [item.content, item.conversationId])).toEqual([["queued follow-up", owner]]);
});

it("does not replace another chat's error or transcript when a background send rejects", async () => {
    const { notify } = await import("@/features/notifications");
    vi.mocked(notify.error).mockClear();
    await startTurn("background send");
    await act(async () => { await session.handleLoadConversation("Y"); });
    await settle();
    const visible = session.messages;
    await act(async () => { backend.pendingSends.shift(); backend.pendingRejects.shift()!(new Error("background failure")); });
    await settle();
    expect(session.conversationId).toBe("Y");
    expect(session.messages).toEqual(visible);
    expect(session.sendError).toBeNull();
    expect(notify.error).toHaveBeenCalledWith("Could not send message", expect.stringContaining("queued messages remain paused"));
});

it("does not dispatch after unmount during asynchronous mention preparation", async () => {
    let finish!: (message: string) => void;
    backend.expand.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    await act(async () => session.setInputValue("prepare me"));
    let pending!: Promise<boolean>;
    act(() => { pending = session.handleSendMessage(); });
    await settle();
    expect(backend.expand).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    await act(async () => { finish("prepared"); await Promise.resolve(); });
    // If the backend is wrongly reached, settle it so a failed regression cannot leak a pending send.
    if (backend.pendingSends.length) await resolveOldestSend();
    await act(async () => { await pending; });
    expect(backend.sent).toEqual([]);
});

it("cancels late preparation even when native Stop fails before dispatch", async () => {
    let finish!: (message: string) => void;
    backend.expand.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    await act(async () => session.setInputValue("prepare me"));
    let pending!: Promise<boolean>;
    act(() => { pending = session.handleSendMessage(); });
    await settle();
    vi.mocked(commands.stopChatMessage).mockRejectedValueOnce(new Error("Stop unavailable"));
    await act(async () => session.handleStopMessage());
    await act(async () => { finish("prepared"); await Promise.resolve(); });
    if (backend.pendingSends.length) await resolveOldestSend();
    await act(async () => { await pending; });
    expect(backend.sent).toEqual([]);
    expect(session.isLoading).toBe(false);
});
