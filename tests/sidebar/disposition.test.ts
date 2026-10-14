import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
let stop: (() => void) | undefined;
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); localStorage.clear(); });
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); });

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
        localStorage.setItem("bettershape-sidebar-dispositions", JSON.stringify({ a: { state: "settled" } }));
        window.dispatchEvent(new StorageEvent("storage", { key: "bettershape-sidebar-dispositions" }));
        expect(meta.getChatDispositions()["a"]).toEqual({ state: "settled" });
        // jsdom queues zero-delay storage events independently of our wake timer.
        vi.advanceTimersByTime(1);
        expect(vi.getTimerCount()).toBe(0);
    });
});
