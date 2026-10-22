import { describe, expect, it } from "vitest";
import {
    COMPOSIO_SECRET_ID,
    PROVIDER_PRESETS,
    SEARCH_SECRET_ID,
    defaultProvidersSettings,
    embeddingModelOptions,
    embeddingsAvailable,
    embeddingProviders,
    embeddingsTarget,
    keyFormatWarning,
    keyOwnerHint,
    maskApiKey,
    mergeProviderConnections,
    modelIdsFor,
    modelsWithProviderPrefix,
    providerSecrets,
    redactProviderSecrets,
    searchKeyWarning,
    stripProviderPrefix,
    toRustAiConfig,
    type ProviderId,
    type ProvidersSettings,
} from "@/lib/ai/providers";

function withKey(id: ProviderId, apiKey: string, extra?: Partial<{ baseUrl: string; models: string[] }>) {
    const settings = defaultProvidersSettings();
    settings.connections[id] = {
        ...settings.connections[id],
        apiKey,
        ...extra,
    };
    return settings;
}

describe("secret handling", () => {
    it("collects every secret under its keychain id", () => {
        const settings = withKey("openai", "sk-live-openai");
        settings.connections.anthropic.apiKey = "sk-ant-live";
        settings.services.search = { provider: "tavily", apiKey: "tvly-live" };
        settings.services.composio = { apiKey: "ck-live", userId: "me" };

        expect(providerSecrets(settings)).toEqual({
            openai: "sk-live-openai",
            anthropic: "sk-ant-live",
            [SEARCH_SECRET_ID]: "tvly-live",
            [COMPOSIO_SECRET_ID]: "ck-live",
        });
    });

    it("strips secrets for storage without touching anything else", () => {
        const settings = withKey("openrouter", "sk-or-live", { models: ["openrouter/openai/gpt-5"] });
        settings.services.search = { provider: "brave", apiKey: "BSA-live" };
        const stored = redactProviderSecrets({
            ...{ unrelated: true },
            ai: { providers: settings },
        });

        expect(providerSecrets(stored.ai.providers)).toEqual({});
        expect(stored.ai.providers.connections.openrouter.models).toEqual([
            "openrouter/openai/gpt-5",
        ]);
        expect(stored.ai.providers.services.search.provider).toBe("brave");
        expect(stored.unrelated).toBe(true);
    });

    it("keeps live keys when the stored copy has none", () => {
        const live = withKey("openai", "sk-live");
        live.services.composio = { apiKey: "ck-live", userId: "me" };
        const loaded = redactProviderSecrets({ ai: { providers: live } }).ai.providers;
        loaded.defaultModel = "openai/gpt-5";

        const merged = mergeProviderConnections(live, loaded);

        expect(merged.connections.openai.apiKey).toBe("sk-live");
        expect(merged.services.composio.apiKey).toBe("ck-live");
        expect(merged.defaultModel).toBe("openai/gpt-5");
    });

    it("lets a stored key replace the live one when present", () => {
        const live = withKey("openai", "sk-old");
        const loaded: ProvidersSettings = {
            ...withKey("openai", "sk-new"),
        };
        expect(mergeProviderConnections(live, loaded).connections.openai.apiKey).toBe("sk-new");
    });
});

describe("key sanity checks", () => {
    it("names the provider a key belongs to", () => {
        expect(keyOwnerHint("sk-ant-api03-abcdefghijkl")?.id).toBe("anthropic");
        expect(keyOwnerHint("sk-or-v1-abcdefghijkl")?.id).toBe("openrouter");
        expect(keyOwnerHint("gsk_abcdefghijklmnop")?.id).toBe("groq");
        expect(keyOwnerHint("AIzaSyabcdefghijklmno")?.id).toBe("google");
        // `sk-` alone is shared by OpenAI, DeepSeek and gateways.
        expect(keyOwnerHint("sk-abcdefghijklmnop")).toBeNull();
        expect(keyOwnerHint("sk-short")).toBeNull();
    });

    it("warns when a key is pasted into the wrong card", () => {
        expect(keyFormatWarning("openai", "sk-or-v1-abcdefghijkl")).toContain("OpenRouter");
        expect(keyFormatWarning("anthropic", "sk-ant-api03-abcdefghijkl")).toBeNull();
        expect(keyFormatWarning("anthropic", "sk-plainvalue123456")).toContain("sk-ant-");
        expect(keyFormatWarning("deepseek", "sk-anything-goes-here")).toBeNull();
        expect(keyFormatWarning("custom", "whatever-local-key")).toBeNull();
        expect(keyFormatWarning("openai", "")).toBeNull();
    });

    it("checks the search keys too", () => {
        expect(searchKeyWarning("tavily", "tvly-dev-123")).toBeNull();
        expect(searchKeyWarning("tavily", "sk-wrong")).toContain("tvly-");
        expect(searchKeyWarning("brave", "BSA-xyz")).toBeNull();
        expect(searchKeyWarning("none", "anything")).toBeNull();
    });

    it("masks a key without losing the edges", () => {
        expect(maskApiKey("sk-ant-api03-abcdefghijkl")).toBe("sk-ant…ijkl");
        expect(maskApiKey("short")).toBe("sh…");
        expect(maskApiKey("")).toBe("");
    });
});

describe("embeddings routing", () => {
    it("ignores OpenAI-wire providers that cannot embed", () => {
        const groqOnly = withKey("groq", "gsk_live");
        expect(embeddingsAvailable(groqOnly)).toBe(false);
        expect(embeddingProviders(groqOnly)).toEqual([]);
        expect(embeddingsTarget(groqOnly)).toBeNull();
        // Regression: the Rust side then receives no model id at all.
        expect(toRustAiConfig(groqOnly).embeddingModel).toBe("");
    });

    it("uses the known default for OpenAI and OpenRouter", () => {
        const openai = withKey("openai", "sk-live");
        expect(embeddingsTarget(openai)).toEqual({ id: "openai", model: "text-embedding-3-small" });
        expect(embeddingModelOptions(openai)).toEqual([
            "text-embedding-3-small",
            "text-embedding-3-large",
        ]);

        const openrouter = withKey("openrouter", "sk-or-live");
        expect(embeddingsTarget(openrouter)).toEqual({
            id: "openrouter",
            model: "openai/text-embedding-3-small",
        });
    });

    it("requires a model id for runtimes that bring their own", () => {
        const custom = withKey("custom", "", { baseUrl: "http://127.0.0.1:11434/v1" });
        custom.connections.custom.enabled = true;
        // A local runtime is usable, but without a model id there is nothing to
        // call — so the index stays off until one is named.
        expect(embeddingModelOptions(custom)).toEqual([]);
        expect(embeddingsTarget(custom)).toBeNull();
        expect(embeddingsAvailable(custom)).toBe(false);

        custom.embeddingModel = "nomic-embed-text";
        expect(embeddingsTarget(custom)).toEqual({ id: "custom", model: "nomic-embed-text" });
        expect(embeddingsAvailable(custom)).toBe(true);
        expect(toRustAiConfig(custom).embeddingModel).toBe("nomic-embed-text");
    });

    it("honours an explicit choice on a provider without a default", () => {
        const groq = withKey("groq", "gsk_live");
        groq.embeddingModel = "my-embed";
        expect(embeddingsTarget(groq)).toEqual({ id: "groq", model: "my-embed" });
    });

    it("routes a vendor model to the connection that advertises it", () => {
        // OpenAI and Mistral are both usable, and the user picked Mistral's own
        // slug. Sending it to OpenAI 404s, so the pick must own the request.
        const settings = withKey("openai", "sk-live");
        settings.connections.mistral = { ...settings.connections.mistral, apiKey: "ms-live" };
        settings.embeddingModel = "mistral-embed";

        expect(embeddingsTarget(settings)).toEqual({ id: "mistral", model: "mistral-embed" });
        const payload = toRustAiConfig(settings);
        expect(payload.embeddingProvider).toBe("mistral");
        expect(payload.embeddingModel).toBe("mistral-embed");
    });

    it("keeps a shared model on the preferred provider", () => {
        // text-embedding-3-small is advertised by OpenAI and OpenRouter. With
        // both usable the pick stays OpenAI, which is the cheaper direct route.
        const settings = withKey("openai", "sk-live");
        settings.connections.openrouter = { ...settings.connections.openrouter, apiKey: "sk-or-live" };
        settings.embeddingModel = "text-embedding-3-small";

        expect(embeddingsTarget(settings)).toEqual({ id: "openai", model: "text-embedding-3-small" });
    });
});

describe("model discovery helpers", () => {
    it("prefixes discovered slugs with the provider id", () => {
        expect(modelsWithProviderPrefix("anthropic", ["claude-sonnet-4-5", " "])).toEqual([
            "anthropic/claude-sonnet-4-5",
        ]);
        expect(modelsWithProviderPrefix("openrouter", ["openai/gpt-5"])).toEqual([
            "openrouter/openai/gpt-5",
        ]);
        // Already-prefixed ids are left alone and duplicates collapse.
        expect(
            modelsWithProviderPrefix("google", ["google/gemini-2.5-pro", "gemini-2.5-pro"]),
        ).toEqual(["google/gemini-2.5-pro"]);
    });

    it("round-trips prefixed ids back to extra-model slugs", () => {
        expect(stripProviderPrefix("openai", ["openai/gpt-5", "gpt-5", ""])).toEqual(["gpt-5"]);
    });

    it("imported models are pickable and routable", () => {
        const settings = withKey("openai", "sk-live");
        settings.connections.openai.models = modelsWithProviderPrefix("openai", [
            "gpt-5",
            "gpt-4.1-mini",
        ]);
        expect(modelIdsFor("openai", settings.connections)).toEqual([
            "openai/gpt-5",
            "openai/gpt-4.1-mini",
        ]);
    });
});

describe("preset registry", () => {
    it("keeps the preset list unique and fully defaulted", () => {
        const ids = PROVIDER_PRESETS.map((preset) => preset.id);
        expect(new Set(ids).size).toBe(ids.length);
        const defaults = defaultProvidersSettings();
        for (const id of ids) expect(defaults.connections[id]).toBeTruthy();
    });
});
