import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    aiVaultSupported: vi.fn(async () => true),
    aiLoadKeys: vi.fn(async () => [] as { id: string; apiKey: string }[]),
    aiStoreKey: vi.fn(async () => undefined),
    aiDeleteKey: vi.fn(async () => undefined),
}));
const { aiVaultSupported, aiLoadKeys, aiStoreKey, aiDeleteKey } = mocks;

vi.mock("@/lib/backend", () => ({ commands: mocks }));

import {
    __resetVaultCacheForTesting,
    __setVaultAvailableForTesting,
    readSecrets,
    vaultAvailable,
    writeSecret,
} from "@/lib/ai/vault";

describe("key vault", () => {
    beforeEach(() => {
        __resetVaultCacheForTesting();
        aiVaultSupported.mockReset().mockResolvedValue(true);
        aiLoadKeys.mockReset().mockResolvedValue([]);
        aiStoreKey.mockReset().mockResolvedValue(undefined);
        aiDeleteKey.mockReset().mockResolvedValue(undefined);
    });

    it("probes the keychain once per session", async () => {
        expect(await vaultAvailable()).toBe(true);
        expect(await vaultAvailable()).toBe(true);
        expect(aiVaultSupported).toHaveBeenCalledTimes(1);
    });

    it("treats a failing probe as no keychain", async () => {
        aiVaultSupported.mockRejectedValueOnce(new Error("no bridge"));
        expect(await vaultAvailable()).toBe(false);
        expect(await writeSecret("openai", "sk-live")).toBe(false);
        expect(aiStoreKey).not.toHaveBeenCalled();
    });

    it("reads stored secrets keyed by id", async () => {
        aiLoadKeys.mockResolvedValueOnce([
            { id: "openai", apiKey: "sk-live" },
            { id: "service:search", apiKey: "  " },
        ]);
        expect(await readSecrets(["openai", "service:search"])).toEqual({ openai: "sk-live" });
    });

    it("skips writes that already succeeded", async () => {
        await writeSecret("openai", "sk-live");
        await writeSecret("openai", "sk-live");
        expect(aiStoreKey).toHaveBeenCalledTimes(1);
        expect(aiStoreKey).toHaveBeenCalledWith("openai", "sk-live");

        // A different value is written again.
        await writeSecret("openai", "sk-next");
        expect(aiStoreKey).toHaveBeenCalledTimes(2);
    });

    it("clears a key instead of storing an empty string", async () => {
        await writeSecret("openai", "sk-live");
        await writeSecret("openai", "");
        expect(aiStoreKey).toHaveBeenCalledTimes(1);
        expect(aiDeleteKey).toHaveBeenCalledWith("openai");
    });

    it("retries a failed write on the next change", async () => {
        aiStoreKey.mockRejectedValueOnce(new Error("locked"));
        expect(await writeSecret("openai", "sk-live")).toBe(false);
        expect(await writeSecret("openai", "sk-live")).toBe(true);
        expect(aiStoreKey).toHaveBeenCalledTimes(2);
    });

    it("never reads the keychain when it is unavailable", async () => {
        __setVaultAvailableForTesting(false);
        expect(await readSecrets(["openai"])).toEqual({});
        expect(aiLoadKeys).not.toHaveBeenCalled();
    });
});
