import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
let stop: (() => void) | undefined;
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); localStorage.clear(); });
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); vi.restoreAllMocks(); });

describe("persistent session disposition", () => {
    it("wakes a snoozed chat at its deadline and stops timers on unsubscribe", async () => {
        const meta = await import("@/lib/sidebar/chat-disposition");
        const changed = vi.fn();
        stop = meta.subscribeChatDispositions(changed);
        meta.setChatDisposition("a", { state: "snoozed", until: Date.now() + 1000 });
        expect(meta.getChatDispositions()["a"].state).toBe("snoozed");
        vi.advanceTimersByTime(999);
        expect(meta.getChatDispositions()["a"].state).toBe("snoozed");
        vi.advanceTimersByTime(1);
        expect(meta.getChatDispositions()["a"].state).toBe("active");
        meta.setChatDisposition("b", { state: "snoozed", until: Date.now() + 1000 });
        stop();
        // jsdom queues zero-delay storage events independently of our wake timer.
        vi.advanceTimersByTime(1);
        expect(vi.getTimerCount()).toBe(0);
        expect(changed).toHaveBeenCalledTimes(3);
    });
    it("validates persisted data and wakes overdue chats after restart", async () => {
        localStorage.setItem("bettershape-sidebar-dispositions", JSON.stringify({
            a: { state: "snoozed", until: Date.now() - 1 },
            b: { state: "settled" }, broken: { state: "snoozed", until: "never" }, array: [],
        }));
        const meta = await import("@/lib/sidebar/chat-disposition");
        stop = meta.subscribeChatDispositions(vi.fn());
        expect(meta.getChatDispositions()).toEqual({ a: { state: "active" }, b: { state: "settled" } });
        expect(meta.getChatDispositions()).toBe(meta.getChatDispositions());
    });
    it("restores the exact disposition for undo, and synchronizes other windows", async () => {
        const meta = await import("@/lib/sidebar/chat-disposition");
        stop = meta.subscribeChatDispositions(vi.fn());
        const old = { state: "snoozed", until: Date.now() + 3000 } as const;
        meta.setChatDisposition("a", old);
        meta.setChatDisposition("a", { state: "settled" });
        meta.setChatDisposition("a", old);
        expect(meta.getChatDispositions()["a"]).toEqual(old);
        localStorage.setItem("bettershape-sidebar-dispositions:v2:a", JSON.stringify({ state: "settled" }));
        window.dispatchEvent(new StorageEvent("storage", { key: "bettershape-sidebar-dispositions:v2:a" }));
        expect(meta.getChatDispositions()["a"]).toEqual({ state: "settled" });
        // jsdom queues zero-delay storage events independently of our wake timer.
        vi.advanceTimersByTime(1);
        expect(vi.getTimerCount()).toBe(0);
    });
});

it("refreshes after another window changes storage while no sidebar is subscribed", async () => {
    const meta = await import("@/lib/sidebar/chat-disposition");
    stop = meta.subscribeChatDispositions(vi.fn());
    meta.setChatDisposition("a", { state: "settled" });
    stop();
    // No StorageEvent is delivered to this detached subscriber.
    localStorage.setItem("bettershape-sidebar-dispositions:v2:a", JSON.stringify({ state: "snoozed", until: Date.now() - 1 }));
    localStorage.setItem("bettershape-sidebar-dispositions:v2:b", JSON.stringify({ state: "settled" }));
    stop = meta.subscribeChatDispositions(vi.fn());
    expect(meta.getChatDispositions()).toEqual({ a: { state: "active" }, b: { state: "settled" } });
    expect(JSON.parse(localStorage.getItem("bettershape-sidebar-dispositions:v2:a")!)).toEqual({ state: "active" });
});

it("preserves session-local intent on remount when persistence is unavailable", async () => {
    const meta = await import("@/lib/sidebar/chat-disposition");
    stop = meta.subscribeChatDispositions(vi.fn());
    vi.spyOn(Object.getPrototypeOf(localStorage), "setItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
    meta.setChatDisposition("a", { state: "settled" });
    stop();
    stop = meta.subscribeChatDispositions(vi.fn());
    expect(meta.getChatDispositions()["a"]).toEqual({ state: "settled" });
});

it("keeps independent chat changes from two WebViews with stale snapshots", async () => {
    const first = await import("@/lib/sidebar/chat-disposition");
    first.getChatDispositions();
    vi.resetModules();
    const second = await import("@/lib/sidebar/chat-disposition");
    second.getChatDispositions();
    first.setChatDisposition("a", { state: "settled" });
    second.setChatDisposition("b", { state: "settled" });
    vi.resetModules();
    const restarted = await import("@/lib/sidebar/chat-disposition");
    expect(restarted.getChatDispositions()).toEqual({ a: { state: "settled" }, b: { state: "settled" } });
});

it("wakes only the expired chat without overwriting another WebView's changes", async () => {
    const first = await import("@/lib/sidebar/chat-disposition");
    first.setChatDisposition("a", { state: "snoozed", until: Date.now() + 100 });
    vi.resetModules();
    const second = await import("@/lib/sidebar/chat-disposition");
    second.setChatDisposition("b", { state: "settled" });
    first.wakeSnoozedChats(Date.now() + 101);
    vi.resetModules();
    const restarted = await import("@/lib/sidebar/chat-disposition");
    expect(restarted.getChatDispositions()).toEqual({ a: { state: "active" }, b: { state: "settled" } });
});

it("retains legacy values and persists clears as tombstones without rewriting the seed", async () => {
    const legacy = JSON.stringify({ a: { state: "settled" }, b: { state: "active" } });
    localStorage.setItem("bettershape-sidebar-dispositions", legacy);
    const meta = await import("@/lib/sidebar/chat-disposition");
    meta.setChatDisposition("a", undefined);
    expect(localStorage.getItem("bettershape-sidebar-dispositions")).toBe(legacy);
    vi.resetModules();
    const restarted = await import("@/lib/sidebar/chat-disposition");
    expect(restarted.getChatDispositions()).toEqual({ b: { state: "active" } });
});

it("keeps failed per-chat writes local while reading other windows' successful changes", async () => {
    const meta = await import("@/lib/sidebar/chat-disposition");
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw new Error("full"); });
    meta.setChatDisposition("a", { state: "settled" });
    write.mockRestore();
    localStorage.setItem("bettershape-sidebar-dispositions:v2:b", JSON.stringify({ state: "settled" }));
    stop = meta.subscribeChatDispositions(vi.fn());
    expect(meta.getChatDispositions()).toEqual({ a: { state: "settled" }, b: { state: "settled" } });
    meta.setChatDisposition("c", { state: "active" });
    expect(JSON.parse(localStorage.getItem("bettershape-sidebar-dispositions:v2:a")!)).toEqual({ state: "settled" });
});

it("does not erase a cached disposition when storage reads become unavailable", async () => {
    const meta = await import("@/lib/sidebar/chat-disposition");
    meta.setChatDisposition("a", { state: "settled" });
    const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    try {
        stop = meta.subscribeChatDispositions(vi.fn());
        expect(meta.getChatDispositions().a).toEqual({ state: "settled" });
    } finally { read.mockRestore(); }
});

it("does not accumulate tombstones when clearing chats absent from the legacy seed", async () => {
    const meta = await import("@/lib/sidebar/chat-disposition");
    for (let index = 0; index < 20; index += 1) meta.setChatDisposition(`unused-${index}`, undefined);
    meta.setChatDisposition("active", { state: "active" });
    meta.setChatDisposition("active", undefined);
    localStorage.setItem("bettershape-sidebar-dispositions:v2:obsolete", "null");
    meta.setChatDisposition("obsolete", undefined);
    expect(localStorage.length).toBe(0);
    expect(meta.getChatDispositions()).toEqual({});
});

it("retains a failed key removal in memory and retries without creating a tombstone", async () => {
    const meta = await import("@/lib/sidebar/chat-disposition");
    meta.setChatDisposition("a", { state: "settled" });
    const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
    meta.setChatDisposition("a", undefined);
    expect(meta.getChatDispositions().a).toBeUndefined();
    expect(localStorage.getItem("bettershape-sidebar-dispositions:v2:a")).toContain("settled");
    remove.mockRestore();
    meta.setChatDisposition("b", { state: "active" });
    expect(localStorage.getItem("bettershape-sidebar-dispositions:v2:a")).toBeNull();
    expect(meta.getChatDispositions()).toEqual({ b: { state: "active" } });
});

it("does not guess whether a clear needs a legacy tombstone when reads fail", async () => {
    localStorage.setItem("bettershape-sidebar-dispositions", JSON.stringify({ a: { state: "settled" } }));
    const meta = await import("@/lib/sidebar/chat-disposition");
    meta.setChatDisposition("a", { state: "active" });
    const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    meta.setChatDisposition("a", undefined);
    expect(meta.getChatDispositions().a).toBeUndefined();
    read.mockRestore();
    expect(localStorage.getItem("bettershape-sidebar-dispositions:v2:a")).toContain("active");
    meta.setChatDisposition("b", { state: "active" });
    expect(localStorage.getItem("bettershape-sidebar-dispositions:v2:a")).toBe("null");
    vi.resetModules();
    const restarted = await import("@/lib/sidebar/chat-disposition");
    expect(restarted.getChatDispositions()).toEqual({ b: { state: "active" } });
});

it("retains snapshot identity when equivalent stored entries are enumerated in another order", async () => {
    const prefix = "bettershape-sidebar-dispositions:v2:";
    localStorage.setItem(`${prefix}a`, JSON.stringify({ state: "settled" }));
    localStorage.setItem(`${prefix}b`, JSON.stringify({ state: "snoozed", until: Date.now() + 5000 }));
    const meta = await import("@/lib/sidebar/chat-disposition");
    stop = meta.subscribeChatDispositions(vi.fn());
    const before = meta.getChatDispositions();
    const a = localStorage.getItem(`${prefix}a`);
    if (a === null) throw new Error("Missing fixture entry");
    localStorage.removeItem(`${prefix}a`);
    localStorage.setItem(`${prefix}a`, a);
    window.dispatchEvent(new StorageEvent("storage", { key: `${prefix}a` }));
    expect(meta.getChatDispositions()).toBe(before);
});

it.each(["focus", "visibilitychange"])("publishes missed storage changes and schedules their deadline on %s", async event => {
    const meta = await import("@/lib/sidebar/chat-disposition");
    const changed = vi.fn();
    stop = meta.subscribeChatDispositions(changed);
    localStorage.setItem("bettershape-sidebar-dispositions:v2:a", JSON.stringify({ state: "snoozed", until: Date.now() + 1000 }));
    (event === "focus" ? window : document).dispatchEvent(new Event(event));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(meta.getChatDispositions().a.state).toBe("snoozed");
    vi.advanceTimersByTime(1000);
    expect(meta.getChatDispositions().a.state).toBe("active");
    expect(changed).toHaveBeenCalledTimes(2);
});

it("publishes changed deadlines but ignores equal metadata storage events", async () => {
    const key = "bettershape-sidebar-dispositions:v2:a";
    const meta = await import("@/lib/sidebar/chat-disposition");
    meta.setChatDisposition("a", { state: "snoozed", until: Date.now() + 5000 });
    const changed = vi.fn();
    stop = meta.subscribeChatDispositions(changed);
    const before = meta.getChatDispositions();
    window.dispatchEvent(new StorageEvent("storage", { key }));
    expect(changed).not.toHaveBeenCalled();
    expect(meta.getChatDispositions()).toBe(before);
    localStorage.setItem(key, JSON.stringify({ state: "snoozed", until: Date.now() + 1000 }));
    window.dispatchEvent(new StorageEvent("storage", { key }));
    expect(changed).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(meta.getChatDispositions().a.state).toBe("active");
});

it("preserves malformed encoded records without assigning them to a guessed chat", async () => {
    const key = "bettershape-sidebar-dispositions:v2:%E0%A4%A";
    localStorage.setItem(key, JSON.stringify({ state: "settled" }));
    localStorage.setItem("bettershape-sidebar-dispositions:v2:valid", JSON.stringify({ state: "active" }));
    const meta = await import("@/lib/sidebar/chat-disposition");
    expect(meta.getChatDispositions()).toEqual({ valid: { state: "active" } });
    meta.setChatDisposition("other", { state: "settled" });
    expect(localStorage.getItem(key)).toBe(JSON.stringify({ state: "settled" }));
});
