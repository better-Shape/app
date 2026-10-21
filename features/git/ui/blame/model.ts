import { getRelativeTime } from "@/features/git/ui/graph/utils";
import type { BlameLine } from "@/lib/backend";

/**
 * One record as `git_blame_file` returns it.
 *
 * The Rust loop walks `blame.len()`, which git2 defines as the hunk count, so the
 * payload carries one record per blame REGION rather than one per file line.
 * `line` is the one-based first line of the region in the file being blamed and
 * `line_count` is how many consecutive lines it covers, both read from the hunk.
 */
export type BlameEntry = {
    /** One-based first line of this region in the file. */
    line: number;
    /** How many consecutive lines the region covers. At least 1. */
    lineCount: number;
    commit: string;
    author: string;
    /** Unix epoch seconds, parsed from the backend's string. Null when unparseable. */
    at: number | null;
    summary: string;
};

export type BlameGroup = {
    commit: string;
    author: string;
    summary: string;
    at: number | null;
    /** First and last file line covered by the group. */
    from: number;
    to: number;
    /** How many returned records the group merged. */
    count: number;
};

export type BlameState =
    | { kind: "no-project" }
    /** Nothing about the request was wrong; the same file will keep giving this. */
    | { kind: "blocked"; reason: string; detail?: string }
    | { kind: "loading" }
    | { kind: "failed"; message: string }
    | {
          kind: "ready";
          fileLabel: string;
          regions: number;
          groups: BlameGroup[];
          commits: number;
          authors: number;
      };

const UNKNOWN_AUTHOR = "Unknown author";
const NO_SUMMARY = "No commit message.";
const UNKNOWN_DATE = "Date unavailable";

export function safeAuthor(raw: unknown): string {
    if (typeof raw !== "string") return UNKNOWN_AUTHOR;
    const trimmed = raw.trim();
    return trimmed ? trimmed : UNKNOWN_AUTHOR;
}

export function safeSummary(raw: unknown): string {
    if (typeof raw !== "string") return NO_SUMMARY;
    const trimmed = raw.trim();
    return trimmed ? trimmed : NO_SUMMARY;
}

/** The backend sends `commit.time().seconds()` as a string. Anything else is unparsed, never NaN. */
export function parseBlameDate(raw: unknown): number | null {
    const value = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.floor(value);
}

/**
 * The last file line a region covers. A hunk always covers at least one line, so
 * a missing or nonsensical `line_count` collapses to a single line rather than
 * producing an inverted span.
 */
export function regionEndLine(entry: BlameEntry): number {
    return entry.line + Math.max(1, entry.lineCount) - 1;
}

export function toBlameEntry(raw: BlameLine | null | undefined): BlameEntry {
    return {
        line: Math.max(1, Math.floor(Number(raw?.line)) || 1),
        lineCount: Math.max(1, Math.floor(Number(raw?.line_count)) || 1),
        commit: typeof raw?.commit === "string" ? raw.commit.trim() : "",
        author: safeAuthor(raw?.author),
        at: parseBlameDate(raw?.date),
        summary: safeSummary(raw?.summary),
    };
}

/**
 * `line` counts up through the file, so sorting on it restores file order for a
 * payload that arrived shuffled, and leaves an in-order payload untouched.
 */
export function orderBlameEntries(entries: BlameEntry[]): BlameEntry[] {
    return [...entries].sort((a, b) => a.line - b.line);
}

/**
 * Merge regions that name the same commit and sit next to each other. A group's
 * span runs from the first region's start line to the last region's end line, so
 * a group of three one-line regions reads `4-6` rather than `4-6` by accident of
 * counting regions.
 */
export function groupBlame(entries: BlameEntry[]): BlameGroup[] {
    const groups: BlameGroup[] = [];
    for (const entry of orderBlameEntries(entries)) {
        const last = groups[groups.length - 1];
        if (last && last.commit === entry.commit) {
            last.to = regionEndLine(entry);
            last.count += 1;
            continue;
        }
        groups.push({
            commit: entry.commit,
            author: entry.author,
            summary: entry.summary,
            at: entry.at,
            from: entry.line,
            to: regionEndLine(entry),
            count: 1,
        });
    }
    return groups;
}

export function pluralRegions(count: number): string {
    return `${count} ${count === 1 ? "region" : "regions"}`;
}

export function pluralAuthors(count: number): string {
    return `${count} ${count === 1 ? "author" : "authors"}`;
}

export function pluralCommits(count: number): string {
    return `${count} ${count === 1 ? "commit" : "commits"}`;
}

/**
 * A heavily edited file can hand back thousands of regions, and the workspace
 * panel is a narrow column. Rendering all of them in one go costs more than the
 * list is worth, so the panel shows a prefix and offers the rest on request.
 */
export const DEFAULT_GROUP_LIMIT = 200;

export function visibleBlameGroups(groups: BlameGroup[], limit: number): BlameGroup[] {
    const cap = Math.max(0, Math.floor(limit));
    return groups.slice(0, cap);
}

/**
 * `getRelativeTime` returns "NaNy ago" for a string it cannot parse, and a
 * negative age for a clock that runs ahead. Both are worse than a plain date, so
 * an unparseable or future epoch falls back to the day it names.
 *
 * `nowSeconds` is Unix epoch seconds, the same unit `at` uses. The helper reads
 * the real clock for the relative form, so `nowSeconds` only decides whether the
 * stamp is in the future.
 */
export function formatBlameDate(at: number | null, nowSeconds: number): string {
    if (at === null) return UNKNOWN_DATE;
    if (at > nowSeconds) return new Date(at * 1000).toISOString().slice(0, 10);
    return getRelativeTime(String(at));
}

/**
 * The reason a path cannot be blamed, when it is knowable without asking git.
 * Anything the panel cannot decide here stays a `failed` state carrying git's
 * own message, because the backend does not classify the failure for us.
 */
export function blameBlockedReason(filePath: string | null, projectPath: string | null): string | null {
    if (!projectPath) return "No project open";
    if (!filePath) return "No file open";
    if (filePath.startsWith("bettershape://")) return "This is a browser tab, not a file on disk";
    if (filePath.startsWith("diff:")) return "This is a diff view, not a file on disk";
    if (isOutsideProject(filePath, projectPath)) {
        return "This file sits outside the project folder, so git has no path for it";
    }
    return null;
}

/**
 * `resolve_repo_relative_path` in src-tauri/src/commands/git/mod.rs falls back to
 * the last path segment when a file is outside the repository. A file called
 * `README.md` outside the repo would then be blamed as the repository's own
 * README, so the panel refuses the path instead of attributing lines wrongly.
 */
export function isOutsideProject(filePath: string, projectPath: string): boolean {
    const full = String(filePath ?? "").replace(/\\/g, "/");
    const base = String(projectPath ?? "").replace(/\\/g, "/").replace(/(?<!\/)\/+$/, "");
    if (!full || !base) return false;
    return !full.toLowerCase().startsWith(`${base.toLowerCase()}/`);
}

export function relativeLabel(projectPath: string | null, filePath: string): string {
    const full = String(filePath ?? "").replace(/\\/g, "/");
    if (!full) return "unknown file";
    const base = String(projectPath ?? "").replace(/\\/g, "/").replace(/(?<!\/)\/+$/, "");
    if (!base) return full;
    return full.toLowerCase().startsWith(`${base.toLowerCase()}/`)
        ? full.slice(base.length + 1)
        : full;
}

export function blameState(input: {
    projectPath: string | null;
    filePath: string | null;
    status: "loading" | "loaded" | "failed";
    message: string | null;
    lines: BlameLine[] | null;
}): BlameState {
    if (!input.projectPath) return { kind: "no-project" };
    if (!input.filePath) return { kind: "blocked", reason: "No file open" };
    const blocked = blameBlockedReason(input.filePath, input.projectPath);
    if (blocked) return { kind: "blocked", reason: blocked };
    if (input.status === "loading") return { kind: "loading" };
    if (input.status === "failed") {
        return {
            kind: "failed",
            message: input.message?.trim() || "Git gave no reason.",
        };
    }
    const entries = (Array.isArray(input.lines) ? input.lines : []).map(toBlameEntry);
    const groups = groupBlame(entries);
    return {
        kind: "ready",
        fileLabel: relativeLabel(input.projectPath, input.filePath),
        regions: entries.length,
        groups,
        commits: new Set(groups.map((group) => group.commit)).size,
        authors: new Set(groups.map((group) => group.author)).size,
    };
}