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
const pendingDeletions = new Set<string>();
const writeRevisions = new Map<string, number>();
function nextRevision(id: string): number {
    const revision = (writeRevisions.get(id) ?? 0) + 1;
    writeRevisions.set(id, revision);
    return revision;
}
function isPendingDeletion(id: string): boolean {
    return pendingDeletions.has(id) || inventoryState(id) === "delete";
}

// Only IDs and deletion intent live here, never credential values. Per-ID
// entries avoid losing unrelated IDs when two windows update the inventory.
const INVENTORY_PREFIX = "bettershape-ai-vault-entry:";
type InventoryState = "stored" | "delete";

function inventoryKey(id: string): string { return `${INVENTORY_PREFIX}${encodeURIComponent(id)}`; }
function inventoryState(id: string): string | null {
    try { return window.localStorage.getItem(inventoryKey(id)); }
    catch { return null; }
}
function inventoryEntries(): Array<[string, InventoryState]> {
    const entries: Array<[string, InventoryState]> = [];
    try {
        for (let index = 0; index < window.localStorage.length; index += 1) {
            const key = window.localStorage.key(index);
            if (!key?.startsWith(INVENTORY_PREFIX)) continue;
            const state = window.localStorage.getItem(key);
            if (state !== "stored" && state !== "delete") continue;
            try {
                const id = decodeURIComponent(key.slice(INVENTORY_PREFIX.length));
                if (id) entries.push([id, state]);
            } catch { /* Ignore malformed metadata, never interpret it as a credential. */ }
        }
    } catch { /* An unavailable metadata store cannot grant deletion authority. */ }
    return entries;
}
function recordInventory(id: string, state: InventoryState): boolean {
    try { window.localStorage.setItem(inventoryKey(id), state); return true; }
    catch { return false; }
}

/** Includes IDs whose header/provider is no longer present in current settings. */
export function knownSecretIds(): string[] { return [...new Set([...inventoryEntries().map(([id]) => id), ...pendingDeletions])]; }

/** Synchronous write-ahead intent: survives exit while a keychain operation is pending. */
export function recordSecretDeletions(ids: string[]): boolean {
    let recorded = true;
    for (const id of ids) {
        nextRevision(id);
        pendingDeletions.add(id);
        written.delete(id);
        if (!recordInventory(id, "delete")) recorded = false;
    }
    return recorded;
}

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
    pendingDeletions.clear();
    writeRevisions.clear();
    supported = null;
}

/** Read the stored secrets for these ids. Missing entries are omitted. */
export async function readSecrets(ids: string[]): Promise<Record<string, string>> {
    if (ids.length === 0) return {};
    if (!(await vaultAvailable())) return {};
    try {
        const rows = await commands.aiLoadKeys(ids.filter((id) => !isPendingDeletion(id)));
        const out: Record<string, string> = {};
        for (const row of rows) {
            const key = row.apiKey.trim();
            // The user may clear a credential while this read is awaiting IPC.
            if (key && !isPendingDeletion(row.id)) {
                out[row.id] = key;
                if (recordInventory(row.id, "stored")) written.set(row.id, key);
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
    if (secret && written.get(id) === secret) return true;
    if (!(await vaultAvailable())) return false;
    // Record BEFORE touching the keychain. A failed/interrupted deletion must
    // remain discoverable even after its header name disappears from settings.
    if (secret ? !recordInventory(id, "stored") : !recordSecretDeletions([id])) return false;
    const revision = nextRevision(id);
    if (secret) pendingDeletions.delete(id);
    try {
        if (secret) {
            await commands.aiStoreKey(id, secret);
        } else {
            await commands.aiDeleteKey(id);
        }
        // A newer local intent may have arrived while IPC was pending. Do not
        // cache an obsolete success or erase that intent's retry marker.
        if (writeRevisions.get(id) === revision) {
            written.set(id, secret);
            if (!secret) {
                pendingDeletions.delete(id);
                try {
                    if (inventoryState(id) === "delete") window.localStorage.removeItem(inventoryKey(id));
                } catch { /* Keeping a tombstone is safe; the next launch retries cleanup. */ }
            }
        }
        return true;
    } catch {
        // Failed stores stay uncached; failed deletions retain their tombstones.
        return false;
    }
}

/** Remove a secret entirely, retaining durable retry intent if the keychain is locked. */
export async function forgetSecret(id: string): Promise<boolean> {
    return writeSecret(id, "");
}

/** Cached nonempty keys plus pending deletions that must retry across restarts. */
export function writtenSecretIds(): string[] {
    return [...new Set([
        ...[...written.entries()].filter(([, value]) => value).map(([id]) => id),
        ...inventoryEntries().filter(([, state]) => state === "delete").map(([id]) => id),
        ...pendingDeletions,
    ])];
}
