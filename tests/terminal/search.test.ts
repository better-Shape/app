import { describe, expect, it } from "vitest";
import { findTerminalMatches, nextMatchIndex } from "@/features/terminal/ui/search";

describe("terminal search", () => {
    it("finds every match with absolute row and column", () => {
        const lines = ["build ok", "error: one", "  error: two", "done"];
        expect(findTerminalMatches(lines, "error")).toEqual([
            { row: 1, col: 0, length: 5 },
            { row: 2, col: 2, length: 5 },
        ]);
    });

    it("is case-insensitive and ignores surrounding whitespace in the query", () => {
        expect(findTerminalMatches(["Hello World"], "  hello ")).toEqual([
            { row: 0, col: 0, length: 5 },
        ]);
    });

    it("finds repeated matches on one line", () => {
        expect(findTerminalMatches(["aXaXa"], "a")).toEqual([
            { row: 0, col: 0, length: 1 },
            { row: 0, col: 2, length: 1 },
            { row: 0, col: 4, length: 1 },
        ]);
    });

    it("returns nothing for an empty query", () => {
        expect(findTerminalMatches(["anything"], "   ")).toEqual([]);
    });

    it("stops at the match limit", () => {
        const lines = Array.from({ length: 50 }, () => "x".repeat(100));
        expect(findTerminalMatches(lines, "x", 10)).toHaveLength(10);
    });

    it("treats missing lines as empty", () => {
        expect(findTerminalMatches([undefined as unknown as string, "ok"], "ok")).toEqual([
            { row: 1, col: 0, length: 2 },
        ]);
    });

    it("wraps while stepping through matches", () => {
        expect(nextMatchIndex(-1, 1, 3)).toBe(0);
        expect(nextMatchIndex(2, 1, 3)).toBe(0);
        expect(nextMatchIndex(0, -1, 3)).toBe(2);
        expect(nextMatchIndex(-1, -1, 3)).toBe(0);
        expect(nextMatchIndex(0, 1, 0)).toBe(-1);
    });
});
