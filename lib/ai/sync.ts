"use client";

/**
 * Push the user's BYOK configuration into the Rust side, and keep the secrets in
 * the OS keychain.
 *
 * Boot order:
 *   1. probe the keychain (and fall back to plain settings when there is none),
 *   2. migrate any keys an older build left in the settings file,
 *   3. read the stored keys back into memory,
 *   4. push secrets + provider config to Rust.
 *
 * Rust resolves models, provider keys, web-search and Composio credentials from
 * this payload, so it is re-pushed on launch and whenever settings change.
 */

import { commands } from "@/lib/backend";
import { notify } from "@/features/notifications";
import {
    areSecretsVaulted,
    applyVaultSecrets,
    getSettings,
    providerSecretsForVault,
    setSecretsVaulted,
    subscribeSettings,
} from "@/lib/settings";
import {
    COMPOSIO_SECRET_ID,
    PROVIDER_PRESETS,
    SEARCH_SECRET_ID,
    headerSecretId,
    toRustAiConfig,
    type RustAiConfig,
} from "@/lib/ai/providers";
import { knownSecretIds, readSecrets, recordSecretDeletions, vaultAvailable, writeSecret, writtenSecretIds } from "@/lib/ai/vault";

/**
 * Every id the keychain may hold a secret under: one per provider, one per
 * connection header, and the two service keys. Header names come from the
 * settings file, which keeps names and never values.
 */
function configuredSecretIds(): string[] {
    const ids = new Set<string>([
        ...PROVIDER_PRESETS.map((preset) => preset.id),
        SEARCH_SECRET_ID,
        COMPOSIO_SECRET_ID,
    ]);
    for (const preset of PROVIDER_PRESETS) {
        const headers = getSettings().ai.providers.connections[preset.id]?.headers ?? {};
        for (const name of Object.keys(headers)) ids.add(headerSecretId(preset.id, name));
    }
    return [...ids];
}

let lastSynced = "";
let pendingSync: Promise<void> = Promise.resolve();

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

/**
 * Copy the secrets currently in settings into the keychain.
 *
 * Returns false when at least one key could not be stored, which keeps the
 * plaintext fallback in place rather than dropping the key on next launch.
 */
async function pushSecretsToVault(prune = true): Promise<boolean> {
    const secrets = providerSecretsForVault();
    let stored = true;
    const configured = new Set(configuredSecretIds());
    const orphaned = prune ? knownSecretIds().filter((id) => !configured.has(id)) : [];
    const ids = new Set([...Object.keys(secrets), ...(prune ? writtenSecretIds() : []), ...orphaned]);
    for (const id of ids) {
        if (!(await writeSecret(id, secrets[id] ?? ""))) stored = false;
    }
    return stored;
}

async function hydrateSecrets(touched: Set<string>): Promise<void> {
    const available = await vaultAvailable();
    if (!available) {
        // No keychain on this machine: keep keys in local settings as before.
        setSecretsVaulted(false);
        return;
    }
    // Keys a previous build wrote to disk move into the keychain now.
    const migrated = await pushSecretsToVault(false);
    setSecretsVaulted(migrated);
    if (!migrated) return;
    const loaded = await readSecrets([...new Set([...configuredSecretIds(), ...knownSecretIds()])]);
    // A clear/edit made while the keychain was opening must win over that read.
    for (const id of touched) delete loaded[id];
    applyVaultSecrets(loaded);
}

/**
 * Sync now and on every settings change. Returns an unsubscribe function.
 *
 * Keys are written to the keychain before the config reaches Rust, so an
 * interrupted session still reconnects on the next launch.
 */
export function initAiConfigSync(): () => void {
    let booting = true;
    let observed = providerSecretsForVault();
    const touched = new Set<string>();
    const sync = async () => {
        if (areSecretsVaulted() && !(await pushSecretsToVault())) {
            notify.error("Could not update saved credentials", "Unlock the system keychain or free local storage, then retry. Your saved credentials may not have changed.");
        }
        await syncAiConfig();
    };
    const enqueue = () => {
        pendingSync = pendingSync.then(sync).catch(() => {
            notify.error("Could not synchronize provider settings");
        });
    };
    const unsubscribe = subscribeSettings(() => {
        const next = providerSecretsForVault();
        const removed = Object.keys(observed).filter((id) => !next[id]);
        if (!recordSecretDeletions(removed)) notify.error("Could not save credential removal", "Local storage is unavailable or full. Make space or enable storage, then retry before closing the app.");
        if (booting) {
            for (const id of new Set([...Object.keys(observed), ...Object.keys(next)])) {
                if (observed[id] !== next[id]) touched.add(id);
            }
        }
        observed = next;
        if (booting) return; // The first reconciliation includes edits made during hydration.
        enqueue();
    });
    // Hydration and subsequent edits share one queue: a slow write can never
    // overtake a newer deletion and put the old credential back into the vault.
    pendingSync = pendingSync.then(async () => {
        try { await hydrateSecrets(touched); }
        finally { booting = false; }
        await sync();
    }).catch(() => {
        booting = false;
        notify.error("Could not load provider credentials");
    });
    return unsubscribe;
}

/** Resolves once boot and all settings changes queued so far have synchronized. */
export function aiConfigReady(): Promise<void> {
    return pendingSync;
}
