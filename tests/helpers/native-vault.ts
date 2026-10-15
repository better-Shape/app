import { createHash } from "node:crypto";
import type { AiVaultMutation, AiVaultReadResult, AiVaultSnapshot } from "@/lib/backend/types";
export type VaultSnapshot = Extract<AiVaultReadResult, { status: "available" }>;
export type VaultMutation = AiVaultMutation;
export function createNativeVault() {
    const values = new Map<string, string>();
    const snapshots = new Map<string, AiVaultSnapshot>();
    const saved = new Map<string, AiVaultSnapshot>();
    let revision = 0;
    const read = (id: string): VaultSnapshot => {
        const apiKey = values.get(id);
        const current = snapshots.get(id) ?? saved.get(id) ?? {
            id, apiKey: apiKey ?? "", persisted: true,
            revision: apiKey === undefined ? "initial" : `legacy:${createHash("sha256").update(apiKey).digest("hex")}`,
        };
        snapshots.set(id, current);
        return { status: "available", ...current };
    };
    const mutate = (id: string, value: string, expected: string, persisted = true, scope?: string): VaultMutation => {
        const current = read(id);
        if (current.revision !== expected) return { applied: false, current };
        if (value && value === current.apiKey && current.persisted && current.scope === scope && current.revision !== "initial") return { applied: true, current };
        const next = { id, apiKey: value, revision: !value || value !== current.apiKey || current.revision === "initial" || current.scope !== scope ? `revision-${++revision}` : current.revision, persisted, scope };
        snapshots.set(id, next);
        if (persisted) { saved.set(id, { ...next }); if (value) values.set(id, value); else values.delete(id); }
        return { applied: true, current: { ...next } };
    };
    return { values, read, mutate, restart: () => snapshots.clear(), reset: () => { values.clear(); snapshots.clear(); saved.clear(); revision = 0; } };
}
