import type { ContentMatch, ContentSearchResult, ReplaceResult, SearchOptions } from "@/lib/backend";

/**
 * The boolean fields `SearchOptions` declares in
 * `src-tauri/src/commands/fs/mod.rs`. `SearchOptions` is `#[derive(Deserialize)]`
 * with every non-`Option` field required, so a field added in Rust without a
 * counterpart here makes the whole invoke fail to deserialise.
 */
export type SearchOptionKey =
    | "case_sensitive"
    | "whole_word"
    | "is_regex"
    | "respect_gitignore"
    | "include_hidden"
    | "follow_symlinks"
    | "exclude_tests"
    | "exclude_docs"
    | "exclude_build"
    | "exclude_assets"
    | "only_source";

export const SEARCH_OPTION_KEYS: readonly SearchOptionKey[] = [
    "case_sensitive",
    "whole_word",
    "is_regex",
    "respect_gitignore",
    "include_hidden",
    "follow_symlinks",
    "exclude_tests",
    "exclude_docs",
    "exclude_build",
    "exclude_assets",
    "only_source",
];

export const SEARCH_OPTION_LABEL: Record<SearchOptionKey, string> = {
    case_sensitive: "Match case",
    whole_word: "Whole word",
    is_regex: "Regular expression",
    respect_gitignore: "Respect .gitignore",
    include_hidden: "Include hidden files",
    follow_symlinks: "Follow symlinks",
    exclude_tests: "Exclude tests",
    exclude_docs: "Exclude docs",
    exclude_build: "Exclude build output",
    exclude_assets: "Exclude assets",
    only_source: "Only source files",
};

export type SearchSettings = {
    flags: Record<SearchOptionKey, boolean>;
    includePattern: string;
    excludePattern: string;
};

/**
 * Every filter that would hide a match defaults to off. A panel that silently
 * omits files reads as "there is nothing here", which is the one thing this
 * feature must not do — an off filter costs the user a click, a wrong default
 * costs them the truth.
 */
const DEFAULT_FLAGS: Record<SearchOptionKey, boolean> = {
    case_sensitive: false,
    whole_word: false,
    is_regex: false,
    respect_gitignore: true,
    include_hidden: false,
    follow_symlinks: false,
    exclude_tests: false,
    exclude_docs: false,
    exclude_build: false,
    exclude_assets: false,
    only_source: false,
};

export function defaultSearchSettings(): SearchSettings {
    return { flags: { ...DEFAULT_FLAGS }, includePattern: "", excludePattern: "" };
}

export function toggleSearchFlag(settings: SearchSettings, key: SearchOptionKey): SearchSettings {
    return { ...settings, flags: { ...settings.flags, [key]: !settings.flags[key] } };
}

export function setSearchPattern(
    settings: SearchSettings,
    which: "include" | "exclude",
    value: string,
): SearchSettings {
    return which === "include" ? { ...settings, includePattern: value } : { ...settings, excludePattern: value };
}

/** Exactly the payload `search_content` / `replace_content` expect. */
export function toSearchOptions(settings: SearchSettings): SearchOptions {
    const include = settings.includePattern.trim();
    const exclude = settings.excludePattern.trim();
    return {
        case_sensitive: settings.flags.case_sensitive,
        whole_word: settings.flags.whole_word,
        is_regex: settings.flags.is_regex,
        respect_gitignore: settings.flags.respect_gitignore,
        include_hidden: settings.flags.include_hidden,
        follow_symlinks: settings.flags.follow_symlinks,
        exclude_tests: settings.flags.exclude_tests,
        exclude_docs: settings.flags.exclude_docs,
        exclude_build: settings.flags.exclude_build,
        exclude_assets: settings.flags.exclude_assets,
        only_source: settings.flags.only_source,
        include_pattern: include ? include : undefined,
        exclude_pattern: exclude ? exclude : undefined,
    };
}

/** Null when a search can run. A string when it must not — never both "no match" and "didn't run". */
export function searchBlockedReason(query: string, settings: SearchSettings): string | null {
    if (!query.trim()) return "Type something to search for.";
    if (!settings.flags.is_regex) return null;
    try {
        // Not a guarantee: JavaScript's and Rust's regex grammars differ, so a
        // pattern that reads here can still be rejected by ripgrep.
        new RegExp(query);
        return null;
    } catch (error) {
        return `JavaScript couldn't read "${query}" as a regular expression, so nothing was searched. ${describeError(error)}`;
    }
}

export function describeError(error: unknown): string {
    const text =
        typeof error === "string" ? error : error instanceof Error ? error.message : String(error ?? "");
    const trimmed = text.trim();
    return trimmed || "The backend gave no reason.";
}

export type SearchHit = {
    /** Absolute path from `ContentSearchResult.path` — what `openDiagnostic` needs. */
    path: string;
    label: string;
    /** 1-based, as the editor jump expects. */
    line: number;
    /** 1-based, as the editor jump expects. `ContentMatch.column_start` is 0-based. */
    column: number;
    lineText: string;
    /** 0-based offsets into `lineText`; `end === start` when the backend gave a zero-width hit. */
    start: number;
    end: number;
    /**
     * The untouched backend payload. `replace_content` filters on an exact
     * (line_number, column_start, column_end) triple, and the offsets above are
     * clamped for display — rebuilding the triple from clamped numbers could
     * quietly turn "replace this one" into "replace nothing".
     */
    raw: ContentMatch;
};

export type SearchFileGroup = {
    path: string;
    label: string;
    hits: SearchHit[];
};

export type SearchSummary = { files: number; matches: number };

function clamp(value: number, low: number, high: number): number {
    return Math.min(Math.max(value, low), high);
}

/** One backend match as a renderable row, or null when the coordinates are unusable. */
export function toHit(result: ContentSearchResult, match: ContentMatch): SearchHit | null {
    const line = Number(match?.line_number);
    if (!Number.isFinite(line) || line < 1) return null;
    const lineText = typeof match?.line_text === "string" ? match.line_text : "";
    const rawStart = Number(match?.column_start);
    const rawEnd = Number(match?.column_end);
    const start = clamp(Number.isFinite(rawStart) ? rawStart : 0, 0, lineText.length);
    const end = clamp(Number.isFinite(rawEnd) ? rawEnd : start, start, lineText.length);
    return {
        path: typeof result?.path === "string" ? result.path : "",
        label: typeof result?.relative_path === "string" ? result.relative_path : "",
        line: Math.floor(line),
        column: start + 1,
        lineText,
        start,
        end,
        raw: match,
    };
}

/** Grouped by `relative_path`; files alphabetically, hits top to bottom. */
export function groupMatches(results: ContentSearchResult[]): SearchFileGroup[] {
    const byLabel = new Map<string, SearchFileGroup>();
    for (const result of Array.isArray(results) ? results : []) {
        const label = typeof result?.relative_path === "string" ? result.relative_path : "";
        if (!label) continue;
        const bucket = byLabel.get(label);
        const hits: SearchHit[] = [];
        for (const match of Array.isArray(result?.matches) ? result.matches : []) {
            const hit = toHit(result, match);
            if (hit) hits.push(hit);
        }
        if (hits.length === 0) continue;
        if (bucket) {
            // Two entries for one file would mean the backend split it; keep both halves.
            if (result.path && !bucket.path) bucket.path = result.path;
            bucket.hits.push(...hits);
        } else {
            byLabel.set(label, { path: typeof result.path === "string" ? result.path : "", label, hits });
        }
    }
    return [...byLabel.values()]
        .map((group) => ({
            ...group,
            hits: [...group.hits].sort((a, b) => a.line - b.line || a.start - b.start),
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

export function summarizeSearch(groups: SearchFileGroup[]): SearchSummary {
    return {
        files: groups.length,
        matches: groups.reduce((total, group) => total + group.hits.length, 0),
    };
}

/**
 * `search_content` runs ripgrep with `-m 50` and stops parsing at `MAX_MATCHES`
 * = 3000, so a payload that lands exactly on either cap may be a slice of a
 * larger result set. Saying "12 matches" when 12,000 exist is the same lie as
 * saying "0 matches" when the search never ran.
 */
export const MATCHES_PER_FILE_CAP = 50;
export const MATCHES_TOTAL_CAP = 3000;

export function mayBeTruncated(groups: SearchFileGroup[]): boolean {
    const summary = summarizeSearch(groups);
    return (
        summary.matches >= MATCHES_TOTAL_CAP || groups.some((group) => group.hits.length >= MATCHES_PER_FILE_CAP)
    );
}

/** Bounds the DOM without hiding anything: whatever is dropped is counted out loud. */
export const RENDERED_HIT_CAP = 500;

export function limitGroups(
    groups: SearchFileGroup[],
    cap: number = RENDERED_HIT_CAP,
): { groups: SearchFileGroup[]; hidden: number } {
    let budget = Math.max(0, Math.floor(cap));
    let hidden = 0;
    const kept: SearchFileGroup[] = [];
    for (const group of groups) {
        if (budget <= 0) {
            hidden += group.hits.length;
            continue;
        }
        if (group.hits.length <= budget) {
            kept.push(group);
            budget -= group.hits.length;
            continue;
        }
        kept.push({ ...group, hits: group.hits.slice(0, budget) });
        hidden += group.hits.length - budget;
        budget = 0;
    }
    return { groups: kept, hidden };
}

export type SearchOutcome =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "done"; results: ContentSearchResult[] }
    | { status: "failed"; message: string };

export type SearchState =
    | { kind: "idle" }
    | { kind: "blocked"; reason: string }
    | { kind: "loading"; previous: SearchFileGroup[] | null }
    | { kind: "failed"; message: string }
    | { kind: "ready"; groups: SearchFileGroup[]; summary: SearchSummary; mayBeTruncated: boolean };

/**
 * The blocked and failed arms exist so that "the search did not happen" can
 * never be drawn as "the search happened and found nothing".
 */
export function deriveSearchState(
    query: string,
    settings: SearchSettings,
    previous: SearchFileGroup[] | null,
    outcome: SearchOutcome,
): SearchState {
    if (!query.trim()) return { kind: "idle" };
    const blocked = searchBlockedReason(query, settings);
    if (blocked) return { kind: "blocked", reason: blocked };
    if (outcome.status === "loading") return { kind: "loading", previous };
    if (outcome.status === "failed") return { kind: "failed", message: outcome.message };
    if (outcome.status === "idle") return { kind: "idle" };
    const groups = groupMatches(outcome.results);
    return { kind: "ready", groups, summary: summarizeSearch(groups), mayBeTruncated: mayBeTruncated(groups) };
}

export type ReplaceSummary =
    | { kind: "nothing" }
    | { kind: "partial"; files: number; replacements: number; errors: string[] }
    | { kind: "done"; files: number; replacements: number };

/**
 * `replace_content` writes each file as it goes, so a non-empty `errors` means
 * some files already changed and others did not — never a success.
 */
export function summarizeReplace(result: ReplaceResult | null): ReplaceSummary | null {
    if (!result) return null;
    const files = Math.max(0, Number(result.files_modified) || 0);
    const replacements = Math.max(0, Number(result.replacements_count) || 0);
    const errors = (Array.isArray(result.errors) ? result.errors : []).filter(
        (line): line is string => typeof line === "string" && line.trim().length > 0,
    );
    if (errors.length > 0) return { kind: "partial", files, replacements, errors };
    if (replacements === 0) return { kind: "nothing" };
    return { kind: "done", files, replacements };
}

export function pluralFiles(count: number): string {
    return `${count} ${count === 1 ? "file" : "files"}`;
}

export function pluralMatches(count: number): string {
    return `${count} ${count === 1 ? "match" : "matches"}`;
}
