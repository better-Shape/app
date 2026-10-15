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
