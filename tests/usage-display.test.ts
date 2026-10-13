import { describe, expect, it } from "vitest";
import {
    LAST_TURN_TTL_MS,
    formatMessageModelLabel,
    formatMessageUsageLine,
    formatModelLabel,
    isAutoModelId,
    resolveChatUsageDisplay,
} from "@/lib/chat/usage-display";

describe("usage-display", () => {
    it("detects auto models", () => {
        expect(isAutoModelId("auto")).toBe(true);
        expect(isAutoModelId("openrouter/auto")).toBe(true);
        expect(isAutoModelId("anthropic/claude-sonnet-4")).toBe(false);
    });

    it("formats model labels", () => {
        expect(formatModelLabel("auto")).toBe("Auto");
        expect(formatModelLabel("openrouter/auto")).toBe("Auto");
        expect(formatModelLabel("anthropic/claude-sonnet-4")).toBe("Claude Sonnet 4");
        expect(formatModelLabel("")).toBe("");
        expect(formatModelLabel(null)).toBe("");
    });

    it("shows Auto when Auto was selected, otherwise the concrete model name", () => {
        expect(
            formatMessageModelLabel("google/gemini-2.5-flash", { usedAuto: true }),
        ).toBe("Auto");
        expect(formatMessageModelLabel("auto", { usedAuto: true })).toBe("Auto");
        expect(formatMessageModelLabel("anthropic/claude-sonnet-4", { usedAuto: false })).toBe(
            "Claude Sonnet 4",
        );
        expect(formatMessageModelLabel("deepseek/deepseek-v4-flash", { usedAuto: false })).toBe(
            "Deepseek V4 Flash",
        );
    });

    it("formats auto usage lines as token counts, not a client-side pool percent", () => {
        expect(
            formatMessageUsageLine(
                { usedAuto: true, autoPercent: 42, tokens: 1200 },
                "openrouter/auto",
            ),
        ).toBe("1,200");
        expect(
            formatMessageUsageLine({ usedAuto: true, tokens: 100_000 }, "auto"),
        ).toBe("100,000");
        expect(formatMessageUsageLine({ usedAuto: true }, "auto")).toBe("");
    });

    it("joins the fields it has and omits empty ones", () => {
        expect(formatMessageUsageLine(undefined, "anthropic/claude-sonnet-4")).toBe("");
        expect(formatMessageUsageLine({}, "anthropic/claude-sonnet-4")).toBe("");
        expect(
            formatMessageUsageLine(
                { tokens: 3400, inputTokens: 3000, outputTokens: 400 },
                "anthropic/claude-sonnet-4",
            ),
        ).toBe("3,400 · 3,000 · 400");
    });

    it("splits usage into separate rows and omits empty fields", async () => {
        const { formatMessageUsageRows } = await import("@/lib/chat/usage-display");
        expect(
            formatMessageUsageRows(
                { usedAuto: true, tokens: 100_000, inputTokens: 80_000, outputTokens: 20_000 },
                "auto",
            ),
        ).toEqual([
            { label: "Tokens", value: "100,000" },
            { label: "Input", value: "80,000" },
            { label: "Output", value: "20,000" },
        ]);
        expect(formatMessageUsageRows({ usedAuto: true }, "auto")).toEqual([]);
        expect(formatMessageUsageRows(undefined, "auto")).toEqual([]);
    });

    const NOW = 1_700_000_000_000;

    it("keeps the ring empty until a turn finishes", () => {
        expect(resolveChatUsageDisplay("auto", null)).toMatchObject({
            mode: "tokens",
            percent: 0,
            title: "",
            tooltip: "Token usage appears after the first reply",
        });
        expect(
            resolveChatUsageDisplay(
                "openai/gpt-5",
                { tokens: 0, inputTokens: 0, usedAuto: false, at: NOW },
                NOW,
            ),
        ).toMatchObject({ percent: 0, title: "" });
    });

    it("measures the last turn against the model's context window", () => {
        expect(
            resolveChatUsageDisplay(
                "openai/gpt-5",
                {
                    tokens: 40_000,
                    inputTokens: 38_000,
                    usedAuto: false,
                    at: NOW,
                },
                NOW,
            ),
        ).toMatchObject({
            mode: "tokens",
            percent: 10,
            title: "40,000 tokens",
            tooltip: "40,000 tokens · 10% of the 400K context window",
        });
    });

    it("still reports tokens for models BetterShape has no window for", () => {
        expect(
            resolveChatUsageDisplay(
                "custom/local-model",
                {
                    tokens: 1200,
                    inputTokens: 1200,
                    usedAuto: false,
                    at: NOW,
                },
                NOW,
            ),
        ).toMatchObject({
            mode: "tokens",
            percent: 0,
            title: "1,200 tokens",
            tooltip: "1,200 tokens in the last turn",
        });
    });

    it("drops a last turn once it is older than the TTL", () => {
        const stale = {
            tokens: 40_000,
            inputTokens: 38_000,
            usedAuto: false,
            at: NOW - LAST_TURN_TTL_MS - 1,
        };
        expect(resolveChatUsageDisplay("openai/gpt-5", stale, NOW)).toMatchObject({
            percent: 0,
            title: "",
            tooltip: "Token usage appears after the first reply",
        });
        expect(
            resolveChatUsageDisplay("openai/gpt-5", { ...stale, at: NOW - LAST_TURN_TTL_MS }, NOW),
        ).toMatchObject({ percent: 10, title: "40,000 tokens" });
    });
});
