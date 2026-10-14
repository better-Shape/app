import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    secrets: {} as Record<string, string>, vaulted: false,
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
    getSettings: () => ({ ai: { providers: { connections: { custom: { headers: { Authorization: "" } } } } } }),
    applyVaultSecrets: (secrets: Record<string, string>) => {
        state.secrets = { ...secrets, ...state.secrets };
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
