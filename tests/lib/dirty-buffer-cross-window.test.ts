import { afterEach, beforeEach, expect, it, vi } from "vitest";

const legacyKey = "bettershape-dirty-buffers-v1";
const entryKey = (path: string) => `bettershape-dirty-buffers-v2:${encodeURIComponent(path)}`;
const draft = (path: string, content: string) => ({ path, content, savedContent: "disk", updatedAt: 1 });
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); vi.clearAllTimers(); localStorage.clear(); vi.useRealTimers(); });

it("retains independent drafts when two WebViews interleave flushes", async () => {
    const a = await import("@/lib/workspace/dirty-buffers");
    vi.resetModules();
    const b = await import("@/lib/workspace/dirty-buffers");
    a.stageDirtyBuffer("/a.txt", "draft A", "disk");
    b.stageDirtyBuffer("/b.txt", "draft B", "disk");
    const write = Storage.prototype.setItem;
    let interleaved = false;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
        if (!interleaved) { interleaved = true; expect(b.flushDirtyBuffers()).toBe(true); }
        write.call(this, key, value);
    });
    expect(a.flushDirtyBuffers()).toBe(true);
    vi.resetModules();
    const restarted = await import("@/lib/workspace/dirty-buffers");
    expect(restarted.listDirtyBuffers().map(buffer => buffer.path).sort()).toEqual(["/a.txt", "/b.txt"]);
});

it("retains this window's unsaved work when recovery reads temporarily fail", async () => {
    const buffers = await import("@/lib/workspace/dirty-buffers");
    buffers.saveDirtyBuffer("/a.txt", "unsaved", "disk");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(buffers.loadDirtyBuffer("/a.txt")?.content).toBe("unsaved");
});

it("keeps legacy recovery immutable and masks a cleared legacy draft after restart", async () => {
    const seed = JSON.stringify([draft("/old.txt", "legacy draft"), draft("/other.txt", "other draft")]);
    localStorage.setItem(legacyKey, seed);
    const buffers = await import("@/lib/workspace/dirty-buffers");
    expect(buffers.clearDirtyBuffer("/old.txt")).toBe(true);
    expect(localStorage.getItem(legacyKey)).toBe(seed);
    expect(localStorage.getItem(entryKey("/old.txt"))).toBe("null");
    vi.resetModules();
    const restarted = await import("@/lib/workspace/dirty-buffers");
    expect(restarted.listDirtyBuffers().map(buffer => buffer.path)).toEqual(["/other.txt"]);
});

it("only retries unsuccessful entries after a partial flush", async () => {
    const buffers = await import("@/lib/workspace/dirty-buffers");
    buffers.stageDirtyBuffer("/a.txt", "A", "disk");
    buffers.stageDirtyBuffer("/b.txt", "B", "disk");
    const write = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
        if (key === entryKey("/a.txt")) throw new Error("quota");
        write.call(this, key, value);
    });
    expect(buffers.flushDirtyBuffers()).toBe(false);
    expect(localStorage.getItem(entryKey("/b.txt"))).toContain('"B"');
    spy.mockRestore();
    const retry = vi.spyOn(Storage.prototype, "setItem");
    expect(buffers.flushDirtyBuffers()).toBe(true);
    expect(retry.mock.calls.map(([key]) => key)).toEqual([entryKey("/a.txt")]);
});

it("clears nonlegacy records without accumulating deletion entries", async () => {
    const buffers = await import("@/lib/workspace/dirty-buffers");
    buffers.saveDirtyBuffer("/new.txt", "draft", "disk");
    expect(buffers.clearDirtyBuffer("/new.txt")).toBe(true);
    expect(localStorage.length).toBe(0);
    expect(buffers.loadDirtyBuffer("/new.txt")).toBeNull();
});

it("keeps a failed legacy read pending instead of removing its masking record", async () => {
    localStorage.setItem(legacyKey, JSON.stringify([draft("/old.txt", "legacy")]));
    const buffers = await import("@/lib/workspace/dirty-buffers");
    buffers.saveDirtyBuffer("/old.txt", "newer", "disk");
    const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(buffers.clearDirtyBuffer("/old.txt")).toBe(false);
    expect(buffers.loadDirtyBuffer("/old.txt")).toBeNull();
    read.mockRestore();
    expect(buffers.flushDirtyBuffers()).toBe(true);
    expect(localStorage.getItem(entryKey("/old.txt"))).toBe("null");
});

it("reads valid per-path recovery despite a malformed legacy seed or neighboring entry", async () => {
    localStorage.setItem(legacyKey, "{broken");
    localStorage.setItem(entryKey("/valid.txt"), JSON.stringify(draft("/valid.txt", "valid")));
    localStorage.setItem(entryKey("/mismatch.txt"), JSON.stringify(draft("/foreign.txt", "wrong path")));
    localStorage.setItem(entryKey("__proto__"), JSON.stringify(draft("__proto__", "unsafe")));
    localStorage.setItem(entryKey("/broken.txt"), "{broken");
    const buffers = await import("@/lib/workspace/dirty-buffers");
    expect(buffers.listDirtyBuffers().map(buffer => buffer.path)).toEqual(["/valid.txt"]);
});

it("retains adopted legacy recovery through a later read failure", async () => {
    localStorage.setItem(legacyKey, JSON.stringify({ old: draft("/old.txt", "recovered") }));
    const buffers = await import("@/lib/workspace/dirty-buffers");
    expect(buffers.loadDirtyBuffer("/old.txt")?.content).toBe("recovered");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(buffers.loadDirtyBuffer("/old.txt")?.content).toBe("recovered");
});
