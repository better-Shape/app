import { describe, expect, it } from "vitest";
import type { ContentMatch, ContentSearchResult, ReplaceResult } from "@/lib/backend/types";
import {
    MATCHES_PER_FILE_CAP,
    MATCHES_TOTAL_CAP,
    RENDERED_HIT_CAP,
    defaultSearchSettings,
    deriveSearchState,
    groupMatches,
    limitGroups,
    mayBeTruncated,
    searchBlockedReason,
    setSearchPattern,
    summarizeReplace,
    summarizeSearch,
    toHit,
    toSearchOptions,
    toggleSearchFlag,
} from "@/features/git/ui/search/model";

function match(over: Partial<ContentMatch> = {}): ContentMatch {
    return { line_number: 1, line_text: "const total = 1;", column_start: 0, column_end: 0, ...over };
}

function file(relative_path: string, matches: ContentMatch[], path = `/repo/${relative_path}`): ContentSearchResult {
    return { path, relative_path, matches };
}

describe("toHit", () => {
    it("turns the backend's 0-based column into the 1-based column the editor jump wants", () => {
        const hit = toHit(file("a.ts", []), match({ column_start: 12, column_end: 17 }));
        expect(hit?.column).toBe(13);
        expect(hit?.line).toBe(1);
    });

    it("clamps offsets that run past the end of the line", () => {
        const hit = toHit(file("a.ts", []), match({ line_text: "short", column_start: 2, column_end: 99 }));
        expect(hit?.start).toBe(2);
        expect(hit?.end).toBe(5);
    });

    it("never lets the end fall behind the start", () => {
        const hit = toHit(file("a.ts", []), match({ column_start: 8, column_end: 2 }));
        expect(hit?.end).toBe(8);
    });

    it("rejects a hit it cannot place on a line", () => {
        expect(toHit(file("a.ts", []), match({ line_number: 0 }))).toBeNull();
        expect(toHit(file("a.ts", []), match({ line_number: Number.NaN }))).toBeNull();
    });

    it("keeps the untouched payload so a replace targets the exact original offsets", () => {
        const raw = match({ column_start: 400, column_end: 900, line_text: "" });
        const hit = toHit(file("a.ts", []), raw);
        // The display offsets are clamped, so rebuilding the replace triple from them
        // would silently replace nothing. `raw` must survive untouched.
        expect(hit?.raw).toBe(raw);
        expect(hit?.raw.column_start).toBe(400);
        expect(hit?.end).toBe(0);
    });

    it("reads the absolute path from the payload, not the relative label", () => {
        const hit = toHit(file("src/a.ts", [], "/repo/src/a.ts"), match());
        expect(hit?.path).toBe("/repo/src/a.ts");
        expect(hit?.label).toBe("src/a.ts");
    });
});

describe("groupMatches", () => {
    it("orders hits top to bottom within a file", () => {
        const groups = groupMatches([
            file("a.ts", [match({ line_number: 9 }), match({ line_number: 2 }), match({ line_number: 40 })]),
        ]);
        expect(groups[0]?.hits.map((h) => h.line)).toEqual([2, 9, 40]);
    });

    it("orders files alphabetically", () => {
        const groups = groupMatches([file("z.ts", [match()]), file("a.ts", [match()]), file("m.ts", [match()])]);
        expect(groups.map((g) => g.label)).toEqual(["a.ts", "m.ts", "z.ts"]);
    });

    it("drops a file whose every hit was unusable, rather than showing an empty group", () => {
        const groups = groupMatches([file("bad.ts", [match({ line_number: 0 })]), file("good.ts", [match()])]);
        expect(groups.map((g) => g.label)).toEqual(["good.ts"]);
    });

    it("merges two payloads for the same file instead of showing it twice", () => {
        const groups = groupMatches([
            file("a.ts", [match({ line_number: 3 })]),
            file("a.ts", [match({ line_number: 1 })], "/repo/a.ts"),
        ]);
        expect(groups).toHaveLength(1);
        expect(groups[0]?.hits.map((h) => h.line)).toEqual([1, 3]);
    });

    it("returns nothing for an empty payload, which is not the same as never running", () => {
        expect(groupMatches([])).toEqual([]);
    });
});

describe("summary and truncation", () => {
    it("counts files and matches separately", () => {
        const groups = groupMatches([file("a.ts", [match(), match()]), file("b.ts", [match()])]);
        expect(summarizeSearch(groups)).toEqual({ files: 2, matches: 3 });
    });

    it("does not claim truncation for a small result", () => {
        expect(mayBeTruncated(groupMatches([file("a.ts", [match()])]))).toBe(false);
    });

    it("flags truncation at the per-file cap, because ripgrep stops there", () => {
        const many = Array.from({ length: MATCHES_PER_FILE_CAP }, () => match());
        expect(mayBeTruncated(groupMatches([file("a.ts", many)]))).toBe(true);
    });

    it("flags truncation one below the per-file cap and not at it", () => {
        const justUnder = Array.from({ length: MATCHES_PER_FILE_CAP - 1 }, () => match());
        expect(mayBeTruncated(groupMatches([file("a.ts", justUnder)]))).toBe(false);
    });

    it("flags truncation at the total cap, spread across files no single one reaching", () => {
        // The total cap is the one the code calls the same lie as reporting zero, and it
        // can be hit without any single file hitting the per-file cap, so the per-file
        // assertion above cannot stand in for it.
        const perFile = MATCHES_PER_FILE_CAP - 1;
        const files = Math.ceil(MATCHES_TOTAL_CAP / perFile);
        const groups = groupMatches(
            Array.from({ length: files }, (_, i) =>
                file(`f${i}.ts`, Array.from({ length: perFile }, () => match())),
            ),
        );
        expect(summarizeSearch(groups).matches).toBeGreaterThanOrEqual(MATCHES_TOTAL_CAP);
        expect(mayBeTruncated(groups)).toBe(true);
    });

    it("does not claim truncation just below the total cap when no file hits its own", () => {
        // Same shape as the test above, one match short, so the only thing that can raise
        // the flag is the total cap.
        const perFile = MATCHES_PER_FILE_CAP - 1;
        let left = MATCHES_TOTAL_CAP - 1;
        const results: ContentSearchResult[] = [];
        let n = 0;
        while (left > 0) {
            const take = Math.min(perFile, left);
            results.push(file(`g${n}.ts`, Array.from({ length: take }, () => match())));
            left -= take;
            n += 1;
        }
        const groups = groupMatches(results);
        expect(summarizeSearch(groups).matches).toBe(MATCHES_TOTAL_CAP - 1);
        expect(mayBeTruncated(groups)).toBe(false);
    });
});

describe("limitGroups", () => {
    const many = (n: number) => Array.from({ length: n }, () => match());

    it("counts out loud whatever it drops", () => {
        const groups = groupMatches([file("a.ts", many(10)), file("b.ts", many(10))]);
        const out = limitGroups(groups, 15);
        expect(out.groups.flatMap((g) => g.hits)).toHaveLength(15);
        expect(out.hidden).toBe(5);
        expect(out.hidden + out.groups.flatMap((g) => g.hits).length).toBe(20);
    });

    it("keeps a partial group rather than dropping the whole file", () => {
        const groups = groupMatches([file("a.ts", many(10))]);
        const out = limitGroups(groups, 4);
        expect(out.groups).toHaveLength(1);
        expect(out.groups[0]?.hits).toHaveLength(4);
    });

    it("hides everything when the budget is zero", () => {
        const groups = groupMatches([file("a.ts", many(3))]);
        const out = limitGroups(groups, 0);
        expect(out.groups).toEqual([]);
        expect(out.hidden).toBe(3);
    });

    it("treats a negative cap as zero rather than a negative budget", () => {
        const groups = groupMatches([file("a.ts", many(3))]);
        expect(limitGroups(groups, -5).hidden).toBe(3);
    });

    it("defaults to the rendered cap", () => {
        const groups = groupMatches([file("a.ts", many(RENDERED_HIT_CAP + 10))]);
        expect(limitGroups(groups).hidden).toBe(10);
    });
});

describe("deriveSearchState", () => {
    const settings = defaultSearchSettings();

    it("is idle with no query, because nothing was asked for", () => {
        expect(deriveSearchState("", settings, null, { status: "idle" }).kind).toBe("idle");
        expect(deriveSearchState("   ", settings, null, { status: "idle" }).kind).toBe("idle");
    });

    it("reports a blocked query as blocked, never as an empty result", () => {
        const bad = toggleSearchFlag(settings, "is_regex");
        const state = deriveSearchState("([unclosed", bad, null, { status: "done", results: [] });
        expect(state.kind).toBe("blocked");
        if (state.kind === "blocked") expect(state.reason).not.toBe("");
    });

    it("reports a failure as failed, never as ready-with-nothing", () => {
        const state = deriveSearchState("x", settings, null, { status: "failed", message: "rg missing" });
        expect(state.kind).toBe("failed");
        if (state.kind === "failed") expect(state.message).toBe("rg missing");
    });

    it("reports a real empty result as ready with zero", () => {
        const state = deriveSearchState("x", settings, null, { status: "done", results: [] });
        expect(state.kind).toBe("ready");
        if (state.kind === "ready") expect(state.summary).toEqual({ files: 0, matches: 0 });
    });

    it("keeps the previous groups visible while loading", () => {
        const previous = groupMatches([file("a.ts", [match()])]);
        const state = deriveSearchState("x", settings, previous, { status: "loading" });
        expect(state.kind).toBe("loading");
        if (state.kind === "loading") expect(state.previous).toBe(previous);
    });
});

describe("summarizeReplace", () => {
    const result = (over: Partial<ReplaceResult> = {}): ReplaceResult => ({
        files_modified: 2,
        replacements_count: 5,
        errors: [],
        ...over,
    });

    it("is null before anything ran", () => {
        expect(summarizeReplace(null)).toBeNull();
    });

    it("calls a partial write partial, because some files already changed", () => {
        const summary = summarizeReplace(result({ files_modified: 1, errors: ["b.ts: denied"] }));
        expect(summary?.kind).toBe("partial");
        if (summary?.kind === "partial") expect(summary.errors).toEqual(["b.ts: denied"]);
    });

    it("treats blank error lines as no errors", () => {
        expect(summarizeReplace(result({ errors: ["", "   "] }))?.kind).toBe("done");
    });

    it("says nothing happened when nothing was replaced", () => {
        expect(summarizeReplace(result({ files_modified: 0, replacements_count: 0 }))?.kind).toBe("nothing");
    });

    it("treats a missing count as zero rather than NaN", () => {
        const summary = summarizeReplace({ errors: [] } as unknown as ReplaceResult);
        expect(summary?.kind).toBe("nothing");
    });
});

describe("search settings", () => {
    it("defaults every filter that would hide a match to off", () => {
        const flags = defaultSearchSettings().flags;
        for (const [key, value] of Object.entries(flags)) {
            if (key === "respect_gitignore") continue;
            expect(value, key).toBe(false);
        }
        expect(flags.respect_gitignore).toBe(true);
    });

    it("sends the payload the backend expects, omitting blank patterns", () => {
        const options = toSearchOptions(defaultSearchSettings());
        expect(options.include_pattern).toBeUndefined();
        expect(options.exclude_pattern).toBeUndefined();
        expect(options).toHaveProperty("case_sensitive", false);
        expect(options).toHaveProperty("only_source", false);
    });

    it("trims a pattern and drops it when only whitespace was typed", () => {
        const withPattern = setSearchPattern(defaultSearchSettings(), "include", "  src/**  ");
        expect(toSearchOptions(withPattern).include_pattern).toBe("src/**");
        const blank = setSearchPattern(defaultSearchSettings(), "include", "   ");
        expect(toSearchOptions(blank).include_pattern).toBeUndefined();
    });

    it("toggles one flag without disturbing the rest", () => {
        const next = toggleSearchFlag(defaultSearchSettings(), "case_sensitive");
        expect(next.flags.case_sensitive).toBe(true);
        expect(next.flags.whole_word).toBe(false);
    });

    it("blocks an empty query and lets a literal one through", () => {
        expect(searchBlockedReason("", defaultSearchSettings())).toBeTruthy();
        expect(searchBlockedReason("plain", defaultSearchSettings())).toBeNull();
    });

    it("only applies the regex check when regex mode is on", () => {
        expect(searchBlockedReason("([unclosed", defaultSearchSettings())).toBeNull();
        const re = toggleSearchFlag(defaultSearchSettings(), "is_regex");
        expect(searchBlockedReason("([unclosed", re)).toBeTruthy();
        expect(searchBlockedReason("[a-z]+", re)).toBeNull();
    });
});