"use client";

import { getCredentialDraftRevision, getUnsavedCredentialCount } from "./credential-drafts";

export async function confirmCredentialClose(confirm: () => Promise<boolean>): Promise<boolean> {
    if (getUnsavedCredentialCount() === 0) return true;
    const revision = getCredentialDraftRevision();
    return await confirm() && revision === getCredentialDraftRevision();
}

export function preventUnsavedCredentialUnload(event: BeforeUnloadEvent): void {
    if (getUnsavedCredentialCount() === 0) return;
    event.preventDefault();
    event.returnValue = "";
}
