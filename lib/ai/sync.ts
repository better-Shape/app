"use client";

/**
 * Push the user's BYOK configuration into the Rust side, and keep the secrets in
 * the OS keychain.
 *
 * Boot order:
 *   1. probe the keychain (failed edits remain session-only),
 *   2. read stored keys and their native revisions,
 *   3. migrate local drafts without overwriting newer credential intent,
 *   4. push secrets + provider config to Rust.
 *
 * Rust resolves models, provider keys, web-search and Composio credentials from
 * this payload, so it is re-pushed on launch and whenever settings change.
 */

import { getUnsavedCredentialCount, getCredentialDraftRevision, acknowledgeCredentialDraft, credentialDraftVersion, retainFailedCredentialDraft, stageCredentialDrafts } from "@/lib/ai/credential-drafts";
import { commands } from "@/lib/backend";
import { notify } from "@/features/notifications";
import {
    applyVaultSecrets,
    acceptCredentialRecovery,
    getSettings,
    getCredentialRecoveryConflicts,
    providerSecretsForVault,
    registerLegacyVaultConflicts,
    registerCredentialRecoveryConflicts,
    setSecretsVaulted,
    subscribeSettings,
} from "@/lib/settings";
import {
    COMPOSIO_SECRET_ID,
    PROVIDER_PRESETS,
    credentialScopes,
    SEARCH_SECRET_ID,
    headerSecretId,
    toRustAiConfig,
    type RustAiConfig,
} from "@/lib/ai/providers";
import { deletedSecretIds, hasLocalSecretIntent, hasPendingSecretWrite, knownSecretIds, readSecretsDetailed, recordSecretChanges, refreshVaultAvailability, vaultAvailable, writeSecretDetailed, writtenSecretIds } from "@/lib/ai/vault";

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
let retrySync: (() => Promise<void>) | undefined;

export async function retryCredentialPersistence(): Promise<void> {
    refreshVaultAvailability();
    await retrySync?.();
}

export async function reviewSavedCredentials(confirm: (destinations: string[]) => Promise<boolean>): Promise<boolean> {
    await aiConfigReady();
    const baseline = getSettings();
    const revision = getCredentialDraftRevision();
    const ids = getCredentialRecoveryConflicts();
    if (ids.length === 0) return false;
    const scopes = credentialScopes(baseline.ai.providers);
    refreshVaultAvailability();
    const saved = await readSecretsDetailed(ids);
    if (!saved.persisted || ids.some((id) => !saved.values[id] || !scopes[id])) {
        notify.error("Saved credentials are not available", "Unlock the OS keychain or re-enter the affected keys. No saved copies have been changed.");
        return false;
    }
    const destinations = ids.map((id) => {
        const parts: unknown = JSON.parse(scopes[id]);
        if (!Array.isArray(parts) || !parts.every((part) => typeof part === "string")) throw new Error("Invalid credential destination");
        if (parts[0] === "provider-v1") return `${id}: ${parts[2]} [${parts[1]}, ${parts[3]}]`;
        return `${id}: ${parts[1]}`;
    });
    if (!(await confirm(destinations))) return false;
    if (baseline !== getSettings() || revision !== getCredentialDraftRevision()) {
        notify.error("Settings changed during credential review", "Review the current destinations before trying again.");
        return false;
    }
    if (!recordSecretChanges(saved.values)) {
        notify.error("Could not record credential recovery", "Make space in local storage, then retry. No saved keys have been changed.");
        return false;
    }
    acceptCredentialRecovery(saved.values);
    await retryCredentialPersistence();
    return getCredentialRecoveryConflicts().length === 0 && getUnsavedCredentialCount() === 0;
}

export async function syncAiConfig(): Promise<void> {
    const payload: RustAiConfig = toRustAiConfig(getSettings().ai.providers);
    const serialized = JSON.stringify(payload);
    if (serialized === lastSynced) return;
    try {
        await commands.setAiConfig(payload);
        lastSynced = serialized;
    } catch {
        notify.error("Could not apply provider settings", "Saved credentials may have changed. Reload settings before retrying.");
    }
}

/**
 * Copy the secrets currently in settings into the keychain.
 *
 * Failed drafts stay in memory; existing legacy plaintext remains until
 * migration succeeds.
 */
type Reconcile = (values: Record<string, string>, expected?: Record<string, string>) => void;

async function pushSecretsToVault(reconcile: Reconcile, prune = true, secrets = providerSecretsForVault()): Promise<boolean | undefined> {
    const scopes = credentialScopes(getSettings().ai.providers);
    let stored = true;
    let conflicted = false;
    // Absence from one window's settings is not deletion authority: a different
    // window may just have added that connection/header. Only explicit removal
    // intents are pruned, including durable retries from a previous launch.
    const ids = new Set([...Object.keys(secrets), ...(prune ? writtenSecretIds() : [])]);
    for (const id of ids) {
        const value = deletedSecretIds().includes(id) ? "" : secrets[id] ?? "";
        const draftVersion = credentialDraftVersion(id, value, value ? scopes[id] : undefined);
        const result = await writeSecretDetailed(id, value, scopes[id]);
        if (result.kind === "stored") acknowledgeCredentialDraft(id, draftVersion);
        if (result.kind === "failed") {
            retainFailedCredentialDraft(id, value);
            stored = false;
        }
        if (result.kind === "conflict") {
            conflicted = true;
            // Never graft a newer secret onto this window's older endpoint.
            // Clear confirmed deletions, but preserve other conflicting drafts
            // until the user reloads settings or explicitly edits them again.
            if (!result.value && deletedSecretIds().includes(id)) {
                reconcile({ [id]: "" }, secrets);
                if (!providerSecretsForVault()[id]) {
                    acknowledgeCredentialDraft(id, draftVersion);
                    if (!result.persisted) retainFailedCredentialDraft(id, "");
                }
            }
            notify.error("Credentials changed in another window", "Reload settings before retrying, or explicitly edit the credential again. Your conflicting draft has not overwritten the saved value.");
        }
    }
    return conflicted ? undefined : stored;
}

async function hydrateSecrets(touched: Set<string>, reconcile: Reconcile): Promise<void> {
    reconcile(Object.fromEntries(deletedSecretIds().filter((id) => !touched.has(id)).map((id) => [id, ""])));
    stageCredentialDrafts(Object.fromEntries(writtenSecretIds().map((id) => [id, ""])));
    if (!(await vaultAvailable())) { stageCredentialDrafts(providerSecretsForVault(), credentialScopes(getSettings().ai.providers)); setSecretsVaulted(false); return; }
    const ids = [...new Set([...configuredSecretIds(), ...knownSecretIds(), ...getCredentialRecoveryConflicts()])];
    // Acquire native leases BEFORE migration, including tombstones. Otherwise
    // a startup migration could replay old plaintext over a newer deletion.
    const pending = new Set(ids.filter(hasPendingSecretWrite));
    const inventoried = new Set(knownSecretIds());
    const { values: loaded, scopes: savedScopes, unavailable, cleared, persisted } = await readSecretsDetailed(ids);
    const expectedScopes = credentialScopes(getSettings().ai.providers);
    const liveSecrets = providerSecretsForVault();
    registerCredentialRecoveryConflicts(Object.keys(loaded).filter((id) => expectedScopes[id] !== undefined && !touched.has(id)
        && savedScopes[id] !== expectedScopes[id]
        && !(savedScopes[id] === undefined && loaded[id] === liveSecrets[id])));
    registerLegacyVaultConflicts(loaded);
    registerCredentialRecoveryConflicts([...pending].filter((id) => expectedScopes[id] !== undefined && !touched.has(id) && !hasLocalSecretIntent(id)));
    if (getCredentialRecoveryConflicts().length) {
        stageCredentialDrafts(providerSecretsForVault(), credentialScopes(getSettings().ai.providers));
        return;
    }
    if (!persisted) notify.error("Some credentials are not available in the keychain", "Unlock the system keychain and retry. Failed reads do not clear local drafts.");
    const authoritative: Record<string, string> = {};
    for (const id of inventoried) {
        if (!pending.has(id) && !touched.has(id) && !unavailable.has(id) && (loaded[id] !== undefined || cleared.has(id))) authoritative[id] = loaded[id] ?? "";
    }
    for (const id of deletedSecretIds()) if (!touched.has(id)) authoritative[id] = "";
    const migration = Object.fromEntries(Object.entries(providerSecretsForVault()).filter(([id]) => !(id in authoritative)));
    stageCredentialDrafts(migration, expectedScopes);
    if (!recordSecretChanges(migration)) { setSecretsVaulted(false); return; }
    const migrated = await pushSecretsToVault(reconcile, false, migration);
    if (migrated === undefined) return;
    // Only successful migration may remove an existing legacy plaintext copy.
    setSecretsVaulted(migrated && persisted);
    reconcile(authoritative);
    for (const id of touched) delete loaded[id];
    for (const id of deletedSecretIds()) delete loaded[id];
    const live = providerSecretsForVault();
    reconcile(Object.fromEntries(Object.entries(loaded).filter(([id]) => !live[id])));
}

/**
 * Sync now and on every settings change. Returns an unsubscribe function.
 *
 * Persisted keys reconnect on launch. Failed edits remain session-only drafts.
 */
export function initAiConfigSync(): () => void {
    let booting = true;
    let observed = providerSecretsForVault();
    let observedScopes = credentialScopes(getSettings().ai.providers);
    let observedConfigured = new Set(configuredSecretIds());
    const touched = new Set<string>();
    let reconciling = false;
    const reconcile: Reconcile = (values, expected) => {
        const live = providerSecretsForVault();
        const applicable = Object.fromEntries(Object.entries(values).filter(([id]) => !expected || live[id] === expected[id]));
        reconciling = true;
        try { applyVaultSecrets(applicable, true); }
        finally { observed = providerSecretsForVault(); reconciling = false; }
    };
    const sync = async () => {
        if (getCredentialRecoveryConflicts().length) {
            notify.error("Credential recovery needs review", "Reload after the other window finishes saving, or re-enter the affected credentials in Settings > Providers. Existing saved copies have not been removed.");
            return;
        }
        if (await vaultAvailable()) {
            const stored = await pushSecretsToVault(reconcile);
            if (stored === undefined) return;
            setSecretsVaulted(stored);
            if (!stored) notify.error("Could not update saved credentials", "Credential changes are unsaved and remain only in this window. Unlock the system keychain, then retry in Settings > Providers before closing.");
        } else {
            stageCredentialDrafts(providerSecretsForVault(), credentialScopes(getSettings().ai.providers));
            setSecretsVaulted(false);
        }
        await syncAiConfig();
    };
    const enqueue = () => {
        pendingSync = pendingSync.then(sync).catch(() => {
            notify.error("Could not synchronize provider settings");
        });
        return pendingSync;
    };
    retrySync = enqueue;
    const unsubscribe = subscribeSettings(() => {
        const next = providerSecretsForVault();
        if (reconciling) { observed = next; return; }
        const scopes = credentialScopes(getSettings().ai.providers);
        const configured = new Set(configuredSecretIds());
        const removedDescriptors = [...observedConfigured].filter((id) => !configured.has(id));
        const changes = Object.fromEntries([...new Set([...Object.keys(observed), ...Object.keys(next), ...removedDescriptors])]
            .filter((id) => observed[id] !== next[id] || removedDescriptors.includes(id) || Boolean(next[id]) && scopes[id] !== observedScopes[id]).map((id) => [id, next[id] ?? ""]));
        observedConfigured = configured;
        observedScopes = scopes;
        stageCredentialDrafts(changes, scopes);
        if (!recordSecretChanges(changes)) notify.error("Could not save credential change", "Local storage is unavailable or full. Make space or enable storage, then retry before closing the app.");
        if (booting) {
            for (const id of new Set([...Object.keys(observed), ...Object.keys(next)])) {
                if (observed[id] !== next[id]) touched.add(id);
            }
        }
        observed = next;
        if (booting) return; // The first reconciliation includes edits made during hydration.
        // The queue owns rejection handling; settings notifications are synchronous.
        void enqueue();
    });
    // Hydration and subsequent edits share one queue: a slow write can never
    // overtake a newer deletion and put the old credential back into the vault.
    pendingSync = pendingSync.then(async () => {
        try { await hydrateSecrets(touched, reconcile); }
        finally { booting = false; }
        await sync();
    }).catch(() => {
        booting = false;
        notify.error("Could not load provider credentials");
    });
    return () => {
        unsubscribe();
        if (retrySync === enqueue) retrySync = undefined;
    };
}

/** Resolves once boot and all settings changes queued so far have synchronized. */
export function aiConfigReady(): Promise<void> {
    return pendingSync;
}
