import { describe, expect, it } from "vitest";
import {
    BETTERSHAPE_ERRORS,
    classifyAiError,
    classifyIdeError,
    errorDocsUrl,
    getError,
} from "@/lib/errors/catalog";

describe("error catalog", () => {
    it("resolves known codes", () => {
        expect(getError(BETTERSHAPE_ERRORS.AI_PROVIDER).name).toBe("AI provider failure");
        expect(getError(BETTERSHAPE_ERRORS.AI_KEY_MISSING).code).toBe(2200);
    });

    it("falls back to unknown", () => {
        expect(getError(99999).code).toBe(BETTERSHAPE_ERRORS.UNKNOWN);
    });

    it("builds docs urls with the numeric code", () => {
        expect(errorDocsUrl(BETTERSHAPE_ERRORS.AI_KEY_MISSING)).toBe(
            "https://github.com/useshape/Shape/blob/main/docs/help/errors.md#2200",
        );
    });

    it("classifies AI error strings", () => {
        expect(classifyAiError("OpenAI API error: model gpt-9 not found").code).toBe(
            BETTERSHAPE_ERRORS.AI_PROVIDER,
        );
        expect(classifyAiError("No model provider is configured").code).toBe(
            BETTERSHAPE_ERRORS.AI_KEY_MISSING,
        );
        expect(classifyAiError("Anthropic has no API key").code).toBe(BETTERSHAPE_ERRORS.AI_KEY_MISSING);
        expect(classifyAiError("network timeout").code).toBe(BETTERSHAPE_ERRORS.AI_NETWORK);
        expect(classifyAiError("429 Too Many Requests").code).toBe(BETTERSHAPE_ERRORS.AI_RATE_LIMITED);
        expect(classifyAiError("rate limit exceeded").code).toBe(BETTERSHAPE_ERRORS.AI_RATE_LIMITED);
        expect(
            classifyAiError(
                'Google API error 429: {"error":{"message":"Resource has been exhausted","status":"RESOURCE_EXHAUSTED"}}',
            ).code,
        ).toBe(BETTERSHAPE_ERRORS.AI_RATE_LIMITED);
    });

    it("includes the local plugin and embeddings codes", () => {
        expect(getError(BETTERSHAPE_ERRORS.AI_RATE_LIMITED).code).toBe(2100);
        expect(getError(BETTERSHAPE_ERRORS.EMBEDDINGS_FAILED).code).toBe(4600);
        expect(getError(BETTERSHAPE_ERRORS.PLUGINS_FAILED).code).toBe(4700);
        expect(getError(BETTERSHAPE_ERRORS.UPDATE_FAILED).code).toBe(4500);
    });

    it("includes IDE workspace range", () => {
        expect(getError(BETTERSHAPE_ERRORS.WORKSPACE_ACCESS).code).toBe(4000);
        expect(getError(BETTERSHAPE_ERRORS.GIT_FAILED).code).toBe(4100);
        expect(getError(BETTERSHAPE_ERRORS.LANGUAGE_SERVER).code).toBe(4200);
        expect(getError(BETTERSHAPE_ERRORS.INDEX_SEARCH).code).toBe(4300);
        expect(getError(BETTERSHAPE_ERRORS.TERMINAL).code).toBe(4400);
    });

    it("classifies IDE error strings", () => {
        expect(classifyIdeError("failed to push origin").code).toBe(BETTERSHAPE_ERRORS.GIT_FAILED);
        expect(classifyIdeError("git checkout failed").code).toBe(BETTERSHAPE_ERRORS.GIT_FAILED);
        expect(classifyIdeError("language server crashed").code).toBe(BETTERSHAPE_ERRORS.LANGUAGE_SERVER);
        expect(classifyIdeError("ripgrep not installed").code).toBe(BETTERSHAPE_ERRORS.INDEX_SEARCH);
        expect(classifyIdeError("Access is denied (os error 5)").code).toBe(BETTERSHAPE_ERRORS.WORKSPACE_ACCESS);
        expect(classifyIdeError("pty spawn failed").code).toBe(BETTERSHAPE_ERRORS.TERMINAL);
        expect(classifyIdeError("composio request failed").code).toBe(BETTERSHAPE_ERRORS.PLUGINS_FAILED);
        expect(classifyIdeError("embeddings are not configured").code).toBe(BETTERSHAPE_ERRORS.EMBEDDINGS_FAILED);
    });
});
