import { describe, expect, it } from "vitest";
import { cellWidth, findTerminalMatches, nextMatchIndex, toCellSelection } from "@/features/terminal/ui/search";

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

    it("measures display cells, not string length", () => {
        expect(cellWidth("abc")).toBe(3);
        expect(cellWidth("\u4f60\u597d")).toBe(4);          // CJK, two cells each
        expect(cellWidth("e\u0301")).toBe(1);               // combining acute
        expect(cellWidth("\u{1f680}")).toBe(2);              // emoji
        expect(cellWidth("\u{1f468}\u200d\u{1f469}\u200d\u{1f467}")).toBe(2); // ZWJ family
        expect(cellWidth("")).toBe(0);
    });

    it("maps a match to the cells xterm should select", () => {
        const line = "\u4f60\u597d error";
        const match = findTerminalMatches([line], "error")[0]!;
        // The CJK prefix is 2 characters but 4 cells wide.
        expect(match.col).toBe(3);
        expect(toCellSelection(line, match)).toEqual({ column: 5, length: 5 });
    });

    it("maps a wide-character match to its full cell width", () => {
        const line = "ab\u4f60\u597d";
        const match = findTerminalMatches([line], "\u4f60\u597d")[0]!;
        expect(toCellSelection(line, match)).toEqual({ column: 2, length: 4 });
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
