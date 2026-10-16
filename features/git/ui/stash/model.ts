import type { GitStashEntry } from "@/lib/backend/types";

export type StashAction = "apply" | "pop" | "drop";

export type StashState =
    | { kind: "blocked"; reason: "no-project" | "no-repo" }
    | { kind: "loading" }
    | { kind: "failed"; message: string }
    | { kind: "ready"; rows: StashRow[] };

export type StashRow = {
    /** Stable across re-renders; derived from the reflog selector git reported. */
    key: string;
    /**
     * The reflog position to send to apply, pop and drop. This is the selector git
     * printed, never the position of the row on screen. A stash's reflog position
     * shifts when anything above it is dropped, so deriving it from the display
     * order is how a panel ends up applying the wrong stash to a working tree.
     * `null` means the selector was unparseable and the row cannot be addressed.
     */
    index: number | null;
    ref: string;
    label: string;
    rawMessage: string;
    branch: string | null;
    when: string;
};

export type StashDiffLine = { kind: "added" | "removed" | "context"; text: string };

export type StashDiffFile = {
    path: string;
    previousPath: string | null;
    status: "added" | "removed" | "modified" | "renamed" | "binary";
    insertions: number;
    deletions: number;
    lines: StashDiffLine[];
    linesTruncated: boolean;
};

export type StashDiff = {
    files: StashDiffFile[];
    filesChanged: number;
    insertions: number;
    deletions: number;
    filesTruncated: boolean;
    empty: boolean;
};

const GIT_HASH = /^[0-9a-f]{7,40}$/i;

/** `On main: message`, or `WIP on main: 1a2b3c4 some message`. A branch name cannot contain `:`. */
const STASH_SUBJECT = /^(On|WIP on) ([\s\S]+?): ([\s\S]+)$/;

export function stashSubject(raw: string): { branch: string | null; label: string } {
    const text = String(raw ?? "").trim();
    const match = text.match(STASH_SUBJECT);
    if (!match) {
        return { branch: null, label: text || "No message" };
    }
    const [, kind, rawBranch, rest] = match;
    const branch = rawBranch.trim() || null;
    let label = rest.trim();
    if (kind === "WIP on") {
        // With no -m, git writes the tip commit's short hash and then its subject.
        const withoutHash = label.match(/^([0-9a-f]{7,40})\s+([\s\S]*)$/i);
        if (withoutHash) label = withoutHash[2].trim();
        if (GIT_HASH.test(label)) label = "";
    }
    return { branch, label: label || "No message" };
}

/** `%ct` is unix seconds. Anything else is a row we cannot date, never a wrong date. */
export function stashTimestampSeconds(date: string): number | null {
    const trimmed = String(date ?? "").trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const seconds = Number(trimmed);
    if (!Number.isSafeInteger(seconds) || seconds <= 0) return null;
    return seconds;
}

/**
 * `features/git/ui/graph/utils.tsx` has `getRelativeTime` for the same seconds input, but it
 * reads `new Date()` internally so it cannot be tested against a fixed clock, and it renders
 * `NaNy ago` for a malformed timestamp and `-300s ago` for a clock-skewed future one. This is
 * the stash-panel copy, with the clock injected. The two should be consolidated once the graph
 * panel's module is open to change.
 */
export function stashRelativeTime(date: string, nowMs: number): string {
    const seconds = stashTimestampSeconds(date);
    if (seconds === null) return "time unknown";
    const elapsed = Math.floor(nowMs / 1000) - seconds;
    if (elapsed < 60) return "just now";
    const minutes = Math.floor(elapsed / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(months / 12)}y ago`;
}

export function stashSelector(index: number | null): string {
    return index === null ? "stash@{unknown}" : `stash@{${index}}`;
}

/**
 * Newest first. Sorting moves rows, so the reflog selector travels with the entry
 * and is never recomputed from the new position. Entries git could not date sort
 * last and keep their original relative order.
 */
export function toStashRows(entries: GitStashEntry[], nowMs: number): StashRow[] {
    const rows = entries.map((entry, position) => {
        const index = Number.isSafeInteger(entry.index) && entry.index >= 0 ? entry.index : null;
        const { branch, label } = stashSubject(entry.message);
        const row: StashRow = {
            key: `${index ?? "?"}:${entry.message}:${entry.date}`,
            index,
            ref: stashSelector(index),
            label,
            rawMessage: entry.message,
            branch,
            when: stashRelativeTime(entry.date, nowMs),
        };
        return { row, position, seconds: stashTimestampSeconds(entry.date) };
    });

    rows.sort((a, b) => {
        if (a.seconds === null && b.seconds === null) return a.position - b.position;
        if (a.seconds === null) return 1;
        if (b.seconds === null) return -1;
        if (b.seconds !== a.seconds) return b.seconds - a.seconds;
        return a.position - b.position;
    });

    return rows.map((item) => item.row);
}

export function stashState(opts: {
    repoPath: string | null;
    projectPath: string | null;
    loading: boolean;
    error: string | null;
    entries: GitStashEntry[] | null;
    nowMs: number;
}): StashState {
    if (!opts.repoPath) {
        return { kind: "blocked", reason: opts.projectPath ? "no-repo" : "no-project" };
    }
    if (opts.error !== null) return { kind: "failed", message: opts.error };
    if (opts.loading || opts.entries === null) return { kind: "loading" };
    return { kind: "ready", rows: toStashRows(opts.entries, opts.nowMs) };
}

export function filterStashRows(rows: StashRow[], query: string): StashRow[] {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
        (row) =>
            row.label.toLowerCase().includes(q) ||
            (row.branch?.toLowerCase().includes(q) ?? false) ||
            row.ref.toLowerCase().includes(q),
    );
}

function entrySignature(entry: GitStashEntry): string {
    return `${entry.index} ${entry.message} ${entry.date}`;
}

/**
 * `git stash push` exits 0 on a clean tree and writes nothing, so the panel has to
 * notice that no row appeared rather than report a stash it did not make.
 */
export function stashSaveOutcome(
    before: GitStashEntry[],
    after: GitStashEntry[],
): "created" | "nothing-to-stash" {
    if (after.length !== before.length) return "created";
    const headBefore = before[0] ? entrySignature(before[0]) : null;
    const headAfter = after[0] ? entrySignature(after[0]) : null;
    return headBefore === headAfter ? "nothing-to-stash" : "created";
}

const GIT_ESCAPES: Record<string, string> = {
    a: "\u0007",
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t",
    v: "\v",
    '"': '"',
    "\\": "\\",
};

function unquoteGitPath(token: string): string {
    const text = token.trim();
    if (!text.startsWith('"') || !text.endsWith('"') || text.length < 2) return text;
    let out = "";
    for (let i = 1; i < text.length - 1; i += 1) {
        const ch = text[i];
        if (ch !== "\\") {
            out += ch;
            continue;
        }
        const next = text[i + 1];
        if (next === undefined) {
            out += ch;
            continue;
        }
        if (next in GIT_ESCAPES) {
            out += GIT_ESCAPES[next];
            i += 1;
            continue;
        }
        const octal = text.slice(i + 1, i + 4);
        if (/^[0-7]{3}$/.test(octal)) {
            out += String.fromCharCode(parseInt(octal, 8));
            i += 3;
            continue;
        }
        out += next;
        i += 1;
    }
    return out;
}

function stripPathPrefix(token: string, prefix: string): string | null {
    const path = unquoteGitPath(token);
    if (path === "/dev/null") return null;
    if (!path.startsWith(prefix)) return null;
    return path.slice(prefix.length);
}

/** Splits `diff --git a/x b/y` into its two path tokens, honouring git's quoting. */
function splitDiffGitPaths(rest: string): { oldPath: string | null; newPath: string | null } {
    const tokens: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < rest.length; i += 1) {
        const ch = rest[i];
        if (ch === "\\") {
            current += ch + (rest[i + 1] ?? "");
            i += 1;
            continue;
        }
        if (ch === '"') {
            inQuotes = !inQuotes;
            current += ch;
            continue;
        }
        if (!inQuotes && (ch === " " || ch === "\t")) {
            if (current) tokens.push(current);
            current = "";
            continue;
        }
        current += ch;
    }
    if (current) tokens.push(current);
    if (tokens.length !== 2) return { oldPath: null, newPath: null };
    return {
        oldPath: stripPathPrefix(tokens[0], "a/"),
        newPath: stripPathPrefix(tokens[1], "b/"),
    };
}

export type ParseStashDiffOptions = {
    /** Retained lines per file. Counts always describe the whole patch. */
    maxLinesPerFile?: number;
    /** Retained files. Totals always describe the whole patch. */
    maxFiles?: number;
};

const DEFAULT_MAX_LINES_PER_FILE = 24;
const DEFAULT_MAX_FILES = 20;

/**
 * `git stash show -p` prints a unified diff against the stash's first parent. Only lines
 * inside a hunk body are counted: `+++` and `---` are headers, and a bare `\ No newline at
 * end of file` is neither an insertion nor a deletion.
 */
export function parseStashDiff(patch: string, options: ParseStashDiffOptions = {}): StashDiff {
    const maxLinesPerFile = Math.max(0, Math.trunc(options.maxLinesPerFile ?? DEFAULT_MAX_LINES_PER_FILE));
    const maxFiles = Math.max(0, Math.trunc(options.maxFiles ?? DEFAULT_MAX_FILES));

    const text = String(patch ?? "");
    const lines = text.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

    const files: StashDiffFile[] = [];
    let file: StashDiffFile | null = null;
    let inHunk = false;

    const finish = () => {
        if (file) files.push(file);
        file = null;
        inHunk = false;
    };

    const makeFile = (path: string | null, previousPath: string | null): StashDiffFile => ({
        path: path ?? "(unknown file)",
        previousPath,
        status: "modified",
        insertions: 0,
        deletions: 0,
        lines: [],
        linesTruncated: false,
    });

    for (const raw of lines) {
        const line = raw.replace(/\r$/, "");
        if (line.startsWith("diff --git ")) {
            const { oldPath, newPath } = splitDiffGitPaths(line.slice("diff --git ".length));
            finish();
            file = makeFile(newPath ?? oldPath, newPath === null ? oldPath : null);
            continue;
        }
        if (!file) continue;
        // Header lines are only headers before the first @@. Once a hunk is open, a
        // removed line whose text starts with "-- " prints as "--- " and must be counted
        // as a deletion, not swallowed as a path header.
        if (!inHunk) {
            if (line.startsWith("@@")) {
                inHunk = true;
            } else if (line.startsWith("--- ")) {
                if (stripPathPrefix(line.slice(4), "a/") === null) file.status = "added";
            } else if (line.startsWith("+++ ")) {
                if (stripPathPrefix(line.slice(4), "b/") === null) file.status = "removed";
            } else if (line.startsWith("new file mode")) {
                file.status = "added";
            } else if (line.startsWith("deleted file mode")) {
                file.status = "removed";
            } else if (line.startsWith("rename from ")) {
                file.status = "renamed";
                file.previousPath = unquoteGitPath(line.slice("rename from ".length));
            } else if (line.startsWith("rename to ")) {
                file.status = "renamed";
                file.path = unquoteGitPath(line.slice("rename to ".length));
            } else if (
                line.startsWith("Binary files ") ||
                line.startsWith("GIT binary patch")
            ) {
                file.status = "binary";
            }
            continue;
        }

        if (line.startsWith("+")) {
            file.insertions += 1;
            if (file.lines.length < maxLinesPerFile) file.lines.push({ kind: "added", text: line.slice(1) });
            else file.linesTruncated = true;
            continue;
        }
        if (line.startsWith("-")) {
            file.deletions += 1;
            if (file.lines.length < maxLinesPerFile) file.lines.push({ kind: "removed", text: line.slice(1) });
            else file.linesTruncated = true;
            continue;
        }
        if (line.startsWith(" ")) {
            if (file.lines.length < maxLinesPerFile) file.lines.push({ kind: "context", text: line.slice(1) });
            continue;
        }
        // `\ No newline at end of file` and anything else git prints inside a hunk body.
        inHunk = false;
    }
    finish();

    const kept = files.slice(0, maxFiles);
    return {
        files: kept,
        filesChanged: files.length,
        insertions: files.reduce((sum, item) => sum + item.insertions, 0),
        deletions: files.reduce((sum, item) => sum + item.deletions, 0),
        filesTruncated: files.length > kept.length,
        empty: files.length === 0,
    };
}

export function describeStashChange(diff: StashDiff): string {
    if (diff.empty) return "no file changes in this stash";
    const files = `${diff.filesChanged} ${diff.filesChanged === 1 ? "file" : "files"}`;
    return `${files}, +${diff.insertions}, -${diff.deletions}`;
}

/**
 * Reading the clock through one helper keeps it out of the render body, the way the
 * graph panel hides `new Date()` inside `getRelativeTime`. It is also the seam tests
 * replace when they need the relative-time labels to be stable.
 */
export function stashNow(): number {
    return Date.now();
}

/** Copy for the confirmation a destructive stash action must stop on. */
export function stashConfirmCopy(
    action: StashAction,
    row: StashRow,
    diff: StashDiff | null,
): { title: string; message: string; okLabel: string } {
    const what = diff ? `${row.ref} (${describeStashChange(diff)})` : row.ref;
    if (action === "apply") {
        return {
            title: "Apply stash",
            message: `Apply ${what} to the working tree? The stash stays in the list.`,
            okLabel: "Apply",
        };
    }
    if (action === "pop") {
        return {
            title: "Pop stash",
            message: `Apply ${what} to the working tree, then delete it from the stash list?`,
            okLabel: "Pop",
        };
    }
    return {
        title: "Drop stash",
        message: `Delete ${what}? The changes in it are gone once this finishes.`,
        okLabel: "Drop",
    };
}