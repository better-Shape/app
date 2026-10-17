// Review finding: lib/ai/sync.ts adoption of a credential the keychain never stored.
//
// `readSecretsDetailed` reports `persisted` separately from availability: a row can be
// `status: "available"` with `persisted: false`, which is the native `write_scoped`
// outcome when `keyring::Entry::set_password` failed. That value lives only in the
// process-wide `VAULT` map and the window that typed it, and sync tells the user exactly
// that ("remain only in this window", sync.ts:168). The adoption block adopted those
// values anyway, because it destructured `values`, `scopes` and `unavailable` and dropped
// `persisted`.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createNativeVault } from "./helpers/native-vault";
const native = createNativeVault();

const state = vi.hoisted(() => ({
    config: {} as Record<string, string>, scopeSuffix: "",
    secrets: {} as Record<string, string>, headers: { Authorization: "" } as Record<string, string>, vaulted: false,
    listeners: new Set<() => void>(),
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
    state.secrets = {}; state.vaulted = false; native.reset(); state.listeners.clear();
    state.load.mockReset().mockImplementation(async (ids: string[]) => ids.map(native.read));
    state.store.mockReset().mockImplementation(async (id: string, secret: string, expected: string, scope?: string) => native.mutate(id, secret, expected, true, scope));
    state.remove.mockReset().mockImplementation(async (id: string, expected: string) => native.mutate(id, "", expected));
    state.configure.mockReset().mockResolvedValue(undefined); state.error.mockReset();
    sync = await import("@/lib/ai/sync");
});
afterEach(async () => { stop?.(); stop = undefined; await sync.aiConfigReady(); localStorage.clear(); });

/** The shared inventory entry another window records before it writes. */
function reserveForeignIntent(id: string) {
    localStorage.setItem(`bettershape-ai-vault-entry:${encodeURIComponent(id)}`, JSON.stringify({ state: "write", token: "foreign-token" }));
}

it("adopts a credential another window saved to the keychain under an id this window never held", async () => {
    stop = sync.initAiConfigSync();
    await sync.aiConfigReady();
    reserveForeignIntent("openai");
    // persisted: true is the ordinary case: the other window's keychain write succeeded.
    native.mutate("openai", "example-from-other-window", "initial", true, "test-scope:openai");
    state.configure.mockClear();
    change({});
    await sync.aiConfigReady();
    expect(state.secrets.openai).toBe("example-from-other-window");
});

it("does not adopt a credential the other window never saved to the keychain", async () => {
    stop = sync.initAiConfigSync();
    await sync.aiConfigReady();
    reserveForeignIntent("openai");
    // persisted: false is the failed-write outcome: available in the process-wide vault,
    // absent from the OS keychain, lost on restart.
    native.mutate("openai", "example-session-only", "initial", false, "test-scope:openai");
    state.configure.mockClear();
    change({});
    await sync.aiConfigReady();
    expect(state.secrets.openai).toBeUndefined();
    // The property that matters is that the session-only key never reaches Rust,
    // so no send could use it. Asserting the exact `configure` payload would
    // pin whether the sync re-pushes an unchanged vault at all, which is a
    // different question and one this path does not promise an answer to.
    for (const call of state.configure.mock.calls) {
        const pushed = (call[0] as { secrets?: Record<string, string> } | undefined)?.secrets;
        expect(pushed?.openai).toBeUndefined();
    }
});