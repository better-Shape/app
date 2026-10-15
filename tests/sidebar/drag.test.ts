import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { moveChatsToShelf, isDropShelf, shelfCollision, createShelfKeyboardNavigation, DROP_SHELVES } from "@/features/agent/sidebar/drag";
import { CHAT_SNOOZE_MS, getChatDispositions, setChatDisposition } from "@/lib/sidebar/chat-disposition";
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

describe("shelf keyboard coordinates", () => {
    type Context = Parameters<ReturnType<typeof createShelfKeyboardNavigation>["coordinates"]>[1]["context"];
    const box = { left: 10, top: 100, right: 310, bottom: 130, width: 300, height: 30 };
    function context(shelf: unknown): Context {
        return {
            activatorEvent: null, activeNode: null, collisions: null, draggingNode: null,
            draggingNodeRect: null, draggableNodes: new Map(), scrollableAncestors: [], scrollAdjustedTranslate: null,
            droppableContainers: Object.assign(new Map(), { toArray: () => [], getEnabled: () => [], getNodeFor: () => undefined }),
            active: { id: "chat", data: { current: { shelf } }, rect: { current: { initial: box, translated: box } } },
            over: null, collisionRect: box, droppableRects: new Map(DROP_SHELVES.map(key => [`shelf:${key}`, box])),
        };
    }
    function coordinates(code: string, value: Context) {
        const event = new KeyboardEvent("keydown", { code, cancelable: true });
        const navigation = createShelfKeyboardNavigation();
        navigation.start(value.active?.data.current?.shelf);
        const result = navigation.coordinates(event, { context: value, active: "chat", currentCoordinates: { x: 0, y: 0 } });
        return { result, prevented: event.defaultPrevented };
    }
    it.each([
        ["ArrowDown", "pinned"], ["ArrowUp", "settled"],
        ["ArrowDown", "working"], ["ArrowUp", undefined],
    ])("moves %s from %s", (code, shelf) => {
        expect(coordinates(code as string, context(shelf))).toEqual({ result: { x: 10, y: 100 }, prevented: true });
    });
    it.each([["ArrowUp", "pinned"], ["ArrowDown", "settled"], ["ArrowLeft", "active"], ["toString", "active"]])(
        "does not consume %s from %s", (code, shelf) => {
            expect(coordinates(code, context(shelf))).toEqual({ result: undefined, prevented: false });
        },
    );
    it.each([["ArrowDown", "active"], ["ArrowUp", "pinned"]])("moves %s from Working to the adjacent %s header", (code, destination) => {
        const value = context("working");
        value.droppableRects.set(`shelf:${destination}`, { ...box, left: 400, right: 700 });
        expect(coordinates(code, value)).toEqual({ result: { x: 400, y: 100 }, prevented: true });
    });
    it("does not mistake an initial collision target for an arrow-selected shelf", () => {
        const value = context("pinned");
        value.over = { id: "shelf:settled", rect: box, disabled: false, data: { current: { shelf: "settled" } } };
        expect(coordinates("ArrowDown", value).prevented).toBe(true);
    });
    it("tracks successive keyboard choices and resets at the next drag", () => {
        const value = context("working");
        DROP_SHELVES.forEach((shelf, index) => value.droppableRects.set(`shelf:${shelf}`, { ...box, left: index * 100, right: index * 100 + 300 }));
        const navigation = createShelfKeyboardNavigation();
        const move = (code: string) => navigation.coordinates(new KeyboardEvent("keydown", { code }), {
            context: value, active: "chat", currentCoordinates: { x: 0, y: 0 },
        });
        navigation.start("working");
        expect(move("ArrowDown")).toMatchObject({ x: 100 });
        expect(move("ArrowLeft")).toBeUndefined();
        expect(move("ArrowDown")).toMatchObject({ x: 200 });
        expect(move("ArrowUp")).toMatchObject({ x: 100 });
        navigation.start("working");
        expect(move("ArrowUp")).toMatchObject({ x: 0 });
    });
    it("leaves an unmeasured target or missing collision rectangle alone", () => {
        const value = context("pinned");
        value.droppableRects.clear();
        expect(coordinates("ArrowDown", value).prevented).toBe(false);
        value.collisionRect = null;
        expect(coordinates("ArrowDown", value).prevented).toBe(false);
    });
});

it.each([
    ["pinned", "pin", "Pinned", "active"], ["active", "resume", "Resumed", "active"],
    ["snoozed", "snooze", "Snoozed", "snoozed"], ["settled", "settle", "Settled", "settled"],
] as const)("keeps the %s shelf's disposition, undo kind and label aligned", (shelf, kind, past, state) => {
    const before = Date.now();
    expect(moveChatsToShelf(["a", "b"], shelf, "2 sessions")).toBe(true);
    expect(getChatUndo()).toMatchObject({ kind, label: `${past} 2 sessions`, chatIds: ["a", "b"] });
    expect(getChatDispositions().a.state).toBe(state);
    expect(getChatDispositions().a).toEqual(getChatDispositions().b);
    expect(getPinnedChatIds().has("a")).toBe(shelf === "pinned");
    const actual = getChatDispositions().a;
    if (actual.state === "snoozed") expect(actual.until).toBeGreaterThanOrEqual(before + CHAT_SNOOZE_MS);
    undoChat();
    expect(getChatDispositions().a).toBeUndefined();
    expect(getPinnedChatIds().size).toBe(0);
});

it("chooses the arrow-selected header when a tall dragged row overlaps multiple shelves equally", () => {
    const rect = (top: number, height: number) => ({ top, bottom: top + height, left: 0, right: 300, width: 300, height });
    const headers = ["pinned", "active", "snoozed"].map((shelf, index) => {
        const box = rect(index * 40, 20);
        return {
            id: `shelf:${shelf}`, key: shelf, disabled: false, data: { current: { shelf } },
            node: { current: null }, rect: { current: box },
        };
    });
    // Keyboard coordinates center the 200px expanded row on the Active header.
    const collisionRect = rect(-50, 200);
    const hits = shelfCollision({
        active: { id: "chat", data: { current: { shelf: "pinned" } }, rect: { current: { initial: collisionRect, translated: collisionRect } } },
        collisionRect, droppableRects: new Map(headers.map(header => [header.id, header.rect.current])),
        droppableContainers: headers, pointerCoordinates: null,
    });
    expect(hits[0]?.id).toBe("shelf:active");
});
