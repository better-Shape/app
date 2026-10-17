// Review finding: lib/settings/store.ts `registerLegacyVaultConflicts`.
//
// The exemption set is declared with the invariant "Legacy-copy replacement consent is not
// authority to bypass a new vault conflict" (store.ts:409). Two readers honour that: line
// 852 (`canReplaceStoredSettings`) and line 918 (`applyDesktopHydration`) use it to decide
// whether a plaintext copy may be overwritten, which is what it means. The third reader, the
// filter inside `registerLegacyVaultConflicts`, used it to decide whether a NATIVE vault value
// that disagrees with the live credential needs review. That is the one the comment forbids.
//
// The exemption is id-scoped and never cleared, so once a window has edited a credential the
// guard can never fire for that id again and a later, different vault value replaces the live
// one silently. The exemption also cannot simply be deleted from that filter: the retry path
// needs it. `hydrateSecrets` only re-runs while it returned `persisted === false`, which means
// some read came back `unavailable`, and then `readSecretsDetailed().values` is empty and this
// function registers nothing either way. The narrow case that does need an exemption is an
// edit made after hydration completed, recognised by `touched` - the same discriminator the two
// sibling `registerCredentialRecoveryConflicts` calls at sync.ts:184 and :188 already use.
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-store", () => ({ load: async () => { throw new Error("browser only"); } }));
vi.mock("@/lib/settings/desktop-store", () => ({ loadDesktopStore: async () => { throw new Error("browser only"); } }));

const PRIMARY = "bettershape-settings-v1";
beforeEach(() => { vi.resetModules(); localStorage.clear(); });
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

type SettingsModule = typeof import("@/lib/settings");

/**
 * Open a window that still holds an unmigrated plaintext credential. That record is the only
 * thing that arms `legacyCredentialsPresent`, which is this function's entry condition.
 */
async function openWithLegacyCopy(openaiKey: string): Promise<SettingsModule> {
    const settings = await import("@/lib/settings");
    const legacy = structuredClone(settings.DEFAULT_SETTINGS);
    legacy.ai.providers.connections.openai.apiKey = openaiKey;
    localStorage.setItem(PRIMARY, JSON.stringify(legacy));
    await settings.initSettings();
    return settings;
}

/** An explicit user edit of the credential, which is what records the exemption. */
function editOpenai(settings: SettingsModule, apiKey: string): void {
    const providers = settings.getSettings().ai.providers;
    settings.updateSettingSection("ai", { providers: { ...providers, connections: { ...providers.connections,
        openai: { ...providers.connections.openai, apiKey },
    } } });
}

it("registers a conflict when the vault disagrees with the live credential", async () => {
    const settings = await openWithLegacyCopy("example-legacy");
    expect(settings.getSettings().ai.providers.connections.openai.apiKey).toBe("example-legacy");
    settings.registerLegacyVaultConflicts({ openai: "example-other-window" });
    expect(settings.getCredentialRecoveryConflicts()).toContain("openai");
});

it("does not skip review for a later different value after this window already replaced the legacy copy", async () => {
    const settings = await openWithLegacyCopy("example-legacy");
    // The user edits the credential, so the id carries replacement consent from here on.
    editOpenai(settings, "example-typed");
    // A later vault value that is not the one they typed still has to be reviewed, or
    // hydration adopts it over their live value without ever asking.
    settings.registerLegacyVaultConflicts({ openai: "example-other-window" });
    expect(settings.getCredentialRecoveryConflicts()).toContain("openai");
});

it("exempts an edit this window still owns so a retry after a locked keychain can save it", async () => {
    const settings = await openWithLegacyCopy("example-legacy");
    editOpenai(settings, "example-typed");
    // `touched` is the anti-regression half: the key was re-entered while the keychain was
    // unavailable, hydration re-runs on retry, and the stale vault value must not block it.
    settings.registerLegacyVaultConflicts({ openai: "example-other-window" }, new Set(["openai"]));
    expect(settings.getCredentialRecoveryConflicts()).toEqual([]);
});

it("still ignores a value whose destination this window does not configure", async () => {
    const settings = await openWithLegacyCopy("example-legacy");
    settings.registerLegacyVaultConflicts({ "header:openai:Removed": "example-other-window" });
    expect(settings.getCredentialRecoveryConflicts()).toEqual([]);
});