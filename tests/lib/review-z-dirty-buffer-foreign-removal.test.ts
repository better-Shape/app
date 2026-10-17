import { afterEach, beforeEach, expect, it, vi } from "vitest";

// A removal in another document arrives as a storage event whose `key` is the removed
// key and whose `newValue` is null. `key: null` is the localStorage.clear() form and never
// names a path, so it cannot reach the per-path repair at all.
const entryKey = (path: string) => `bettershape-dirty-buffers-v2:${encodeURIComponent(path)}`;
const removal = (path: string, oldValue: string | null) =>
    new StorageEvent("storage", { key: entryKey(path), oldValue, newValue: null, storageArea: localStorage });
const overwrite = (path: string, newValue: string) =>
    new StorageEvent("storage", { key: entryKey(path), newValue, storageArea: localStorage });

// The module registers one storage listener per instance and never removes it, and every
// instance keeps its own in-memory drafts. Give each test a fresh instance and its own path
// so an earlier test's listener cannot answer for a later test's entry.
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); vi.clearAllTimers(); localStorage.clear(); vi.useRealTimers(); });

it("does not resurrect this window's draft when another WebView removed the record", async () => {
    vi.setSystemTime(6_000);
    const buffers = await import("@/lib/workspace/dirty-buffers");
    buffers.stageDirtyBuffer("/removed.txt", "draft", "disk");
    expect(buffers.flushDirtyBuffers()).toBe(true);
    const persisted = localStorage.getItem(entryKey("/removed.txt"));
    expect(persisted).toContain("draft");
    // Another WebView saved the file, so its record is gone. The removal carries no stamp to
    // order this draft against, and re-adding one would revive recovery for a saved file.
    localStorage.removeItem(entryKey("/removed.txt"));
    window.dispatchEvent(removal("/removed.txt", persisted));
    expect(localStorage.getItem(entryKey("/removed.txt"))).toBeNull();
});

it("still repairs a genuine clobber, which is what proves the removal reached the listener", async () => {
    vi.setSystemTime(6_000);
    const buffers = await import("@/lib/workspace/dirty-buffers");
    buffers.stageDirtyBuffer("/clobbered.txt", "my draft", "disk");
    expect(buffers.flushDirtyBuffers()).toBe(true);
    // Another WebView committed an older copy after reading the path, so this window's newer
    // draft was overwritten. A key has no compare-and-swap, so the write is repaired here.
    const older = JSON.stringify({ path: "/clobbered.txt", content: "older draft", savedContent: "disk", updatedAt: 5_000 });
    localStorage.setItem(entryKey("/clobbered.txt"), older);
    window.dispatchEvent(overwrite("/clobbered.txt", older));
    expect(JSON.parse(localStorage.getItem(entryKey("/clobbered.txt"))!).content).toBe("my draft");
});

it("does not resurrect this window's draft over the mask a legacy-seeded removal writes", async () => {
    vi.setSystemTime(6_000);
    const buffers = await import("@/lib/workspace/dirty-buffers");
    buffers.stageDirtyBuffer("/masked.txt", "draft", "disk");
    expect(buffers.flushDirtyBuffers()).toBe(true);
    // Clearing a path that the legacy seed still holds cannot drop the key, so the removal is
    // persisted as the string "null" instead. It is a removal, and it is not repaired either.
    localStorage.setItem(entryKey("/masked.txt"), "null");
    window.dispatchEvent(overwrite("/masked.txt", "null"));
    expect(localStorage.getItem(entryKey("/masked.txt"))).toBe("null");
});

it("writes nothing on a removal that lands while this window has an unflushed draft", async () => {
    vi.setSystemTime(6_000);
    const buffers = await import("@/lib/workspace/dirty-buffers");
    buffers.stageDirtyBuffer("/pending.txt", "first draft", "disk");
    expect(buffers.flushDirtyBuffers()).toBe(true);
    const persisted = localStorage.getItem(entryKey("/pending.txt"));
    // This window types again, so a newer draft is staged and waiting for its 250ms timer.
    vi.setSystemTime(7_000);
    buffers.stageDirtyBuffer("/pending.txt", "second draft", "disk");
    localStorage.removeItem(entryKey("/pending.txt"));
    window.dispatchEvent(removal("/pending.txt", persisted));
    expect(localStorage.getItem(entryKey("/pending.txt"))).toBeNull();
    // The draft this window is still holding lands on its own timer, not because of the removal.
    expect(buffers.flushDirtyBuffers()).toBe(true);
    expect(JSON.parse(localStorage.getItem(entryKey("/pending.txt"))!).content).toBe("second draft");
});

it("does not re-add the draft when the removal was written by another window's own discard", async () => {
    vi.setSystemTime(8_000);
    const discarding = await import("@/lib/workspace/dirty-buffers");
    discarding.stageDirtyBuffer("/discarded.txt", "draft", "disk");
    expect(discarding.flushDirtyBuffers()).toBe(true);
    const persisted = localStorage.getItem(entryKey("/discarded.txt"));
    // A second window adopts the same recovery, so it holds the same draft at the same stamp.
    // Staging anything is what arms a window's storage listener, so the peer touches a file.
    vi.resetModules();
    const peer = await import("@/lib/workspace/dirty-buffers");
    peer.stageDirtyBuffer("/peer-touched.txt", "unrelated draft", "disk");
    expect(peer.flushDirtyBuffers()).toBe(true);
    expect(peer.loadDirtyBuffer("/discarded.txt")?.content).toBe("draft");
    // The first window discards. Its removal owns exactly that draft, so it drops the record.
    expect(discarding.clearDirtyBuffer("/discarded.txt")).toBe(true);
    expect(localStorage.getItem(entryKey("/discarded.txt"))).toBeNull();
    // The peer still holds the draft in memory and hears the removal. Re-committing it would
    // bring back recovery for a file the user just threw away.
    window.dispatchEvent(removal("/discarded.txt", persisted));
    expect(localStorage.getItem(entryKey("/discarded.txt"))).toBeNull();
});