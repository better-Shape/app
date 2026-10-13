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
});
