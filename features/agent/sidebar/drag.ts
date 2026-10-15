"use client";

import { pointerWithin, closestCenter, type CollisionDetection, type KeyboardCoordinateGetter } from "@dnd-kit/core";
import { getPinnedChatIds, setChatPinned } from "@/lib/sidebar/chat-list-meta";
import { CHAT_SNOOZE_MS, getChatDispositions, setChatDisposition, type ChatDisposition } from "@/lib/sidebar/chat-disposition";
import { pendingRemovalChatIds, pushChatUndo, type ChatUndoKind } from "./undo";

// Working is derived from a live agent, never something dragging can start.
export const DROP_SHELVES = ["pinned", "active", "snoozed", "settled"] as const;
export type DropShelf = (typeof DROP_SHELVES)[number];
export const DROP_VERBS: Record<DropShelf, string> = {
    pinned: "Pin", active: "Resume", snoozed: "Snooze", settled: "Settle",
};

/** Menu actions and shelf drops use the same labels and wake/snooze semantics. */
export const SHELF_ACTIONS = {
    pinned: { kind: "pin", past: "Pinned", state: "active" },
    active: { kind: "resume", past: "Resumed", state: "active" },
    snoozed: { kind: "snooze", past: "Snoozed", state: "snoozed" },
    settled: { kind: "settle", past: "Settled", state: "settled" },
} as const satisfies Record<DropShelf, { kind: ChatUndoKind; past: string; state: ChatDisposition["state"] }>;

export function dispositionForShelf(shelf: DropShelf, now = Date.now()): ChatDisposition {
    const { state } = SHELF_ACTIONS[shelf];
    return state === "snoozed" ? { state, until: now + CHAT_SNOOZE_MS } : { state };
}

/** Narrow a drop target to an actionable shelf; runtime-derived Working is never a drop command. */
export function isDropShelf(value: unknown): value is DropShelf {
    return typeof value === "string" && (DROP_SHELVES as readonly string[]).includes(value);
}

/** Pointer drops require containment; keyboard moves explicitly center the row on a header. */
export const shelfCollision: CollisionDetection = (args) =>
    args.pointerCoordinates ? pointerWithin(args) : closestCenter(args);

type KeyboardContext = Parameters<KeyboardCoordinateGetter>[1]["context"];
const KEYBOARD_DIRECTIONS = new Map([["ArrowDown", 1], ["ArrowUp", -1]]);

function shelfOf(target: KeyboardContext["over"] | KeyboardContext["active"]): unknown {
    return target?.data.current?.shelf;
}

function nextKeyboardShelf(context: KeyboardContext, direction: number): DropShelf | undefined {
    const current = shelfOf(context.over) ?? shelfOf(context.active);
    const index = DROP_SHELVES.findIndex(shelf => shelf === current);
    if (index >= 0) return DROP_SHELVES[index + direction];
    return direction > 0 ? DROP_SHELVES[0] : DROP_SHELVES[DROP_SHELVES.length - 1];
}

/** Arrow keys step between actionable shelf headers, including empty/collapsed ones. */
export const shelfKeyboardCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
    const direction = KEYBOARD_DIRECTIONS.get(event.code);
    if (!direction) return undefined;
    const next = nextKeyboardShelf(context, direction);
    if (!next || !context.collisionRect) return undefined;
    const rect = context.droppableRects.get(`shelf:${next}`);
    if (!rect) return undefined;
    event.preventDefault();
    return {
        x: rect.left + rect.width / 2 - context.collisionRect.width / 2,
        y: rect.top + rect.height / 2 - context.collisionRect.height / 2,
    };
};

/** A shelf drop is ONE undo operation, including the pin/disposition combination. */
export function moveChatsToShelf(ids: readonly string[], shelf: DropShelf, label: string): boolean {
    const hidden = pendingRemovalChatIds();
    const targets = [...new Set(ids)].filter((id) => id && !hidden.has(id));
    if (targets.length === 0) return false;
    const pinned = getPinnedChatIds();
    const dispositions = getChatDispositions();
    const previous = targets.map((id) => ({ id, pinned: pinned.has(id), disposition: dispositions[id] }));
    const state = dispositionForShelf(shelf);
    const action = SHELF_ACTIONS[shelf];
    for (const id of targets) {
        setChatPinned(id, shelf === "pinned");
        setChatDisposition(id, state);
    }
    pushChatUndo({
        kind: action.kind,
        chatId: targets[0], chatIds: targets,
        label: `${action.past} ${label}`,
        revert: () => {
            for (const chat of previous) {
                setChatPinned(chat.id, chat.pinned);
                setChatDisposition(chat.id, chat.disposition);
            }
        },
    });
    return true;
}
