import { resetDirtyBufferRecovery } from "../helpers/dirty-buffers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { commands } from "@/lib/backend/commands";
import { dirtyOpenFiles, loadDirtyBuffer, saveDirtyBuffer } from "@/lib/workspace/dirty-buffers";

beforeEach(() => { resetDirtyBufferRecovery(); invoke.mockReset().mockResolvedValue(undefined); });
afterEach(() => resetDirtyBufferRecovery());

it("clears only the recovery draft that was actually saved", async () => {
    saveDirtyBuffer("/a.txt", "saved edit", "original");
    await commands.saveFile("/a.txt", "saved edit");
    expect(loadDirtyBuffer("/a.txt")).toBeNull();
});

it("retains newer edits while updating their saved baseline", async () => {
    let finish!: () => void;
    invoke.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    saveDirtyBuffer("/a.txt", "first edit", "original");
    const saving = commands.saveFile("/a.txt", "first edit");
    saveDirtyBuffer("/a.txt", "newer edit", "original");
    finish(); await saving;
    expect(loadDirtyBuffer("/a.txt")).toMatchObject({ content: "newer edit", savedContent: "first edit" });
});

it("does not acknowledge a failed native save", async () => {
    saveDirtyBuffer("/a.txt", "unsaved", "original");
    invoke.mockRejectedValueOnce(new Error("Disk full"));
    const listener = vi.fn(); window.addEventListener("bettershape-file-saved", listener);
    try {
        await expect(commands.saveFile("/a.txt", "unsaved")).rejects.toThrow("Disk full");
        expect(loadDirtyBuffer("/a.txt")).toMatchObject({ content: "unsaved", savedContent: "original" });
        expect(listener).not.toHaveBeenCalled();
    } finally { window.removeEventListener("bettershape-file-saved", listener); }
});

it("publishes the acknowledged content so mounted editors can update their baseline", async () => {
    const listener = vi.fn(); window.addEventListener("bettershape-file-saved", listener);
    try {
        await commands.saveFile("/a.txt", "saved text");
        expect(listener).toHaveBeenCalledOnce();
        expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ path: "/a.txt", content: "saved text" });
    } finally { window.removeEventListener("bettershape-file-saved", listener); }
});

it("includes recovered open files without selecting closed files or clean buffers", () => {
    saveDirtyBuffer("/restored.txt", "draft", "disk");
    saveDirtyBuffer("/closed.txt", "old draft", "disk");
    const files = [
        { path: "/restored.txt", is_dirty: false },
        { path: "/native-dirty.txt", is_dirty: true },
        { path: "/clean.txt", is_dirty: false },
    ];
    expect(dirtyOpenFiles(files).map((file) => file.path)).toEqual(["/restored.txt", "/native-dirty.txt"]);
});
