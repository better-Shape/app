import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createNativeVault, type VaultSnapshot, type VaultMutation } from "../helpers/native-vault";
const native = createNativeVault();

const state = vi.hoisted(() => ({
    config: {} as Record<string, string>, scopeSuffix: "",
    secrets: {} as Record<string, string>, headers: { Authorization: "" } as Record<string, string>, vaulted: false,
    listeners: new Set<() => void>(), vault: new Map<string, string>(),
    supported: vi.fn(), load: vi.fn(), store: vi.fn(), remove: vi.fn(), configure: vi.fn(), error: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ commands: {
    aiVaultSupported: state.supported,
    aiLoadKeys: state.load, aiStoreKey: state.store, aiDeleteKey: state.remove, setAiConfig: state.configure,
} }));
vi.mock("@/features/notifications", () => ({ notify: { error: state.error } }));
vi.mock("@/lib/settings", () => ({
    areSecretsVaulted: () => state.vaulted,
    acceptCredentialRecovery: () => undefined,
    getCredentialRecoveryConflicts: () => [],
    registerLegacyVaultConflicts: () => undefined,
    registerCredentialRecoveryConflicts: () => undefined,
    setSecretsVaulted: (value: boolean) => { state.vaulted = value; },
    providerSecretsForVault: () => ({ ...state.secrets }),
    getSettings: () => ({ ai: { providers: { connections: { custom: { headers: state.headers } } } } }),
    applyVaultSecrets: (secrets: Record<string, string>, overwrite = false) => {
        const allowed = new Set(["openai", "custom", "service:search", "service:composio", ...Object.keys(state.headers).map((name) => `header:custom:${name}`)]);
        const applicable = Object.fromEntries(Object.entries(secrets).filter(([id]) => allowed.has(id)));
        const merged = overwrite ? { ...state.secrets, ...applicable } : { ...applicable, ...state.secrets };
        state.secrets = Object.fromEntries(Object.entries(merged).filter(([, value]) => value));
        for (const listener of state.listeners) listener();
    },
    subscribeSettings: (listener: () => void) => { state.listeners.add(listener); return () => { state.listeners.delete(listener); }; },
}));
vi.mock("@/lib/ai/providers", () => ({
    credentialScopes: () => Object.fromEntries(["openai", "custom", "service:search", "service:composio", ...Object.keys(state.headers).map((name) => `header:custom:${name}`)].map((id) => [id, `test-scope:${id}${state.scopeSuffix}`])),
    PROVIDER_PRESETS: [{ id: "openai" }, { id: "custom" }],
    SEARCH_SECRET_ID: "service:search", COMPOSIO_SECRET_ID: "service:composio",
    headerSecretId: (id: string, name: string) => `header:${id}:${name}`,
    toRustAiConfig: () => ({ secrets: { ...state.secrets }, ...state.config }),
}));
let stop: (() => void) | undefined;
let sync: typeof import("@/lib/ai/sync");
function change(secrets: Record<string, string>) {
    state.secrets = secrets;
    for (const listener of state.listeners) listener();
}
beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    state.supported.mockReset().mockResolvedValue(true);
    state.headers = { Authorization: "" }; state.config = {}; state.scopeSuffix = "";
    state.secrets = {}; state.vaulted = false; native.reset(); state.vault = native.values; state.listeners.clear();
    state.load.mockReset().mockImplementation(async (ids: string[]) => ids.map(native.read));
    state.store.mockReset().mockImplementation(async (id: string, secret: string, expected: string, scope?: string) => native.mutate(id, secret, expected, true, scope));
    state.remove.mockReset().mockImplementation(async (id: string, expected: string) => native.mutate(id, "", expected));
    state.configure.mockReset().mockResolvedValue(undefined); state.error.mockReset();
    sync = await import("@/lib/ai/sync");
});
afterEach(async () => { stop?.(); stop = undefined; await sync.aiConfigReady(); });

it("hydrates stored credentials before pruning empty settings", async () => {
    state.vault.set("openai", "example-persisted");
    stop = sync.initAiConfigSync(); await sync.aiConfigReady();
    expect(state.secrets.openai).toBe("example-persisted");
    expect(state.remove).not.toHaveBeenCalled();
    expect(state.configure).toHaveBeenCalledWith({ secrets: { openai: "example-persisted" } });
});

it("removes cleared provider, service, and removed header keys from the actual vault", async () => {
    for (const id of ["openai", "service:search", "service:composio", "header:custom:Authorization"]) state.vault.set(id, `example-${id}`);
    stop = sync.initAiConfigSync(); await sync.aiConfigReady();
    change({}); await sync.aiConfigReady();
    expect(state.vault.size).toBe(0);
    expect(state.remove).toHaveBeenCalledTimes(4);
    expect(state.configure).toHaveBeenLastCalledWith({ secrets: {} });
    // Restart with a new in-memory vault cache; cleared credentials must stay gone.
    stop(); stop = undefined;
    const vault = await import("@/lib/ai/vault"); vault.__resetVaultCacheForTesting();
    stop = sync.initAiConfigSync(); await sync.aiConfigReady();
    expect(state.secrets).toEqual({});
});

it("does not resurrect a key cleared while keychain hydration is in flight", async () => {
    state.secrets = { openai: "example-before-clear" };
    let finish!: (rows: VaultSnapshot[]) => void;
    state.load.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    stop = sync.initAiConfigSync();
    await vi.waitFor(() => expect(state.load).toHaveBeenCalled());
    change({});
    finish([{ status: "available", id: "openai", apiKey: "example-before-clear", revision: "initial", persisted: true }]);
    await sync.aiConfigReady();
    expect(state.secrets).toEqual({});
    expect(state.vault.has("openai")).toBe(false);
});

it("serializes a slow write followed by a delete", async () => {
    stop = sync.initAiConfigSync(); await sync.aiConfigReady();
    let finish!: () => void;
    state.store.mockImplementationOnce((id: string, secret: string, expected: string, scope?: string) => new Promise<VaultMutation>((resolve) => {
        finish = () => resolve(native.mutate(id, secret, expected, true, scope));
    }));
    change({ openai: "example-transient" });
    await vi.waitFor(() => expect(state.store).toHaveBeenCalled());
    change({});
    expect(state.remove).not.toHaveBeenCalled();
    finish(); await sync.aiConfigReady();
    expect(state.vault.has("openai")).toBe(false);
    expect(state.configure).toHaveBeenLastCalledWith({ secrets: {} });
});

it("reports failed deletion without poisoning its retry cache", async () => {
    state.vault.set("openai", "example-old");
    stop = sync.initAiConfigSync(); await sync.aiConfigReady();
    state.remove.mockRejectedValueOnce(new Error("Keychain locked"));
    change({}); await sync.aiConfigReady();
    expect(state.error).toHaveBeenCalledWith("Could not update saved credentials", expect.any(String));
    expect(state.vault.has("openai")).toBe(true);
    change({}); await sync.aiConfigReady();
    expect(state.vault.has("openai")).toBe(false);
});

it("stops watching settings on unsubscribe", async () => {
    stop = sync.initAiConfigSync(); await sync.aiConfigReady(); stop();
    change({ openai: "example-after-stop" }); await sync.aiConfigReady();
    expect(state.store).not.toHaveBeenCalled();
});

it("retries a failed removed-header deletion after restart without resurrecting the value", async () => {
    const id = "header:custom:Authorization";
    state.vault.set(id, "example-header-token");
    stop = sync.initAiConfigSync(); await sync.aiConfigReady();
    state.remove.mockRejectedValueOnce(new Error("Locked"));
    state.headers = {};
    change({}); await sync.aiConfigReady();
    expect(state.vault.has(id)).toBe(true);
    expect(JSON.stringify(localStorage)).not.toContain("example-header-token");
    stop();
    const vault = await import("@/lib/ai/vault"); vault.__resetVaultCacheForTesting();
    expect(vault.knownSecretIds()).toContain(id);
    stop = sync.initAiConfigSync(); await sync.aiConfigReady();
    expect(state.vault.has(id)).toBe(false);
    expect(state.secrets).toEqual({});
    // Re-adding the name after another restart cannot restore the old key.
    stop(); vault.__resetVaultCacheForTesting(); state.headers = { Authorization: "" };
    stop = sync.initAiConfigSync(); await sync.aiConfigReady();
    expect(state.secrets).toEqual({});
});

it("does not hydrate a credential whose write-ahead deletion survived an interrupted session", async () => {
    const vault = await import("@/lib/ai/vault");
    state.vault.set("openai", "example-stale");
    expect(vault.recordSecretDeletions(["openai"])).toBe(true);
    vault.__resetVaultCacheForTesting();
    state.remove.mockRejectedValueOnce(new Error("Still locked"));
    stop = sync.initAiConfigSync(); await sync.aiConfigReady();
    expect(state.secrets).toEqual({});
    expect(state.vault.get("openai")).toBe("example-stale");
    change({}); await sync.aiConfigReady();
    expect(state.vault.has("openai")).toBe(false);
});

it("does not treat a header absent from this window as permission to delete another window’s key", async () => {
    const vault = await import("@/lib/ai/vault");
    const id = "header:custom:Removed";
    await vault.writeSecret(id, "example-orphan", `test-scope:${id}`);
    vault.__resetVaultCacheForTesting();
    state.load.mockResolvedValue([]);
    stop = sync.initAiConfigSync(); await sync.aiConfigReady();
    expect(state.remove).not.toHaveBeenCalled();
    expect(state.vault.get(id)).toBe("example-orphan");
});

it("keeps a deliberate re-entry when a clear overtook a pending first write", async () => {
    stop = sync.initAiConfigSync(); await sync.aiConfigReady();
    let finish!: () => void;
    state.store.mockImplementationOnce((id: string, secret: string, expected: string, scope?: string) => new Promise<VaultMutation>((resolve) => {
        finish = () => resolve(native.mutate(id, secret, expected, true, scope));
    }));
    change({ openai: "example-reentered" });
    await vi.waitFor(() => expect(state.store).toHaveBeenCalled());
    change({});
    change({ openai: "example-reentered" });
    finish(); await sync.aiConfigReady();
    stop();
    const vault = await import("@/lib/ai/vault"); vault.__resetVaultCacheForTesting();
    state.secrets = {};
    stop = sync.initAiConfigSync(); await sync.aiConfigReady();
    expect(state.secrets.openai).toBe("example-reentered");
});

it("refuses a keychain mutation without durable metadata, and can retry in this session", async () => {
    stop = sync.initAiConfigSync(); await sync.aiConfigReady();
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
    try {
        change({ openai: "example-unsaved" }); await sync.aiConfigReady();
        expect(state.store).not.toHaveBeenCalled();
        expect(state.error).toHaveBeenCalled();
    } finally { write.mockRestore(); }
    change({ openai: "example-unsaved" }); await sync.aiConfigReady();
    expect(state.vault.get("openai")).toBe("example-unsaved");
});


it("preserves a local recovery draft when an inventoried account cannot be read", async () => {
    state.secrets = { openai: "example-local-recovery" };
    localStorage.setItem("bettershape-ai-vault-entry:openai", JSON.stringify({ state: "stored", token: "previous-session" }));
    state.load.mockImplementation(async (ids: string[]) => ids.map((id) => id === "openai"
        ? { status: "unavailable", id } : native.read(id)));
    state.store.mockRejectedValue(new Error("Keychain locked"));
    stop = sync.initAiConfigSync();
    await sync.aiConfigReady();
    expect(state.secrets.openai).toBe("example-local-recovery");
    expect(state.configure).toHaveBeenLastCalledWith({ secrets: { openai: "example-local-recovery" } });
    expect(state.remove).not.toHaveBeenCalled();
    expect(state.error).toHaveBeenCalledWith("Some credentials are not available in the keychain", expect.any(String));
});

it("migrates a legacy draft when an inventoried account is missing rather than explicitly cleared", async () => {
    state.secrets = { openai: "example-legacy-copy" };
    localStorage.setItem("bettershape-ai-vault-entry:openai", JSON.stringify({ state: "stored", token: "previous-session" }));
    stop = sync.initAiConfigSync(); await sync.aiConfigReady();
    expect(state.secrets.openai).toBe("example-legacy-copy");
    expect(state.vault.get("openai")).toBe("example-legacy-copy");
});

it("hydrates untouched saved keys when retry unlocks a vault unavailable at startup", async () => {
    state.vault.set("openai", "example-persisted");
    state.supported.mockResolvedValue(false);
    stop = sync.initAiConfigSync(); await sync.aiConfigReady();
    expect(state.secrets).toEqual({});
    state.supported.mockResolvedValue(true);
    await sync.retryCredentialPersistence();
    expect(state.secrets.openai).toBe("example-persisted");
    expect(state.configure).toHaveBeenLastCalledWith({ secrets: { openai: "example-persisted" } });
});

it("retries unavailable key reads without requiring a restart", async () => {
    state.vault.set("openai", "example-persisted");
    state.load.mockImplementationOnce(async (ids: string[]) => ids.map(id => ({ status: "unavailable", id })));
    stop = sync.initAiConfigSync(); await sync.aiConfigReady();
    expect(state.secrets).toEqual({});
    await sync.retryCredentialPersistence();
    expect(state.secrets.openai).toBe("example-persisted");
});

it("preserves edits made while retry hydration is in flight", async () => {
    state.vault.set("openai", "example-persisted");
    state.supported.mockResolvedValue(false);
    stop = sync.initAiConfigSync(); await sync.aiConfigReady();
    state.supported.mockResolvedValue(true);
    let finish!: (rows: VaultSnapshot[]) => void;
    state.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const retry = sync.retryCredentialPersistence();
    await vi.waitFor(() => expect(state.load).toHaveBeenCalled());
    change({ openai: "example-edited-during-retry" });
    finish([native.read("openai")]);
    await retry; await sync.aiConfigReady();
    expect(state.secrets.openai).toBe("example-edited-during-retry");
});

it("does not repeatedly hydrate inaccessible keys on unrelated settings changes", async () => {
    state.load.mockImplementationOnce(async (ids: string[]) => ids.map(id => ({ status: "unavailable", id })));
    stop = sync.initAiConfigSync(); await sync.aiConfigReady();
    change({}); await sync.aiConfigReady();
    change({}); await sync.aiConfigReady();
    expect(state.load).toHaveBeenCalledTimes(1);
    await sync.retryCredentialPersistence();
    expect(state.load).toHaveBeenCalledTimes(2);
});

it("retries a cleared key after its deletion metadata could not be recorded", async () => {
    state.vault.set("openai", "example-persisted");
    stop = sync.initAiConfigSync(); await sync.aiConfigReady();
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
    try {
        change({}); await sync.aiConfigReady();
        expect(state.vault.get("openai")).toBe("example-persisted");
    } finally { write.mockRestore(); }
    await sync.retryCredentialPersistence();
    expect(state.vault.has("openai")).toBe(false);
    expect(state.secrets).toEqual({});
    const { getUnsavedCredentialCount } = await import("@/lib/ai/credential-drafts");
    expect(getUnsavedCredentialCount()).toBe(0);
});

it("rejects send readiness after native configuration failure and recovers on retry", async () => {
    state.configure.mockRejectedValueOnce(new Error("private backend details"));
    stop = sync.initAiConfigSync();
    await expect(sync.aiConfigReady()).rejects.toThrow("Provider settings are not applied");
    await sync.retryCredentialPersistence();
    await expect(sync.aiConfigReady()).resolves.toBeUndefined();
    expect(state.configure).toHaveBeenCalledTimes(2);
});


it("syncs noncredential settings without rewriting successfully stored keys", async () => {
    state.secrets = { openai: "example-stored" };
    stop = sync.initAiConfigSync(); await sync.aiConfigReady();
    const writes = state.store.mock.calls.length;
    expect(writes).toBeGreaterThan(0);
    state.config = { model: "next-model" };
    change({ ...state.secrets }); await sync.aiConfigReady();
    change({ ...state.secrets }); await sync.aiConfigReady();
    expect(state.store).toHaveBeenCalledTimes(writes);
    expect(state.configure).toHaveBeenLastCalledWith({ secrets: { openai: "example-stored" }, model: "next-model" });
});

it("still validates unchanged saved keys on explicit persistence retry", async () => {
    state.secrets = { openai: "example-stored" };
    stop = sync.initAiConfigSync(); await sync.aiConfigReady();
    const writes = state.store.mock.calls.length;
    await sync.retryCredentialPersistence(); await sync.aiConfigReady();
    expect(state.store.mock.calls.length).toBeGreaterThan(writes);
});

it("retries a failed credential write on an unchanged settings notification", async () => {
    stop = sync.initAiConfigSync(); await sync.aiConfigReady();
    state.store.mockRejectedValueOnce(new Error("Keychain locked"));
    change({ openai: "example-retry" }); await sync.aiConfigReady();
    expect(state.vault.has("openai")).toBe(false);
    change({ ...state.secrets }); await sync.aiConfigReady();
    expect(state.vault.get("openai")).toBe("example-retry");
    expect(state.store).toHaveBeenCalledTimes(2);
});

it("persists a changed destination even when its credential text is unchanged", async () => {
    state.secrets = { openai: "example-stored" };
    stop = sync.initAiConfigSync(); await sync.aiConfigReady();
    const writes = state.store.mock.calls.length;
    state.scopeSuffix = ":new-destination";
    change({ ...state.secrets }); await sync.aiConfigReady();
    expect(state.store.mock.calls.length).toBeGreaterThan(writes);
    expect(state.store).toHaveBeenLastCalledWith("openai", "example-stored", expect.any(String), "test-scope:openai:new-destination");
});

it("does not mark a newer credential edit clean when an older sync acknowledges", async () => {
    stop = sync.initAiConfigSync(); await sync.aiConfigReady();
    let finish!: () => void;
    state.store.mockImplementationOnce((id: string, secret: string, expected: string, scope?: string) => new Promise<VaultMutation>(resolve => {
        finish = () => resolve(native.mutate(id, secret, expected, true, scope));
    }));
    change({ openai: "example-earlier" });
    await vi.waitFor(() => expect(state.store).toHaveBeenCalledTimes(1));
    change({ openai: "example-later" });
    change({ ...state.secrets });
    finish(); await sync.aiConfigReady();
    expect(state.vault.get("openai")).toBe("example-later");
    expect(state.vaulted).toBe(true);
});


it("settles the captured initialization work without waiting for later settings edits", async () => {
    let finish: (() => void) | undefined;
    state.configure.mockImplementationOnce(async () => {
        state.config.revision = "later";
        change({});
    }).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    stop = sync.initAiConfigSync();
    let settled = false;
    void sync.aiConfigSettled().then(() => { settled = true; });
    try {
        await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
        await vi.waitFor(() => expect(settled).toBe(true));
    } finally {
        finish?.();
    }
    await sync.aiConfigReady();
});

it("fails readiness under continual configuration churn and permits a later retry", async () => {
    let edits = 0;
    state.configure.mockImplementation(async () => {
        if (edits >= 32) return;
        state.config.revision = String(++edits);
        change({});
    });
    stop = sync.initAiConfigSync();
    try {
        await expect(sync.aiConfigReady()).rejects.toThrow("Provider settings keep changing");
        expect(edits).toBeLessThan(32);
    } finally {
        state.configure.mockResolvedValue(undefined);
    }
    await expect(sync.aiConfigReady()).resolves.toBeUndefined();
});

it("retains only live header edits through failed hydration and descriptor removal/re-add", async () => {
    state.supported.mockResolvedValue(false);
    stop = sync.initAiConfigSync(); await sync.aiConfigReady();
    for (let index = 0; index < 40; index += 1) {
        const name = `Transient${index}`;
        state.headers = { [name]: "" };
        change({ [`header:custom:${name}`]: "example-unsaved" });
    }
    state.headers = { Authorization: "" };
    change({ "header:custom:Authorization": "example-kept" });
    await sync.aiConfigReady();
    state.supported.mockResolvedValue(true);
    await sync.retryCredentialPersistence(); await sync.aiConfigReady();
    expect(state.secrets).toEqual({ "header:custom:Authorization": "example-kept" });
    expect(state.vault.get("header:custom:Authorization")).toBe("example-kept");
    expect([...state.vault.keys()].filter(id => id.includes("Transient"))).toEqual([]);
    state.headers = { Transient0: "" };
    change({ "header:custom:Transient0": "example-readded" });
    await sync.aiConfigReady();
    expect(state.vault.get("header:custom:Transient0")).toBe("example-readded");
});
