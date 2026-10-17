import { describe, expect, it } from "vitest";
import { resolveChatModels, sanitizeEnabledModels, sanitizeSubagentModels, resolveSubagentDefaultModel, subagentModelsForSend, type ModelInfo } from "@/lib/settings/models";

function model(partial: Partial<ModelInfo> & Pick<ModelInfo, "id" | "name" | "provider">): ModelInfo {
    return {
        description: "",
        inputCost: 0,
        cachedInputCost: 0,
        outputCost: 0,
        contextWindow: "128K",
        releaseDate: "",
        ...partial,
    };
}

const list: ModelInfo[] = [
    model({ id: "auto", name: "Auto", provider: "Auto" }),
    model({ id: "openai/gpt-4o", name: "GPT-4o", provider: "OpenAI" }),
    model({ id: "anthropic/claude-sonnet-4.6", name: "Claude", provider: "Anthropic" }),
    model({ id: "anthropic/claude-opus-5", name: "Opus", provider: "Anthropic" }),
];

describe("resolveChatModels", () => {
    it("lists the catalog in order, Auto first, without adding models that are not in it", () => {
        const ids = resolveChatModels(list).map((m) => m.id);
        expect(ids).toEqual(["auto", "openai/gpt-4o", "anthropic/claude-sonnet-4.6", "anthropic/claude-opus-5"]);
    });
});

describe("sanitizeEnabledModels", () => {
    it("clears stale ids so the picker shows the full catalog", () => {
        expect(
            sanitizeEnabledModels(
                ["auto", "openai/gpt-4o-mini", "openai/gpt-4o"],
                ["auto", "anthropic/claude-sonnet-4.6", "openai/gpt-5.5"],
                ["auto"],
            ),
        ).toEqual([]);
    });

    it("treats a full catalog selection as all models", () => {
        expect(
            sanitizeEnabledModels(
                ["auto", "anthropic/claude-sonnet-4.6", "openai/gpt-5.5"],
                ["auto", "anthropic/claude-sonnet-4.6", "openai/gpt-5.5"],
            ),
        ).toEqual([]);
    });
});

describe("sanitizeSubagentModels", () => {
    it("defaults to Auto when empty or stale", () => {
        const catalog = ["auto", "anthropic/claude-opus-5.5", "google/gemini-3.8-flash"];
        expect(sanitizeSubagentModels([], catalog)).toEqual(["auto"]);
        expect(sanitizeSubagentModels(["gone/model"], catalog)).toEqual(["auto"]);
    });

    it("keeps an explicit cheap allowlist", () => {
        const catalog = ["auto", "anthropic/claude-opus-5.5", "google/gemini-3.8-flash"];
        expect(sanitizeSubagentModels(["auto", "google/gemini-3.8-flash"], catalog)).toEqual([
            "auto",
            "google/gemini-3.8-flash",
        ]);
        expect(resolveSubagentDefaultModel("anthropic/claude-opus-5.5", ["auto", "google/gemini-3.8-flash"])).toBe(
            "auto",
        );
    });
});

describe("subagentModelsForSend", () => {
    const catalog = ["auto", "anthropic/claude-opus-5.5", "google/gemini-3.8-flash"];

    it("keeps the enabled allowlist and its default model", () => {
        expect(
            subagentModelsForSend(["auto", "google/gemini-3.8-flash"], catalog, {
                defaultModel: "google/gemini-3.8-flash",
            }),
        ).toEqual({
            models: ["auto", "google/gemini-3.8-flash"],
            defaultModel: "google/gemini-3.8-flash",
        });
        expect(
            subagentModelsForSend(["auto", "anthropic/claude-opus-5.5"], catalog, {
                defaultModel: "anthropic/claude-opus-5.5",
            }),
        ).toEqual({
            models: ["auto", "anthropic/claude-opus-5.5"],
            defaultModel: "anthropic/claude-opus-5.5",
        });
    });

    it("falls back to Auto when the default model is not in the allowlist", () => {
        expect(
            subagentModelsForSend(["auto", "google/gemini-3.8-flash"], catalog, {
                defaultModel: "anthropic/claude-opus-5.5",
            }),
        ).toEqual({ models: ["auto", "google/gemini-3.8-flash"], defaultModel: "auto" });
        expect(subagentModelsForSend([], catalog, { defaultModel: "gone/model" })).toEqual({
            models: ["auto"],
            defaultModel: "auto",
        });
    });
});
