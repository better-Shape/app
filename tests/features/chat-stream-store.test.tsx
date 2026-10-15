/**
 * Regression tests for the chat stream store's view ownership.
 *
 * Reported bugs covered here:
 *  - a chat clicked in the tab strip showed a different chat's messages, because the
 *    store adopted the backend's "current" chat as the view on every sync;
 *  - a slow load for a chat the user had already left could overwrite the chat on screen;
 *  - a chat that started in the background took over the view (and copied the viewed
 *    transcript into its own live turn).
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/lib/backend/types";

const backend = vi.hoisted(() => ({
    current: null as string | null,
    /** Pending `getCurrentConversationId` calls, resolved by the test. */
    currentResolvers: [] as Array<(id: string | null) => void>,
    /** Pending `getConversationMessages` calls, resolved by the test. */
    messageRequests: [] as Array<{ id: string; resolve: (m: unknown[]) => void }>,
}));

const events = vi.hoisted(() => ({
    handlers: new Map<string, Set<(event: { payload: unknown }) => void>>(),
}));

vi.mock("@tauri-apps/api/event", () => ({
    listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
        if (!events.handlers.has(name)) events.handlers.set(name, new Set());
        events.handlers.get(name)!.add(handler);
        return () => {
            events.handlers.get(name)?.delete(handler);
        };
    }),
}));

vi.mock("@/lib/backend", () => ({
    commands: {
        getCurrentConversationId: vi.fn(
            () => new Promise<string | null>((resolve) => backend.currentResolvers.push(resolve)),
        ),
        getConversationMessages: vi.fn(
            (id: string) => new Promise<unknown[]>((resolve) => backend.messageRequests.push({ id, resolve })),
        ),
        getChatGenerationState: vi.fn(async () => ({
            isGenerating: false,
            conversationId: null,
            turnId: null,
            activityLabel: null,
        })),
        cleanupDesignSandbox: vi.fn(async () => {}),
    },
}));

import { ChatStreamProvider, useChatStream } from "@/features/chat/lib/chat-stream-store";
import { getChatActivities, resetChatActivitiesForTests } from "@/features/chat/lib/chat-activity";
import { isChatGenerating, resetGeneratingChatsForTests } from "@/features/chat/lib/generating-chats";

type Api = ReturnType<typeof useChatStream>;

let root: Root;
let host: HTMLDivElement;
let api: Api;

function Consumer({ onRender }: { onRender: (api: Api) => void }) {
    const value = useChatStream();
    React.useEffect(() => {
        onRender(value);
    });
    return null;
}

async function settle(rounds = 4) {
    for (let i = 0; i < rounds; i++) {
        await act(async () => {
            await new Promise((r) => setTimeout(r, 0));
        });
    }
}

/** Mount the provider, then answer the mount-time `getCurrentConversationId` with `currentId`. */
async function mount(currentId: string | null) {
    await act(async () => {
        root.render(
            React.createElement(
                ChatStreamProvider,
                null,
                React.createElement(Consumer, { onRender: (a: Api) => (api = a) }),
            ),
        );
    });
    const resolveCurrent = backend.currentResolvers.shift();
    if (!resolveCurrent) throw new Error("bootstrap did not ask for the current chat");
    await act(async () => resolveCurrent(currentId));
    await settle();
}

/** Answer the oldest pending `getConversationMessages` request for `id`. */
async function answerMessages(id: string, messages: unknown[]) {
    const index = backend.messageRequests.findIndex((r) => r.id === id);
    if (index < 0) throw new Error(`no pending load for ${id}`);
    const [req] = backend.messageRequests.splice(index, 1);
    await act(async () => req.resolve(messages));
    await settle();
}

const turnAliases = new Map<string, string>();
function nativeTurnId(alias: string): string {
    if (!turnAliases.has(alias)) turnAliases.set(alias, `${turnAliases.size + 1}:${alias}`);
    return turnAliases.get(alias)!;
}
function emit(name: string, payload: unknown) {
    if (payload && typeof payload === "object" && "turnId" in payload && typeof payload.turnId === "string") {
        payload = { ...payload, turnId: nativeTurnId(payload.turnId) };
    }
    act(() => {
        for (const handler of events.handlers.get(name) ?? []) handler({ payload });
    });
}

const msg = (role: "user" | "assistant", content: string): ChatMessage =>
    ({ role, content, timestamp: 1 }) as ChatMessage;

beforeEach(() => {
    turnAliases.clear();
    backend.current = null;
    backend.currentResolvers = [];
    backend.messageRequests = [];
    events.handlers.clear();
    resetGeneratingChatsForTests();
    resetChatActivitiesForTests();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
});

describe("the view is chosen by the user, not by the backend pointer", () => {
    it("adopts the backend's current chat on first mount and shows its transcript", async () => {
        await mount("A");
        await answerMessages("A", [msg("user", "hello A")]);
        expect(api.viewedConversationId).toBe("A");
        expect(api.messages.map((m) => m.content)).toEqual(["hello A"]);
    });

    it("keeps a choice made before the mount-time bootstrap answers", async () => {
        await act(async () => {
            root.render(
                React.createElement(
                    ChatStreamProvider,
                    null,
                    React.createElement(Consumer, { onRender: (a: Api) => (api = a) }),
                ),
            );
        });
        // The user picks chat B while the backend is still answering "which chat is current?".
        await act(async () => {
            api.showConversation("B");
        });
        const resolveCurrent = backend.currentResolvers.shift();
        await act(async () => resolveCurrent?.("A"));
        await settle();
        expect(api.viewedConversationId).toBe("B");
    });

    it("drops a load for a chat the user has already left", async () => {
        await mount(null);

        let seqB = 0;
        let seqC = 0;
        act(() => {
            seqB = api.showConversation("B");
        });
        let loadB!: Promise<unknown>;
        act(() => {
            loadB = api.reloadViewedMessages(seqB);
        });
        act(() => {
            seqC = api.showConversation("C");
        });
        let loadC!: Promise<unknown>;
        act(() => {
            loadC = api.reloadViewedMessages(seqC);
        });

        await answerMessages("C", [msg("user", "from C")]);
        await act(async () => {
            await loadC;
        });
        // B answers last, after the user has moved on to C.
        await answerMessages("B", [msg("user", "from B")]);
        expect(await loadB).toBeNull();

        expect(api.viewedConversationId).toBe("C");
        expect(api.messages.map((m) => m.content)).toEqual(["from C"]);
    });
});

describe("a chat that runs in the background stays in the background", () => {
    it("does not take over the view when it starts, and its live turn does not copy the viewed chat", async () => {
        await mount("A");
        await answerMessages("A", [msg("user", "A question"), msg("assistant", "A answer")]);
        expect(api.viewedConversationId).toBe("A");

        emit("chat_started", { conversationId: "B", turnId: "t-b", model: "m" });
        emit("chat_token", { chunk: "streamed", conversationId: "B", turnId: "t-b" });

        // The user is still looking at A, and A is not running.
        expect(api.viewedConversationId).toBe("A");
        expect(api.isLoading).toBe(false);
        expect(api.messages.map((m) => m.content)).toEqual(["A question", "A answer"]);

        // Opening B shows B's own live turn: its streamed text, not A's transcript.
        act(() => {
            api.showConversation("B");
        });
        expect(api.isLoading).toBe(true);
        expect(api.messages.map((m) => m.content)).toEqual(["streamed"]);
    });

    it("binds a draft's first turn to its new id, and moves the draft view onto it", async () => {
        await mount(null);
        const adopted: string[] = [];
        act(() => {
            api.setDraftAdopter((id) => adopted.push(id));
        });
        // A send from the draft shows its message first; that creates the pending turn.
        act(() => {
            api.appendUserOptimistic("first", null, "r-1");
        });
        emit("chat_started", { conversationId: "N1", turnId: "t-1", requestId: "r-1" });
        expect(adopted).toEqual(["N1"]);
        expect(api.viewedConversationId).toBe("N1");
        expect(api.getDraftConversationId()).toBe("N1");
    });

    it("a chat that starts while a draft is pending does not take the draft's turn", async () => {
        await mount(null);
        act(() => {
            api.appendUserOptimistic("draft words", null, "r-draft");
        });
        // Another chat starts first. It carries a different request id, so it must not bind.
        emit("chat_started", { conversationId: "B", turnId: "t-b", requestId: "r-other" });
        expect(api.getDraftConversationId()).toBeNull();
        expect(api.messages.map((m) => m.content)).toEqual(["draft words", ""]);

        // The draft's own turn then binds to its new id.
        emit("chat_started", { conversationId: "N2", turnId: "t-2", requestId: "r-draft" });
        expect(api.getDraftConversationId()).toBe("N2");
    });
});


describe("runtime event ownership", () => {
    it("does not attribute unscoped or unknown status events to the viewed chat when two turns run", async () => {
        await mount(null);
        emit("chat_started", { conversationId: "A", turnId: "t-a" });
        emit("chat_started", { conversationId: "B", turnId: "t-b" });
        act(() => { api.showConversation("A"); });
        emit("chat_status", { phase: "approval" });
        emit("chat_status", { conversationId: "missing", phase: "approval" });
        expect(api.turnPhase).toBe("thinking");
        emit("chat_status", { conversationId: "B", phase: "approval" });
        expect(api.turnPhase).toBe("thinking");
        expect(getChatActivities().get("B")).toBe("approval");
    });

    it("keeps a newer turn alive when old tokens and completion arrive late", async () => {
        await mount(null);
        emit("chat_started", { conversationId: "A", turnId: "old" });
        emit("chat_started", { conversationId: "A", turnId: "new" });
        act(() => { api.showConversation("A"); });
        emit("chat_token", { conversationId: "A", turnId: "old", chunk: "obsolete" });
        emit("chat_complete", { conversationId: "A", turnId: "old", error: "Old failure" });
        expect(api.isLoading).toBe(true);
        expect(api.turnId).toBe(nativeTurnId("new"));
        expect(isChatGenerating("A")).toBe(true);
        expect(api.messages.some((message) => message.content.includes("obsolete"))).toBe(false);
        emit("chat_complete", { conversationId: "A", turnId: "new", error: "429 rate limit" });
        expect(getChatActivities().get("A")).toBe("limited");
        expect(api.isLoading).toBe(false);
    });

    it("does not let a background token steal a pending draft before chat_started", async () => {
        await mount(null);
        act(() => { api.appendUserOptimistic("draft", null, "draft-request"); });
        emit("chat_token", { conversationId: "B", turnId: "background", chunk: "background words" });
        expect(api.getDraftConversationId()).toBeNull();
        expect(api.messages.map((message) => message.content)).toEqual(["draft", ""]);
        emit("chat_started", { conversationId: "New", turnId: "draft-turn", requestId: "draft-request" });
        expect(api.getDraftConversationId()).toBe("New");
        expect(api.messages.map((message) => message.content)).toEqual(["draft", ""]);
    });

    it("distinguishes input and background waiting using actual runtime phases", async () => {
        await mount(null);
        emit("chat_started", { conversationId: "A", turnId: "t-a" });
        emit("agent-ask-pending", { id: "question" });
        expect(getChatActivities().get("A")).toBe("input");
        emit("chat_status", { phase: "tool", tool: "wait" });
        expect(getChatActivities().get("A")).toBe("waiting");
        emit("chat_complete", { conversationId: "A", turnId: "t-a", error: "Cancelled" });
        expect(getChatActivities().has("A")).toBe(false);
    });
});

it("does not restart a viewed idle chat from an orphaned token", async () => {
    await mount("A");
    await answerMessages("A", [msg("user", "Saved transcript")]);
    emit("chat_token", { conversationId: "A", chunk: "stale unowned text" });
    emit("chat_token", { conversationId: "A", turnId: "unknown-turn", chunk: "also stale" });
    expect(api.isLoading).toBe(false);
    expect(api.messages.map((message) => message.content)).toEqual(["Saved transcript"]);
    expect(isChatGenerating("A")).toBe(false);
    expect(getChatActivities().has("A")).toBe(false);
});

it.each(["command", "edit"])("scopes %s approvals and resolutions to their emitting live turn", async (kind) => {
    await mount(null);
    emit("chat_started", { conversationId: "A", turnId: "t-a" });
    emit("chat_started", { conversationId: "B", turnId: "t-b" });
    act(() => { api.showConversation("A"); });
    emit(`agent-${kind}-pending`, { id: "approval-b", conversationId: "B", turnId: "t-b" });
    expect(api.turnPhase).toBe("thinking");
    expect(getChatActivities().get("B")).toBe("approval");
    act(() => { api.showConversation("B"); });
    expect(api.turnPhase).toBe("awaiting_approval");
    emit(`agent-${kind}-resolved`, { id: "approval-b", conversationId: "B", turnId: "old-b", approved: true });
    emit("chat_status", { conversationId: "B", turnId: "old-b", phase: "model" });
    expect(api.turnPhase).toBe("awaiting_approval");
    emit(`agent-${kind}-resolved`, { id: "approval-b", conversationId: "B", turnId: "t-b", approved: false });
    expect(api.turnPhase).toBe("thinking");
});

it("keeps an optimistic replacement alive when old events arrive before its chat_started", async () => {
    await mount(null);
    emit("chat_started", { conversationId: "A", turnId: "old" });
    act(() => { api.showConversation("A"); api.appendUserOptimistic("new request", "A", "new-request"); });
    emit("chat_token", { conversationId: "A", turnId: "old", chunk: "obsolete text" });
    emit("chat_status", { conversationId: "A", turnId: "old", phase: "approval" });
    emit("chat_complete", { conversationId: "A", turnId: "old", error: "Cancelled" });
    expect(api.isLoading).toBe(true);
    expect(api.turnPhase).toBe("thinking");
    expect(api.messages.some((message) => message.content.includes("obsolete"))).toBe(false);
    emit("chat_started", { conversationId: "A", turnId: "new", requestId: "new-request" });
    emit("chat_token", { conversationId: "A", turnId: "new", chunk: "new response" });
    expect(api.turnId).toBe(nativeTurnId("new"));
    expect(api.isLoading).toBe(true);
    expect(api.messages.some((message) => message.content.includes("new response"))).toBe(true);
});

it("reloads the persisted transcript for the exact stopped turn", async () => {
    await mount("A"); await answerMessages("A", [msg("user", "Question")]);
    emit("chat_started", { conversationId: "A", turnId: "stopped" });
    act(() => api.stopLiveTurn());
    emit("chat_complete", { conversationId: "A", turnId: "stopped", error: "Cancelled" });
    await answerMessages("A", [msg("user", "Question"), msg("assistant", "Persisted partial response")]);
    expect(api.messages.at(-1)?.content).toBe("Persisted partial response");
    expect(api.isLoading).toBe(false);
});

it("does not reload a stopped completion over a replacement send", async () => {
    await mount("A"); await answerMessages("A", [msg("user", "Question")]);
    emit("chat_started", { conversationId: "A", turnId: "stopped" });
    act(() => api.stopLiveTurn());
    act(() => api.appendUserOptimistic("Replacement", "A", "new-request"));
    emit("chat_complete", { conversationId: "A", turnId: "stopped", error: "Cancelled" });
    expect(backend.messageRequests).toHaveLength(0);
    expect(api.isLoading).toBe(true);
    expect(api.messages.some((message) => message.content === "Replacement")).toBe(true);
});

it("does not re-adopt a stopped turn from a delayed start after its replacement", async () => {
    await mount("A"); await answerMessages("A", [msg("user", "Question")]);
    emit("chat_started", { conversationId: "A", turnId: "stopped" });
    act(() => api.stopLiveTurn());
    act(() => api.appendUserOptimistic("Replacement", "A", "new-request"));
    emit("chat_started", { conversationId: "A", turnId: "stopped" });
    emit("chat_token", { conversationId: "A", turnId: "stopped", chunk: "obsolete" });
    expect(api.turnId).toBe(null);
    expect(api.messages.some((message) => message.content.includes("obsolete"))).toBe(false);
    emit("chat_started", { conversationId: "A", turnId: "new", requestId: "new-request" });
    expect(api.turnId).toBe(nativeTurnId("new"));
});

it.each(["A", null])("does not revive a stopped optimistic request for %s, even after its replacement", async (target) => {
    const { createChatRequestId } = await import("@/lib/chat/request-ownership");
    await mount(target);
    if (target) await answerMessages(target, []);
    const oldRequest = createChatRequestId(target);
    act(() => api.appendUserOptimistic("old", target, oldRequest));
    act(() => { api.stopLiveTurn(); });
    const nextRequest = createChatRequestId(target);
    act(() => api.appendUserOptimistic("new", target, nextRequest));
    const oldId = target ?? "old-draft";
    const nextId = target ?? "new-draft";
    emit("chat_started", { conversationId: oldId, turnId: "old", requestId: oldRequest });
    expect(api.turnId).toBeNull();
    expect(api.viewedConversationId).toBe(target);
    emit("chat_started", { conversationId: nextId, turnId: "new", requestId: nextRequest });
    emit("chat_started", { conversationId: oldId, turnId: "old", requestId: oldRequest });
    expect(api.viewedConversationId).toBe(nextId);
    expect(api.turnId).toBe(nativeTurnId("new"));
    emit("chat_complete", { conversationId: nextId, turnId: "new" });
    emit("chat_started", { conversationId: nextId, turnId: "new", requestId: nextRequest });
    expect(api.isLoading).toBe(false);
});

it("seeds turn ordering from native restoration before accepting delayed starts", async () => {
    const { commands } = await import("@/lib/backend");
    nativeTurnId("old");
    vi.mocked(commands.getChatGenerationState).mockResolvedValueOnce({
        isGenerating: true, turnId: nativeTurnId("restored"), requestId: "old-window:%22A%22:17", conversationId: "A", activityLabel: "Thinking", partialContent: null,
    });
    await mount("A"); await answerMessages("A", [msg("assistant", "current")]);
    emit("chat_started", { conversationId: "A", turnId: "old" });
    emit("chat_token", { conversationId: "A", turnId: "old", chunk: "obsolete" });
    expect(api.turnId).toBe(nativeTurnId("restored"));
    expect(api.messages.map(m => m.content)).toEqual(["current"]);
    act(() => expect(api.stopLiveTurn()).toBe("old-window:%22A%22:17"));
});

it("stopping a background owner does not stop the conversation on screen", async () => {
    await mount("A"); await answerMessages("A", []);
    emit("chat_started", { conversationId: "A", turnId: "a" });
    emit("chat_started", { conversationId: "B", turnId: "b" });
    act(() => api.stopLiveTurn("B"));
    expect(api.isLoading).toBe(true);
    expect(api.turnId).toBe(nativeTurnId("a"));
    expect(api.hasLiveTurn("A")).toBe(true);
    expect(api.hasLiveTurn("B")).toBe(false);
});
