import { afterEach, expect, it, vi } from "vitest";
import { credentialScopes, defaultProvidersSettings } from "@/lib/ai/providers";
import { createNativeVault } from "../helpers/native-vault";
const native = createNativeVault();
const bridge = vi.hoisted(() => ({ readStore: vi.fn(), load: vi.fn(), store: vi.fn(), remove: vi.fn(), configure: vi.fn(), error: vi.fn(), supported: true, disk: null as unknown }));
vi.mock("@/lib/backend", () => ({ commands: {
    aiVaultSupported: async () => bridge.supported, setIndexEmbeddings: async () => undefined, setChatMemoryEnabled: async () => undefined,
    aiLoadKeys: bridge.load, aiStoreKey: bridge.store, aiDeleteKey: bridge.remove, setAiConfig: bridge.configure,
} }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => undefined, emit: async () => undefined }));
vi.mock("@/features/notifications", () => ({ notify: { error: bridge.error } }));
vi.mock("@tauri-apps/plugin-store", () => ({ load: async () => ({
    get: bridge.readStore,
    set: async (_key: string, value: unknown) => { bridge.disk = structuredClone(value); },
    save: async () => undefined,
}) }));
let stop: (() => void) | undefined;
afterEach(() => { stop?.(); stop = undefined; localStorage.clear(); });

function reset() {
    vi.resetModules(); localStorage.clear(); native.reset(); bridge.disk = null; bridge.supported = true;
    bridge.readStore.mockReset().mockImplementation(async () => bridge.disk);
    bridge.load.mockReset().mockImplementation(async (ids: string[]) => ids.map(native.read));
    bridge.store.mockReset().mockImplementation(async (id: string, value: string, expected: string, scope?: string) => native.mutate(id, value, expected, true, scope));
    bridge.remove.mockReset().mockImplementation(async (id: string, expected: string) => native.mutate(id, "", expected));
    bridge.configure.mockReset().mockResolvedValue(undefined);
}
async function openWindow(readiness: "ready" | "blocked" = "ready") {
    vi.resetModules();
    const settings = await import("@/lib/settings"); await settings.initSettings();
    const drafts = await import("@/lib/ai/credential-drafts");
    const sync = await import("@/lib/ai/sync");
    const unsubscribe = sync.initAiConfigSync();
    if (readiness === "blocked") await expect(sync.aiConfigReady()).rejects.toThrow("Provider settings are not applied");
    else await sync.aiConfigReady();
    return { settings, drafts, sync, unsubscribe, edit: (apiKey: string) => {
        const providers = settings.getSettings().ai.providers;
        settings.updateSettingSection("ai", { providers: { ...providers, connections: { ...providers.connections, openai: { ...providers.connections.openai, apiKey } } } });
    } };
}
it("keeps failed edits in memory, redacts unrelated keys, and saves only after retry", async () => {
    reset(); native.mutate("service:search", "example-unrelated", "initial", true, credentialScopes(defaultProvidersSettings())["service:search"]);
    const a = await openWindow(); stop = a.unsubscribe;
    a.edit("example-old"); await a.sync.aiConfigReady();
    bridge.store.mockImplementationOnce(async (id: string, value: string, expected: string, scope?: string) => native.mutate(id, value, expected, false, scope));
    a.edit("example-new"); await a.sync.aiConfigReady();
    expect(a.settings.getSettings().ai.providers.connections.openai.apiKey).toBe("example-new");
    expect(a.drafts.getUnsavedCredentialCount()).toBe(1);
    expect(native.values.get("openai")).toBe("example-old");
    await vi.waitFor(() => expect(JSON.stringify(bridge.disk)).not.toContain("example-"));
    expect(localStorage.getItem("bettershape-settings-v1")).not.toContain("example-");
    await a.sync.retryCredentialPersistence();
    expect(native.values.get("openai")).toBe("example-new");
    expect(a.drafts.getUnsavedCredentialCount()).toBe(0);
    expect(a.settings.areSecretsVaulted()).toBe(true);
});
it("never persists newly entered keys when no keychain is available", async () => {
    reset(); bridge.supported = false;
    const a = await openWindow(); stop = a.unsubscribe;
    a.edit("example-session-only"); await a.sync.aiConfigReady();
    expect(a.drafts.getUnsavedCredentialCount()).toBe(1);
    expect(localStorage.getItem("bettershape-settings-v1")).not.toContain("example-session-only");
    await vi.waitFor(() => expect(JSON.stringify(bridge.disk)).not.toContain("example-session-only"));
    expect(bridge.store).not.toHaveBeenCalled();
    bridge.supported = true;
    await a.sync.retryCredentialPersistence();
    expect(native.values.get("openai")).toBe("example-session-only");
    expect(a.drafts.getUnsavedCredentialCount()).toBe(0);
});
it("preserves an existing plaintext copy until migration succeeds without persisting a new draft", async () => {
    reset();
    const { DEFAULT_SETTINGS } = await import("@/lib/settings");
    const legacy = structuredClone(DEFAULT_SETTINGS);
    legacy.ai.providers.connections.openai.apiKey = "example-legacy";
    bridge.disk = structuredClone(legacy);
    localStorage.setItem("bettershape-settings-v1", JSON.stringify(legacy));
    bridge.store.mockImplementation(async (id: string, value: string, expected: string, scope?: string) => native.mutate(id, value, expected, false, scope));
    const a = await openWindow(); stop = a.unsubscribe;
    a.edit("example-new"); await a.sync.aiConfigReady();
    expect(localStorage.getItem("bettershape-settings-v1")).toContain("example-legacy");
    expect(JSON.stringify(bridge.disk)).toContain("example-legacy");
    expect(JSON.stringify(bridge.disk)).not.toContain("example-new");
    expect(a.settings.getSettings().ai.providers.connections.openai.apiKey).toBe("example-new");
    bridge.store.mockImplementation(async (id: string, value: string, expected: string, scope?: string) => native.mutate(id, value, expected, true, scope));
    await a.sync.retryCredentialPersistence();
    expect(native.values.get("openai")).toBe("example-new");
    expect(localStorage.getItem("bettershape-settings-v1")).not.toContain("example-");
    await vi.waitFor(() => expect(JSON.stringify(bridge.disk)).not.toContain("example-"));
});
it("does not lose another window's unsaved in-memory draft to an unrelated settings save", async () => {
    reset(); const stops: (() => void)[] = []; stop = () => stops.forEach((fn) => fn());
    const a = await openWindow(); stops.push(a.unsubscribe);
    a.edit("example-old"); await a.sync.aiConfigReady();
    const b = await openWindow(); stops.push(b.unsubscribe);
    bridge.store.mockImplementationOnce(async (id: string, value: string, expected: string, scope?: string) => native.mutate(id, value, expected, false, scope));
    b.edit("example-new"); await b.sync.aiConfigReady();
    a.settings.updateSettingSection("editor", { fontSize: 17 });
    await expect(a.sync.aiConfigReady()).rejects.toThrow("Provider settings are not applied");
    expect(b.settings.getSettings().ai.providers.connections.openai.apiKey).toBe("example-new");
    expect(b.drafts.getUnsavedCredentialCount()).toBe(1);
    expect(JSON.stringify(bridge.disk)).not.toContain("example-");
    await b.sync.retryCredentialPersistence();
    expect(native.values.get("openai")).toBe("example-new");
    expect(b.drafts.getUnsavedCredentialCount()).toBe(0);
});

it("does not erase divergent legacy copies before an explicit credential edit", async () => {
    reset();
    const { DEFAULT_SETTINGS } = await import("@/lib/settings");
    const disk = structuredClone(DEFAULT_SETTINGS);
    disk.ai.providers.connections.openai.apiKey = "example-disk-copy";
    bridge.disk = disk;
    const local = structuredClone(disk);
    local.ai.providers.connections.openai.apiKey = "example-local-copy";
    localStorage.setItem("bettershape-settings-v1", JSON.stringify(local));
    const a = await openWindow("blocked"); stop = a.unsubscribe;
    expect(a.settings.getCredentialRecoveryConflicts()).toEqual(["openai"]);
    expect(bridge.store).not.toHaveBeenCalled();
    expect(localStorage.getItem("bettershape-settings-v1")).toContain("example-local-copy");
    expect(JSON.stringify(bridge.disk)).toContain("example-disk-copy");
    a.edit("example-selected"); await a.sync.aiConfigReady();
    expect(native.values.get("openai")).toBe("example-selected");
    expect(a.settings.getCredentialRecoveryConflicts()).toEqual([]);
    await vi.waitFor(() => expect(JSON.stringify(bridge.disk)).not.toContain("example-"));
});
it("still reads the desktop store after an early renderer settings read", async () => {
    reset();
    const settings = await import("@/lib/settings");
    const legacy = structuredClone(settings.DEFAULT_SETTINGS);
    legacy.ai.providers.connections.openai.apiKey = "example-desktop-copy";
    bridge.disk = legacy;
    settings.getSettings();
    await settings.initSettings();
    expect(settings.getSettings().ai.providers.connections.openai.apiKey).toBe("example-desktop-copy");
    expect(JSON.stringify(bridge.disk)).toContain("example-desktop-copy");
});

it("does not reload redacted storage over a draft entered before the first settings read", async () => {
    reset();
    const settings = await import("@/lib/settings");
    const providers = structuredClone(settings.DEFAULT_SETTINGS.ai.providers);
    providers.services.composio.apiKey = "example-first-edit";
    settings.updateSettingSection("ai", { providers });
    expect(settings.getSettings().ai.providers.services.composio.apiKey).toBe("example-first-edit");
    expect(localStorage.getItem("bettershape-settings-v1")).not.toContain("example-first-edit");
});

it("does not attach a newly saved key to an old endpoint after a partial legacy migration restart", async () => {
    reset();
    const { DEFAULT_SETTINGS } = await import("@/lib/settings");
    const legacy = structuredClone(DEFAULT_SETTINGS);
    legacy.ai.providers.connections.openai.baseUrl = "https://old.example.invalid/v1";
    legacy.ai.providers.connections.anthropic.apiKey = "example-unmigrated";
    bridge.disk = structuredClone(legacy);
    localStorage.setItem("bettershape-settings-v1", JSON.stringify(legacy));
    bridge.store.mockImplementation(async (id: string, value: string, expected: string, scope?: string) => native.mutate(id, value, expected, id !== "anthropic", scope));
    const a = await openWindow(); stop = a.unsubscribe;
    const providers = a.settings.getSettings().ai.providers;
    a.settings.updateSettingSection("ai", { providers: { ...providers, connections: { ...providers.connections,
        openai: { ...providers.connections.openai, apiKey: "example-new", baseUrl: "https://new.example.invalid/v1" },
    } } });
    await a.sync.aiConfigReady();
    expect(native.values.get("openai")).toBe("example-new");
    expect(JSON.stringify(bridge.disk)).toContain("https://old.example.invalid/v1");
    a.unsubscribe();
    native.restart();
    bridge.configure.mockClear();
    const restarted = await openWindow("blocked"); stop = restarted.unsubscribe;
    expect(restarted.settings.getCredentialRecoveryConflicts()).toContain("openai");
    expect(restarted.settings.getSettings().ai.providers.connections.openai.apiKey).not.toBe("example-new");
    expect(bridge.configure).not.toHaveBeenCalled();
    expect(native.values.get("openai")).toBe("example-new");
});

it("does not reuse an older saved key at a new endpoint after an unsaved edit is lost", async () => {
    reset();
    const a = await openWindow(); stop = a.unsubscribe;
    a.edit("example-old"); await a.sync.aiConfigReady();
    bridge.store.mockImplementationOnce(async (id: string, value: string, expected: string, scope?: string) => native.mutate(id, value, expected, false, scope));
    const providers = a.settings.getSettings().ai.providers;
    a.settings.updateSettingSection("ai", { providers: { ...providers, connections: { ...providers.connections,
        openai: { ...providers.connections.openai, apiKey: "example-new", baseUrl: "https://new.example.invalid/v1" },
    } } });
    await a.sync.aiConfigReady();
    expect(a.drafts.getUnsavedCredentialCount()).toBe(1);
    a.unsubscribe();
    native.restart();
    bridge.configure.mockClear();
    const restarted = await openWindow("blocked"); stop = restarted.unsubscribe;
    expect(restarted.settings.getCredentialRecoveryConflicts()).toContain("openai");
    expect(restarted.settings.getSettings().ai.providers.connections.openai.apiKey).toBe("");
    expect(bridge.configure).not.toHaveBeenCalled();
    expect(native.values.get("openai")).toBe("example-old");
    restarted.edit("example-reentered"); await restarted.sync.aiConfigReady();
    expect(restarted.settings.getCredentialRecoveryConflicts()).toEqual([]);
    expect(native.values.get("openai")).toBe("example-reentered");
});

it("shares initialization and preserves an early edit while loading unrelated desktop settings", async () => {
    reset();
    const settings = await import("@/lib/settings");
    const legacy = structuredClone(settings.DEFAULT_SETTINGS);
    legacy.ai.providers.connections.anthropic.apiKey = "example-unmigrated";
    legacy.editor.wordWrap = "on";
    bridge.disk = legacy;
    let complete!: () => void;
    bridge.readStore.mockImplementationOnce(() => new Promise((resolve) => { complete = () => resolve(legacy); }));
    const first = settings.initSettings();
    const second = settings.initSettings();
    expect(second).toBe(first);
    await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
    expect(bridge.readStore).toHaveBeenCalledTimes(1);
    const providers = settings.getSettings().ai.providers;
    settings.updateSettingSection("ai", { providers: { ...providers, connections: { ...providers.connections,
        openai: { ...providers.connections.openai, apiKey: "example-live-edit" },
    } } });
    complete(); await first;
    expect(settings.getSettings().ai.providers.connections.openai.apiKey).toBe("example-live-edit");
    expect(settings.getSettings().ai.providers.connections.anthropic.apiKey).toBe("example-unmigrated");
    expect(settings.getSettings().editor.wordWrap).toBe("on");
    const sync = await import("@/lib/ai/sync"); stop = sync.initAiConfigSync();
    await sync.aiConfigReady();
    expect(native.values.get("openai")).toBe("example-live-edit");
    expect(settings.areSecretsVaulted()).toBe(true);
    await vi.waitFor(() => expect(bridge.readStore.mock.calls.length).toBeGreaterThanOrEqual(3));
    expect(native.values.get("anthropic")).toBe("example-unmigrated");
    expect(JSON.stringify(bridge.disk)).not.toContain("example-");
});

it("retains a pending deletion across an unsupported-vault restart", async () => {
    reset();
    const a = await openWindow(); stop = a.unsubscribe;
    a.edit("example-saved"); await a.sync.aiConfigReady();
    bridge.supported = false;
    const vault = await import("@/lib/ai/vault"); vault.refreshVaultAvailability();
    a.edit(""); await a.sync.aiConfigReady();
    expect(a.drafts.getUnsavedCredentialCount()).toBe(1);
    a.unsubscribe(); native.restart();
    const restarted = await openWindow(); stop = restarted.unsubscribe;
    expect(restarted.settings.getSettings().ai.providers.connections.openai.apiKey).toBe("");
    expect(restarted.drafts.getUnsavedCredentialCount()).toBe(1);
    expect(native.values.get("openai")).toBe("example-saved");
    bridge.supported = true;
    await restarted.sync.retryCredentialPersistence();
    expect(restarted.drafts.getUnsavedCredentialCount()).toBe(0);
    expect(native.values.has("openai")).toBe(false);
    expect(bridge.remove).toHaveBeenCalledTimes(1);
});

it("publishes recovery conflicts even when no in-memory credential draft exists", async () => {
    reset();
    const settings = await import("@/lib/settings");
    const drafts = await import("@/lib/ai/credential-drafts");
    const before = settings.getSettings();
    const listener = vi.fn(); stop = settings.subscribeSettings(listener);
    settings.registerCredentialRecoveryConflicts(["openai"]);
    expect(drafts.getUnsavedCredentialCount()).toBe(0);
    expect(settings.getCredentialRecoveryConflicts()).toEqual(["openai"]);
    expect(settings.getSettings()).not.toBe(before);
    expect(listener).toHaveBeenCalledTimes(1);
    settings.registerCredentialRecoveryConflicts(["openai"]);
    expect(listener).toHaveBeenCalledTimes(1);
});

it("retains a legacy credential absent from the live snapshot even after other keys are saved", async () => {
    reset();
    const settings = await import("@/lib/settings");
    const legacy = structuredClone(settings.DEFAULT_SETTINGS);
    legacy.ai.providers.connections.anthropic.apiKey = "example-retained";
    bridge.disk = legacy;
    await settings.initSettings();
    settings.applyVaultSecrets({ anthropic: "" }, true);
    settings.setSecretsVaulted(true);
    expect(settings.areSecretsVaulted()).toBe(true);
    await vi.waitFor(() => expect(bridge.readStore.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(JSON.stringify(bridge.disk)).toContain("example-retained");
});

it("rejects a saved key whose destination differs even when the intent ledger is missing", async () => {
    reset();
    const a = await openWindow(); stop = a.unsubscribe;
    a.edit("example-original"); await a.sync.aiConfigReady();
    bridge.store.mockImplementationOnce(async (id: string, value: string, expected: string, scope?: string) => native.mutate(id, value, expected, false, scope));
    const providers = a.settings.getSettings().ai.providers;
    a.settings.updateSettingSection("ai", { providers: { ...providers, connections: { ...providers.connections,
        openai: { ...providers.connections.openai, apiKey: "example-lost", baseUrl: "https://different.invalid/v1" },
    } } });
    await a.sync.aiConfigReady(); a.unsubscribe(); native.restart();
    for (const key of Object.keys(localStorage)) if (key.startsWith("bettershape-ai-vault-entry:")) localStorage.removeItem(key);
    bridge.configure.mockClear();
    const restarted = await openWindow("blocked"); stop = restarted.unsubscribe;
    expect(restarted.settings.getCredentialRecoveryConflicts()).toContain("openai");
    expect(restarted.settings.getSettings().ai.providers.connections.openai.apiKey).toBe("");
    expect(bridge.configure).not.toHaveBeenCalled();
    expect(native.values.get("openai")).toBe("example-original");
});

it("rejects stale redacted endpoint metadata after a newer key and destination were saved", async () => {
    reset();
    const a = await openWindow(); stop = a.unsubscribe;
    a.edit("example-original"); await a.sync.aiConfigReady();
    const stale = structuredClone(bridge.disk);
    const providers = a.settings.getSettings().ai.providers;
    a.settings.updateSettingSection("ai", { providers: { ...providers, connections: { ...providers.connections,
        openai: { ...providers.connections.openai, apiKey: "example-new", baseUrl: "https://new.invalid/v1" },
    } } });
    await a.sync.aiConfigReady(); a.unsubscribe(); native.restart();
    bridge.disk = stale;
    bridge.readStore.mockResolvedValue(stale);
    localStorage.setItem("bettershape-settings-v1", JSON.stringify(stale));
    bridge.configure.mockClear();
    const restarted = await openWindow("blocked"); stop = restarted.unsubscribe;
    expect(restarted.settings.getCredentialRecoveryConflicts()).toContain("openai");
    expect(restarted.settings.getSettings().ai.providers.connections.openai.apiKey).toBe("");
    expect(bridge.configure).not.toHaveBeenCalled();
    expect(native.values.get("openai")).toBe("example-new");
});

it("requires re-entry for an old vault key with no proven destination", async () => {
    reset(); native.values.set("openai", "example-unbound");
    const a = await openWindow("blocked"); stop = a.unsubscribe;
    expect(a.settings.getCredentialRecoveryConflicts()).toEqual(["openai"]);
    expect(a.settings.getSettings().ai.providers.connections.openai.apiKey).toBe("");
    expect(bridge.configure).not.toHaveBeenCalled();
    a.edit("example-reentered"); await a.sync.aiConfigReady();
    expect(native.read("openai").scope).toBe(credentialScopes(a.settings.getSettings().ai.providers).openai);
    expect(a.drafts.getUnsavedCredentialCount()).toBe(0);
});

it("does not acknowledge a later destination edit when an earlier save returns the same key", async () => {
    reset();
    const a = await openWindow(); stop = a.unsubscribe;
    a.edit("example-same-key"); await a.sync.aiConfigReady();
    const finishes: Array<() => void> = [];
    bridge.store.mockImplementation((id: string, value: string, expected: string, scope?: string) => new Promise((resolve) => {
        finishes.push(() => resolve(native.mutate(id, value, expected, true, scope)));
    }));
    const editUrl = (baseUrl: string) => {
        const providers = a.settings.getSettings().ai.providers;
        a.settings.updateSettingSection("ai", { providers: { ...providers, connections: { ...providers.connections,
            openai: { ...providers.connections.openai, baseUrl },
        } } });
    };
    editUrl("https://first.invalid/v1");
    await vi.waitFor(() => expect(finishes).toHaveLength(1));
    editUrl("https://second.invalid/v1");
    finishes[0]();
    await vi.waitFor(() => expect(finishes).toHaveLength(2));
    expect(a.drafts.getUnsavedCredentialCount()).toBe(1);
    finishes[1](); await a.sync.aiConfigReady();
    expect(a.drafts.getUnsavedCredentialCount()).toBe(0);
    expect(native.read("openai").scope).toContain("https://second.invalid/v1");
});

it("does not infer a migration destination from legacy copies with equal keys but different endpoints", async () => {
    reset();
    const { DEFAULT_SETTINGS } = await import("@/lib/settings");
    const local = structuredClone(DEFAULT_SETTINGS);
    local.ai.providers.connections.openai.apiKey = "example-same-key";
    local.ai.providers.connections.openai.baseUrl = "https://first.invalid/v1";
    const disk = structuredClone(local);
    disk.ai.providers.connections.openai.baseUrl = "https://second.invalid/v1";
    bridge.disk = disk;
    localStorage.setItem("bettershape-settings-v1", JSON.stringify(local));
    const a = await openWindow("blocked"); stop = a.unsubscribe;
    expect(a.settings.getCredentialRecoveryConflicts()).toContain("openai");
    expect(bridge.store).not.toHaveBeenCalled();
    expect(bridge.configure).not.toHaveBeenCalled();
    expect(JSON.stringify(bridge.disk)).toContain("https://second.invalid/v1");
    expect(localStorage.getItem("bettershape-settings-v1")).toContain("https://first.invalid/v1");
});

it("preserves a newer draft when an earlier in-flight clear wins the native lease", async () => {
    reset(); const stops: (() => void)[] = []; stop = () => stops.forEach((fn) => fn());
    const a = await openWindow(); stops.push(a.unsubscribe);
    a.edit("example-old"); await a.sync.aiConfigReady();
    const b = await openWindow(); stops.push(b.unsubscribe);
    let clear!: () => void; let write!: () => void;
    bridge.remove.mockImplementationOnce((id: string, expected: string) => new Promise((resolve) => {
        clear = () => resolve(native.mutate(id, "", expected));
    }));
    bridge.store.mockImplementationOnce((id: string, value: string, expected: string, scope?: string) => new Promise((resolve) => {
        write = () => resolve(native.mutate(id, value, expected, true, scope));
    }));
    a.edit("");
    await vi.waitFor(() => expect(clear).toBeTypeOf("function"));
    b.edit("example-new");
    await vi.waitFor(() => expect(write).toBeTypeOf("function"));
    clear(); await a.sync.aiConfigReady();
    write(); await expect(b.sync.aiConfigReady()).rejects.toThrow("Provider settings are not applied");
    expect(native.values.has("openai")).toBe(false);
    expect(b.settings.getSettings().ai.providers.connections.openai.apiKey).toBe("example-new");
    expect(b.drafts.getUnsavedCredentialCount()).toBe(1);
});

it("binds an existing vault key only after explicit review without exposing it in the prompt", async () => {
    reset(); native.values.set("openai", "example-existing-key");
    const a = await openWindow("blocked"); stop = a.unsubscribe;
    const confirm = vi.fn(async (destinations: string[]) => {
        expect(destinations.join("\n")).toContain("https://api.openai.com/v1");
        expect(destinations.join("\n")).not.toContain("example-existing-key");
        return true;
    });
    expect(await a.sync.reviewSavedCredentials(confirm)).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
    expect(a.settings.getSettings().ai.providers.connections.openai.apiKey).toBe("example-existing-key");
    expect(native.read("openai").scope).toBe(credentialScopes(a.settings.getSettings().ai.providers).openai);
    expect(a.drafts.getUnsavedCredentialCount()).toBe(0);
    expect(a.settings.getCredentialRecoveryConflicts()).toEqual([]);
});

it("leaves saved keys and recovery conflicts untouched when review is cancelled", async () => {
    reset(); native.values.set("openai", "example-existing-key");
    const a = await openWindow("blocked"); stop = a.unsubscribe;
    expect(await a.sync.reviewSavedCredentials(async () => false)).toBe(false);
    expect(bridge.store).not.toHaveBeenCalled();
    expect(a.settings.getCredentialRecoveryConflicts()).toEqual(["openai"]);
    expect(a.settings.getSettings().ai.providers.connections.openai.apiKey).toBe("");
});

it("rejects a recovery approval if settings change during the dialog", async () => {
    reset(); native.values.set("openai", "example-existing-key");
    const a = await openWindow("blocked"); stop = a.unsubscribe;
    expect(await a.sync.reviewSavedCredentials(async () => {
        const providers = a.settings.getSettings().ai.providers;
        a.settings.updateSettingSection("ai", { providers: { ...providers, connections: { ...providers.connections,
            openai: { ...providers.connections.openai, baseUrl: "https://changed.invalid/v1" },
        } } });
        return true;
    })).toBe(false);
    expect(bridge.store).not.toHaveBeenCalled();
    expect(a.settings.getSettings().ai.providers.connections.openai.apiKey).toBe("");
});

it("does not offer unavailable or unsaved native values as saved-key recovery", async () => {
    reset(); native.values.set("openai", "example-existing-key");
    const a = await openWindow("blocked"); stop = a.unsubscribe;
    bridge.load.mockResolvedValueOnce([{ status: "unavailable", id: "openai" }]);
    const confirm = vi.fn(async () => true);
    expect(await a.sync.reviewSavedCredentials(confirm)).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(bridge.store).not.toHaveBeenCalled();
});

it("keeps recovery unsaved when another window advances the native revision during review", async () => {
    reset(); native.values.set("openai", "example-existing-key");
    const a = await openWindow("blocked"); stop = a.unsubscribe;
    expect(await a.sync.reviewSavedCredentials(async () => {
        native.mutate("openai", "example-newer-key", native.read("openai").revision, true, "other-destination");
        return true;
    })).toBe(false);
    expect(native.values.get("openai")).toBe("example-newer-key");
    expect(a.drafts.getUnsavedCredentialCount()).toBe(1);
});

it("keeps an orphaned scoped header without loading it or blocking unrelated configuration", async () => {
    reset();
    const id = "header:custom:Removed";
    native.mutate(id, "example-orphan", "initial", true, credentialScopes(defaultProvidersSettings()).custom);
    localStorage.setItem(`bettershape-ai-vault-entry:${encodeURIComponent(id)}`, "stored");
    const a = await openWindow(); stop = a.unsubscribe;
    expect(a.settings.getCredentialRecoveryConflicts()).toEqual([]);
    expect(a.settings.getSettings().ai.providers.connections.custom.headers.Removed).toBeUndefined();
    expect(native.values.get(id)).toBe("example-orphan");
    expect(bridge.remove).not.toHaveBeenCalled();
    expect(bridge.configure).toHaveBeenCalled();
});

it("migrates a local legacy key when the desktop copy is redacted at the same destination", async () => {
    reset();
    const { DEFAULT_SETTINGS } = await import("@/lib/settings");
    bridge.disk = structuredClone(DEFAULT_SETTINGS);
    const local = structuredClone(DEFAULT_SETTINGS);
    local.ai.providers.connections.openai.apiKey = "example-legacy-local";
    localStorage.setItem("bettershape-settings-v1", JSON.stringify(local));
    const a = await openWindow(); stop = a.unsubscribe;
    expect(a.settings.getCredentialRecoveryConflicts()).toEqual([]);
    expect(a.settings.getSettings().ai.providers.connections.openai.apiKey).toBe("example-legacy-local");
    expect(native.values.get("openai")).toBe("example-legacy-local");
    expect(localStorage.getItem("bettershape-settings-v1")).not.toContain("example-legacy-local");
    expect(JSON.stringify(bridge.disk)).not.toContain("example-legacy-local");
});
