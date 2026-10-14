"use client";

import { useEffect, useSyncExternalStore } from "react";

const EMPTY_IDS: ReadonlySet<string> = new Set();
let generatingIds: ReadonlySet<string> = EMPTY_IDS;
const listeners = new Set<() => void>();

function emit() {
    for (const l of listeners) l();
}

/** Mark a chat tab/conversation as currently generating (or clear it). */
export function setChatGenerating(chatId: string | null | undefined, generating: boolean) {
    if (!chatId) return;
    const before = generatingIds.has(chatId);
    if (before !== generating) {
        const next = new Set(generatingIds);
        if (generating) next.add(chatId);
        else next.delete(chatId);
        generatingIds = next.size ? next : EMPTY_IDS;
        emit();
        window.dispatchEvent(
            new CustomEvent("bettershape-chat-generating", {
                detail: { id: chatId, generating },
            }),
        );
    }
}

export function resetGeneratingChatsForTests() {
    generatingIds = EMPTY_IDS;
    emit();
}

function subscribe(cb: () => void) {
    listeners.add(cb);
    return () => {
        listeners.delete(cb);
    };
}

function getSnapshot() {
    return generatingIds;
}

/** Reactive set of chat IDs that are currently streaming. */
export function useGeneratingChatIds(): ReadonlySet<string> {
    return useSyncExternalStore(
        subscribe,
        getSnapshot,
        () => EMPTY_IDS,
    );
}

export function useIsChatGenerating(chatId: string | null | undefined): boolean {
    const ids = useGeneratingChatIds();
    if (!chatId) return false;
    return ids.has(chatId);
}

export function isChatGenerating(chatId: string | null | undefined): boolean {
    if (!chatId) return false;
    return generatingIds.has(chatId);
}

export function hasGeneratingChats(): boolean {
    return generatingIds.size > 0;
}

/** Optimistic: mark generating while this chat is streaming. Clears come from chat_complete. */
export function useSyncChatGenerating(
    chatId: string | null | undefined,
    isLoading: boolean,
) {
    useEffect(() => {
        if (!chatId || !isLoading) return;
        setChatGenerating(chatId, true);
    }, [chatId, isLoading]);
}
