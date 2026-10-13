"use client";

import { commands } from "@/lib/backend/commands";

let active = false;
const listeners = new Set<() => void>();

function emit() {
    for (const l of listeners) l();
}

export function subscribeIncognito(cb: () => void) {
    listeners.add(cb);
    return () => {
        listeners.delete(cb);
    };
}

export function isIncognitoChat(): boolean {
    return active;
}

export async function setIncognitoChat(enabled: boolean): Promise<void> {
    const previous = active;
    active = enabled;
    emit();
    try {
        await commands.setChatIncognito(enabled);
        if (enabled) {
            const id = await commands.getCurrentConversationId();
            if (id) await purgeIncognitoConversation(id);
        }
    } catch {
        // The backend refused the change: roll the flag back rather than
        // showing an incognito chat the backend does not know about.
        if (active !== previous) {
            active = previous;
            emit();
        }
        return;
    }
    window.dispatchEvent(
        new CustomEvent("bettershape-chat-incognito", { detail: { enabled: active } }),
    );
}

export async function syncIncognitoFromBackend(): Promise<void> {
    try {
        const enabled = await commands.getChatIncognito();
        if (enabled !== active) {
            active = enabled;
            emit();
        }
    } catch {
        /* ignore */
    }
}

export async function purgeIncognitoConversation(id: string): Promise<void> {
    if (!id) return;
    try {
        await commands.deleteConversation(id);
    } catch {
        /* draft / already gone */
    }
}
