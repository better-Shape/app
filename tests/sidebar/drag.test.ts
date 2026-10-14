import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { moveChatsToShelf, isDropShelf, shelfCollision, DROP_SHELVES } from "@/features/agent/sidebar/drag";
import { getChatDispositions, setChatDisposition } from "@/lib/sidebar/chat-disposition";
import { getPinnedChatIds, setChatPinned } from "@/lib/sidebar/chat-list-meta";
import { getChatUndo, pendingChatUndoCount, pushChatUndo, resetChatUndoForTests, undoChat } from "@/features/agent/sidebar/undo";
function reset() {
    resetChatUndoForTests();
    for (const id of getPinnedChatIds()) setChatPinned(id, false);
    for (const id of Object.keys(getChatDispositions())) setChatDisposition(id, undefined);
}
beforeEach(reset);
afterEach(reset);

describe("shelf drops", () => {
    it("does not expose working as a drop target", () => {
        expect(DROP_SHELVES).toEqual(["pinned", "active", "snoozed", "settled"]);
        expect(isDropShelf("working")).toBe(false);
        expect(isDropShelf(undefined)).toBe(false);
    });
    it("moves a mixed selection atomically and restores both pin and snooze intent", () => {
        const oldSnooze = { state: "snoozed", until: Date.now() + 120_000 } as const;
        setChatPinned("a", true);
        setChatDisposition("b", oldSnooze);
        moveChatsToShelf(["a", "b", "a"], "settled", "2 sessions");
        expect([...getPinnedChatIds()]).toEqual([]);
        expect(getChatDispositions()).toMatchObject({ a: { state: "settled" }, b: { state: "settled" } });
        expect(pendingChatUndoCount()).toBe(1);
        expect(getChatUndo()?.chatIds).toEqual(["a", "b"]);
        undoChat();
        expect(getPinnedChatIds().has("a")).toBe(true);
        expect(getChatDispositions()["a"]).toBeUndefined();
        expect(getChatDispositions()["b"]).toEqual(oldSnooze);
    });
    it("pinning a settled chat wakes it so it actually reaches the pinned shelf", () => {
        setChatDisposition("a", { state: "settled" });
        moveChatsToShelf(["a"], "pinned", "Alpha");
        expect(getChatDispositions()["a"]).toEqual({ state: "active" });
        expect(getPinnedChatIds().has("a")).toBe(true);
        undoChat();
        expect(getChatDispositions()["a"]).toEqual({ state: "settled" });
        expect(getPinnedChatIds().has("a")).toBe(false);
    });
    it("does not drag pending removals back into view", () => {
        pushChatUndo({ kind: "delete", chatId: "a", label: "Delete a" });
        expect(moveChatsToShelf(["a"], "active", "Alpha")).toBe(false);
        expect(getChatDispositions()["a"]).toBeUndefined();
        expect(pendingChatUndoCount()).toBe(1);
    });
    it("does not snap an outside pointer onto a nearby target", () => {
        const rect = { top: 0, left: 0, right: 100, bottom: 30, width: 100, height: 30 };
        const data = { current: { shelf: "pinned" } };
        const droppable = { id: "shelf:pinned", key: "shelf:pinned", disabled: false, data, node: { current: null }, rect: { current: rect } };
        expect(shelfCollision({
            active: { id: "a", data, rect: { current: { initial: null, translated: null } } },
            collisionRect: rect, droppableRects: new Map([[droppable.id, rect]]),
            droppableContainers: [droppable], pointerCoordinates: { x: 300, y: 300 },
        })).toEqual([]);
    });
});
