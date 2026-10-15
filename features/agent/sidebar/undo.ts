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
import { notify } from "@/features/notifications";

export type ChatUndoKind = "pin" | "archive" | "delete" | "settle" | "snooze" | "resume";

export const CHAT_UNDO_WINDOW_MS = 5000;

export interface ChatUndoEntry {
    id: string;
    kind: ChatUndoKind;
    chatId: string;
    chatIds?: readonly string[];
    /** What the bar reads out loud, e.g. "Pinned “Refactor auth”". */
    label: string;
    createdAt: number;
    expiresAt: number;
    /**
     * Runs when the window closes without an undo. Archive and delete need it — it is
     * the one action with no reverse, so it is held back until the user is out of
     * time to change their mind.
     */
    commit?: () => void | Promise<void>;
    /**
     * Runs when the window is undone. Deferred removals have none, because they never reached
     * the backend.
     */
    revert?: () => void | Promise<void>;
}

export interface PushChatUndoInput {
    kind: ChatUndoKind;
    chatId: string;
    chatIds?: readonly string[];
    label: string;
    commit?: () => void | Promise<void>;
    revert?: () => void | Promise<void>;
    /** Test seam. Defaults to `Date.now()`. */
    now?: number;
}

const listeners = new Set<() => void>();
/** Newest first. */
let stack: readonly ChatUndoEntry[] = [];
let timer: number | null = null;
let seq = 0;
const committing = new Map<string, ChatUndoEntry>();
let committingRevision = 0;

/** Notify undo-store subscribers after a stack or in-flight commit transition. */
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
let idsCache: { stack: typeof stack; revision: number; value: ReadonlySet<string> } | null = null;

/** Return a cached snapshot only while both staged and committing owners are unchanged. */
function currentRemovalSnapshot(): ReadonlySet<string> | undefined {
    const cache = idsCache;
    return cache && cache.stack === stack && cache.revision === committingRevision ? cache.value : undefined;
}

/** Pin/disposition operations move rows; only archive/delete temporarily remove their targets. */
function removalIds(entry: ChatUndoEntry): readonly string[] {
    if (entry.kind !== "archive" && entry.kind !== "delete") return [];
    return entry.chatIds ?? [entry.chatId];
}

/**
 * Chats a live undo entry has taken off screen but not yet destroyed.
 *
 * Archive and delete both remove the row before the backend has been told (or,
 * for delete, before it is told at all), so the sidebar hides these ids rather
 * than waiting for a reload. Pin is excluded: it moves a row between shelves, it
 * does not remove it.
 */
export function pendingRemovalChatIds(): ReadonlySet<string> {
    const cached = currentRemovalSnapshot();
    if (cached) return cached;
    const value = new Set([...stack, ...committing.values()].flatMap(removalIds));
    const previous = idsCache ? idsCache.value : EMPTY_IDS;
    const snapshot = value.size === previous.size && [...value].every((id) => previous.has(id)) ? previous : value;
    idsCache = { stack, revision: committingRevision, value: snapshot };
    return snapshot;
}

/** Return the stable empty removal snapshot for server rendering. */
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
        chatIds: [...(input.chatIds ?? [input.chatId])],
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

/** Track an expired entry through synchronous or asynchronous commit, reporting failures and releasing pending-removal ownership. */
function commitEntry(entry: ChatUndoEntry) {
    if (!entry.commit) return;
    committing.set(entry.id, entry);
    committingRevision += 1;
    /** Release this commit's ownership and invalidate the removal snapshot after either success or failure. */
    const finish = () => {
        committing.delete(entry.id);
        committingRevision += 1;
        emit();
    };
    try {
        const result = entry.commit();
        if (result && typeof result.then === "function") {
            void result.catch((error: unknown) => {
                notify.error(error instanceof Error ? error.message : "Could not update session");
            }).finally(finish);
        } else finish();
    } catch (error) {
        finish();
        notify.error(error instanceof Error ? error.message : "Could not update session");
    }
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
    for (const entry of expired) commitEntry(entry);
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
    try {
        const result = entry.revert?.();
        if (result && typeof result.then === "function") void result.catch((error: unknown) => {
            notify.error(error instanceof Error ? error.message : "Could not undo session change");
        });
    } catch (error) {
        notify.error(error instanceof Error ? error.message : "Could not undo session change");
    }
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
    commitEntry(entry);
    emit();
    return entry;
}

export function resetChatUndoForTests() {
    stopTimer();
    stack = [];
    seq = 0;
    idsCache = null;
    committing.clear();
    committingRevision += 1;
    emit();
}

export function useChatUndo(): ChatUndoEntry | null {
    return useSyncExternalStore(subscribeChatUndo, getChatUndo, getChatUndoServer);
}