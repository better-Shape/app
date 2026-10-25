import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
    currentResolvers: [] as Array<(id: string | null) => void>,
    messageRequests: [] as Array<{ id: string; resolve: (m: unknown[]) => void }>,
}));

const events = vi.hoisted(() => ({
    handlers: new Map<string, Set<(event: { payload: unknown }) => void>>(),
}));

vi.mock("@tauri-apps/api/event", () => ({
    listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
        let bucket = events.handlers.get(name);
        if (!bucket) {
            bucket = new Set();
            events.handlers.set(name, bucket);
        }
        bucket.add(handler);
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
            (id: string) =>
                new Promise<unknown[]>((resolve) => backend.messageRequests.push({ id, resolve })),
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

import {
    ChatStreamProvider,
    prefetchChatConversation,
    useChatStream,
    useChatStreamGetters,
    useChatStreamStatus,
    useViewedConversationId,
} from "@/features/chat/lib/chat-stream-store";
import { resetChatActivitiesForTests } from "@/features/chat/lib/chat-activity";
import { resetGeneratingChatsForTests } from "@/features/chat/lib/generating-chats";

function emit(name: string, payload: unknown) {
    for (const h of events.handlers.get(name) ?? []) {
        h({ payload });
    }
}

async function settle(rounds = 4) {
    for (let i = 0; i < rounds; i++) {
        await act(async () => {
            await new Promise((r) => setTimeout(r, 0));
        });
    }
}

describe("ChatStreamProvider context splitting, rAF coalescing, and resident LRU prefetch", () => {
    let host: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        backend.currentResolvers.length = 0;
        backend.messageRequests.length = 0;
        events.handlers.clear();
        resetChatActivitiesForTests();
        resetGeneratingChatsForTests();
        host = document.createElement("div");
        document.body.append(host);
        root = createRoot(host);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        host.remove();
        vi.restoreAllMocks();
    });

    it("isolates useViewedConversationId, useChatStreamGetters, and useChatStreamStatus from per-token transcript renders", async () => {
        let streamApi!: ReturnType<typeof useChatStream>;
        let viewedIdRenders = 0;
        let gettersRenders = 0;
        let statusRenders = 0;
        let fullStreamRenders = 0;

        const ViewedIdProbe = React.memo(function ViewedIdProbe() {
            useViewedConversationId();
            viewedIdRenders++;
            return null;
        });

        const GettersProbe = React.memo(function GettersProbe() {
            useChatStreamGetters();
            gettersRenders++;
            return null;
        });

        const StatusProbe = React.memo(function StatusProbe() {
            useChatStreamStatus();
            statusRenders++;
            return null;
        });

        function StreamProbe() {
            streamApi = useChatStream();
            fullStreamRenders++;
            return null;
        }

        const rafCallbacks: FrameRequestCallback[] = [];
        vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
            rafCallbacks.push(cb);
            return rafCallbacks.length;
        });

        await act(async () => {
            root.render(
                <ChatStreamProvider>
                    <ViewedIdProbe />
                    <GettersProbe />
                    <StatusProbe />
                    <StreamProbe />
                </ChatStreamProvider>,
            );
        });
        await settle();

        backend.currentResolvers.shift()?.("conv-1");
        await settle();
        backend.messageRequests
            .find((r) => r.id === "conv-1")
            ?.resolve([{ role: "user", content: "Hello", timestamp: 1 }]);
        await settle();

        await act(async () => {
            emit("chat_started", { conversationId: "conv-1", turnId: "1:turn-a" });
        });

        const baselineViewedId = viewedIdRenders;
        const baselineGetters = gettersRenders;
        const baselineStatus = statusRenders;
        const baselineStream = fullStreamRenders;

        // First token flushes on leading edge; subsequent burst tokens coalesce into 1 rAF
        await act(async () => {
            emit("chat_token", { conversationId: "conv-1", turnId: "1:turn-a", chunk: "First " });
            emit("chat_token", { conversationId: "conv-1", turnId: "1:turn-a", chunk: "second " });
            emit("chat_token", { conversationId: "conv-1", turnId: "1:turn-a", chunk: "third " });
            emit("chat_token", { conversationId: "conv-1", turnId: "1:turn-a", chunk: "fourth." });
        });

        // Leading edge applied immediately for <16ms TTFT:
        expect(streamApi.messages.at(-1)?.content).toBe("First ");
        expect(rafCallbacks.length).toBe(1);

        // Flush single animation frame for the 3 coalesced tokens:
        await act(async () => {
            const cb = rafCallbacks.shift();
            cb?.(16.6);
        });

        expect(streamApi.messages.at(-1)?.content).toBe("First second third fourth.");
        // Only 2 transcript renders for 4 tokens (1 leading + 1 rAF), and ZERO re-renders on decoupled selectors:
        expect(fullStreamRenders - baselineStream).toBe(2);
        expect(viewedIdRenders).toBe(baselineViewedId);
        expect(gettersRenders).toBe(baselineGetters);
        expect(statusRenders).toBe(baselineStatus);
    });

    it("serves prefetched and previously visited conversations synchronously in 0ms from resident LRU cache", async () => {
        let streamApi!: ReturnType<typeof useChatStream>;

        function StreamProbe() {
            streamApi = useChatStream();
            return null;
        }

        await act(async () => {
            root.render(
                <ChatStreamProvider>
                    <StreamProbe />
                </ChatStreamProvider>,
            );
        });
        await settle();

        backend.currentResolvers.shift()?.("conv-a");
        await settle();
        backend.messageRequests
            .find((r) => r.id === "conv-a")
            ?.resolve([{ role: "user", content: "Alpha prompt", timestamp: 10 }]);
        await settle();
        expect(streamApi.messages.map((m) => m.content)).toEqual(["Alpha prompt"]);

        // Hover-prefetch conv-b via the global event helper BEFORE switching tabs:
        await act(async () => {
            prefetchChatConversation("conv-b");
        });
        const prefetchReq = backend.messageRequests.find((r) => r.id === "conv-b");
        expect(prefetchReq).toBeDefined();
        prefetchReq?.resolve([
            { role: "user", content: "Beta prefetched prompt", timestamp: 20 },
            { role: "assistant", content: "Beta instant reply", timestamp: 21 },
        ]);
        await settle();

        // Switching to conv-b renders its prefetched messages IMMEDIATELY on frame 0:
        await act(async () => {
            streamApi.showConversation("conv-b");
        });
        expect(streamApi.viewedConversationId).toBe("conv-b");
        expect(streamApi.messages.map((m) => m.content)).toEqual([
            "Beta prefetched prompt",
            "Beta instant reply",
        ]);

        // Switching back to conv-a also hits resident LRU cache synchronously in 0ms:
        await act(async () => {
            streamApi.showConversation("conv-a");
        });
        expect(streamApi.viewedConversationId).toBe("conv-a");
        expect(streamApi.messages.map((m) => m.content)).toEqual(["Alpha prompt"]);
    });
});
