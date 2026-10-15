"use client";

const drafts = new Map<string, { value: string; version: number; scope?: string }>();
const listeners = new Set<() => void>();
let revision = 0;

export function stageCredentialDrafts(changes: Record<string, string>, scopes: Record<string, string> = {}): void {
    let changed = false;
    for (const [id, raw] of Object.entries(changes)) {
        const value = raw.trim();
        const scope = value ? scopes[id] : undefined;
        if (drafts.get(id)?.value === value && drafts.get(id)?.scope === scope) continue;
        drafts.set(id, { value, version: ++revision, scope });
        changed = true;
    }
    if (changed) listeners.forEach((listener) => listener());
}

export function credentialDraftVersion(id: string, value: string, scope?: string): number | undefined {
    const draft = drafts.get(id);
    return draft?.value === value.trim() && draft.scope === scope ? draft.version : undefined;
}

export function retainFailedCredentialDraft(id: string, value: string): void {
    if (!drafts.has(id)) stageCredentialDrafts({ [id]: value });
}

export function acknowledgeCredentialDraft(id: string, version: number | undefined): void {
    if (version === undefined || drafts.get(id)?.version !== version) return;
    drafts.delete(id);
    revision++;
    listeners.forEach((listener) => listener());
}

export function getUnsavedCredentialCount(): number { return drafts.size; }
export function getCredentialDraftRevision(): number { return revision; }
export function subscribeCredentialDrafts(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
