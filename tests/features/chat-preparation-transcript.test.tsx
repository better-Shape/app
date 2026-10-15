import { act, startTransition, Suspense, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({ expand: vi.fn(), usable: true, send: vi.fn(), stop: vi.fn() }));
vi.mock("@/lib/ai/bootstrap", () => ({ waitForAiConfiguration: async () => {} }));
vi.mock("@/lib/backend", () => ({
    useProjectState: () => ({ project_path: "/project" }),
    commands: {
        getCurrentConversationId: async () => "A", getConversationMessages: async () => [],
        getChatGenerationState: async () => ({ isGenerating: false, turnId: null }),
        getConversations: async () => [], getChatTitle: async () => "Chat", getChatHistory: async () => [],
        sendChatMessage: backend.send, stopChatMessage: backend.stop, cleanupDesignSandbox: async () => {},
    },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@/lib/ai/providers", async importOriginal => ({
    ...await importOriginal<typeof import("@/lib/ai/providers")>(), hasAnyUsableProvider: () => backend.usable,
}));
vi.mock("@/lib/catalog/store", () => ({
    useBetterShapeCatalog: () => ({ catalog: null }), getCatalogModels: () => [], getCatalogDefaultEnabledIds: () => [],
}));
vi.mock("@/lib/chat/mentions", () => ({ buildMessageWithMentions: backend.expand, mentionRanges: () => [] }));
vi.mock("@/lib/workspace/trust", () => ({ isWorkspaceTrusted: () => false }));
vi.mock("@/features/notifications", () => ({ notify: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

import { ChatStreamProvider, useChatStream } from "@/features/chat/lib/chat-stream-store";
import { useChatSession } from "@/features/chat/lib/use-chat-session";
import { resetGeneratingChatsForTests } from "@/features/chat/lib/generating-chats";
import { resetChatActivitiesForTests } from "@/features/chat/lib/chat-activity";

type Session = ReturnType<typeof useChatSession>;
let session: Session;
let stream: ReturnType<typeof useChatStream>;
let host: HTMLDivElement;
let root: Root;
let suspended: Promise<void> | null = null;
function Consumer() {
    const end = useRef<HTMLDivElement>(null);
    const scroll = useRef<HTMLDivElement>(null);
    const value = useChatSession(end, scroll);
    const currentStream = useChatStream();
    useEffect(() => { session = value; stream = currentStream; });
    if (suspended) throw suspended;
    return <div>{value.messages.map((message, index) => <p key={index} data-role={message.role}>{message.content}</p>)}</div>;
}
beforeEach(async () => {
    backend.usable = true; suspended = null;
    backend.expand.mockReset().mockImplementation(async message => message);
    backend.send.mockReset().mockResolvedValue("ok"); backend.stop.mockReset().mockResolvedValue(undefined);
    resetGeneratingChatsForTests(); resetChatActivitiesForTests();
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root.render(<ChatStreamProvider><Suspense fallback={null}><Consumer /></Suspense></ChatStreamProvider>));
    await act(async () => session.setInputValue("keep this draft"));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

it.each(["stop", "provider", "mention"])("does not retain an unsent bubble after %s during preparation, then retries once", async kind => {
    let finish!: (message: string) => void;
    let reject!: (error: Error) => void;
    backend.expand.mockImplementationOnce(() => new Promise<string>((resolve, fail) => { finish = resolve; reject = fail; }));
    let sending!: Promise<boolean>;
    await act(async () => { sending = session.handleSendMessage(); });
    expect(backend.expand).toHaveBeenCalledOnce();
    expect(host.querySelectorAll('[data-role="user"]')).toHaveLength(0);
    expect(session.isPreparing).toBe(true);
    expect(session.isLoading).toBe(false);
    if (kind === "stop") await act(async () => { await session.handleStopMessage(); });
    if (kind === "provider") backend.usable = false;
    await act(async () => {
        if (kind === "mention") reject(new Error("Mention read failed"));
        else finish("expanded");
        expect(await sending).toBe(false);
    });
    expect(backend.send).not.toHaveBeenCalled();
    expect(host.querySelectorAll('[data-role="user"]')).toHaveLength(0);
    expect(session.inputValue).toBe("keep this draft");
    expect(session.isLoading).toBe(false);
    backend.usable = true;
    await act(async () => { expect(await session.handleSendMessage()).toBe(true); });
    expect(backend.send).toHaveBeenCalledOnce();
    expect([...host.querySelectorAll('[data-role="user"]')].map(node => node.textContent)).toEqual(["keep this draft"]);
});


it("preserves existing transcripts and another viewed chat when preparation fails", async () => {
    await act(async () => stream.showConversation("A", [{ role: "user", content: "previous A", timestamp: 1 }]));
    let fail!: (error: Error) => void;
    backend.expand.mockImplementationOnce(() => new Promise<string>((_resolve, reject) => { fail = reject; }));
    let sending!: Promise<boolean>;
    await act(async () => { sending = session.handleSendMessage(); });
    await act(async () => stream.showConversation("B", [{ role: "user", content: "previous B", timestamp: 2 }]));
    await act(async () => { fail(new Error("Cannot read mention")); expect(await sending).toBe(false); });
    expect(host.textContent).toBe("previous B");
    await act(async () => stream.showConversation("A"));
    expect(host.textContent).toBe("previous A");
    expect(backend.send).not.toHaveBeenCalled();
});

it("does not replace a newer live owner that starts while mentions are being prepared", async () => {
    let finish!: (message: string) => void;
    backend.expand.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    let sending!: Promise<boolean>;
    await act(async () => { sending = session.handleSendMessage(); });
    await act(async () => stream.appendUserOptimistic("newer owner", "A", "another-request"));
    await act(async () => { finish("expanded"); expect(await sending).toBe(false); });
    expect([...host.querySelectorAll('[data-role="user"]')].map(node => node.textContent)).toEqual(["newer owner"]);
    expect(stream.ownsRequest("A", "another-request")).toBe(true);
    expect(stream.isLoading).toBe(true);
    expect(session.inputValue).toBe("keep this draft");
    expect(backend.send).not.toHaveBeenCalled();
});


it.each(["model", "mode"])("does not send with a %s from an uncommitted suspended render", async field => {
    let finish!: (message: string) => void;
    backend.expand.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    let sending!: Promise<boolean>;
    await act(async () => { sending = session.handleSendMessage(); });
    const committed = field === "model" ? session.selectedModel : session.selectedMode;
    let release!: () => void;
    suspended = new Promise<void>(resolve => { release = resolve; });
    try {
        await act(async () => startTransition(() => {
            if (field === "model") session.setSelectedModel("uncommitted-model");
            else session.setSelectedMode("Ask");
        }));
        expect(field === "model" ? session.selectedModel : session.selectedMode).toBe(committed);
        await act(async () => { finish("expanded"); expect(await sending).toBe(true); });
        expect(backend.send.mock.calls[0][field === "model" ? 1 : 2]).toBe(committed);
    } finally {
        await act(async () => { suspended = null; release(); });
    }
});
