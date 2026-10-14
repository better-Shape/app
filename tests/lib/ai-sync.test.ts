import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    secrets: {} as Record<string, string>, headers: { Authorization: "" } as Record<string, string>, vaulted: false,
    listeners: new Set<() => void>(), vault: new Map<string, string>(),
    load: vi.fn(), store: vi.fn(), remove: vi.fn(), configure: vi.fn(), error: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ commands: {
    aiVaultSupported: async () => true,
    aiLoadKeys: state.load, aiStoreKey: state.store, aiDeleteKey: state.remove, setAiConfig: state.configure,
} }));
vi.mock("@/features/notifications", () => ({ notify: { error: state.error } }));
vi.mock("@/lib/settings", () => ({
    areSecretsVaulted: () => state.vaulted,
    setSecretsVaulted: (value: boolean) => { state.vaulted = value; },
    providerSecretsForVault: () => ({ ...state.secrets }),
    getSettings: () => ({ ai: { providers: { connections: { custom: { headers: state.headers } } } } }),
    applyVaultSecrets: (secrets: Record<string, string>) => {
        const allowed = new Set(["openai", "custom", "service:search", "service:composio", ...Object.keys(state.headers).map((name) => `header:custom:${name}`)]);
        state.secrets = { ...Object.fromEntries(Object.entries(secrets).filter(([id]) => allowed.has(id))), ...state.secrets };
        for (const listener of state.listeners) listener();
    },
    subscribeSettings: (listener: () => void) => { state.listeners.add(listener); return () => { state.listeners.delete(listener); }; },
}));
vi.mock("@/lib/ai/providers", () => ({
    PROVIDER_PRESETS: [{ id: "openai" }, { id: "custom" }],
    SEARCH_SECRET_ID: "service:search", COMPOSIO_SECRET_ID: "service:composio",
    headerSecretId: (id: string, name: string) => `header:${id}:${name}`,
    toRustAiConfig: () => ({ secrets: { ...state.secrets } }),
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
    state.headers = { Authorization: "" };
    state.secrets = {}; state.vaulted = false; state.vault.clear(); state.listeners.clear();
    state.load.mockReset().mockImplementation(async (ids: string[]) => ids.flatMap((id) => state.vault.has(id) ? [{ id, apiKey: state.vault.get(id)! }] : []));
    state.store.mockReset().mockImplementation(async (id: string, secret: string) => { state.vault.set(id, secret); });
    state.remove.mockReset().mockImplementation(async (id: string) => { state.vault.delete(id); });
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
    let finish!: (rows: { id: string; apiKey: string }[]) => void;
    state.load.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    stop = sync.initAiConfigSync();
    await vi.waitFor(() => expect(state.load).toHaveBeenCalled());
    change({});
    finish([{ id: "openai", apiKey: "example-before-clear" }]);
    await sync.aiConfigReady();
    expect(state.secrets).toEqual({});
    expect(state.vault.has("openai")).toBe(false);
});

it("serializes a slow write followed by a delete", async () => {
    stop = sync.initAiConfigSync(); await sync.aiConfigReady();
    let finish!: () => void;
    state.store.mockImplementationOnce((id: string, secret: string) => new Promise<void>((resolve) => {
        finish = () => { state.vault.set(id, secret); resolve(); };
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

it("prunes an inventoried header absent from settings even if it could not be read", async () => {
    const vault = await import("@/lib/ai/vault");
    const id = "header:custom:Removed";
    await vault.writeSecret(id, "example-orphan");
    vault.__resetVaultCacheForTesting();
    state.load.mockResolvedValue([]);
    stop = sync.initAiConfigSync(); await sync.aiConfigReady();
    expect(state.remove).toHaveBeenCalledWith(id);
    expect(state.vault.has(id)).toBe(false);
});

it("keeps a deliberate re-entry when a clear overtook a pending first write", async () => {
    stop = sync.initAiConfigSync(); await sync.aiConfigReady();
    let finish!: () => void;
    state.store.mockImplementationOnce((id: string, secret: string) => new Promise<void>((resolve) => {
        finish = () => { state.vault.set(id, secret); resolve(); };
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
