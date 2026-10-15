import { resetDirtyBufferRecovery } from "../helpers/dirty-buffers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { createMenuActionHandler } from "@/features/agent/workbench/titlebar/menu-actions";
import { clearDirtyBuffer, loadDirtyBuffer, saveDirtyBuffer, stageDirtyBuffer } from "@/lib/workspace/dirty-buffers";

beforeEach(() => { resetDirtyBufferRecovery(); invoke.mockReset().mockResolvedValue(undefined); });
afterEach(() => { clearDirtyBuffer("/a.txt"); resetDirtyBufferRecovery(); });
function handler(openFiles: Array<{ path: string; is_dirty: boolean }>, content: string) {
    return createMenuActionHandler({ projectPath: "/", activeFile: null, openFiles, closeWindow: vi.fn(), readLatestContent: async () => content });
}

it("saves a recovered file even if the native dirty flag has not caught up", async () => {
    saveDirtyBuffer("/a.txt", "recovered", "disk");
    await handler([{ path: "/a.txt", is_dirty: false }], "recovered")("Save All");
    expect(invoke).toHaveBeenCalledWith("save_file", { path: "/a.txt", content: "recovered" });
    expect(loadDirtyBuffer("/a.txt")).toBeNull();
});

it("includes an in-memory edit before its recovery debounce completes", async () => {
    stageDirtyBuffer("/a.txt", "last keystroke", "disk");
    await handler([{ path: "/a.txt", is_dirty: false }], "last keystroke")("Save All");
    expect(invoke).toHaveBeenCalledWith("save_file", { path: "/a.txt", content: "last keystroke" });
    expect(loadDirtyBuffer("/a.txt")).toBeNull();
});

it("propagates failed saves and preserves their recovery", async () => {
    saveDirtyBuffer("/a.txt", "unsaved", "disk");
    invoke.mockRejectedValueOnce(new Error("disk full"));
    await expect(handler([{ path: "/a.txt", is_dirty: true }], "unsaved")("Save All")).rejects.toThrow("disk full");
    expect(loadDirtyBuffer("/a.txt")?.content).toBe("unsaved");
});

it("does not run binary assets through a text save", async () => {
    await handler([{ path: "/photo.png", is_dirty: true }], "not image bytes")("Save All");
    expect(invoke).not.toHaveBeenCalled();
});
