import { describe, expect, it } from "vitest";
import {
    PROVIDER_PRESETS,
    availableModels,
    canonicalProviderId,
    defaultProvidersSettings,
    formatHeaderLines,
    headerSecretId,
    isConnectionUsable,
    matchesProviderQuery,
    mergeProviderConnections,
    parseHeaderLines,
    parseHeaderSecretId,
    providerAuthStyle,
    providerGroups,
    providerHeaders,
    providerPreset,
    providerSecrets,
    providersForModelNames,
    redactProviderSecrets,
    toRustAiConfig,
    translateModelId,
    type ProviderId,
    type ProvidersSettings,
} from "@/lib/ai/providers";

/** A settings object with one connection ready to route. */
function configured(id: ProviderId, patch: Partial<ProvidersSettings["connections"][ProviderId]> = {}) {
    const settings = defaultProvidersSettings();
    settings.connections[id] = { ...settings.connections[id], enabled: true, ...patch };
    return settings;
}

function connectionOf(settings: ProvidersSettings, id: ProviderId) {
    return settings.connections[id];
}

describe("keyless connections", () => {
    it("ships each preset in the state its preset asks for", () => {
        const settings = defaultProvidersSettings();
        for (const preset of PROVIDER_PRESETS) {
            expect(`${preset.id}:${settings.connections[preset.id].enabled}`).toBe(
                `${preset.id}:${preset.defaultEnabled ?? !preset.keyless}`,
            );
        }
        expect(isConnectionUsable("ollama", settings.connections)).toBe(false);
        expect(isConnectionUsable("custom", settings.connections)).toBe(false);
    });

    it("counts a keyless endpoint as usable once enabled, without a key", () => {
        const settings = configured("ollama");
        expect(isConnectionUsable("ollama", settings.connections)).toBe(true);
        expect(availableModels(settings).some((model) => model.providerId === "ollama")).toBe(true);
    });

    it("still refuses a keyed provider with no key", () => {
        const settings = configured("groq");
        expect(isConnectionUsable("groq", settings.connections)).toBe(false);
        settings.connections.groq.apiKey = "gsk_live";
        expect(isConnectionUsable("groq", settings.connections)).toBe(true);
    });

    it("keeps the OpenCode gateways keyed", () => {
        // Verified against the live gateway: free models answer 403 FreeTierError
        // for unattributable traffic, whatever headers it carries, so these need
        // the user's own Console/Go key.
        const settings = configured("zen");
        expect(isConnectionUsable("zen", settings.connections)).toBe(false);
        settings.connections.zen.apiKey = "oc_sk_live";
        expect(isConnectionUsable("zen", settings.connections)).toBe(true);

        const payload = toRustAiConfig(settings);
        const zen = payload.providers.find((provider) => provider.id === "zen");
        expect(zen).toMatchObject({ apiKey: "oc_sk_live", keyless: false });
    });

    it("lists OpenCode's free models, and the Go plan's", () => {
        const free = PROVIDER_PRESETS.find((preset) => preset.id === "zen")!.models.filter(
            (model) => model.name.includes("free"),
        );
        // The free roster rotates, so this asserts the shape rather than a
        // fixed list: they exist, they carry the Zen prefix, and they are free.
        expect(free.length).toBeGreaterThanOrEqual(8);
        for (const model of free) {
            expect(model.id.startsWith("zen/")).toBe(true);
        }
        const go = PROVIDER_PRESETS.find((preset) => preset.id === "zen-go")!;
        expect(go.baseUrl).toBe("https://opencode.ai/zen/go/v1");
        expect(go.models.some((model) => model.id === "zen-go/cat-jam-free")).toBe(true);
        // Every gateway preset addresses its own host.
        for (const id of ["zen", "zen-messages", "zen-go"] as const) {
            expect(providerPreset(id).baseUrl).toContain("opencode.ai");
            expect(providerPreset(id).keyless).toBeUndefined();
        }
    });
});

describe("request headers and auth", () => {
    it("merges preset headers with the connection's own, user first", () => {
        expect(providerHeaders("nvidia", connectionOf(defaultProvidersSettings(), "nvidia"))).toMatchObject({
            "X-BILLING-INVOKE-ORIGIN": "BetterShape",
        });

        const settings = configured("nvidia", {
            headers: { "X-Title": "mine", "X-Tenant": "acme" },
        });
        const headers = providerHeaders("nvidia", settings.connections.nvidia);
        expect(headers["X-Title"]).toBe("mine");
        expect(headers["X-Tenant"]).toBe("acme");
    });

    it("defaults the auth header per wire format and honours an override", () => {
        const settings = defaultProvidersSettings();
        expect(providerAuthStyle("openai", settings.connections.openai)).toBe("bearer");
        expect(providerAuthStyle("anthropic", settings.connections.anthropic)).toBe("x-api-key");
        expect(providerAuthStyle("google", settings.connections.google)).toBe("x-goog-api-key");
        expect(providerAuthStyle("azure", settings.connections.azure)).toBe("api-key");
        expect(providerAuthStyle("azure", { ...settings.connections.azure, authStyle: "bearer" })).toBe("bearer");
    });

    it("round-trips the header textarea format", () => {
        expect(parseHeaderLines("X-Tenant: acme\n\n# comment\nHTTP-Referer: https://x.test/\nbroken")).toEqual({
            "X-Tenant": "acme",
            "HTTP-Referer": "https://x.test/",
        });
        expect(formatHeaderLines({ A: "1", B: "2" })).toBe("A: 1\nB: 2");
    });

    it("pushes headers and auth style to Rust", () => {
        const settings = configured("azure", {
            apiKey: "az-key",
            baseUrl: "https://res.openai.azure.com/openai/v1",
        });
        const azure = toRustAiConfig(settings).providers.find((provider) => provider.id === "azure");
        expect(azure).toMatchObject({
            kind: "openai",
            authStyle: "api-key",
            keyless: false,
            headers: {},
        });
    });
});

describe("header values are secrets", () => {
    it("stores header values in the keychain beside the key", () => {
        const settings = configured("cloudflare-gateway", {
            baseUrl: "https://gateway.ai.cloudflare.com/v1/a/g/compat",
            headers: { "cf-aig-authorization": "Bearer gateway-token" },
        });
        const secrets = providerSecrets(settings);
        expect(secrets[headerSecretId("cloudflare-gateway", "cf-aig-authorization")]).toBe("Bearer gateway-token");
        expect(parseHeaderSecretId(headerSecretId("cloudflare-gateway", "cf-aig-authorization"))).toEqual({
            id: "cloudflare-gateway",
            name: "cf-aig-authorization",
        });
        expect(parseHeaderSecretId("service:search")).toBeNull();
    });

    it("redacts header values but keeps the names", () => {
        const settings = configured("nvidia", { headers: { "X-Tenant": "acme" } });
        const stored = redactProviderSecrets({ ai: { providers: settings } });
        expect(stored.ai.providers.connections.nvidia.headers).toEqual({ "X-Tenant": "" });
        expect(providerSecrets(stored.ai.providers)).toEqual({});
    });

    it("keeps in-memory header values when a redacted copy is loaded", () => {
        const live = configured("nvidia", { headers: { "X-Tenant": "acme" } });
        const loaded = redactProviderSecrets({ ai: { providers: live } });
        const merged = mergeProviderConnections(live, loaded.ai.providers);
        expect(merged.connections.nvidia.headers).toEqual({ "X-Tenant": "acme" });
    });
});

describe("model ids from other clients", () => {
    it("maps alias prefixes onto the providers this app ships", () => {
        expect(canonicalProviderId("gemini")).toBe("google");
        expect(canonicalProviderId("opencode-zen")).toBe("zen");
        expect(canonicalProviderId("nvidia-nim")).toBe("nvidia");
        expect(canonicalProviderId("kimi")).toBe("moonshot");
        expect(canonicalProviderId("lm-studio")).toBe("lmstudio");
        expect(canonicalProviderId("nope")).toBeNull();
        // Real ids are returned unchanged.
        expect(canonicalProviderId("zen")).toBe("zen");
    });

    it("rewrites a foreign model id onto ours", () => {
        expect(translateModelId("gemini/gemini-2.5-pro")).toBe("google/gemini-2.5-pro");
        expect(translateModelId("openai/gpt-5")).toBe("openai/gpt-5");
        expect(translateModelId("qwen3-coder")).toBe("qwen3-coder");
    });

    it("suggests providers for pasted model names", () => {
        const settings = defaultProvidersSettings();
        settings.connections.anthropic.apiKey = "sk-ant-live";
        settings.connections.openrouter.apiKey = "sk-or-live";
        settings.connections.together.apiKey = "tgp_v1_live";

        expect(providersForModelNames(["claude-3-7-sonnet"], settings.connections)).toEqual(["anthropic"]);
        // A display name that two providers can serve matches both.
        expect(providersForModelNames(["Claude Sonnet 4.5"], settings.connections)).toEqual([
            "anthropic",
            "openrouter",
        ]);
        // Namespaces differ between clients; the model is what matters.
        expect(providersForModelNames(["deepseek/DeepSeek-R1"], settings.connections)).toEqual(["together"]);
        // A provider the user has no key for is never suggested, and presets that
        // can serve anything are left alone.
        expect(providersForModelNames(["kimi-k2-0905-preview"], settings.connections)).toEqual([]);
        expect(providersForModelNames(["llama3.1"], settings.connections)).toEqual([]);
    });
});

describe("provider browsing", () => {
    it("groups every preset and searches names, ids and models", () => {
        const groups = providerGroups();
        expect(groups.map((group) => group.group)).toEqual([
            "Native APIs",
            "Gateways",
            "Providers",
            "Local",
        ]);
        expect(groups.flatMap((group) => group.presets)).toHaveLength(PROVIDER_PRESETS.length);

        expect(matchesProviderQuery(providerPreset("nvidia"), "nvidia")).toBe(true);
        expect(matchesProviderQuery(providerPreset("nvidia"), "deepseek-r1")).toBe(true);
        expect(matchesProviderQuery(providerPreset("nvidia"), "zzz")).toBe(false);
        expect(matchesProviderQuery(providerPreset("groq"), "")).toBe(true);
    });
});
