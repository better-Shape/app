"use client";

/**
 * Push the user's BYOK configuration into the Rust side.
 *
 * Rust resolves models, provider keys, web-search and Composio credentials from
 * this payload, so it is pushed on launch and whenever settings change. Keys
 * live only in the app's local settings (and in this in-memory snapshot).
 */

import { commands } from "@/lib/backend";
import { getSettings, subscribeSettings } from "@/lib/settings";
import { toRustAiConfig, type RustAiConfig } from "@/lib/ai/providers";

let lastSynced = "";

export async function syncAiConfig(): Promise<void> {
    const payload: RustAiConfig = toRustAiConfig(getSettings().ai.providers);
    const serialized = JSON.stringify(payload);
    if (serialized === lastSynced) return;
    try {
        await commands.setAiConfig(payload);
        lastSynced = serialized;
    } catch {
        // Leave lastSynced untouched so the next change retries.
    }
}

/** Sync now and on every settings change. Returns an unsubscribe function. */
export function initAiConfigSync(): () => void {
    void syncAiConfig();
    return subscribeSettings(() => {
        void syncAiConfig();
    });
}
