import { beforeEach, expect, it, vi } from "vitest";
let drafts: typeof import("@/lib/ai/credential-drafts");
let close: typeof import("@/lib/ai/credential-close");
beforeEach(async () => {
    vi.resetModules();
    drafts = await import("@/lib/ai/credential-drafts");
    close = await import("@/lib/ai/credential-close");
});
it("does not acknowledge a newer re-entry with an older write's receipt", () => {
    drafts.stageCredentialDrafts({ openai: "example-key" });
    const old = drafts.credentialDraftVersion("openai", "example-key");
    drafts.stageCredentialDrafts({ openai: "" });
    drafts.stageCredentialDrafts({ openai: "example-key" });
    drafts.acknowledgeCredentialDraft("openai", old);
    expect(drafts.getUnsavedCredentialCount()).toBe(1);
    drafts.acknowledgeCredentialDraft("openai", drafts.credentialDraftVersion("openai", "example-key"));
    expect(drafts.getUnsavedCredentialCount()).toBe(0);
});
it("keeps failed deletions unsaved until acknowledged", () => {
    drafts.stageCredentialDrafts({ openai: "" });
    expect(drafts.getUnsavedCredentialCount()).toBe(1);
    drafts.acknowledgeCredentialDraft("openai", drafts.credentialDraftVersion("openai", ""));
    expect(drafts.getUnsavedCredentialCount()).toBe(0);
});
it("does not replace a newer draft with an older failed request", () => {
    drafts.stageCredentialDrafts({ openai: "example-new" });
    drafts.retainFailedCredentialDraft("openai", "example-old");
    expect(drafts.credentialDraftVersion("openai", "example-new")).toBeDefined();
});
it("closes saved windows without prompting and respects cancellation for unsaved ones", async () => {
    const confirm = vi.fn(async () => false);
    expect(await close.confirmCredentialClose(confirm)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    drafts.stageCredentialDrafts({ openai: "example-key" });
    expect(await close.confirmCredentialClose(confirm)).toBe(false);
    expect(await close.confirmCredentialClose(async () => true)).toBe(true);
});
it("rejects a close approval if drafts changed while the dialog was open", async () => {
    drafts.stageCredentialDrafts({ openai: "example-old" });
    expect(await close.confirmCredentialClose(async () => {
        drafts.stageCredentialDrafts({ openai: "example-new" });
        return true;
    })).toBe(false);
});
it("guards browser reload only while credentials are unsaved", () => {
    const clean = new Event("beforeunload", { cancelable: true });
    close.preventUnsavedCredentialUnload(clean as BeforeUnloadEvent);
    expect(clean.defaultPrevented).toBe(false);
    drafts.stageCredentialDrafts({ openai: "example-key" });
    const dirty = new Event("beforeunload", { cancelable: true });
    close.preventUnsavedCredentialUnload(dirty as BeforeUnloadEvent);
    expect(dirty.defaultPrevented).toBe(true);
});
