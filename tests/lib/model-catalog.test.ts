import { describe, expect, it, vi } from "vitest";
import {
    catalogSize,
    enrichDiscoveredModels,
    formatContextWindow,
    formatModelPricing,
    getModelMetadata,
    listCatalogModels,
    primeModelCatalog,
    refreshModelCatalog,
} from "@/lib/ai/model-catalog";

describe("model catalog", () => {
    it("loads the bundled snapshot", () => {
        expect(catalogSize()).toBeGreaterThan(200);
    });

    it("looks up known models with metadata", () => {
        const meta = getModelMetadata("openai/gpt-4o-mini");
        // Either found in snapshot or inferred — never throws.
        expect(meta.id).toContain("gpt-4o-mini");
        expect(meta.providerId).toBe("openai");
    });

    it("resolves bare slugs with a provider hint", () => {
        const meta = getModelMetadata("gpt-4o", "openai");
        expect(meta.providerId).toBe("openai");
    });

    it("returns inferred metadata for unknown ids", () => {
        const meta = getModelMetadata("custom/acme-internal-model-2026");
        expect(meta.source).toBe("inferred");
        expect(meta.providerId).toBe("custom");
        expect(meta.contextWindowLabel).toBe("");
    });

    it("lists models per provider", () => {
        const openai = listCatalogModels("openai");
        expect(openai.length).toBeGreaterThan(5);
        expect(openai.every((m) => m.providerId === "openai")).toBe(true);
    });

    it("enriches raw ids reported by a provider", () => {
        const models = enrichDiscoveredModels("openai", ["gpt-4o-mini", "gpt-4o", "text-embedding-3-small"]);
        expect(models.length).toBe(3);
        // Embedding model should be flagged nonChat.
        const embed = models.find((m) => m.slug === "text-embedding-3-small");
        expect(embed?.nonChat).toBe(true);
        // Known chat models carry context windows.
        const chat = models.find((m) => m.slug === "gpt-4o-mini");
        expect(chat?.contextWindow).toBeGreaterThan(0);
        expect(chat?.nonChat).toBeFalsy();
    });

    it("formats prices for display", () => {
        const free = getModelMetadata("some-free-thing");
        expect(formatModelPricing({ ...free, inputCostPerM: 0, outputCostPerM: 0 })).toBe("Free");
        const priced = getModelMetadata("some-priced");
        expect(formatModelPricing({ ...priced, inputCostPerM: 3, outputCostPerM: 15 })).toBe("$3.00 / $15.00");
        const subcent = getModelMetadata("cheap");
        expect(formatModelPricing({ ...subcent, inputCostPerM: 0.001, outputCostPerM: 0.003 })).toMatch(/\$0\.001/);
    });

    it("refreshModelCatalog resolves (may fall back to snapshot)", async () => {
        const result = await refreshModelCatalog();
        expect(result.models.length).toBeGreaterThan(200);
        expect(typeof result.fetchedAt).toBe("number");
        expect(typeof result.fromNetwork).toBe("boolean");
    });

    it("primeModelCatalog warms the bundled snapshot without network fetches in Browser Preview", () => {
        vi.useFakeTimers();
        const fetchSpy = vi.spyOn(globalThis, "fetch");
        const win = window as Window & { __BETTERSHAPE_PREVIEW__?: unknown };
        const previous = win.__BETTERSHAPE_PREVIEW__;
        win.__BETTERSHAPE_PREVIEW__ = { seed: "welcome", invokes: [] };
        try {
            primeModelCatalog();
            vi.advanceTimersByTime(15_000);
            expect(catalogSize()).toBeGreaterThan(200);
            expect(fetchSpy).not.toHaveBeenCalled();
        } finally {
            if (previous === undefined) {
                delete win.__BETTERSHAPE_PREVIEW__;
            } else {
                win.__BETTERSHAPE_PREVIEW__ = previous;
            }
            fetchSpy.mockRestore();
            vi.useRealTimers();
        }
    });

    it("snaps binary power-of-two context windows to clean tier labels and fetches OpenRouter catalog envelope", async () => {
        expect(formatContextWindow(131_072)).toBe("128K");
        expect(formatContextWindow(262_144)).toBe("256K");
        expect(formatContextWindow(524_288)).toBe("512K");
        expect(formatContextWindow(400_000)).toBe("400K");

        const sampleData = Array.from({ length: 210 }, (_entry, idx) => ({
            id: `openai/gpt-test-${idx}`,
            name: `OpenAI: GPT Test ${idx}`,
            context_length: 131_072,
        }));
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(JSON.stringify({ data: sampleData }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );
        try {
            const refreshed = await refreshModelCatalog();
            expect(fetchSpy).toHaveBeenCalledWith(
                "https://openrouter.ai/api/v1/models",
                expect.objectContaining({ cache: "no-cache" }),
            );
            expect(refreshed.fromNetwork).toBe(true);
            expect(refreshed.models.length).toBeGreaterThanOrEqual(210);
        } finally {
            if (typeof window !== "undefined") {
                window.localStorage.removeItem("bettershape.model-catalog.v2");
            }
            fetchSpy.mockRestore();
        }
    });
});
