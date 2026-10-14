"use client";

/**
 * A short-lived undo stack for the destructive sidebar actions.
 *
 * Same external-store shape as `lib/sidebar/chat-list-meta` so the sidebar can
 * bind it with `useSyncExternalStore`. The stack lives in the module rather than
 * in a component because a delete is only *committed* when its window closes:
 * remounting the sidebar must not turn a pending delete into a real one, or lose
 * the chance to undo it.
 */

import { useSyncExternalStore } from "react";

export type ChatUndoKind = "pin" | "archive" | "delete";

export const CHAT_UNDO_WINDOW_MS = 5000;

export interface ChatUndoEntry {
    id: string;
    kind: ChatUndoKind;
    chatId: string;
    /** What the bar reads out loud, e.g. "Pinned “Refactor auth”". */
    label: string;
    createdAt: number;
    expiresAt: number;
    /**
     * Runs when the window closes without an undo. Only `delete` needs it — it is
     * the one action with no reverse, so it is held back until the user is out of
     * time to change their mind.
     */
    commit?: () => void;
    /**
     * Runs when the window is undone. `delete` has none, because it never reached
     * the backend.
     */
    revert?: () => void;
}

export interface PushChatUndoInput {
    kind: ChatUndoKind;
    chatId: string;
    label: string;
    commit?: () => void;
    revert?: () => void;
    /** Test seam. Defaults to `Date.now()`. */
    now?: number;
}

const listeners = new Set<() => void>();
/** Newest first. */
let stack: readonly ChatUndoEntry[] = [];
let timer: number | null = null;
let seq = 0;

function emit() {
    for (const listener of listeners) listener();
}

function stopTimer() {
    if (timer === null || typeof window === "undefined") return;
    window.clearTimeout(timer);
    timer = null;
}

/** Wakes for the oldest deadline still on the stack. */
function schedule() {
    stopTimer();
    if (typeof window === "undefined") return;
    const oldest = stack[stack.length - 1];
    if (!oldest) return;
    timer = window.setTimeout(
        () => {
            timer = null;
            sweepChatUndo();
        },
        Math.max(0, oldest.expiresAt - Date.now()),
    );
}

export function subscribeChatUndo(cb: () => void) {
    listeners.add(cb);
    return () => {
        listeners.delete(cb);
    };
}

/** Stable snapshot for `useSyncExternalStore`. */
export function getChatUndo(): ChatUndoEntry | null {
    return stack[0] ?? null;
}

export function getChatUndoServer(): ChatUndoEntry | null {
    return null;
}

/** How many actions can still be undone, oldest last. Test and debug aid. */
export function pendingChatUndoCount(): number {
    return stack.length;
}

const EMPTY_IDS: ReadonlySet<string> = new Set();
let idsCache: { key: string; value: ReadonlySet<string> } | null = null;

/**
 * Chats a live undo entry has taken off screen but not yet destroyed.
 *
 * Archive and delete both remove the row before the backend has been told (or,
 * for delete, before it is told at all), so the sidebar hides these ids rather
 * than waiting for a reload. Pin is excluded: it moves a row between shelves, it
 * does not remove it.
 */
export function pendingRemovalChatIds(): ReadonlySet<string> {
    const removals = stack.filter((entry) => entry.kind === "archive" || entry.kind === "delete");
    const key = removals.map((entry) => entry.chatId).join("\u0000");
    if (idsCache && idsCache.key === key) return idsCache.value;
    const value = new Set(removals.map((entry) => entry.chatId));
    idsCache = { key, value };
    return value;
}

export function pendingRemovalChatIdsServer(): ReadonlySet<string> {
    return EMPTY_IDS;
}

export function pushChatUndo(input: PushChatUndoInput): ChatUndoEntry {
    seq += 1;
    const now = input.now ?? Date.now();
    const entry: ChatUndoEntry = {
        id: `chat-undo-${seq}`,
        kind: input.kind,
        chatId: input.chatId,
        label: input.label,
        createdAt: now,
        expiresAt: now + CHAT_UNDO_WINDOW_MS,
        ...(input.commit ? { commit: input.commit } : {}),
        ...(input.revert ? { revert: input.revert } : {}),
    };
    stack = [entry, ...stack];
    schedule();
    emit();
    return entry;
}

/**
 * Drops every entry whose window has closed and commits them.
 *
 * A timer alone is not enough: a background tab throttles `setTimeout`, so an
 * entry can be past its deadline with the sweep still pending. Every caller
 * checks the clock rather than trusting the callback to have run.
 */
export function sweepChatUndo(now: number = Date.now()): ChatUndoEntry[] {
    const expired = stack.filter((entry) => entry.expiresAt <= now);
    if (expired.length === 0) return [];
    stack = stack.filter((entry) => entry.expiresAt > now);
    for (const entry of expired) entry.commit?.();
    schedule();
    emit();
    return expired;
}

/**
 * Reverts the newest live action and returns it, or `null` when nothing was
 * pending — which the `mod+Z` handler uses to decide whether the key is its own.
 */
export function undoChat(): ChatUndoEntry | null {
    sweepChatUndo();
    const entry = stack[0];
    if (!entry) return null;
    stack = stack.slice(1);
    schedule();
    entry.revert?.();
    emit();
    return entry;
}

/** Throws the newest action away instead of undoing it. A pending delete commits now. */
export function dismissChatUndo(): ChatUndoEntry | null {
    sweepChatUndo();
    const entry = stack[0];
    if (!entry) return null;
    stack = stack.slice(1);
    schedule();
    entry.commit?.();
    emit();
    return entry;
}

export function resetChatUndoForTests() {
    stopTimer();
    stack = [];
    seq = 0;
    idsCache = null;
    emit();
}

export function useChatUndo(): ChatUndoEntry | null {
    return useSyncExternalStore(subscribeChatUndo, getChatUndo, getChatUndoServer);
}