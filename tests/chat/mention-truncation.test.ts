import { describe, expect, it } from "vitest";
import {
    DEFAULT_MAX_CONTEXT_LINES,
    MENTION_CHAR_LIMIT,
    maxContextLineLimit,
    truncateMentionContent,
} from "@/lib/chat/mention-truncation";

const lines = (count: number) => Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n");

describe("mention truncation", () => {
    it("sends a short file untouched", () => {
        expect(truncateMentionContent(lines(10), 200)).toBeNull();
    });

    it("keeps exactly the configured number of lines and marks the cut", () => {
        const result = truncateMentionContent(lines(300), 200);
        expect(result).not.toBeNull();
        const body = result!.replace(/\n…\(truncated\)$/, "");
        expect(body.split("\n")).toHaveLength(200);
        expect(body.endsWith("line 200")).toBe(true);
    });

    it("does not mark a file that is exactly at the limit", () => {
        expect(truncateMentionContent(lines(200), 200)).toBeNull();
    });

    it("still caps characters so a minified bundle cannot flood the turn", () => {
        const wide = "x".repeat(MENTION_CHAR_LIMIT * 2);
        const result = truncateMentionContent(wide, 200);
        expect(result).toBe(`${"x".repeat(MENTION_CHAR_LIMIT)}\n…(truncated)`);
    });

    it("falls back to the default for a missing or nonsensical limit", () => {
        expect(maxContextLineLimit(undefined)).toBe(DEFAULT_MAX_CONTEXT_LINES);
        expect(maxContextLineLimit(0)).toBe(DEFAULT_MAX_CONTEXT_LINES);
        expect(maxContextLineLimit(-5)).toBe(DEFAULT_MAX_CONTEXT_LINES);
        expect(maxContextLineLimit(Number.NaN)).toBe(DEFAULT_MAX_CONTEXT_LINES);
        expect(maxContextLineLimit(500.7)).toBe(500);
    });
});
