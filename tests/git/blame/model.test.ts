import { describe, expect, it } from "vitest";
import {
    blameBlockedReason,
    blameState,
    formatBlameDate,
    groupBlame,
    isOutsideProject,
    orderBlameEntries,
    parseBlameDate,
    regionEndLine,
    pluralAuthors,
    pluralCommits,
    pluralRegions,
    relativeLabel,
    safeAuthor,
    safeSummary,
    toBlameEntry,
    visibleBlameGroups,
    DEFAULT_GROUP_LIMIT,
    type BlameEntry,
} from "@/features/git/ui/blame/model";
import type { BlameLine } from "@/lib/backend";

/**
 * `git_blame_file` walks `blame.len()`, which git2 defines as the hunk count, so
 * the payload carries one record per region. `line` is the hunk's
 * `final_start_line` and `line_count` is `lines_in_hunk`, both one-based and
 * counted in the file being blamed.
 */
function raw(overrides: Partial<BlameLine> & { line: number; commit: string }): BlameLine {
    return { line_count: 1, author: "Ada", date: "1700000000", summary: "Do the thing", ...overrides };
}

const LINES: BlameLine[] = [
    raw({ line: 1, line_count: 1, commit: "aaa1111", summary: "Add the parser" }),
    raw({ line: 2, line_count: 4, commit: "aaa1111", summary: "Add the parser" }),
    raw({ line: 6, line_count: 2, commit: "bbb2222", author: "Grace", summary: "Fix the off-by-one", date: "1700086400" }),
    raw({ line: 8, line_count: 1, commit: "ccc3333", author: "Alan", summary: "Rename the flag" }),
];

describe("blame entry normalisation", () => {
    it("keeps the fields the payload carries", () => {
        const entry = toBlameEntry(LINES[2]);
        expect(entry).toEqual({
            line: 6,
            lineCount: 2,
            commit: "bbb2222",
            author: "Grace",
            at: 1700086400,
            summary: "Fix the off-by-one",
        });
    });

    it("parses the backend's epoch-seconds string and never produces NaN", () => {
        expect(parseBlameDate("1700000000")).toBe(1700000000);
        expect(parseBlameDate("")).toBeNull();
        expect(parseBlameDate("not a date")).toBeNull();
        expect(parseBlameDate(undefined)).toBeNull();
        expect(parseBlameDate("-5")).toBeNull();
        expect(parseBlameDate(0)).toBeNull();
    });

    it("replaces a blank author or summary rather than an empty row", () => {
        expect(safeAuthor("   ").length).toBeGreaterThan(0);
        expect(safeSummary(undefined).length).toBeGreaterThan(0);
        expect(toBlameEntry(raw({ line: 1, commit: "a", author: "  " })).author).toBe("Unknown author");
        expect(toBlameEntry(raw({ line: 1, commit: "a", summary: "" })).summary).toBe("No commit message.");
    });

    it("keeps a file line at or above one even when the payload is malformed", () => {
        expect(toBlameEntry(raw({ line: 0, commit: "a" })).line).toBe(1);
        expect(toBlameEntry({ line: Number.NaN } as unknown as BlameLine).line).toBe(1);
        expect(toBlameEntry(null).line).toBe(1);
    });

    it("treats a missing or nonsensical line_count as a single line, never an inverted span", () => {
        expect(toBlameEntry({ line: 10 } as unknown as BlameLine).lineCount).toBe(1);
        expect(toBlameEntry(raw({ line: 10, line_count: 0, commit: "a" })).lineCount).toBe(1);
        expect(toBlameEntry(raw({ line: 10, line_count: -3, commit: "a" })).lineCount).toBe(1);
        // The span must never end before it starts, which is what the panel renders.
        expect(regionEndLine(toBlameEntry(raw({ line: 10, line_count: -3, commit: "a" })))).toBe(10);
    });
});

describe("blame ordering and grouping", () => {
    it("restores file order from the start line when the payload arrives shuffled", () => {
        const entries = [toBlameEntry(LINES[2]), toBlameEntry(LINES[0]), toBlameEntry(LINES[1])];
        expect(orderBlameEntries(entries).map((entry) => entry.line)).toEqual([1, 2, 6]);
    });

    it("merges neighbouring regions that name the same commit", () => {
        const groups = groupBlame(LINES.map(toBlameEntry));
        expect(groups).toHaveLength(3);
        // Lines 1 and 2,5,6 are the same commit, so the span ends at the END of the
        // last region, not at its start line.
        expect(groups[0]).toMatchObject({ commit: "aaa1111", from: 1, to: 5, count: 2, author: "Ada" });
        expect(groups[1]).toMatchObject({ commit: "bbb2222", from: 6, to: 7, count: 1, author: "Grace" });
        expect(groups[2]).toMatchObject({ commit: "ccc3333", from: 8, to: 8, count: 1, author: "Alan" });
    });

    it("ends a single multi-line region on its last line, not its first", () => {
        // A group of ONE region is the case a start-line-only span gets wrong.
        const groups = groupBlame([toBlameEntry(raw({ line: 40, line_count: 12, commit: "solo" }))]);
        expect(groups[0]).toMatchObject({ from: 40, to: 51, count: 1 });
    });

    it("does not merge the same commit across another one", () => {
        const interleaved = [
            toBlameEntry(raw({ line: 1, commit: "aaa" })),
            toBlameEntry(raw({ line: 2, commit: "bbb" })),
            toBlameEntry(raw({ line: 3, commit: "aaa" })),
        ];
        expect(groupBlame(interleaved).map((group) => group.commit)).toEqual(["aaa", "bbb", "aaa"]);
    });

    it("takes the author and summary from the first region of the run", () => {
        const groups = groupBlame([
            toBlameEntry(raw({ line: 1, commit: "aaa", author: "First", summary: "One" })),
            toBlameEntry(raw({ line: 5, commit: "aaa", author: "Second", summary: "Two" })),
        ]);
        expect(groups[0].author).toBe("First");
        expect(groups[0].summary).toBe("One");
    });

    it("returns no groups for no regions", () => {
        expect(groupBlame([])).toEqual([]);
    });
});

describe("blame dates", () => {
    it("shows a relative age for a past stamp", () => {
        const threeDaysAgo = Math.floor(Date.now() / 1000) - 3 * 24 * 60 * 60;
        expect(formatBlameDate(threeDaysAgo, threeDaysAgo + 60)).toMatch(/ago$/);
    });

    it("falls back to plain text rather than NaN for an unparsed stamp", () => {
        const text = formatBlameDate(null, 1_700_000_000);
        expect(text).toBe("Date unavailable");
        expect(text).not.toContain("NaN");
    });

    it("shows the day itself when the clock runs ahead of the commit", () => {
        const text = formatBlameDate(1_700_000_000, 1_600_000_000);
        expect(text).toBe("2023-11-14");
        expect(text).not.toContain("NaN");
    });
});

describe("blame blocked paths", () => {
    it("knows the editor's pseudo paths cannot be blamed", () => {
        expect(blameBlockedReason("bettershape://browser", "/repo")).toContain("browser tab");
        expect(blameBlockedReason("diff:working:/repo/a.ts", "/repo")).toContain("diff view");
    });

    it("refuses a file outside the project rather than blaming a same-named repo file", () => {
        // `resolve_repo_relative_path` falls back to the last path segment, so a
        // README.md outside the repo would otherwise be blamed as the repo's own.
        expect(blameBlockedReason("/elsewhere/README.md", "/repo")).toContain("outside the project");
        expect(isOutsideProject("/elsewhere/README.md", "/repo")).toBe(true);
        expect(isOutsideProject("/repo/README.md", "/repo")).toBe(false);
        expect(isOutsideProject("C:\\repo\\src\\a.ts", "C:/repo")).toBe(false);
    });

    it("does not confuse a sibling folder whose name starts like the project", () => {
        expect(isOutsideProject("/repository-other/a.ts", "/repo")).toBe(true);
    });

    it("blocks when there is no project or no file", () => {
        expect(blameBlockedReason("/repo/a.ts", null)).toBe("No project open");
        expect(blameBlockedReason(null, "/repo")).toBe("No file open");
        expect(blameBlockedReason("/repo/a.ts", "/repo")).toBeNull();
    });

    it("shows a project-relative label", () => {
        expect(relativeLabel("/repo", "/repo/src/a.ts")).toBe("src/a.ts");
        expect(relativeLabel("C:\\repo", "C:\\repo\\src\\a.ts")).toBe("src/a.ts");
        expect(relativeLabel("/repo/", "/repo/src/a.ts")).toBe("src/a.ts");
    });
});

describe("blame state", () => {
    function state(overrides: Partial<Parameters<typeof blameState>[0]> = {}) {
        return blameState({
            projectPath: "/repo",
            filePath: "/repo/src/a.ts",
            status: "loaded",
            message: null,
            lines: LINES,
            ...overrides,
        });
    }

    it("has no state without a project", () => {
        expect(state({ projectPath: null }).kind).toBe("no-project");
    });

    it("blocks before calling git when the path cannot be blamed", () => {
        const blocked = state({ filePath: "bettershape://browser" });
        expect(blocked.kind).toBe("blocked");
        if (blocked.kind !== "blocked") throw new Error("expected blocked");
        expect(blocked.reason).toContain("browser tab");
    });

    it("loads rather than showing an empty list while git is running", () => {
        expect(state({ status: "loading", lines: null }).kind).toBe("loading");
    });

    it("keeps git's own reason when blame fails", () => {
        const failed = state({ status: "failed", lines: null, message: "Git error: object not found" });
        expect(failed.kind).toBe("failed");
        if (failed.kind !== "failed") throw new Error("expected failed");
        expect(failed.message).toBe("Git error: object not found");
    });

    it("never renders a blank reason when git said nothing", () => {
        const failed = state({ status: "failed", lines: null, message: "   " });
        if (failed.kind !== "failed") throw new Error("expected failed");
        expect(failed.message.length).toBeGreaterThan(0);
    });

    it("counts regions, commits and authors from the payload", () => {
        const ready = state();
        if (ready.kind !== "ready") throw new Error("expected ready");
        expect(ready.regions).toBe(4);
        expect(ready.commits).toBe(3);
        expect(ready.authors).toBe(3);
        expect(ready.fileLabel).toBe("src/a.ts");
    });

    it("reports zero regions as an empty answer, not as a failure", () => {
        const ready = state({ lines: [] });
        if (ready.kind !== "ready") throw new Error("expected ready");
        expect(ready.groups).toEqual([]);
        expect(ready.regions).toBe(0);
    });

    it("survives a payload that is not an array", () => {
        const ready = state({ lines: null as unknown as BlameLine[] });
        expect(ready.kind).toBe("ready");
    });

    it("pluralises each count from the number, not a fixed word", () => {
        expect(pluralRegions(1)).toBe("1 region");
        expect(pluralRegions(4)).toBe("4 regions");
        expect(pluralCommits(1)).toBe("1 commit");
        expect(pluralAuthors(2)).toBe("2 authors");
    });
});

describe("blame region cap", () => {
    function groups(count: number): BlameEntry[] {
        return Array.from({ length: count }, (_, index) => toBlameEntry(raw({ line: index + 1, commit: `c${index}` })));
    }

    it("caps a long file and keeps the prefix in order", () => {
        const rows = visibleBlameGroups(groupBlame(groups(500)), DEFAULT_GROUP_LIMIT);
        expect(rows).toHaveLength(DEFAULT_GROUP_LIMIT);
        expect(rows[0].from).toBe(1);
        expect(rows[rows.length - 1].to).toBe(DEFAULT_GROUP_LIMIT);
    });

    it("counts a long file's regions rather than its lines", () => {
        // Every fixture is one line, so 500 regions is 500 lines. A payload of
        // multi-line regions must report the same region count, not a line count.
        const wide = Array.from({ length: 500 }, (_, index) =>
            toBlameEntry(raw({ line: index * 3 + 1, line_count: 3, commit: `c${index}` })),
        );
        expect(groupBlame(wide)).toHaveLength(500);
        expect(groupBlame(wide)[499]).toMatchObject({ from: 1498, to: 1500 });
    });

    it("shows everything once the cap is lifted", () => {
        expect(visibleBlameGroups(groupBlame(groups(500)), 500)).toHaveLength(500);
    });

    it("treats a negative cap as no rows rather than throwing", () => {
        expect(visibleBlameGroups(groupBlame(groups(3)), -1)).toEqual([]);
    });
});