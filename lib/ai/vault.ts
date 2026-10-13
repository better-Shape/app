"use client";

/**
 * OS-keychain storage for BYOK secrets.
 *
 * Provider keys — plus the web-search and Composio keys — are the only secrets
 * the app holds. They are written to the operating system's credential store
 * (Keychain on macOS, Credential Manager on Windows, Secret Service on Linux)
 * through the Rust `ai_*` key commands, never into the settings JSON.
 *
 * If a machine has no usable keychain the app falls back to keeping keys in
 * local settings, because a missing keychain must never lock someone out of the
 * models they paid for. Settings redaction is switched on only once a keychain
 * has been confirmed working in this process.
 */

import { commands } from "@/lib/backend";

/**
 * Ids that already hold the value we last wrote, so a settings change that does
 * not touch the key costs nothing.
 */
const written = new Map<string, string>();

let supported: boolean | null = null;

/** Probe (once per session) whether this machine can store secrets. */
export async function vaultAvailable(): Promise<boolean> {
    if (supported !== null) return supported;
    try {
        supported = await commands.aiVaultSupported();
    } catch {
        // Desktop bridge missing (browser dev) or the probe failed.
        supported = false;
    }
    return supported;
}

/** Test seam: pin the availability answer without touching the keychain. */
export function __setVaultAvailableForTesting(value: boolean | null): void {
    supported = value;
}

/** Forget the write cache (tests, and after a deliberate clear). */
export function __resetVaultCacheForTesting(): void {
    written.clear();
    supported = null;
}

/** Read the stored secrets for these ids. Missing entries are omitted. */
export async function readSecrets(ids: string[]): Promise<Record<string, string>> {
    if (ids.length === 0) return {};
    if (!(await vaultAvailable())) return {};
    try {
        const rows = await commands.aiLoadKeys(ids);
        const out: Record<string, string> = {};
        for (const row of rows) {
            const key = row.apiKey.trim();
            if (key) {
                out[row.id] = key;
                written.set(row.id, key);
            }
        }
        return out;
    } catch {
        return {};
    }
}

/** Store a secret (empty clears it). Returns false when no keychain is usable. */
export async function writeSecret(id: string, value: string): Promise<boolean> {
    const secret = value.trim();
    if (written.get(id) === secret) return true;
    if (!(await vaultAvailable())) return false;
    try {
        if (secret) {
            await commands.aiStoreKey(id, secret);
        } else {
            await commands.aiDeleteKey(id);
        }
        written.set(id, secret);
        return true;
    } catch {
        // Keep the cache untouched so the next settings change retries.
        return false;
    }
}

/** Remove a secret entirely (also used when a provider is reset). */
export async function forgetSecret(id: string): Promise<void> {
    written.delete(id);
    if (!(await vaultAvailable())) return;
    try {
        await commands.aiDeleteKey(id);
        written.set(id, "");
    } catch {
        /* nothing stored, or no keychain — either way nothing to remove */
    }
}

/** Ids this session has written, used to prune secrets of removed providers. */
export function writtenSecretIds(): string[] {
    return [...written.entries()].filter(([, value]) => value).map(([id]) => id);
}
