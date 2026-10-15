import { describe, expect, it } from "vitest";
import fixtures from "../fixtures/credential-scopes.json";
import { credentialScopes, defaultProvidersSettings, mergeProviderConnections, normalizeProvidersSettings } from "@/lib/ai/providers";

describe("credential destinations", () => {
    it.each(fixtures)("matches the shared native wire fixture for $provider.id", ({ provider, scope }) => {
        const base = defaultProvidersSettings();
        const settings = normalizeProvidersSettings({ ...base, connections: {
            ...base.connections, [provider.id]: { ...base.connections.openai, ...provider },
        } });
        expect(credentialScopes(settings)[provider.id]).toBe(scope);
    });

    it.each([
        [" https://example.com/v1/// ", "https://example.com/v1"],
        ["https://example.com/" + "/".repeat(8192) + "tenant///", "https://example.com/" + "/".repeat(8192) + "tenant"],
        ["https://example.com/v1" + "/".repeat(8192), "https://example.com/v1"],
        ["////", ""],
    ])("normalizes only terminal URL slashes (case %#)", (url, expected) => {
        const settings = defaultProvidersSettings();
        settings.connections.openai.baseUrl = url;
        expect(JSON.parse(credentialScopes(settings).openai)[2]).toBe(expected);
    });

    it("includes path, query, authentication style, search provider and Composio account", () => {
        const settings = defaultProvidersSettings();
        const first = credentialScopes(settings);
        settings.connections.openai.baseUrl = "https://api.openai.com/v1/other?tenant=2";
        settings.connections.anthropic.authStyle = "bearer";
        settings.services.search.provider = "brave";
        settings.services.composio.userId = "other-account";
        const next = credentialScopes(settings);
        for (const id of ["openai", "anthropic", "service:search", "service:composio"]) expect(next[id]).not.toBe(first[id]);
        expect(next["service:search"]).toBe('["search-v1","brave"]');
        expect(next["service:composio"]).toBe('["composio-v1","other-account"]');
    });

    it("does not include secret values or model selection in a destination", () => {
        const settings = defaultProvidersSettings();
        const first = credentialScopes(settings).openai;
        settings.connections.openai.apiKey = "example-secret";
        settings.connections.openai.headers.Authorization = "example-header";
        settings.connections.openai.models = ["changed-model"];
        const next = credentialScopes(settings);
        expect(next.openai).toBe(first);
        expect(next["header:openai:Authorization"]).toBe(first);
        expect(JSON.stringify(next)).not.toContain("example-");
    });

    it("keeps live credentials paired with their destination on an external settings update", () => {
        const live = defaultProvidersSettings();
        live.connections.openai.apiKey = "example-live";
        live.connections.custom.headers.Authorization = "example-header";
        live.services.search = { provider: "brave", apiKey: "example-search" };
        live.services.composio = { userId: "first", apiKey: "example-composio" };
        const incoming = defaultProvidersSettings();
        incoming.connections.openai.baseUrl = "https://other.invalid/v1";
        incoming.connections.custom.baseUrl = "https://other.invalid/v1";
        incoming.services.search.provider = "tavily";
        incoming.services.composio.userId = "second";
        const merged = mergeProviderConnections(live, incoming);
        expect(merged.connections.openai).toEqual(live.connections.openai);
        expect(merged.connections.custom).toEqual(live.connections.custom);
        expect(merged.services).toEqual(live.services);
    });
});

it("retains a live credential bundle without dropping unrelated incoming model choices", () => {
    const live = defaultProvidersSettings();
    live.connections.openai.apiKey = "example-live";
    live.connections.openai.headers = { tenant: "example-live-header" };
    const incoming = defaultProvidersSettings();
    incoming.connections.openai.baseUrl = "https://other.invalid/v1";
    incoming.connections.openai.models = ["saved-model"];
    incoming.connections.openai.enabled = false;
    const merged = mergeProviderConnections(live, incoming);
    expect(merged.connections.openai).toEqual({
        ...live.connections.openai, models: ["saved-model"], enabled: false,
    });
    expect(credentialScopes(merged).openai).toBe(credentialScopes(live).openai);
});
