import { describe, expect, it } from "vitest";
import {
    blameEntryAt,
    inlineBlameLabel,
    toInlineBlameEntries,
} from "@/features/editor/lib/inline-blame";

const raw = (line: number, lineCount: number, author: string, date: string, summary: string) => ({
    line,
    line_count: lineCount,
    commit: `c${line}`,
    author,
    date,
    summary,
});

describe("inline blame", () => {
    it("orders regions by line and drops records git cannot place", () => {
        const entries = toInlineBlameEntries([
            raw(20, 5, "Ada", "1700000000", "second"),
            raw(1, 19, "Grace", "1600000000", "first"),
            raw(0, 3, "Nobody", "0", "ignored"),
        ]);
        expect(entries.map((entry) => entry.line)).toEqual([1, 20]);
        expect(entries.map((entry) => entry.author)).toEqual(["Grace", "Ada"]);
    });

    it("returns nothing for an empty or missing history", () => {
        expect(toInlineBlameEntries(null)).toEqual([]);
        expect(blameEntryAt([], 4)).toBeNull();
        expect(blameEntryAt(toInlineBlameEntries([]), 4)).toBeNull();
    });

    it("finds the region that covers a line, including its last line", () => {
        const entries = toInlineBlameEntries([
            raw(1, 3, "Grace", "1600000000", "first"),
            raw(4, 2, "Ada", "1700000000", "second"),
        ]);
        expect(blameEntryAt(entries, 1)?.author).toBe("Grace");
        expect(blameEntryAt(entries, 3)?.author).toBe("Grace");
        expect(blameEntryAt(entries, 4)?.author).toBe("Ada");
        expect(blameEntryAt(entries, 5)?.author).toBe("Ada");
        // Past the last region, or before the first, there is nothing to show.
        expect(blameEntryAt(entries, 6)).toBeNull();
        expect(blameEntryAt(entries, 0)).toBeNull();
    });

    it("treats a zero or missing line count as the single line it starts on", () => {
        const entries = toInlineBlameEntries([raw(7, 0, "Ada", "1700000000", "one line")]);
        expect(blameEntryAt(entries, 7)?.summary).toBe("one line");
        expect(blameEntryAt(entries, 8)).toBeNull();
    });

    it("labels a commit with author, relative date and summary", () => {
        const now = 1_700_000_000;
        const entries = toInlineBlameEntries([raw(1, 1, "Ada", String(now - 120), "fix: thing")]);
        const entry = blameEntryAt(entries, 1);
        expect(entry).not.toBeNull();
        expect(inlineBlameLabel(entry!, now)).toMatch(/^Ada · .+ · fix: thing$/);
    });

    it("leaves out empty parts instead of dangling separators", () => {
        const now = 1_700_000_000;
        const entries = toInlineBlameEntries([raw(1, 1, "", "0", "")]);
        expect(inlineBlameLabel(entries[0]!, now)).toBe(
            "Unknown author · Date unavailable · No commit message.",
        );
    });
});
