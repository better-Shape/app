import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
    searchProjectFiles: vi.fn(),
    getConversations: vi.fn(),
    getMcpStatus: vi.fn(),
}));

const preloads = vi.hoisted(() => ({
    preloadSyntaxHighlighter: vi.fn(),
    ensureFreshScan: vi.fn(),
    peekPluginsCache: vi.fn<() => unknown>(() => ({ plugins: [] })),
    fetchPlugins: vi.fn(async () => ({ plugins: [] })),
}));

vi.mock("@/lib/backend", () => ({
    commands: {
        searchProjectFiles: backend.searchProjectFiles,
        getConversations: backend.getConversations,
        getMcpStatus: backend.getMcpStatus,
    },
}));

vi.mock("@/lib/ui/syntax-highlight", () => ({
    preloadSyntaxHighlighter: preloads.preloadSyntaxHighlighter,
}));

vi.mock("@/lib/chat/skill-index", () => ({
    ensureFreshScan: preloads.ensureFreshScan,
}));

vi.mock("@/lib/plugins/api", () => ({
    peekPluginsCache: preloads.peekPluginsCache,
    fetchPlugins: preloads.fetchPlugins,
}));

import {
    fetchWarmMcpServers,
    fetchWarmProjectFiles,
    fetchWarmRecentChats,
    peekWarmMcpServers,
    peekWarmProjectFiles,
    peekWarmRecentChats,
    resetMentionWarmCachesForTests,
    warmComposerResources,
} from "@/lib/chat/mention-warm-cache";

describe("mention-warm-cache", () => {
    beforeEach(() => {
        resetMentionWarmCachesForTests();
        vi.clearAllMocks();
    });

    afterEach(() => {
        resetMentionWarmCachesForTests();
        vi.useRealTimers();
    });

    it("deduplicates concurrent in-flight project file fetches and serves synchronous peek hits", async () => {
        let resolveSearch!: (rows: Array<{ path: string; relative_path: string }>) => void;
        backend.searchProjectFiles.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveSearch = resolve;
                }),
        );

        expect(peekWarmProjectFiles("/repo")).toBeNull();
        const p1 = fetchWarmProjectFiles("/repo", "", 40);
        const p2 = fetchWarmProjectFiles("/repo", "", 40);
        expect(backend.searchProjectFiles).toHaveBeenCalledTimes(1);

        resolveSearch([
            { path: "/repo/src/App.tsx", relative_path: "src\\App.tsx" },
            { path: "/repo/package.json", relative_path: "package.json" },
        ]);

        const [r1, r2] = await Promise.all([p1, p2]);
        expect(r1).toEqual(["src/App.tsx", "package.json"]);
        expect(r2).toEqual(["src/App.tsx", "package.json"]);
        expect(peekWarmProjectFiles("/repo")).toEqual(["src/App.tsx", "package.json"]);

        // Subsequent warm call hits memory without invoking IPC again
        const r3 = await fetchWarmProjectFiles("/repo", "", 40);
        expect(r3).toEqual(["src/App.tsx", "package.json"]);
        expect(backend.searchProjectFiles).toHaveBeenCalledTimes(1);
    });

    it("invalidates file and conversation caches immediately on workspace change events", async () => {
        backend.searchProjectFiles.mockResolvedValue([
            { path: "/repo/a.ts", relative_path: "a.ts" },
        ]);
        backend.getConversations.mockResolvedValue([
            { id: "c-1", title: "Refactor stream" },
        ]);
        backend.getMcpStatus.mockResolvedValue([
            { id: "github", name: "GitHub", status: "connected" },
            { id: "offline", name: "Offline", status: "disconnected" },
        ]);

        await Promise.all([
            fetchWarmProjectFiles("/repo"),
            fetchWarmRecentChats("/repo"),
            fetchWarmMcpServers(),
        ]);

        expect(peekWarmProjectFiles("/repo")).toEqual(["a.ts"]);
        expect(peekWarmRecentChats("/repo")).toEqual([{ id: "c-1", title: "Refactor stream" }]);
        expect(peekWarmMcpServers()).toEqual([{ id: "github", name: "GitHub" }]);

        window.dispatchEvent(new Event("bettershape-files-changed"));
        expect(peekWarmProjectFiles("/repo")).toBeNull();
        expect(peekWarmRecentChats("/repo")).not.toBeNull();

        window.dispatchEvent(new Event("bettershape-chats-changed"));
        expect(peekWarmRecentChats("/repo")).toBeNull();
    });

    it("cancels scheduled idle pre-warm cleanly when disposed before idle callback fires", () => {
        vi.useFakeTimers();
        const dispose = warmComposerResources("/repo");
        dispose();
        vi.runAllTimers();
        expect(preloads.preloadSyntaxHighlighter).not.toHaveBeenCalled();
        expect(backend.searchProjectFiles).not.toHaveBeenCalled();
    });
});
