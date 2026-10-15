import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    CHAT_UNDO_WINDOW_MS,
    dismissChatUndo,
    getChatUndo,
    pendingChatUndoCount,
    pendingRemovalChatIds,
    pushChatUndo,
    resetChatUndoForTests,
    subscribeChatUndo,
    sweepChatUndo,
    undoChat,
} from "@/features/agent/sidebar/undo";

/**
 * The stack is module state on purpose — a delete only reaches the backend when
 * its window closes, and a remount of the sidebar must not change that. So the
 * tests drive the clock: entries are pushed with `now`, and expiry only happens
 * through an explicit `sweepChatUndo` or through `undoChat` reading a patched
 * `Date.now`. Nothing here waits on a real timer.
 */

beforeEach(() => {
    resetChatUndoForTests();
});

afterEach(() => {
    resetChatUndoForTests();
    vi.restoreAllMocks();
});

describe("undo stack", () => {
    it("offers the newest action and keeps one snapshot between changes", () => {
        const seen: (string | null)[] = [];
        const stop = subscribeChatUndo(() => seen.push(getChatUndo()?.label ?? null));

        const first = pushChatUndo({ kind: "pin", chatId: "a", label: "Pinned a" });
        const snapshot = getChatUndo();
        // A re-read with no intervening write has to be the same reference, or
        // useSyncExternalStore would render forever.
        expect(getChatUndo()).toBe(snapshot);
        expect(first.expiresAt - first.createdAt).toBe(CHAT_UNDO_WINDOW_MS);

        pushChatUndo({ kind: "archive", chatId: "b", label: "Archived b" });

        expect(getChatUndo()?.label).toBe("Archived b");
        expect(getChatUndo()?.kind).toBe("archive");
        expect(getChatUndo()?.chatId).toBe("b");
        expect(seen).toEqual(["Pinned a", "Archived b"]);
        stop();
    });

    it("undoes the newest action first and leaves the older one on offer", () => {
        const calls: string[] = [];
        pushChatUndo({
            kind: "pin",
            chatId: "a",
            label: "Pinned a",
            revert: () => { calls.push("revert-a"); },
        });
        pushChatUndo({
            kind: "pin",
            chatId: "b",
            label: "Pinned b",
            revert: () => { calls.push("revert-b"); },
        });

        expect(undoChat()?.chatId).toBe("b");
        expect(getChatUndo()?.chatId).toBe("a");
        expect(undoChat()?.chatId).toBe("a");
        expect(undoChat()).toBeNull();
        expect(calls).toEqual(["revert-b", "revert-a"]);
        expect(pendingChatUndoCount()).toBe(0);
    });

    it("does not commit a delete until the window has closed", () => {
        const commit = vi.fn();
        const now = Date.now();
        pushChatUndo({ kind: "delete", chatId: "a", label: "Deleted a", now, commit });

        expect(commit).not.toHaveBeenCalled();
        expect(sweepChatUndo(now)).toEqual([]);
        expect(sweepChatUndo(now + CHAT_UNDO_WINDOW_MS - 1)).toEqual([]);
        expect(commit).not.toHaveBeenCalled();
        // Still undoable: the conversation has not been deleted yet.
        expect(getChatUndo()?.kind).toBe("delete");
    });

    it("commits every expired delete in one sweep", () => {
        const order: string[] = [];
        const now = Date.now();
        pushChatUndo({ kind: "delete", chatId: "a", label: "a", now, commit: () => { order.push("a"); } });
        pushChatUndo({ kind: "delete", chatId: "b", label: "b", now, commit: () => { order.push("b"); } });

        const expired = sweepChatUndo(now + CHAT_UNDO_WINDOW_MS + 50);
        expect(expired.map((entry) => entry.chatId)).toEqual(["b", "a"]);
        expect(order).toEqual(["b", "a"]);
        expect(pendingChatUndoCount()).toBe(0);
        expect(getChatUndo()).toBeNull();
    });

    it("refuses an undo whose window closed while the timer was throttled", () => {
        const commit = vi.fn();
        const revert = vi.fn();
        pushChatUndo({ kind: "delete", chatId: "a", label: "a", revert, commit });

        // A backgrounded tab throttles setTimeout, so the window can close with
        // no sweep having run. Coming back and pressing undo must not resurrect
        // a conversation the backend was already told to forget.
        const later = Date.now() + CHAT_UNDO_WINDOW_MS * 10;
        vi.spyOn(Date, "now").mockReturnValue(later);
        expect(undoChat()).toBeNull();
        expect(revert).not.toHaveBeenCalled();
        expect(commit).toHaveBeenCalledTimes(1);
    });

    it("dismisses a pending delete by committing it right away", () => {
        const commit = vi.fn();
        pushChatUndo({ kind: "delete", chatId: "a", label: "a", commit });

        expect(dismissChatUndo()?.chatId).toBe("a");
        expect(commit).toHaveBeenCalledTimes(1);
        expect(getChatUndo()).toBeNull();
    });

    it("leaves a pin alone when its window closes, because pin is already applied", () => {
        // Mirrors the real caller: a pin is applied immediately and carries only a
        // revert, because there is nothing left to commit when the window closes.
        const revert = vi.fn();
        const now = Date.now();
        pushChatUndo({ kind: "pin", chatId: "a", label: "a", now, revert });

        const expired = sweepChatUndo(now + CHAT_UNDO_WINDOW_MS);
        // The sweep reports what it dropped so a caller can announce it, and the entry
        // is gone either way — this is the behaviour that matters.
        expect(expired.map((entry) => entry.chatId)).toEqual(["a"]);
        expect(revert).not.toHaveBeenCalled();
        expect(pendingChatUndoCount()).toBe(0);
    });

    it("hides chats with a live archive or delete, but not a pin", () => {
        pushChatUndo({ kind: "pin", chatId: "pinned-only", label: "p" });
        pushChatUndo({ kind: "archive", chatId: "archived", label: "a" });
        pushChatUndo({ kind: "delete", chatId: "deleted", label: "d" });

        const hidden = pendingRemovalChatIds();
        expect([...hidden].sort()).toEqual(["archived", "deleted"]);
        // Same set, same reference: a re-render must not see a new snapshot.
        expect(pendingRemovalChatIds()).toBe(hidden);

        undoChat();
        const afterPinUndo = pendingRemovalChatIds();
        expect([...afterPinUndo].sort()).toEqual(["archived"]);
        expect(afterPinUndo).not.toBe(hidden);

        sweepChatUndo(Date.now() + CHAT_UNDO_WINDOW_MS + 1);
        expect(pendingRemovalChatIds().size).toBe(0);
    });
});

describe("batch removals", () => {
    it("hides every selected chat as one undoable operation", () => {
        pushChatUndo({ kind: "delete", chatId: "a", chatIds: ["a", "b", "c"], label: "Deleted 3 sessions" });
        expect([...pendingRemovalChatIds()]).toEqual(["a", "b", "c"]);
        undoChat();
        expect(pendingRemovalChatIds().size).toBe(0);
    });
    it("keeps committing removals hidden until async persistence finishes", async () => {
        let finish!: () => void;
        const now = Date.now();
        pushChatUndo({ kind: "archive", chatId: "a", chatIds: ["a", "b"], label: "Archive", now,
            commit: () => new Promise<void>((resolve) => { finish = resolve; }) });
        sweepChatUndo(now + CHAT_UNDO_WINDOW_MS);
        expect(pendingChatUndoCount()).toBe(0);
        expect([...pendingRemovalChatIds()]).toEqual(["a", "b"]);
        finish();
        await Promise.resolve();
        await Promise.resolve();
        expect(pendingRemovalChatIds().size).toBe(0);
    });
    it("releases failed removals and does not strand other commits", async () => {
        const now = Date.now();
        const next = vi.fn();
        pushChatUndo({ kind: "delete", chatId: "a", label: "a", now, commit: next });
        pushChatUndo({ kind: "delete", chatId: "b", label: "b", now, commit: () => { throw new Error("disk failure"); } });
        expect(() => sweepChatUndo(now + CHAT_UNDO_WINDOW_MS)).not.toThrow();
        expect(next).toHaveBeenCalledTimes(1);
        expect(pendingRemovalChatIds().size).toBe(0);
    });
});

it("retains removal snapshot identity when unrelated pin entries change", () => {
    pushChatUndo({ kind: "delete", chatId: "a", label: "Delete a" });
    const hidden = pendingRemovalChatIds();
    pushChatUndo({ kind: "pin", chatId: "b", label: "Pin b" });
    expect(pendingRemovalChatIds()).toBe(hidden);
    undoChat();
    expect(pendingRemovalChatIds()).toBe(hidden);
});
it("retains overlapping removal owners until both commits settle", async () => {
    const finishes: Array<() => void> = [];
    const now = Date.now();
    for (const kind of ["archive", "delete"] as const) {
        pushChatUndo({ kind, chatId: "a", label: kind, now,
            commit: () => new Promise<void>(resolve => { finishes.push(resolve); }) });
    }
    sweepChatUndo(now + CHAT_UNDO_WINDOW_MS);
    const hidden = pendingRemovalChatIds();
    finishes[0](); await Promise.resolve(); await Promise.resolve();
    expect(pendingRemovalChatIds()).toBe(hidden);
    finishes[1](); await Promise.resolve(); await Promise.resolve();
    expect(pendingRemovalChatIds().size).toBe(0);
});
