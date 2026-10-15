import { beforeEach, expect, it, vi } from "vitest";
import { createNativeVault, type VaultMutation } from "../helpers/native-vault";
const native = createNativeVault();
const bridge = vi.hoisted(() => ({ load: vi.fn(), store: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/backend", () => ({ commands: {
    aiVaultSupported: async () => true,
    aiLoadKeys: bridge.load, aiStoreKey: bridge.store, aiDeleteKey: bridge.remove,
} }));
beforeEach(() => {
    vi.resetModules(); localStorage.clear(); native.reset(); native.values.set("openai", "example-old");
    bridge.load.mockReset().mockImplementation(async (ids: string[]) => ids.map(native.read));
    bridge.store.mockReset().mockImplementation(async (id: string, value: string, expected: string, scope?: string) => native.mutate(id, value, expected, true, scope));
    bridge.remove.mockReset().mockImplementation(async (id: string, expected: string) => native.mutate(id, "", expected));
});
async function windows() {
    const first = await import("@/lib/ai/vault"); await first.readSecrets(["openai"]);
    vi.resetModules();
    const second = await import("@/lib/ai/vault"); await second.readSecrets(["openai"]);
    return { first, second };
}
it("a delayed IPC store cannot resurrect another WebView's completed deletion", async () => {
    const { first, second } = await windows();
    let complete!: () => void;
    bridge.store.mockImplementationOnce((id: string, value: string, expected: string, scope?: string) => new Promise<VaultMutation>((resolve) => {
        complete = () => resolve(native.mutate(id, value, expected, true, scope));
    }));
    const earlier = first.writeSecret("openai", "example-new", "test-scope");
    await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
    expect(await second.writeSecret("openai", "")).toBe(true);
    complete();
    expect(await earlier).toBe(false);
    expect(native.values.has("openai")).toBe(false);
});
it("a local cached value is not proof that the shared vault still contains it", async () => {
    const { first, second } = await windows();
    expect(await second.writeSecret("openai", "")).toBe(true);
    // Even without a delivered storage event or the shared intent ledger, the
    // native lease refuses the old value. This tests more than a metadata flag.
    localStorage.clear();
    expect(await first.writeSecret("openai", "example-old", "test-scope")).toBe(false);
    expect(native.values.has("openai")).toBe(false);
});
it("a stale writer cannot replace a newer, deliberately saved credential", async () => {
    const { first, second } = await windows();
    expect(await second.writeSecret("openai", "example-newer", "test-scope")).toBe(true);
    localStorage.clear();
    expect(await first.writeSecret("openai", "example-old", "test-scope")).toBe(false);
    expect(first.hasPendingSecretWrite("openai")).toBe(true);
    // An unrelated settings tick must not borrow the conflict's newer lease
    // and silently retry the same obsolete value.
    expect(await first.writeSecret("openai", "example-old", "test-scope")).toBe(false);
    expect(native.values.get("openai")).toBe("example-newer");
});
it("a failed native deletion still fences older writes until its retry succeeds", async () => {
    const { first, second } = await windows();
    bridge.remove.mockImplementationOnce(async (id: string, expected: string) => native.mutate(id, "", expected, false));
    expect(await second.writeSecret("openai", "")).toBe(false);
    expect(await first.writeSecret("openai", "example-old", "test-scope")).toBe(false);
    expect(await second.writeSecret("openai", "")).toBe(true);
    expect(native.values.has("openai")).toBe(false);
});

it("a repeated clear fences a pending re-entry even when the native value was already empty", async () => {
    const { first, second } = await windows();
    expect(await second.writeSecret("openai", "")).toBe(true);
    await first.readSecrets(["openai"]);
    let complete!: () => void;
    bridge.store.mockImplementationOnce((id: string, value: string, expected: string, scope?: string) => new Promise<VaultMutation>((resolve) => {
        complete = () => resolve(native.mutate(id, value, expected, true, scope));
    }));
    const earlier = first.writeSecret("openai", "example-reentry", "test-scope");
    await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
    expect(await second.writeSecret("openai", "")).toBe(true);
    complete();
    expect(await earlier).toBe(false);
    expect(native.values.has("openai")).toBe(false);
});

it("does not acknowledge another destination's save just because the key value matches", async () => {
    const { first, second } = await windows();
    first.recordSecretChanges({ openai: "example-old" });
    second.recordSecretChanges({ openai: "example-old" });
    expect(await second.writeSecretDetailed("openai", "example-old", "second-destination")).toEqual({ kind: "stored" });
    expect(await first.writeSecretDetailed("openai", "example-old", "first-destination")).toEqual({ kind: "conflict", value: "example-old", persisted: true });
    expect(native.read("openai").scope).toBe("second-destination");
});

it("does not let deletion lease recovery overtake a newer re-entry", async () => {
    const { first, second } = await windows();
    first.recordSecretDeletions(["openai"]);
    first.__resetVaultCacheForTesting();
    let finish!: () => void;
    bridge.load.mockImplementationOnce((ids: string[]) => new Promise((resolve) => {
        finish = () => resolve(ids.map(native.read));
    }));
    const deletion = first.writeSecretDetailed("openai", "");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    second.recordSecretChanges({ openai: "example-reentered" });
    expect(await second.writeSecretDetailed("openai", "example-reentered", "test-scope")).toEqual({ kind: "stored" });
    finish();
    expect(await deletion).toEqual({ kind: "conflict", value: "example-reentered", persisted: true });
    expect(bridge.remove).not.toHaveBeenCalled();
    expect(native.values.get("openai")).toBe("example-reentered");
});

it("cannot overwrite a newer deletion between checking intent and recording a save receipt", async () => {
    const { first, second } = await windows();
    first.recordSecretChanges({ openai: "example-new" });
    const setItem = Storage.prototype.setItem;
    let interleaved = false;
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
        const row: unknown = JSON.parse(value);
        if (!interleaved && row && typeof row === "object" && "state" in row && row.state === "stored") {
            interleaved = true;
            second.recordSecretDeletions(["openai"]);
        }
        setItem.call(this, key, value);
    });
    try { await first.writeSecretDetailed("openai", "example-new", "test-scope"); }
    finally { write.mockRestore(); }
    expect(interleaved).toBe(true);
    expect(second.deletedSecretIds()).toContain("openai");
    vi.resetModules();
    const restarted = await import("@/lib/ai/vault");
    expect((await restarted.readSecrets(["openai"])).openai).toBeUndefined();
    expect(await restarted.writeSecretDetailed("openai", "")).toEqual({ kind: "stored" });
    expect(native.values.has("openai")).toBe(false);
});
