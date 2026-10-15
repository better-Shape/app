import { beforeEach, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ supported: vi.fn() }));
vi.mock("@/lib/backend", () => ({ commands: { aiVaultSupported: bridge.supported } }));
beforeEach(() => { vi.resetModules(); bridge.supported.mockReset(); });

function deferred() {
    let resolve!: (value: boolean) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<boolean>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

it("shares an in-flight availability probe across callers", async () => {
    const pending = deferred();
    bridge.supported.mockReturnValue(pending.promise);
    const vault = await import("@/lib/ai/vault");
    const first = vault.vaultAvailable();
    const second = vault.vaultAvailable();
    await vi.waitFor(() => expect(bridge.supported).toHaveBeenCalledTimes(1));
    pending.resolve(true);
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    await expect(vault.vaultAvailable()).resolves.toBe(true);
    expect(bridge.supported).toHaveBeenCalledTimes(1);
});

it.each([false, true])("does not let a stale %s probe overwrite a refreshed result", async (stale) => {
    const old = deferred();
    bridge.supported.mockReturnValueOnce(old.promise).mockResolvedValueOnce(!stale);
    const vault = await import("@/lib/ai/vault");
    const first = vault.vaultAvailable();
    await vi.waitFor(() => expect(bridge.supported).toHaveBeenCalledTimes(1));
    vault.refreshVaultAvailability();
    await expect(vault.vaultAvailable()).resolves.toBe(!stale);
    old.resolve(stale);
    await expect(first).resolves.toBe(!stale);
    await expect(vault.vaultAvailable()).resolves.toBe(!stale);
    expect(bridge.supported).toHaveBeenCalledTimes(2);
});

it("does not let a late probe rejection replace a successful retry", async () => {
    const old = deferred();
    bridge.supported.mockReturnValueOnce(old.promise).mockResolvedValueOnce(true);
    const vault = await import("@/lib/ai/vault");
    const first = vault.vaultAvailable();
    await vi.waitFor(() => expect(bridge.supported).toHaveBeenCalledTimes(1));
    vault.refreshVaultAvailability();
    await expect(vault.vaultAvailable()).resolves.toBe(true);
    old.reject(new Error("stale failure"));
    await expect(first).resolves.toBe(true);
    await expect(vault.vaultAvailable()).resolves.toBe(true);
});
