import type { AiVaultReadResult } from "@/lib/backend/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNativeVault, type VaultMutation } from "../helpers/native-vault";
const native = createNativeVault();

const mocks = vi.hoisted(() => ({
    aiVaultSupported: vi.fn(async () => true),
    aiLoadKeys: vi.fn<(ids: string[]) => Promise<AiVaultReadResult[]>>(),
    aiStoreKey: vi.fn<(id: string, value: string, expected: string, scope?: string) => Promise<VaultMutation>>(),
    aiDeleteKey: vi.fn<(id: string, expected: string) => Promise<VaultMutation>>(),
}));
const { aiVaultSupported, aiLoadKeys, aiStoreKey, aiDeleteKey } = mocks;

vi.mock("@/lib/backend", () => ({ commands: mocks }));

import {
    __resetVaultCacheForTesting,
    __setVaultAvailableForTesting,
    readSecrets,
    readSecretsDetailed,
    vaultAvailable,
    writeSecret,
    recordSecretChanges,
    hasUnvalidatedSecretIntent,
} from "@/lib/ai/vault";

describe("key vault", () => {
    beforeEach(() => {
        __resetVaultCacheForTesting();
        localStorage.clear(); native.reset();
        aiVaultSupported.mockReset().mockResolvedValue(true);
        aiLoadKeys.mockReset().mockImplementation(async (ids) => ids.map(native.read));
        aiStoreKey.mockReset().mockImplementation(async (id, value, expected, scope) => native.mutate(id, value, expected, true, scope));
        aiDeleteKey.mockReset().mockImplementation(async (id, expected) => native.mutate(id, "", expected));
    });

    it("does not replace a known lease with an unreadable placeholder", async () => {
        native.mutate("openai", "example-existing", "initial");
        await readSecrets(["openai"]);
        aiLoadKeys.mockResolvedValueOnce([{ status: "unavailable", id: "openai" }]);
        const result = await readSecretsDetailed(["openai"]);
        expect(result.values).toEqual({});
        expect(result.unavailable).toEqual(new Set(["openai"]));
        expect(result.persisted).toBe(false);
        expect(await writeSecret("openai", "example-new", "test-scope")).toBe(true);
        expect(aiStoreKey).toHaveBeenLastCalledWith("openai", "example-new", "revision-1", "test-scope");
    });

    it("does not report omitted read results as durable empty credentials", async () => {
        aiLoadKeys.mockResolvedValueOnce([]);
        const result = await readSecretsDetailed(["openai"]);
        expect(result.unavailable).toEqual(new Set(["openai"]));
        expect(result.persisted).toBe(false);
    });

    it.each([
        ["stored", "example-stored", false],
        ["deleted", "", false],
        ["write", "example-pending", true],
        ["delete", "", true],
        ["stored", "", true],
        ["deleted", "example-not-deleted", true],
    ])("validates only a durable matching %s intent after reload", async (state, value, unvalidated) => {
        localStorage.setItem("bettershape-ai-vault-entry:openai", JSON.stringify({ state, token: "previous-session" }));
        native.mutate("openai", value, "initial", true, "test-scope");
        expect(hasUnvalidatedSecretIntent("openai")).toBe(true);
        await readSecretsDetailed(["openai"]);
        expect(hasUnvalidatedSecretIntent("openai")).toBe(unvalidated);
        expect(aiStoreKey).not.toHaveBeenCalled();
    });

    it("does not validate a foreign intent that changes while a stored read is pending", async () => {
        localStorage.setItem("bettershape-ai-vault-entry:openai", JSON.stringify({ state: "stored", token: "before" }));
        native.mutate("openai", "example-stored", "initial", true, "test-scope");
        aiLoadKeys.mockImplementationOnce(async () => {
            localStorage.setItem("bettershape-ai-vault-entry:openai", JSON.stringify({ state: "stored", token: "after" }));
            return [native.read("openai")];
        });
        await readSecretsDetailed(["openai"]);
        expect(hasUnvalidatedSecretIntent("openai")).toBe(true);
    });

    it("does not validate a stored intent from an unavailable or session-only read", async () => {
        localStorage.setItem("bettershape-ai-vault-entry:openai", JSON.stringify({ state: "stored", token: "previous-session" }));
        aiLoadKeys.mockResolvedValueOnce([{ status: "unavailable", id: "openai" }]);
        await readSecretsDetailed(["openai"]);
        expect(hasUnvalidatedSecretIntent("openai")).toBe(true);
        native.mutate("openai", "example-unsaved", "initial", false, "test-scope");
        await readSecretsDetailed(["openai"]);
        expect(hasUnvalidatedSecretIntent("openai")).toBe(true);
    });

    it("does not invent a pending intent for a key without inventory", async () => {
        native.mutate("openai", "example-stored", "initial", true, "test-scope");
        expect(hasUnvalidatedSecretIntent("openai")).toBe(false);
        await readSecretsDetailed(["openai"]);
        expect(hasUnvalidatedSecretIntent("openai")).toBe(false);
    });

    it("probes the keychain once per session", async () => {
        expect(await vaultAvailable()).toBe(true);
        expect(await vaultAvailable()).toBe(true);
        expect(aiVaultSupported).toHaveBeenCalledTimes(1);
    });

    it("treats a failing probe as no keychain", async () => {
        aiVaultSupported.mockRejectedValueOnce(new Error("no bridge"));
        expect(await vaultAvailable()).toBe(false);
        expect(await writeSecret("openai", "sk-live", "test-scope")).toBe(false);
        expect(aiStoreKey).not.toHaveBeenCalled();
    });

    it("reads stored secrets keyed by id", async () => {
        aiLoadKeys.mockResolvedValueOnce([
            { status: "available", id: "openai", apiKey: "sk-live", revision: "initial", persisted: true },
            { status: "available", id: "service:search", apiKey: "  ", revision: "initial", persisted: true },
        ]);
        expect(await readSecrets(["openai", "service:search"])).toEqual({ openai: "sk-live" });
    });

    it("validates repeated values against the native lease rather than trusting a local cache", async () => {
        await writeSecret("openai", "sk-live", "test-scope");
        await writeSecret("openai", "sk-live", "test-scope");
        expect(aiStoreKey).toHaveBeenCalledTimes(2);
        expect(aiStoreKey).toHaveBeenCalledWith("openai", "sk-live", "initial", "test-scope");

        // A different value is written again.
        await writeSecret("openai", "sk-next", "test-scope");
        expect(aiStoreKey).toHaveBeenCalledTimes(3);
    });

    it("clears a key instead of storing an empty string", async () => {
        await writeSecret("openai", "sk-live", "test-scope");
        await writeSecret("openai", "");
        expect(aiStoreKey).toHaveBeenCalledTimes(1);
        expect(aiDeleteKey).toHaveBeenCalledWith("openai", expect.any(String));
    });

    it("retries a failed write on the next change", async () => {
        aiStoreKey.mockRejectedValueOnce(new Error("locked"));
        expect(await writeSecret("openai", "sk-live", "test-scope")).toBe(false);
        expect(await writeSecret("openai", "sk-live", "test-scope")).toBe(true);
        expect(aiStoreKey).toHaveBeenCalledTimes(2);
    });

    it("never reads the keychain when it is unavailable", async () => {
        __setVaultAvailableForTesting(false);
        expect(await readSecrets(["openai"])).toEqual({});
        expect(aiLoadKeys).not.toHaveBeenCalled();
    });

    it("keeps a foreign intent unvalidated when an older native write acknowledges", async () => {
        recordSecretChanges({ openai: "example-first" });
        expect(hasUnvalidatedSecretIntent("openai")).toBe(true);
        await writeSecret("openai", "example-first", "test-scope");
        expect(hasUnvalidatedSecretIntent("openai")).toBe(false);
        recordSecretChanges({ openai: "example-second" });
        let finish!: () => void;
        aiStoreKey.mockImplementationOnce((id, value, expected, scope) => new Promise(resolve => {
            finish = () => resolve(native.mutate(id, value, expected, true, scope));
        }));
        const pending = writeSecret("openai", "example-second", "test-scope");
        await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
        localStorage.setItem("bettershape-ai-vault-entry:openai", JSON.stringify({ state: "write", token: "another-window-intent" }));
        finish(); await pending;
        expect(hasUnvalidatedSecretIntent("openai")).toBe(true);
    });

});
