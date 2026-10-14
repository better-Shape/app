"use client";

import { pointerWithin, rectIntersection, type CollisionDetection, type KeyboardCoordinateGetter } from "@dnd-kit/core";
import { getPinnedChatIds, setChatPinned } from "@/lib/sidebar/chat-list-meta";
import { CHAT_SNOOZE_MS, getChatDispositions, setChatDisposition, type ChatDisposition } from "@/lib/sidebar/chat-disposition";
import { pendingRemovalChatIds, pushChatUndo } from "./undo";

// Working is derived from a live agent, never something dragging can start.
export const DROP_SHELVES = ["pinned", "active", "snoozed", "settled"] as const;
export type DropShelf = (typeof DROP_SHELVES)[number];
export const DROP_VERBS: Record<DropShelf, string> = {
    pinned: "Pin", active: "Resume", snoozed: "Snooze", settled: "Settle",
};

export function isDropShelf(value: unknown): value is DropShelf {
    return typeof value === "string" && (DROP_SHELVES as readonly string[]).includes(value);
}

/** A pointer outside all targets means cancel, not "drop on the nearest shelf". */
export const shelfCollision: CollisionDetection = (args) =>
    args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args);

/** Arrow keys step between actionable shelf headers, including empty/collapsed ones. */
export const shelfKeyboardCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
    if (event.code !== "ArrowDown" && event.code !== "ArrowUp") return;
    const current = context.over?.data.current?.shelf ?? context.active?.data.current?.shelf;
    const index = DROP_SHELVES.findIndex((shelf) => shelf === current);
    const direction = event.code === "ArrowDown" ? 1 : -1;
    const nextIndex = index < 0 ? (direction > 0 ? 0 : DROP_SHELVES.length - 1) : index + direction;
    const next = DROP_SHELVES[nextIndex];
    if (!next || !context.collisionRect) return;
    const rect = context.droppableRects.get(`shelf:${next}`);
    if (!rect) return;
    event.preventDefault();
    return {
        x: rect.left + rect.width / 2 - context.collisionRect.width / 2,
        y: rect.top + rect.height / 2 - context.collisionRect.height / 2,
    };
};

/** A shelf drop is ONE undo operation, including the pin/disposition combination. */
export function moveChatsToShelf(ids: readonly string[], shelf: DropShelf, label: string): boolean {
    const targets = [...new Set(ids)].filter((id) => id && !pendingRemovalChatIds().has(id));
    if (targets.length === 0) return false;
    const previous = targets.map((id) => ({
        id, pinned: getPinnedChatIds().has(id), disposition: getChatDispositions()[id],
    }));
    const state: ChatDisposition = shelf === "snoozed"
        ? { state: "snoozed", until: Date.now() + CHAT_SNOOZE_MS }
        : { state: shelf === "settled" ? "settled" : "active" };
    for (const id of targets) {
        setChatPinned(id, shelf === "pinned");
        setChatDisposition(id, state);
    }
    pushChatUndo({
        kind: shelf === "pinned" ? "pin" : shelf === "snoozed" ? "snooze" : shelf === "settled" ? "settle" : "resume",
        chatId: targets[0], chatIds: targets,
        label: `${shelf === "pinned" ? "Pinned" : shelf === "snoozed" ? "Snoozed" : shelf === "settled" ? "Settled" : "Resumed"} ${label}`,
        revert: () => {
            for (const chat of previous) {
                setChatPinned(chat.id, chat.pinned);
                setChatDisposition(chat.id, chat.disposition);
            }
        },
    });
    return true;
}
