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
import { readSecrets, vaultAvailable, writeSecret } from "@/lib/ai/vault";

/**
 * Every id the keychain may hold a secret under: one per provider, one per
 * connection header, and the two service keys. Header names come from the
 * settings file, which keeps names and never values.
 */
function secretIds(): string[] {
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
let hydration: Promise<void> | null = null;

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
async function pushSecretsToVault(): Promise<boolean> {
    const secrets = providerSecretsForVault();
    let stored = true;
    for (const [id, value] of Object.entries(secrets)) {
        if (!(await writeSecret(id, value))) stored = false;
    }
    return stored;
}

async function hydrateSecrets(): Promise<void> {
    const available = await vaultAvailable();
    if (!available) {
        // No keychain on this machine: keep keys in local settings as before.
        setSecretsVaulted(false);
        return;
    }
    // Keys a previous build wrote to disk move into the keychain now.
    const migrated = await pushSecretsToVault();
    setSecretsVaulted(migrated);
    if (!migrated) return;
    applyVaultSecrets(await readSecrets(secretIds()));
}

/**
 * Sync now and on every settings change. Returns an unsubscribe function.
 *
 * Keys are written to the keychain before the config reaches Rust, so an
 * interrupted session still reconnects on the next launch.
 */
export function initAiConfigSync(): () => void {
    const unsubscribe = subscribeSettings(() => {
        void (async () => {
            if (areSecretsVaulted()) await pushSecretsToVault();
            await syncAiConfig();
        })();
    });
    hydration = (async () => {
        await hydrateSecrets();
        if (areSecretsVaulted()) await pushSecretsToVault();
        await syncAiConfig();
    })();
    return unsubscribe;
}

/** Resolves once the keychain probe and first sync have run (tests, dialogs). */
export function aiConfigReady(): Promise<void> {
    return hydration ?? Promise.resolve();
}
