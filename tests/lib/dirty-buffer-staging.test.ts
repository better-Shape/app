import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { preventUnpersistedEditorUnload, acknowledgeDirtyBuffer, clearDirtyBuffer, dirtyOpenFiles, flushDirtyBuffers, listDirtyBuffers, loadDirtyBuffer, saveDirtyBuffer, stageDirtyBuffer } from "@/lib/workspace/dirty-buffers";

beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => {
    vi.restoreAllMocks();
    for (const buffer of listDirtyBuffers()) clearDirtyBuffer(buffer.path);
    flushDirtyBuffers();
    localStorage.clear(); vi.useRealTimers();
});

it("makes a draft available immediately without a storage write for every keystroke", async () => {
    const write = vi.spyOn(Storage.prototype, "setItem");
    stageDirtyBuffer("/a.txt", "first", "disk");
    stageDirtyBuffer("/a.txt", "latest", "disk");
    expect(loadDirtyBuffer("/a.txt")?.content).toBe("latest");
    expect(dirtyOpenFiles([{ path: "/a.txt", is_dirty: false }])).toHaveLength(1);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(write).toHaveBeenCalledOnce();
    expect(localStorage.getItem("bettershape-dirty-buffers-v1")).toContain("latest");
});

it("keeps session recovery available after quota failure and persists it on retry", async () => {
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw new DOMException("Quota exceeded", "QuotaExceededError"); });
    stageDirtyBuffer("/a.txt", "unsaved", "disk");
    await vi.advanceTimersByTimeAsync(250);
    expect(loadDirtyBuffer("/a.txt")?.content).toBe("unsaved");
    expect(localStorage.getItem("bettershape-dirty-buffers-v1")).toBeNull();
    flushDirtyBuffers();
    expect(write).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem("bettershape-dirty-buffers-v1")).toContain("unsaved");
});

it("does not resurrect a discarded staged draft when its timer fires", async () => {
    stageDirtyBuffer("/a.txt", "unsaved", "disk");
    clearDirtyBuffer("/a.txt");
    await vi.advanceTimersByTimeAsync(250);
    expect(loadDirtyBuffer("/a.txt")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
});

it("reverts a persisted draft immediately while its deletion is waiting to flush", () => {
    saveDirtyBuffer("/a.txt", "old draft", "disk");
    stageDirtyBuffer("/a.txt", "disk", "disk");
    expect(loadDirtyBuffer("/a.txt")).toBeNull();
    expect(dirtyOpenFiles([{ path: "/a.txt", is_dirty: false }])).toEqual([]);
    flushDirtyBuffers();
    expect(localStorage.getItem("bettershape-dirty-buffers-v1")).not.toContain("old draft");
});

it("acknowledges saved content without clearing a later staged edit", () => {
    saveDirtyBuffer("/a.txt", "first", "disk");
    stageDirtyBuffer("/a.txt", "second", "disk");
    acknowledgeDirtyBuffer("/a.txt", "first");
    expect(loadDirtyBuffer("/a.txt")).toMatchObject({ content: "second", savedContent: "first" });
});

it("merges pending edits with unrelated persisted recovery", () => {
    saveDirtyBuffer("/a.txt", "draft A", "disk A");
    stageDirtyBuffer("/b.txt", "draft B", "disk B");
    flushDirtyBuffers();
    expect(listDirtyBuffers().map((buffer) => buffer.path).sort()).toEqual(["/a.txt", "/b.txt"]);
});

it.each([false, true])("requests a reload warning only when editor recovery cannot persist: %s", (blocked) => {
    if (blocked) vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage unavailable"); });
    stageDirtyBuffer("/a.txt", "unsaved", "disk");
    window.addEventListener("beforeunload", preventUnpersistedEditorUnload);
    try {
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(blocked);
    } finally { window.removeEventListener("beforeunload", preventUnpersistedEditorUnload); }
});

it("blocks unload until a reverted draft's failed tombstone flush succeeds", () => {
    saveDirtyBuffer("/a.txt", "discarded draft", "disk");
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage unavailable"); });
    stageDirtyBuffer("/a.txt", "disk", "disk");
    expect(loadDirtyBuffer("/a.txt")).toBeNull();
    const blocked = new Event("beforeunload", { cancelable: true });
    preventUnpersistedEditorUnload(blocked as BeforeUnloadEvent);
    expect(blocked.defaultPrevented).toBe(true);
    expect(localStorage.getItem("bettershape-dirty-buffers-v1")).toContain("discarded draft");
    write.mockRestore();
    const retry = new Event("beforeunload", { cancelable: true });
    preventUnpersistedEditorUnload(retry as BeforeUnloadEvent);
    expect(retry.defaultPrevented).toBe(false);
    expect(localStorage.getItem("bettershape-dirty-buffers-v1")).not.toContain("discarded draft");
});
