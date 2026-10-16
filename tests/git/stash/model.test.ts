import { describe, expect, it } from "vitest";

import {
    describeStashChange,
    filterStashRows,
    parseStashDiff,
    stashConfirmCopy,
    stashRelativeTime,
    stashSaveOutcome,
    stashSelector,
    stashState,
    stashSubject,
    stashTimestampSeconds,
    toStashRows,
} from "@/features/git/ui/stash/model";
import type { GitStashEntry } from "@/lib/backend/types";

const NOW = 1_700_000_000_000; // 2023-11-14T22:13:20Z
const NOW_S = Math.floor(NOW / 1000);

function entry(index: number, message: string, secondsAgo: number): GitStashEntry {
    return { index, message, date: String(NOW_S - secondsAgo) };
}

describe("stashSubject", () => {
    it("reads the branch and message out of a stashed-with-message subject", () => {
        expect(stashSubject("On main: fix the parser")).toEqual({
            branch: "main",
            label: "fix the parser",
        });
    });

    it("strips the tip commit hash git writes when no message was given", () => {
        expect(stashSubject("WIP on feature/login: 1a2b3c4d Drop the temp table")).toEqual({
            branch: "feature/login",
            label: "Drop the temp table",
        });
    });

    it("keeps a colon that belongs to the message rather than the branch", () => {
        expect(stashSubject("On main: fix: handle empty input")).toEqual({
            branch: "main",
            label: "fix: handle empty input",
        });
    });

    it("keeps a detached HEAD marker as the branch", () => {
        expect(stashSubject("WIP on (no branch): 9f8e7d6c mid-refactor")).toEqual({
            branch: "(no branch)",
            label: "mid-refactor",
        });
    });

    it("falls back to the whole subject when there is no branch prefix", () => {
        expect(stashSubject("manual note with no prefix")).toEqual({
            branch: null,
            label: "manual note with no prefix",
        });
    });

    it("reports no message when a WIP subject held only the commit hash", () => {
        expect(stashSubject("WIP on main: 1a2b3c4d").label).toBe("No message");
    });

    it("keeps a hash the user typed as their own message", () => {
        expect(stashSubject("On main: 1a2b3c4d").label).toBe("1a2b3c4d");
    });

    it("does not strip a leading word that only looks like a hash", () => {
        expect(stashSubject("WIP on main: todo finish this").label).toBe("todo finish this");
    });

    it("reports no message for an empty subject", () => {
        expect(stashSubject("").label).toBe("No message");
    });
});

describe("stashTimestampSeconds", () => {
    it("accepts a unix seconds string", () => {
        expect(stashTimestampSeconds("1700000000")).toBe(1700000000);
    });

    it("rejects anything that is not a positive integer string", () => {
        expect(stashTimestampSeconds("")).toBeNull();
        expect(stashTimestampSeconds("  ")).toBeNull();
        expect(stashTimestampSeconds("soon")).toBeNull();
        expect(stashTimestampSeconds("1700000000.5")).toBeNull();
        expect(stashTimestampSeconds("-5")).toBeNull();
        expect(stashTimestampSeconds("0")).toBeNull();
    });
});

describe("stashRelativeTime", () => {
    it("reports a fresh stash as just now", () => {
        expect(stashRelativeTime(String(NOW_S), NOW)).toBe("just now");
        expect(stashRelativeTime(String(NOW_S - 59), NOW)).toBe("just now");
    });

    it("steps through minutes, hours, days, months and years", () => {
        expect(stashRelativeTime(String(NOW_S - 60), NOW)).toBe("1m ago");
        expect(stashRelativeTime(String(NOW_S - 59 * 60), NOW)).toBe("59m ago");
        expect(stashRelativeTime(String(NOW_S - 60 * 60), NOW)).toBe("1h ago");
        expect(stashRelativeTime(String(NOW_S - 24 * 3600), NOW)).toBe("1d ago");
        expect(stashRelativeTime(String(NOW_S - 29 * 86400), NOW)).toBe("29d ago");
        expect(stashRelativeTime(String(NOW_S - 30 * 86400), NOW)).toBe("1mo ago");
        expect(stashRelativeTime(String(NOW_S - 330 * 86400), NOW)).toBe("11mo ago");
        expect(stashRelativeTime(String(NOW_S - 365 * 86400), NOW)).toBe("1y ago");
    });

    it("does not print a negative age for a clock-skewed future timestamp", () => {
        expect(stashRelativeTime(String(NOW_S + 600), NOW)).toBe("just now");
    });

    it("says the time is unknown rather than printing NaN", () => {
        expect(stashRelativeTime("not-a-date", NOW)).toBe("time unknown");
        expect(stashRelativeTime("", NOW)).toBe("time unknown");
    });
});

describe("toStashRows", () => {
    it("orders rows newest first while each row keeps the index git reported", () => {
        const rows = toStashRows(
            [
                entry(0, "On main: newest", 10),
                entry(1, "On main: middle", 600),
                entry(2, "On main: oldest", 6000),
            ],
            NOW,
        );

        expect(rows.map((row) => row.label)).toEqual(["newest", "middle", "oldest"]);
        expect(rows.map((row) => row.index)).toEqual([0, 1, 2]);
        expect(rows.map((row) => row.ref)).toEqual(["stash@{0}", "stash@{1}", "stash@{2}"]);
    });

    it("keeps the reflog selector attached to its entry when the dates disagree with the order", () => {
        // Clock skew: git's reflog has this third entry, but it carries the newest commit
        // time, so sorting puts it at the top. The index it is applied with must still be
        // 2, not its new row position of 0. The other two sort by clock too: 4000s ago is
        // newer than 5000s ago, so index 1 stays above index 0.
        const rows = toStashRows(
            [
                entry(0, "On main: recorded first", 5000),
                entry(1, "On main: recorded second", 4000),
                entry(2, "On main: newest by clock", 10),
            ],
            NOW,
        );

        expect(rows.map((row) => row.label)).toEqual([
            "newest by clock",
            "recorded second",
            "recorded first",
        ]);
        expect(rows.map((row) => row.index)).toEqual([2, 1, 0]);
        expect(rows.map((row) => row.ref)).toEqual(["stash@{2}", "stash@{1}", "stash@{0}"]);
    });

    it("marks an entry git could not number as unaddressable instead of guessing a position", () => {
        const rows = toStashRows(
            [{ index: Number.NaN, message: "On main: broken selector", date: String(NOW_S - 5) }],
            NOW,
        );

        expect(rows[0].index).toBeNull();
        expect(rows[0].ref).toBe("stash@{unknown}");
    });

    it("rejects a negative index rather than addressing the wrong reflog entry", () => {
        const rows = toStashRows([{ index: -1, message: "On main: bogus", date: String(NOW_S) }], NOW);
        expect(rows[0].index).toBeNull();
    });

    it("sorts undated entries last and keeps their original order", () => {
        const rows = toStashRows(
            [
                { index: 0, message: "On main: undated a", date: "" },
                entry(1, "On main: dated", 60),
                { index: 2, message: "On main: undated b", date: "junk" },
            ],
            NOW,
        );

        expect(rows.map((row) => row.index)).toEqual([1, 0, 2]);
        expect(rows[0].when).toBe("1m ago");
        expect(rows[1].when).toBe("time unknown");
        expect(rows[2].when).toBe("time unknown");
    });

    it("leaves entries in git's own order when every timestamp ties", () => {
        const rows = toStashRows(
            [entry(3, "On main: a", 60), entry(1, "On main: b", 60), entry(2, "On main: c", 60)],
            NOW,
        );
        expect(rows.map((row) => row.index)).toEqual([3, 1, 2]);
    });

    it("gives two identical entries distinct row keys", () => {
        const rows = toStashRows([entry(0, "On main: dup", 60), entry(1, "On main: dup", 60)], NOW);
        expect(rows[0].key).not.toBe(rows[1].key);
    });

    it("carries the branch out of the subject", () => {
        const rows = toStashRows([entry(0, "On release/2.0: ship it", 60)], NOW);
        expect(rows[0].branch).toBe("release/2.0");
        expect(rows[0].rawMessage).toBe("On release/2.0: ship it");
    });
});

describe("stashSelector", () => {
    it("names the ref a row will act on", () => {
        expect(stashSelector(3)).toBe("stash@{3}");
        expect(stashSelector(0)).toBe("stash@{0}");
        expect(stashSelector(null)).toBe("stash@{unknown}");
    });
});

describe("stashState", () => {
    const base = {
        repoPath: "/repo",
        projectPath: "/repo",
        loading: false,
        error: null,
        entries: null as GitStashEntry[] | null,
        nowMs: NOW,
    };

    it("blocks on a missing project", () => {
        expect(stashState({ ...base, repoPath: null, projectPath: null })).toEqual({
            kind: "blocked",
            reason: "no-project",
        });
    });

    it("blocks on a folder that is not a repository", () => {
        expect(stashState({ ...base, repoPath: null, projectPath: "/folder" })).toEqual({
            kind: "blocked",
            reason: "no-repo",
        });
    });

    it("stays blocked while loading, because there is nothing to load", () => {
        expect(stashState({ ...base, repoPath: null, loading: true }).kind).toBe("blocked");
    });

    it("reports an unreadable stash list as failed, not as no stashes", () => {
        expect(stashState({ ...base, error: "fatal: not a git repository", entries: [] })).toEqual({
            kind: "failed",
            message: "fatal: not a git repository",
        });
    });

    it("keeps a failure visible even when a previous list is still in state", () => {
        const state = stashState({ ...base, error: "boom", entries: [entry(0, "On main: a", 10)] });
        expect(state.kind).toBe("failed");
    });

    it("is loading until a first list lands", () => {
        expect(stashState({ ...base, loading: true }).kind).toBe("loading");
        expect(stashState({ ...base, entries: null }).kind).toBe("loading");
    });

    it("is ready with no rows when git reported an empty stash list", () => {
        const state = stashState({ ...base, entries: [] });
        expect(state.kind).toBe("ready");
        expect(state.kind === "ready" && state.rows).toEqual([]);
    });
});

describe("filterStashRows", () => {
    const rows = toStashRows(
        [entry(0, "On main: parser rewrite", 10), entry(1, "On feature/login: add oauth", 20)],
        NOW,
    );

    it("returns everything for an empty query", () => {
        expect(filterStashRows(rows, "   ")).toHaveLength(2);
    });

    it("matches the message regardless of case", () => {
        expect(filterStashRows(rows, "PARSER").map((row) => row.index)).toEqual([0]);
    });

    it("matches the branch", () => {
        expect(filterStashRows(rows, "login").map((row) => row.index)).toEqual([1]);
    });

    it("matches the ref", () => {
        expect(filterStashRows(rows, "stash@{1}").map((row) => row.index)).toEqual([1]);
    });

    it("returns nothing when no row matches", () => {
        expect(filterStashRows(rows, "zzz")).toEqual([]);
    });
});

describe("stashSaveOutcome", () => {
    const before = [entry(0, "On main: existing", 100)];

    it("reports a save when a new row appeared", () => {
        const after = [entry(0, "On main: fresh", 1), ...before];
        expect(stashSaveOutcome(before, after)).toBe("created");
    });

    it("reports a save when the list grew without changing the head", () => {
        expect(stashSaveOutcome(before, [before[0], entry(1, "On main: older", 500)])).toBe("created");
    });

    it("reports a save when the head changed even though the length did not", () => {
        // git drop stash@{0} from another window, then a push. Length matches, work happened.
        expect(stashSaveOutcome(before, [entry(0, "On main: something else", 50)])).toBe("created");
    });

    it("reports nothing to stash when a push on a clean tree left the list untouched", () => {
        expect(stashSaveOutcome(before, before)).toBe("nothing-to-stash");
    });

    it("reports nothing to stash when the list was empty and stayed empty", () => {
        expect(stashSaveOutcome([], [])).toBe("nothing-to-stash");
    });

    it("reports a save when the first stash of an empty repo is created", () => {
        expect(stashSaveOutcome([], [entry(0, "On main: first", 1)])).toBe("created");
    });
});

const SAMPLE_PATCH = [
    "diff --git a/src/parser.ts b/src/parser.ts",
    "index 1234567..89abcde 100644",
    "--- a/src/parser.ts",
    "+++ b/src/parser.ts",
    "@@ -1,3 +1,4 @@",
    " const first = 1;",
    "-const second = 2;",
    "+const second = 3;",
    "+const third = 4;",
    "diff --git a/docs/new.md b/docs/new.md",
    "new file mode 100644",
    "index 0000000..e69de29",
    "--- /dev/null",
    "+++ b/docs/new.md",
    "@@ -0,0 +1,2 @@",
    "+# New",
    "+",
    "diff --git a/old/gone.ts b/old/gone.ts",
    "deleted file mode 100644",
    "index e69de29..0000000",
    "--- a/old/gone.ts",
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
    "-const gone = 1;",
    "-const gone = 2;",
    "diff --git a/img/logo.png b/img/logo.png",
    "index aaaaaaa..bbbbbbb 100644",
    "Binary files a/img/logo.png and b/img/logo.png differ",
    "",
].join("\n");

describe("parseStashDiff", () => {
    it("counts insertions and deletions across every file in the patch", () => {
        const diff = parseStashDiff(SAMPLE_PATCH);
        expect(diff.filesChanged).toBe(4);
        expect(diff.insertions).toBe(4);
        expect(diff.deletions).toBe(3);
    });

    it("names each file from the diff header", () => {
        expect(parseStashDiff(SAMPLE_PATCH).files.map((file) => file.path)).toEqual([
            "src/parser.ts",
            "docs/new.md",
            "old/gone.ts",
            "img/logo.png",
        ]);
    });

    it("classifies added, removed and binary files from their headers", () => {
        expect(parseStashDiff(SAMPLE_PATCH).files.map((file) => file.status)).toEqual([
            "modified",
            "added",
            "removed",
            "binary",
        ]);
    });

    it("does not count the --- and +++ header lines as changes", () => {
        const file = parseStashDiff(SAMPLE_PATCH).files[0];
        expect(file.insertions).toBe(2);
        expect(file.deletions).toBe(1);
    });

    it("splits a hunk body into context, added and removed lines", () => {
        expect(parseStashDiff(SAMPLE_PATCH).files[0].lines).toEqual([
            { kind: "context", text: "const first = 1;" },
            { kind: "removed", text: "const second = 2;" },
            { kind: "added", text: "const second = 3;" },
            { kind: "added", text: "const third = 4;" },
        ]);
    });

    it("counts an added line whose text is empty", () => {
        const added = parseStashDiff(SAMPLE_PATCH).files[1];
        expect(added.insertions).toBe(2);
        expect(added.deletions).toBe(0);
        expect(added.lines).toEqual([
            { kind: "added", text: "# New" },
            { kind: "added", text: "" },
        ]);
    });

    it("counts a removed line whose own text starts with -- as a deletion, not a header", () => {
        const sql = [
            "diff --git a/q.sql b/q.sql",
            "--- a/q.sql",
            "+++ b/q.sql",
            "@@ -1,2 +1,1 @@",
            "--- SELECT 1",
            "-SELECT 1",
            "+SELECT 2",
        ].join("\n");
        const diff = parseStashDiff(sql);
        expect(diff.deletions).toBe(2);
        expect(diff.insertions).toBe(1);
        expect(diff.files[0].path).toBe("q.sql");
        expect(diff.files[0].lines).toEqual([
            { kind: "removed", text: "-- SELECT 1" },
            { kind: "removed", text: "SELECT 1" },
            { kind: "added", text: "SELECT 2" },
        ]);
    });

    it("counts an added line whose own text starts with ++ as an insertion, not a header", () => {
        const c = [
            "diff --git a/m.c b/m.c",
            "--- a/m.c",
            "+++ b/m.c",
            "@@ -0,0 +1,1 @@",
            "+++ preprocessor_thing();",
        ].join("\n");
        const diff = parseStashDiff(c);
        expect(diff.insertions).toBe(1);
        expect(diff.files[0].status).toBe("modified");
        expect(diff.files[0].lines).toEqual([{ kind: "added", text: "++ preprocessor_thing();" }]);
    });

    it("treats a no-newline marker as neither an insertion nor a deletion", () => {
        const withMarker = [
            "diff --git a/a.txt b/a.txt",
            "--- a/a.txt",
            "+++ b/a.txt",
            "@@ -1 +1 @@",
            "-old",
            "+new",
            "\\ No newline at end of file",
        ].join("\n");
        const diff = parseStashDiff(withMarker);
        expect(diff.insertions).toBe(1);
        expect(diff.deletions).toBe(1);
    });

    it("keeps whole-patch totals while truncating the lines it retains", () => {
        const many = [
            "diff --git a/big.txt b/big.txt",
            "--- a/big.txt",
            "+++ b/big.txt",
            "@@ -0,0 +1,30 @@",
            ...Array.from({ length: 30 }, (_, i) => `+line ${i}`),
        ].join("\n");
        const diff = parseStashDiff(many, { maxLinesPerFile: 5 });

        expect(diff.insertions).toBe(30);
        expect(diff.files[0].lines).toHaveLength(5);
        expect(diff.files[0].linesTruncated).toBe(true);
    });

    it("keeps whole-patch totals while truncating the files it retains", () => {
        const manyFiles = Array.from({ length: 5 }, (_, i) =>
            [
                `diff --git a/f${i}.txt b/f${i}.txt`,
                `--- a/f${i}.txt`,
                `+++ b/f${i}.txt`,
                "@@ -0,0 +1 @@",
                `+body ${i}`,
            ].join("\n"),
        ).join("\n");
        const diff = parseStashDiff(manyFiles, { maxFiles: 2 });

        expect(diff.filesChanged).toBe(5);
        expect(diff.files).toHaveLength(2);
        expect(diff.insertions).toBe(5);
        expect(diff.filesTruncated).toBe(true);
    });

    it("reads a renamed file's old path from the rename header", () => {
        const renamed = [
            "diff --git a/old/name.ts b/new/name.ts",
            "similarity index 92%",
            "rename from old/name.ts",
            "rename to new/name.ts",
        ].join("\n");
        const file = parseStashDiff(renamed).files[0];
        expect(file.status).toBe("renamed");
        expect(file.previousPath).toBe("old/name.ts");
        expect(file.path).toBe("new/name.ts");
    });

    it("reads a path that git quoted because it contains a space", () => {
        const spaced = [
            'diff --git "a/my notes.md" "b/my notes.md"',
            '--- "a/my notes.md"',
            '+++ "b/my notes.md"',
            "@@ -0,0 +1 @@",
            "+hello",
        ].join("\n");
        const diff = parseStashDiff(spaced);
        expect(diff.files[0].path).toBe("my notes.md");
        expect(diff.insertions).toBe(1);
    });

    it("decodes a tab git escaped inside a quoted path", () => {
        const tabbed = [
            'diff --git "a/a\\tb.txt" "b/a\\tb.txt"',
            '--- "a/a\\tb.txt"',
            '+++ "b/a\\tb.txt"',
            "@@ -0,0 +1 @@",
            "+x",
        ].join("\n");
        expect(parseStashDiff(tabbed).files[0].path).toBe("a\tb.txt");
    });

    it("reports an empty patch as empty rather than as a failure", () => {
        const diff = parseStashDiff("");
        expect(diff.empty).toBe(true);
        expect(diff.filesChanged).toBe(0);
        expect(diff.insertions).toBe(0);
        expect(diff.deletions).toBe(0);
    });

    it("does not invent a file from trailing blank lines", () => {
        expect(parseStashDiff(SAMPLE_PATCH).filesChanged).toBe(4);
        expect(parseStashDiff(SAMPLE_PATCH + "\n\n").filesChanged).toBe(4);
    });

    it("reads a git binary patch body as a binary file with no line counts", () => {
        const binary = "diff --git a/x.bin b/x.bin\nGIT binary patch\n";
        const diff = parseStashDiff(binary);
        expect(diff.files[0].status).toBe("binary");
        expect(diff.insertions).toBe(0);
    });
});

describe("describeStashChange", () => {
    it("reads out the totals for the confirmation copy", () => {
        const diff = parseStashDiff(
            [
                "diff --git a/a.ts b/a.ts",
                "--- a/a.ts",
                "+++ b/a.ts",
                "@@ -0,0 +1,2 @@",
                "+one",
                "+two",
            ].join("\n"),
        );
        expect(describeStashChange(diff)).toBe("1 file, +2, -0");
    });

    it("uses the plural for more than one file", () => {
        const diff = parseStashDiff(
            [
                "diff --git a/a.ts b/a.ts",
                "--- a/a.ts",
                "+++ b/a.ts",
                "@@ -0,0 +1 @@",
                "+one",
                "diff --git a/b.ts b/b.ts",
                "--- a/b.ts",
                "+++ b/b.ts",
                "@@ -0,0 +1 @@",
                "+two",
            ].join("\n"),
        );
        expect(describeStashChange(diff)).toBe("2 files, +2, -0");
    });

    it("says so when the stash has no file changes", () => {
        expect(describeStashChange(parseStashDiff(""))).toBe("no file changes in this stash");
    });
});

describe("stashConfirmCopy", () => {
    const row = toStashRows([entry(4, "On main: parser rewrite", 60)], NOW)[0];
    const diff = parseStashDiff(
        [
            "diff --git a/a.ts b/a.ts",
            "--- a/a.ts",
            "+++ b/a.ts",
            "@@ -0,0 +1 @@",
            "+one",
        ].join("\n"),
    );

    it("names the ref and the counts for a pop", () => {
        expect(stashConfirmCopy("pop", row, diff)).toEqual({
            title: "Pop stash",
            message:
                "Apply stash@{4} (1 file, +1, -0) to the working tree, then delete it from the stash list?",
            okLabel: "Pop",
        });
    });

    it("tells the user a drop cannot be undone", () => {
        expect(stashConfirmCopy("drop", row, diff).message).toBe(
            "Delete stash@{4} (1 file, +1, -0)? The changes in it are gone once this finishes.",
        );
    });

    it("says the stash stays behind for an apply", () => {
        expect(stashConfirmCopy("apply", row, diff).message).toContain("stays in the list");
    });

    it("still names the ref when no preview was loaded", () => {
        expect(stashConfirmCopy("drop", row, null).message).toBe(
            "Delete stash@{4}? The changes in it are gone once this finishes.",
        );
    });
});