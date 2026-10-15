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
    expect(localStorage.getItem("bettershape-dirty-buffers-v2:%2Fa.txt")).toContain("latest");
});

it("keeps session recovery available after quota failure and persists it on retry", async () => {
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw new DOMException("Quota exceeded", "QuotaExceededError"); });
    stageDirtyBuffer("/a.txt", "unsaved", "disk");
    await vi.advanceTimersByTimeAsync(250);
    expect(loadDirtyBuffer("/a.txt")?.content).toBe("unsaved");
    expect(localStorage.getItem("bettershape-dirty-buffers-v2:%2Fa.txt")).toBeNull();
    flushDirtyBuffers();
    expect(write).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem("bettershape-dirty-buffers-v2:%2Fa.txt")).toContain("unsaved");
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
    expect(localStorage.getItem("bettershape-dirty-buffers-v2:%2Fa.txt")).toBeNull();
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
    const write = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("storage unavailable"); });
    stageDirtyBuffer("/a.txt", "disk", "disk");
    expect(loadDirtyBuffer("/a.txt")).toBeNull();
    const blocked = new Event("beforeunload", { cancelable: true });
    preventUnpersistedEditorUnload(blocked as BeforeUnloadEvent);
    expect(blocked.defaultPrevented).toBe(true);
    expect(localStorage.getItem("bettershape-dirty-buffers-v2:%2Fa.txt")).toContain("discarded draft");
    write.mockRestore();
    const retry = new Event("beforeunload", { cancelable: true });
    preventUnpersistedEditorUnload(retry as BeforeUnloadEvent);
    expect(retry.defaultPrevented).toBe(false);
    expect(localStorage.getItem("bettershape-dirty-buffers-v2:%2Fa.txt")).toBeNull();
});

it("prefers recovery another renderer persisted after this window loaded its copy", () => {
    const key = "bettershape-dirty-buffers-v2:%2Fa.txt";
    saveDirtyBuffer("/a.txt", "local draft", "disk");
    expect(loadDirtyBuffer("/a.txt")?.content).toBe("local draft");
    vi.setSystemTime(Date.now() + 1000);
    localStorage.setItem(key, JSON.stringify({ path: "/a.txt", content: "newer draft", savedContent: "disk", updatedAt: Date.now() }));
    expect(loadDirtyBuffer("/a.txt")?.content).toBe("newer draft");
    // A later local edit is newer than the record it follows, so it still wins.
    vi.setSystemTime(Date.now() + 1000);
    stageDirtyBuffer("/a.txt", "my next edit", "disk");
    expect(loadDirtyBuffer("/a.txt")?.content).toBe("my next edit");
});

it("does not show a stale staged copy over recovery another renderer persisted while it waited", () => {
    const key = "bettershape-dirty-buffers-v2:%2Fa.txt";
    stageDirtyBuffer("/a.txt", "local draft", "disk");
    // The staged change is still waiting for its flush when the other renderer commits.
    vi.setSystemTime(Date.now() + 1000);
    localStorage.setItem(key, JSON.stringify({ path: "/a.txt", content: "newer draft", savedContent: "disk", updatedAt: Date.now() }));
    expect(loadDirtyBuffer("/a.txt")?.content).toBe("newer draft");
    expect(listDirtyBuffers().map((buffer) => buffer.content)).toEqual(["newer draft"]);
    expect(flushDirtyBuffers()).toBe(true);
});

it("keeps both copies when a staged change ties a committed record in the same millisecond", () => {
    const key = "bettershape-dirty-buffers-v2:%2Fa.txt";
    stageDirtyBuffer("/a.txt", "local draft", "disk");
    // Same stamp, different content: neither write can be shown to be newer.
    localStorage.setItem(key, JSON.stringify({ path: "/a.txt", content: "other draft", savedContent: "disk", updatedAt: Date.now() }));
    expect(flushDirtyBuffers()).toBe(false);
    expect(JSON.parse(localStorage.getItem(key)!).content).toBe("other draft");
    expect(loadDirtyBuffer("/a.txt")?.content).toBe("local draft");
    // A later edit restamps past the tie and persists.
    vi.setSystemTime(Date.now() + 1000);
    stageDirtyBuffer("/a.txt", "local draft v2", "disk");
    expect(flushDirtyBuffers()).toBe(true);
    expect(JSON.parse(localStorage.getItem(key)!).content).toBe("local draft v2");
});

it("does not overwrite recovery another renderer persisted before a delayed flush", () => {
    const key = "bettershape-dirty-buffers-v2:%2Fa.txt";
    stageDirtyBuffer("/a.txt", "late local draft", "disk");
    vi.setSystemTime(Date.now() + 1000);
    localStorage.setItem(key, JSON.stringify({ path: "/a.txt", content: "newer elsewhere", savedContent: "disk", updatedAt: Date.now() }));
    expect(flushDirtyBuffers()).toBe(true);
    expect(JSON.parse(localStorage.getItem(key)!).content).toBe("newer elsewhere");
    expect(loadDirtyBuffer("/a.txt")?.content).toBe("newer elsewhere");
});

it("keeps recovery another renderer persisted after the draft this window discarded", () => {
    const key = "bettershape-dirty-buffers-v2:%2Fa.txt";
    saveDirtyBuffer("/a.txt", "discarded draft", "disk");
    vi.setSystemTime(Date.now() + 1000);
    localStorage.setItem(key, JSON.stringify({ path: "/a.txt", content: "re-drafted elsewhere", savedContent: "disk", updatedAt: Date.now() }));
    expect(clearDirtyBuffer("/a.txt")).toBe(true);
    expect(JSON.parse(localStorage.getItem(key)!).content).toBe("re-drafted elsewhere");
    expect(loadDirtyBuffer("/a.txt")?.content).toBe("re-drafted elsewhere");
});
