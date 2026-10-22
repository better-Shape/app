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

const desktopNotifications = vi.hoisted(() => ({ show: vi.fn() }));

vi.mock("@tauri-apps/api/event", () => ({
    listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
        if (!events.handlers.has(name)) events.handlers.set(name, new Set());
        events.handlers.get(name)!.add(handler);
        return () => {
            events.handlers.get(name)?.delete(handler);
        };
    }),
}));

vi.mock("@/lib/notifications/desktop", () => ({
    showDesktopNotification: desktopNotifications.show,
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
import { resetGeneratingChatsForTests } from "@/features/chat/lib/generating-chats";

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

function emit(name: string, payload: unknown) {
    act(() => {
        for (const handler of events.handlers.get(name) ?? []) handler({ payload });
    });
}

const msg = (role: "user" | "assistant", content: string): ChatMessage =>
    ({ role, content, timestamp: 1 }) as ChatMessage;

beforeEach(() => {
    backend.current = null;
    backend.currentResolvers = [];
    backend.messageRequests = [];
    events.handlers.clear();
    desktopNotifications.show.mockClear();
    resetGeneratingChatsForTests();
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

    it("routes chat status only to the matching live conversation and turn", async () => {
        await mount("A");
        await answerMessages("A", [msg("user", "A question")]);

        emit("chat_started", { conversationId: "A", turnId: "t-a", model: "m" });
        emit("chat_started", { conversationId: "B", turnId: "t-b", model: "m" });
        act(() => api.showConversation("B"));
        expect(api.activityLabel).toBe("Thinking");

        // Legacy/unscoped and stale-turn statuses must not mutate either hidden conversation.
        emit("chat_status", { phase: "tool", tool: "run_terminal", label: "Wrong chat" });
        expect(api.activityLabel).toBe("Thinking");
        act(() => api.showConversation("A"));
        expect(api.activityLabel).toBe("Thinking");
        act(() => api.showConversation("B"));

        emit("chat_status", {
            conversationId: "A",
            turnId: "old-turn",
            phase: "tool",
            tool: "run_terminal",
            label: "Stale turn",
        });
        expect(api.activityLabel).toBe("Thinking");
        act(() => api.showConversation("A"));
        expect(api.activityLabel).toBe("Thinking");
        act(() => api.showConversation("B"));

        // A's event arrives while B is visible: it updates A's live state only.
        emit("chat_status", {
            conversationId: "A",
            turnId: "t-a",
            phase: "tool",
            tool: "run_terminal",
            label: "A terminal command",
        });
        expect(api.activityLabel).toBe("Thinking");

        emit("chat_status", {
            conversationId: "B",
            turnId: "t-b",
            phase: "tool",
            tool: "run_terminal",
            label: "B terminal command",
        });
        expect(api.activityLabel).toBe("B terminal command");

        act(() => api.showConversation("A"));
        expect(api.activityLabel).toBe("A terminal command");
    });

    it("ignores a duplicate completion instead of replacing the settled assistant answer", async () => {
        await mount("A");
        await answerMessages("A", [msg("user", "A question"), msg("assistant", "streaming answer")]);
        emit("chat_started", { conversationId: "A", turnId: "turn-a", model: "m" });

        emit("chat_complete", {
            conversationId: "A",
            turnId: "turn-a",
            content: "final answer",
        });
        expect(api.isLoading).toBe(false);
        expect(api.turnId).toBeNull();
        expect(api.messages.at(-1)?.content).toBe("final answer");

        emit("chat_complete", {
            conversationId: "A",
            turnId: "turn-a",
            content: "duplicate stale payload",
        });
        expect(api.isLoading).toBe(false);
        expect(api.turnId).toBeNull();
        expect(api.messages.at(-1)?.content).toBe("final answer");
    });

    it("ignores a stale completion when a newer turn is live for the same conversation", async () => {
        await mount("A");
        await answerMessages("A", [msg("assistant", "existing transcript")]);
        emit("chat_started", { conversationId: "A", turnId: "old-turn", model: "m" });
        emit("chat_started", { conversationId: "A", turnId: "new-turn", model: "m" });
        const transcriptBeforeStaleCompletion = api.messages.map(({ role, content, timestamp }) => ({
            role,
            content,
            timestamp,
        }));

        emit("chat_complete", {
            conversationId: "A",
            turnId: "old-turn",
            content: "stale completion",
        });

        expect(api.isLoading).toBe(true);
        expect(api.turnId).toBe("new-turn");
        expect(api.activityLabel).toBe("Thinking");
        expect(api.messages.map(({ role, content, timestamp }) => ({ role, content, timestamp })))
            .toEqual(transcriptBeforeStaleCompletion);

        emit("chat_token", {
            chunk: "late stale token",
            conversationId: "A",
            turnId: "old-turn",
        });
        expect(api.messages.map(({ role, content, timestamp }) => ({ role, content, timestamp })))
            .toEqual(transcriptBeforeStaleCompletion);
        expect(api.turnId).toBe("new-turn");
    });

    it("sends approval notifications only for accepted live-turn events", async () => {
        await mount("A");
        emit("chat_started", { conversationId: "A", turnId: "t-a", model: "m" });
        emit("chat_started", { conversationId: "B", turnId: "t-b", model: "m" });
        act(() => api.showConversation("B"));

        emit("agent-command-pending", {
            id: "unscoped",
            command: "git status",
        });
        emit("agent-command-pending", {
            id: "stale",
            conversationId: "A",
            turnId: "old-turn",
            command: "git status",
        });
        await settle();
        expect(desktopNotifications.show).not.toHaveBeenCalled();

        emit("agent-command-pending", {
            id: "current",
            conversationId: "A",
            turnId: "t-a",
            command: "git status",
        });
        await settle();
        expect(desktopNotifications.show).toHaveBeenCalledTimes(1);
    });

    it("routes approval pending and resolved events to their owning live turn", async () => {
        await mount("A");
        await answerMessages("A", [msg("user", "A question")]);
        emit("chat_started", { conversationId: "A", turnId: "t-a", model: "m" });
        emit("chat_started", { conversationId: "B", turnId: "t-b", model: "m" });
        act(() => api.showConversation("B"));
        expect(api.activityLabel).toBe("Thinking");

        // Events without ownership and events for another chat cannot take over B's chrome.
        emit("agent-command-pending", { id: "unscoped", command: "git status" });
        emit("agent-ask-pending", { id: "stale", conversationId: "A", turnId: "old-turn" });
        expect(api.activityLabel).toBe("Thinking");

        emit("agent-command-pending", {
            id: "cmd-a",
            command: "git status",
            conversationId: "A",
            turnId: "t-a",
        });
        expect(api.activityLabel).toBe("Thinking");
        act(() => api.showConversation("A"));
        expect(api.activityLabel).toBe("Waiting for approval");

        emit("agent-command-resolved", {
            id: "cmd-a",
            approved: true,
            conversationId: "A",
            turnId: "t-a",
        });
        expect(api.activityLabel).toBe("Running command");

        emit("agent-command-pending", {
            id: "cmd-rejected",
            command: "git push",
            conversationId: "A",
            turnId: "t-a",
        });
        expect(api.activityLabel).toBe("Waiting for approval");
        emit("agent-command-resolved", {
            id: "cmd-rejected",
            approved: false,
            conversationId: "A",
            turnId: "t-a",
        });
        expect(api.activityLabel).toBe("Thinking");

        emit("agent-edit-pending", {
            id: "edit-b",
            file: "src/app.ts",
            conversationId: "B",
            turnId: "t-b",
        });
        expect(api.activityLabel).toBe("Thinking");
        act(() => api.showConversation("B"));
        expect(api.activityLabel).toBe("Waiting for edit approval");

        emit("agent-edit-resolved", {
            id: "edit-b",
            approved: true,
            conversationId: "B",
            turnId: "t-b",
        });
        expect(api.activityLabel).toBe("Editing file");

        emit("agent-edit-pending", {
            id: "edit-rejected",
            path: "src/other.ts",
            conversationId: "B",
            turnId: "t-b",
        });
        expect(api.activityLabel).toBe("Waiting for edit approval");
        emit("agent-edit-resolved", {
            id: "edit-rejected",
            approved: false,
            conversationId: "B",
            turnId: "t-b",
        });
        expect(api.activityLabel).toBe("Thinking");

        emit("agent-ask-pending", {
            id: "ask-a",
            conversationId: "A",
            turnId: "t-a",
        });
        expect(api.activityLabel).toBe("Thinking");
        act(() => api.showConversation("A"));
        expect(api.activityLabel).toBe("Waiting for your answers");
    });

    it("uses operation-specific labels after plugin and MCP server approval", async () => {
        await mount("A");
        emit("chat_started", { conversationId: "A", turnId: "t-a", model: "m" });

        emit("agent-command-pending", {
            id: "plugin",
            command: "mail: send",
            conversationId: "A",
            turnId: "t-a",
        });
        expect(api.activityLabel).toBe("Waiting for approval");
        emit("agent-command-resolved", {
            id: "plugin",
            approved: true,
            activityLabel: "Running plugin action",
            conversationId: "A",
            turnId: "t-a",
        });
        expect(api.activityLabel).toBe("Running plugin action");

        emit("agent-command-pending", {
            id: "mcp",
            command: "npx server-package",
            conversationId: "A",
            turnId: "t-a",
        });
        expect(api.activityLabel).toBe("Waiting for approval");
        emit("agent-command-resolved", {
            id: "mcp",
            approved: true,
            activityLabel: "Starting MCP server",
            conversationId: "A",
            turnId: "t-a",
        });
        expect(api.activityLabel).toBe("Starting MCP server");
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
