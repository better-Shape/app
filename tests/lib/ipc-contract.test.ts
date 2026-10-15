import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined), convertFileSrc: (p: string) => p }));
import { invoke } from "@tauri-apps/api/core";
import { commands } from "@/lib/backend/commands";
describe("ipc", () => {
    beforeEach(() => vi.mocked(invoke).mockClear());
    it("camelCase", async () => {
        const u = undefined;
        await Promise.all([commands.selectDesignPreview("i", "c", false, "{}"), commands.sendChatMessage("h", u, u, u, u, u, { customSystemPrompt: "p" }), commands.renamePath("a", "b"), commands.forkConversation(3), commands.setMessageFeedback(1, "up", "c"), commands.openInApp("code", "p"), commands.setExtraWorkspaceFolders(["e"]), commands.grantIpcPath("x")]);
        for (const [c, p] of [["select_design_preview", { id: "i", skipped: false, conceptId: "c", tweaks: "{}" }], ["send_chat_message", expect.objectContaining({ message: "h", customSystemPrompt: "p" })], ["rename_path", { oldPath: "a", newPath: "b" }], ["fork_conversation", { messageIndex: 3 }], ["set_message_feedback", { index: 1, feedback: "up", conversationId: "c" }], ["open_in_app", { app: "code", path: "p" }], ["set_extra_workspace_folders", { folders: ["e"] }], ["grant_ipc_path", { path: "x" }]] as const) expect(invoke).toHaveBeenCalledWith(c, p);
        for (const x of vi.mocked(invoke).mock.calls) for (const k of Object.keys((x[1] ?? {}) as Record<string, unknown>)) expect(k).not.toMatch(/_/);
    });

    it("BYOK diagnostics", async () => {
        await Promise.all([
            commands.aiTestProvider("openai", "openai", "sk-live", "https://api.openai.com/v1"),
            commands.aiVaultSupported(),
            commands.aiStoreKey("openai", "sk-live", "initial", "example-scope"),
            commands.aiDeleteKey("openai", "revision-1"),
            commands.aiLoadKeys(["openai", "service:search"]),
            commands.aiCheckProvider("nvidia", {
                kind: "openai",
                apiKey: "nvapi-live",
                baseUrl: "https://integrate.api.nvidia.com/v1",
                model: "nvidia/deepseek-ai/deepseek-r1",
                headers: { "X-Title": "BetterShape" },
                authStyle: "bearer",
            }),
        ]);
        expect(invoke).toHaveBeenCalledWith("ai_test_provider", {
            providerId: "openai",
            kind: "openai",
            apiKey: "sk-live",
            baseUrl: "https://api.openai.com/v1",
        });
        expect(invoke).toHaveBeenCalledWith("ai_vault_supported", undefined);
        expect(invoke).toHaveBeenCalledWith("ai_store_key", {
            providerId: "openai",
            apiKey: "sk-live",
            expectedRevision: "initial",
            scope: "example-scope",
        });
        expect(invoke).toHaveBeenCalledWith("ai_delete_key", { providerId: "openai", expectedRevision: "revision-1" });
        expect(invoke).toHaveBeenCalledWith("ai_load_keys", {
            providerIds: ["openai", "service:search"],
        });
        // Every optional argument is sent explicitly: the Rust command takes
        // Options, and a missing key would read as "no override".
        expect(invoke).toHaveBeenCalledWith("ai_check_provider", {
            providerId: "nvidia",
            kind: "openai",
            apiKey: "nvapi-live",
            baseUrl: "https://integrate.api.nvidia.com/v1",
            model: "nvidia/deepseek-ai/deepseek-r1",
            headers: { "X-Title": "BetterShape" },
            authStyle: "bearer",
        });
        for (const x of vi.mocked(invoke).mock.calls)
            for (const k of Object.keys((x[1] ?? {}) as Record<string, unknown>))
                expect(k).not.toMatch(/_/);
    });
});

it("scopes a pending Stop to its originating request instead of the native current chat", async () => {
    await commands.stopChatMessage(null, "window:draft:4");
    expect(invoke).toHaveBeenCalledWith("stop_chat_message", { conversationId: null, clientRequestId: "window:draft:4" });
    await commands.stopChatMessage("chat-a");
    expect(invoke).toHaveBeenCalledWith("stop_chat_message", { conversationId: "chat-a", clientRequestId: null });
});
