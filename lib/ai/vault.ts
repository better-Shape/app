"use client";

/** Native, revision-checked OS-keychain storage shared by all WebViews. */
import { commands } from "@/lib/backend";

const written = new Map<string, string>();
const conflicts = new Map<string, { submitted: string; value: string; persisted: boolean }>();
const revisions = new Map<string, string>();
const scopes = new Map<string, string | undefined>();
const localIntents = new Map<string, { token: string; value: string; recorded: boolean; previousToken: string | null }>();
const INVENTORY_PREFIX = "bettershape-ai-vault-entry:";
type InventoryState = "stored" | "write" | "delete" | "deleted";
type Intent = { state: InventoryState; token: string };
let supported: boolean | null = null;

function inventoryKey(id: string): string { return `${INVENTORY_PREFIX}${encodeURIComponent(id)}`; }
function inventoryIntent(id: string): Intent | null {
    try {
        const raw = window.localStorage.getItem(inventoryKey(id));
        if (raw === "stored" || raw === "delete") return { state: raw, token: raw };
        if (!raw) return null;
        const value: unknown = JSON.parse(raw);
        if (!value || typeof value !== "object" || !("state" in value) || !("token" in value)) return null;
        if (!["stored", "write", "delete", "deleted"].includes(String(value.state)) || typeof value.token !== "string") return null;
        return value as Intent;
    } catch { return null; }
}
function recordInventory(id: string, intent: Intent): boolean {
    try { window.localStorage.setItem(inventoryKey(id), JSON.stringify(intent)); return true; }
    catch { return false; }
}
function inventoryEntries(): Array<[string, Intent]> {
    const entries: Array<[string, Intent]> = [];
    try {
        for (let index = 0; index < window.localStorage.length; index += 1) {
            const key = window.localStorage.key(index);
            if (!key?.startsWith(INVENTORY_PREFIX)) continue;
            try {
                const id = decodeURIComponent(key.slice(INVENTORY_PREFIX.length));
                const intent = inventoryIntent(id);
                if (id && intent) entries.push([id, intent]);
            } catch { /* Malformed metadata grants no authority. */ }
        }
    } catch { /* The caller reports failed write-ahead metadata separately. */ }
    return entries;
}
function isDeleted(id: string): boolean {
    const state = inventoryIntent(id)?.state;
    return state === "delete" || state === "deleted";
}
export function knownSecretIds(): string[] { return inventoryEntries().map(([id]) => id); }
export function deletedSecretIds(): string[] { return inventoryEntries().filter(([id]) => isDeleted(id)).map(([id]) => id); }
export function hasLocalSecretIntent(id: string): boolean { return localIntents.has(id); }
export function hasPendingSecretWrite(id: string): boolean { return inventoryIntent(id)?.state === "write"; }

/** Reserve user intent synchronously, before availability checks or queued IPC. */
export function recordSecretChanges(changes: Record<string, string>): boolean {
    let recorded = true;
    for (const [id, value] of Object.entries(changes)) {
        conflicts.delete(id);
        const token = Array.from(crypto.getRandomValues(new Uint32Array(4))).join("-");
        const previousToken = inventoryIntent(id)?.token ?? null;
        const saved = recordInventory(id, { state: value.trim() ? "write" : "delete", token });
        localIntents.set(id, { token, value: value.trim(), recorded: saved, previousToken });
        if (!saved) recorded = false;
    }
    return recorded;
}
export function recordSecretDeletions(ids: string[]): boolean {
    return recordSecretChanges(Object.fromEntries(ids.map((id) => [id, ""])));
}
export function refreshVaultAvailability(): void { supported = null; }
export async function vaultAvailable(): Promise<boolean> {
    if (supported !== null) return supported;
    try { supported = await commands.aiVaultSupported(); }
    catch { supported = false; }
    return supported;
}
export function __setVaultAvailableForTesting(value: boolean | null): void { supported = value; }
export function __resetVaultCacheForTesting(): void {
    written.clear(); conflicts.clear(); revisions.clear(); scopes.clear(); localIntents.clear(); supported = null;
}

interface SecretReadResult {
    scopes: Record<string, string | undefined>;
    values: Record<string, string>;
    unavailable: Set<string>;
    cleared: Set<string>;
    persisted: boolean;
}

/** Reads acquire leases for empty entries, but never for inaccessible entries. */
export async function readSecretsDetailed(ids: string[]): Promise<SecretReadResult> {
    const result: SecretReadResult = { values: {}, scopes: {}, unavailable: new Set(ids), cleared: new Set(), persisted: true };
    if (ids.length === 0) return result;
    if (!(await vaultAvailable())) return { ...result, persisted: false };
    const before = new Map(revisions);
    const rows = await commands.aiLoadKeys(ids);
    for (const row of rows) {
        if (row.status === "unavailable") continue;
        result.unavailable.delete(row.id);
        result.persisted &&= row.persisted;
        // An older read must not roll back a lease advanced by our own write.
        if (revisions.get(row.id) !== before.get(row.id)) continue;
        revisions.set(row.id, row.revision);
        scopes.set(row.id, row.scope);
        result.scopes[row.id] = row.scope;
        const key = row.apiKey.trim();
        if (!key && row.revision !== "initial") result.cleared.add(row.id);
        written.set(row.id, key);
        if (key && !isDeleted(row.id)) result.values[row.id] = key;
    }
    result.persisted &&= result.unavailable.size === 0;
    return result;
}

export async function readSecrets(ids: string[]): Promise<Record<string, string>> {
    return (await readSecretsDetailed(ids)).values;
}

export type SecretWriteResult = { kind: "stored" | "failed" } | { kind: "conflict"; value: string; persisted: boolean };

export async function writeSecretDetailed(id: string, value: string, scope?: string): Promise<SecretWriteResult> {
    const secret = value.trim();
    if (secret && !scope) return { kind: "failed" };
    const blocked = conflicts.get(id);
    if (blocked?.submitted === secret && !isDeleted(id)) return { kind: "conflict", value: blocked.value, persisted: blocked.persisted };
    const conflict = (current: string, persisted: boolean): SecretWriteResult => {
        conflicts.set(id, { submitted: secret, value: current, persisted });
        return { kind: "conflict", value: current, persisted };
    };
    if (!secret && !revisions.has(id) && isDeleted(id)) {
        const deletion = inventoryIntent(id);
        const read = await readSecretsDetailed([id]);
        if (read.unavailable.has(id)) return { kind: "failed" };
        if (inventoryIntent(id)?.token !== deletion?.token || !isDeleted(id)) {
            return conflict(read.values[id] ?? "", read.persisted);
        }
    }
    // After acquiring a missing deletion lease, retain it through queued IPC.
    const expectedRevision = revisions.get(id) ?? "initial";
    let intent = inventoryIntent(id);
    const own = localIntents.get(id);
    if (own && !own.recorded && (intent?.token ?? null) === own.previousToken) {
        if (!recordInventory(id, { state: own.value ? "write" : "delete", token: own.token })) return { kind: "failed" };
        own.recorded = true;
        intent = inventoryIntent(id);
    }
    if (secret && isDeleted(id)) return conflict("", inventoryIntent(id)?.state === "deleted");
    if (own && own.token !== intent?.token) {
        const { values: current, persisted, unavailable } = await readSecretsDetailed([id]);
        if (unavailable.has(id)) return { kind: "failed" };
        if (localIntents.get(id) === own) localIntents.delete(id);
        if (!secret && inventoryIntent(id)?.state === "delete") return writeSecretDetailed(id, "");
        if ((current[id] ?? "") === secret && (!secret || scopes.get(id) === scope)) return { kind: persisted ? "stored" : "failed" };
        return conflict(current[id] ?? "", persisted);
    }
    const matchingIntent = secret ? intent?.state === "write" : intent?.state === "delete" || intent?.state === "deleted";
    if (!intent || (written.get(id) !== secret && (!own || own.value !== secret) && !matchingIntent)) {
        if (!recordSecretChanges({ [id]: secret })) return { kind: "failed" };
        intent = inventoryIntent(id);
    }
    const ownsIntent = localIntents.get(id)?.token === intent?.token;
    if (secret && scopes.get(id) !== undefined && scopes.get(id) !== scope && !ownsIntent) {
        return conflict(written.get(id) ?? "", true);
    }
    if (!intent || !(await vaultAvailable())) return { kind: "failed" };
    try {
        const result = secret
            ? await commands.aiStoreKey(id, secret, expectedRevision, scope)
            : await commands.aiDeleteKey(id, expectedRevision);
        const current = result.current;
        if ((revisions.get(id) ?? "initial") === expectedRevision) {
            revisions.set(id, current.revision);
            written.set(id, current.apiKey);
            scopes.set(id, current.scope);
        }
        // A later user intent (in either window) owns its retry marker. A late
        // callback may neither erase a deletion nor claim a newer draft saved.
        const latest = inventoryIntent(id);
        const stillOwnsIntent = latest?.token === intent?.token;
        if (stillOwnsIntent && (ownsIntent || !secret)) {
            const state = !result.applied ? (secret ? "write" : "delete")
                : current.persisted ? (current.apiKey ? "stored" : "deleted") : (current.apiKey ? "write" : "delete");
            if (!recordInventory(id, { state, token: intent.token })) return { kind: "failed" };
            if (result.applied && current.persisted) localIntents.delete(id);
        }
        if (!stillOwnsIntent && isDeleted(id)) return conflict("", inventoryIntent(id)?.state === "deleted");
        if (!result.applied) return conflict(current.apiKey, current.persisted);
        return { kind: current.persisted ? "stored" : "failed" };
    } catch {
        // Rejections leave the draft unsaved; only a successful retry persists it.
        return { kind: "failed" };
    }
}
export async function writeSecret(id: string, value: string, scope?: string): Promise<boolean> {
    if (!value.trim() && !recordSecretDeletions([id])) return false;
    if (value.trim() && isDeleted(id) && written.get(id) !== value.trim() && !recordSecretChanges({ [id]: value })) return false;
    return (await writeSecretDetailed(id, value, scope)).kind === "stored";
}
export async function forgetSecret(id: string): Promise<boolean> { return writeSecret(id, ""); }
export function writtenSecretIds(): string[] {
    return [...new Set([
        ...inventoryEntries().filter(([, intent]) => intent.state === "delete").map(([id]) => id),
    ])];
}
