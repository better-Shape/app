import { describe, expect, it } from "vitest";
import { mergeSettingsHydration } from "@/lib/settings/hydration";

function settings() {
    return {
        editor: { fontSize: 14, wordWrap: "off" },
        ai: { providers: {
            connections: {
                openai: { apiKey: "", baseUrl: "https://visible.invalid", headers: {}, models: [] as string[] },
                anthropic: { apiKey: "", baseUrl: "", headers: {}, models: [] as string[] },
            },
            services: { search: { provider: "none", apiKey: "" } },
        } },
        folders: ["before"],
    };
}

describe("settings hydration", () => {
    it("loads unrelated saved fields while retaining edits to the same section", () => {
        const before = settings(); const live = structuredClone(before); const incoming = settings();
        live.editor.fontSize = 19;
        incoming.editor = { fontSize: 22, wordWrap: "on" };
        incoming.ai.providers.connections.anthropic.apiKey = "example-saved";
        const result = mergeSettingsHydration(before, live, incoming);
        expect(result.editor).toEqual({ fontSize: 19, wordWrap: "on" });
        expect(result.ai.providers.connections.anthropic.apiKey).toBe("example-saved");
        expect(before.editor.fontSize).toBe(14);
        expect(incoming.editor.fontSize).toBe(22);
    });

    it("keeps a locally edited key with its visible endpoint and headers", () => {
        const before = settings(); const live = structuredClone(before); const incoming = settings();
        live.ai.providers.connections.openai.apiKey = "example-edit";
        incoming.ai.providers.connections.openai.baseUrl = "https://disk.invalid";
        incoming.ai.providers.connections.openai.headers = { tenant: "disk-tenant" };
        const result = mergeSettingsHydration(before, live, incoming);
        expect(result.ai.providers.connections.openai).toEqual(live.ai.providers.connections.openai);
    });

    it("does not bring a disk credential into a locally edited service provider", () => {
        const before = settings(); const live = structuredClone(before); const incoming = settings();
        live.ai.providers.services.search.provider = "tavily";
        incoming.ai.providers.services.search = { provider: "brave", apiKey: "example-brave" };
        expect(mergeSettingsHydration(before, live, incoming).ai.providers.services.search).toEqual({ provider: "tavily", apiKey: "" });
    });

    it("takes incoming arrays unless their contents changed locally", () => {
        const before = settings(); const live = structuredClone(before); const incoming = settings();
        incoming.folders = ["saved"];
        expect(mergeSettingsHydration(before, live, incoming).folders).toEqual(["saved"]);
        live.folders = [];
        expect(mergeSettingsHydration(before, live, incoming).folders).toEqual([]);
    });

    it("preserves explicit removals and additions without merging removed fields back", () => {
        const before = { entries: { old: "before" } as Record<string, string> };
        const live = { entries: { added: "live" } };
        const incoming = { entries: { old: "disk", diskOnly: "saved" } };
        expect(mergeSettingsHydration(before, live, incoming)).toEqual({ entries: { added: "live", diskOnly: "saved" } });
    });
});

it("hydrates saved destination and model pins when only enabled changes locally", () => {
    const before = { ai: { providers: { connections: { openai: {
        enabled: true, apiKey: "", baseUrl: "", authStyle: "", headers: {}, models: [] as string[],
    } } } } };
    const live = structuredClone(before); live.ai.providers.connections.openai.enabled = false;
    const incoming = structuredClone(before);
    Object.assign(incoming.ai.providers.connections.openai, { apiKey: "example-saved", baseUrl: "https://saved.invalid", models: ["saved-model"] });
    expect(mergeSettingsHydration(before, live, incoming).ai.providers.connections.openai).toEqual({
        ...incoming.ai.providers.connections.openai, enabled: false,
    });
});
it("retains edited model pins without discarding an untouched saved endpoint", () => {
    const before = settings(); const live = structuredClone(before); const incoming = settings();
    live.ai.providers.connections.openai.models = ["local-model"];
    incoming.ai.providers.connections.openai.baseUrl = "https://saved.invalid";
    incoming.ai.providers.connections.openai.apiKey = "example-saved";
    expect(mergeSettingsHydration(before, live, incoming).ai.providers.connections.openai).toEqual({
        ...incoming.ai.providers.connections.openai, models: ["local-model"],
    });
});
it("pins an edited credential bundle without discarding saved model pins", () => {
    const before = settings(); const live = structuredClone(before); const incoming = settings();
    live.ai.providers.connections.openai.apiKey = "example-local";
    incoming.ai.providers.connections.openai.baseUrl = "https://saved.invalid";
    incoming.ai.providers.connections.openai.headers = { tenant: "example-saved-header" };
    incoming.ai.providers.connections.openai.models = ["saved-model"];
    expect(mergeSettingsHydration(before, live, incoming).ai.providers.connections.openai).toEqual({
        ...live.ai.providers.connections.openai, models: ["saved-model"],
    });
});
it("does not inject a credential field absent from the locally edited bundle", () => {
    const before = { ai: { providers: { connections: { custom: { baseUrl: "https://first.invalid" } } } } };
    const live = structuredClone(before); live.ai.providers.connections.custom.baseUrl = "https://second.invalid";
    const incoming = { ai: { providers: { connections: { custom: { baseUrl: "https://saved.invalid", apiKey: "example-saved" } } } } };
    expect(mergeSettingsHydration(before, live, incoming).ai.providers.connections.custom).toEqual(live.ai.providers.connections.custom);
});
it.each([
    { baseUrl: "https://local.invalid" },
    { headers: { tenant: "example-local-header" } },
    { authStyle: "api-key" },
])("does not import saved credentials after a local routing edit: %j", patch => {
    const before = settings(); const live = structuredClone(before); const incoming = settings();
    Object.assign(live.ai.providers.connections.openai, patch);
    incoming.ai.providers.connections.openai.apiKey = "example-saved";
    incoming.ai.providers.connections.openai.models = ["saved-model"];
    const result = mergeSettingsHydration(before, live, incoming);
    expect(result.ai.providers.connections.openai).toEqual({
        ...live.ai.providers.connections.openai, models: ["saved-model"],
    });
    expect(incoming.ai.providers.connections.openai.apiKey).toBe("example-saved");
    expect(live.ai.providers.connections.openai.models).toEqual([]);
});
it.each([
    ["search", "provider", "tavily"], ["search", "apiKey", "example-local"],
    ["composio", "userId", "local-account"], ["composio", "apiKey", "example-local"],
])("keeps the %s credential bundle paired after editing %s", (service, field, value) => {
    const services: Record<string, Record<string, string>> = {
        search: { provider: "brave", apiKey: "" }, composio: { userId: "first-account", apiKey: "" },
    };
    const before = { ai: { providers: { services } } };
    const live = structuredClone(before); const incoming = structuredClone(before);
    live.ai.providers.services[service][field] = value;
    incoming.ai.providers.services.search = { provider: "tavily", apiKey: "example-saved-search" };
    incoming.ai.providers.services.composio = { userId: "saved-account", apiKey: "example-saved-composio" };
    const merged = mergeSettingsHydration(before, live, incoming);
    expect(merged.ai.providers.services[service]).toEqual(live.ai.providers.services[service]);
    const other = service === "search" ? "composio" : "search";
    expect(merged.ai.providers.services[other]).toEqual(incoming.ai.providers.services[other]);
});

it("keeps an unknown service's edited key paired with its existing destination without creating absent fields", () => {
    const before = { ai: { providers: { services: { future: { apiKey: "", provider: "old", preference: "before" } } } } };
    const live = structuredClone(before); live.ai.providers.services.future.apiKey = "example-local";
    const incoming = structuredClone(before);
    incoming.ai.providers.services.future = { apiKey: "example-saved", provider: "other", preference: "saved" };
    expect(mergeSettingsHydration(before, live, incoming).ai.providers.services.future).toEqual({
        apiKey: "example-local", provider: "old", preference: "saved",
    });
});
it("keeps an unknown service's edited account from importing a saved credential", () => {
    const before = { ai: { providers: { services: { future: { apiKey: "", userId: "before" } } } } };
    const live = structuredClone(before); live.ai.providers.services.future.userId = "local-account";
    const incoming = structuredClone(before); incoming.ai.providers.services.future.apiKey = "example-saved";
    expect(mergeSettingsHydration(before, live, incoming).ai.providers.services.future).toEqual(live.ai.providers.services.future);
});

it("projects only known or changed overlay fields while a legacy source is unreadable", async () => {
    const { projectSettingsOverlay } = await import("@/lib/settings/hydration");
    const defaults = { editor: { fontSize: 14, tabSize: 4 }, folders: ["default"], entries: { retained: 1 } };
    const live = { editor: { fontSize: 22, tabSize: 4 }, folders: ["default"], entries: { added: 2 } };
    expect(projectSettingsOverlay(defaults, live, undefined)).toEqual({ editor: { fontSize: 22 }, entries: { added: 2 } });
    expect(projectSettingsOverlay(defaults, live, { editor: { tabSize: 8 }, folders: [], entries: { removed: 3 } })).toEqual({
        editor: { fontSize: 22, tabSize: 4 }, folders: ["default"], entries: { added: 2 },
    });
});

it("merges sparse structural fields without making dynamic maps or arrays undeletable", async () => {
    const { mergeSettingsOverlay, projectSettingsOverlay } = await import("@/lib/settings/hydration");
    const defaults = { editor: { fontSize: 14, tabSize: 4 }, approvals: {}, folders: [] };
    const live = { editor: { fontSize: 22, tabSize: 8 }, approvals: { obsolete: true }, folders: ["old"] };
    expect(mergeSettingsOverlay(defaults, live, { editor: { fontSize: 29 }, approvals: {}, folders: [] })).toEqual({
        editor: { fontSize: 29, tabSize: 8 }, approvals: {}, folders: [],
    });
    expect(projectSettingsOverlay(defaults, { ...live, approvals: { replacement: false } }, { approvals: { obsolete: true } })).toEqual({
        editor: { fontSize: 22, tabSize: 8 }, approvals: { replacement: false }, folders: ["old"],
    });
});
