import { describe, expect, it } from "vitest";
import {
    catalogSize,
    enrichDiscoveredModels,
    formatModelPricing,
    getModelMetadata,
    listCatalogModels,
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
});
