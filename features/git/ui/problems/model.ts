import { getFileExtension } from "@/features/editor/lib/image-types";
import type { EslintDiagnostic } from "@/lib/backend";

export type ProblemSeverity = "error" | "warning" | "info";

export type SeverityCounts = Record<ProblemSeverity, number>;

export type Problem = {
    path: string;
    label: string;
    severity: ProblemSeverity;
    ruleId: string | null;
    message: string;
    line: number;
    column: number;
};

export type ProblemGroup = {
    path: string;
    label: string;
    problems: Problem[];
    counts: SeverityCounts;
};

export type ProblemSummary = SeverityCounts & { total: number };

export type ProblemsState =
    | { kind: "no-project" }
    | { kind: "no-files"; reason: string }
    | { kind: "loading"; detail?: string }
    | { kind: "failed"; message: string }
    | {
          kind: "ready";
          groups: ProblemGroup[];
          summary: ProblemSummary;
          lintedCount: number;
          skippedCount: number;
          partialErrors: { path: string; label: string; message: string }[];
      };

export const SEVERITY_LABEL: Record<ProblemSeverity, string> = {
    error: "Error",
    warning: "Warning",
    info: "Info",
};

const SEVERITY_RANK: Record<ProblemSeverity, number> = { error: 0, warning: 1, info: 2 };

/** ESLint only has parsers for these; anything else would be spawned for nothing. */
const LINTABLE_EXTENSIONS = new Set(["js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx"]);

const EMPTY_COUNTS: SeverityCounts = { error: 0, warning: 0, info: 0 };

/**
 * `eslint_lint_file` maps ESLint's numeric severity onto "error" | "warning" |
 * "info" itself (src-tauri/src/commands/lint/mod.rs), so the string arm is the
 * one that runs. The numeric arm keeps the panel honest if a raw ESLint payload
 * ever reaches it through another route.
 */
export function normalizeSeverity(raw: unknown): ProblemSeverity {
    if (typeof raw === "number") {
        return raw === 2 ? "error" : raw === 1 ? "warning" : "info";
    }
    const text = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (text === "error" || text === "2" || text === "fatal") return "error";
    if (text === "warning" || text === "warn" || text === "1") return "warning";
    return "info";
}

/** Line and column are rendered verbatim, so a missing one becomes 1 and never NaN. */
export function safePosition(raw: unknown, fallback = 1): number {
    const value = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(value) || value < 1) return fallback;
    return Math.floor(value);
}

export function safeRuleId(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
}

export function safeMessage(raw: unknown): string {
    if (typeof raw !== "string") return "No message from ESLint.";
    const trimmed = raw.trim();
    return trimmed ? trimmed : "No message from ESLint.";
}

/**
 * `line:column` for a problem entry.
 *
 * Diagnostics arrive from several parsers and a missing coordinate is `undefined`
 * rather than a number, so both arguments are accepted as `unknown` and run
 * through `safePosition`. Typing them as `number` meant a caller holding a real
 * diagnostic could not pass it without a cast.
 */
export function formatPosition(line: unknown, column: unknown): string {
    return `${safePosition(line)}:${safePosition(column)}`;
}

/** `diff:` entries and `bettershape://` tabs are editor-only views, not files on disk. */
export function isLintablePath(path: string): boolean {
    if (!path) return false;
    if (path.startsWith("bettershape://")) return false;
    if (path.startsWith("diff:")) return false;
    return LINTABLE_EXTENSIONS.has(getFileExtension(path));
}

/** Open files in the order the editor lists them, de-duplicated, capped by `limit`. */
export function selectLintTargets(paths: string[], limit: number): { targets: string[]; skipped: number } {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const path of paths) {
        if (!isLintablePath(path)) continue;
        const key = path.replace(/\\/g, "/").toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(path);
    }
    const cap = Math.max(0, Math.floor(limit));
    return { targets: unique.slice(0, cap), skipped: Math.max(0, unique.length - cap) };
}

/** Project-relative when the file lives under the project, absolute (and slash-normalised) otherwise. */
export function relativeLabel(projectPath: string | null, filePath: string): string {
    const full = String(filePath ?? "").replace(/\\/g, "/");
    if (!full) return "unknown file";
    const base = String(projectPath ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
    if (!base) return full;
    const lowerFull = full.toLowerCase();
    const lowerBase = base.toLowerCase();
    return lowerFull.startsWith(`${lowerBase}/`) ? full.slice(base.length + 1) : full;
}

/** Turns one backend payload into a renderable row. Never yields undefined or NaN. */
export function toProblem(diagnostic: EslintDiagnostic, path: string, projectPath: string | null): Problem {
    return {
        path,
        label: relativeLabel(projectPath, path),
        severity: normalizeSeverity(diagnostic?.severity),
        ruleId: safeRuleId(diagnostic?.rule_id),
        message: safeMessage(diagnostic?.message),
        line: safePosition(diagnostic?.line),
        column: safePosition(diagnostic?.column),
    };
}

function compareProblems(a: Problem, b: Problem): number {
    const rank = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (rank !== 0) return rank;
    if (a.line !== b.line) return a.line - b.line;
    if (a.column !== b.column) return a.column - b.column;
    return a.message.localeCompare(b.message);
}

/** Files with an error sort above warning-only files; rows are errors-first, then line, then column. */
export function groupProblems(problems: Problem[]): ProblemGroup[] {
    const byPath = new Map<string, Problem[]>();
    for (const problem of problems) {
        const bucket = byPath.get(problem.path);
        if (bucket) bucket.push(problem);
        else byPath.set(problem.path, [problem]);
    }

    const groups: ProblemGroup[] = [];
    byPath.forEach((rows, path) => {
        const counts: SeverityCounts = { ...EMPTY_COUNTS };
        for (const row of rows) counts[row.severity] += 1;
        groups.push({
            path,
            label: rows[0]?.label ?? relativeLabel(null, path),
            problems: [...rows].sort(compareProblems),
            counts,
        });
    });

    return groups.sort((a, b) => {
        const worst = (group: ProblemGroup) =>
            group.counts.error > 0 ? 0 : group.counts.warning > 0 ? 1 : 2;
        const rank = worst(a) - worst(b);
        return rank !== 0 ? rank : a.label.localeCompare(b.label);
    });
}

export function summarize(groups: ProblemGroup[]): ProblemSummary {
    const counts: SeverityCounts = { ...EMPTY_COUNTS };
    for (const group of groups) {
        counts.error += group.counts.error;
        counts.warning += group.counts.warning;
        counts.info += group.counts.info;
    }
    return { ...counts, total: counts.error + counts.warning + counts.info };
}

export function pluralFiles(count: number): string {
    return `${count} ${count === 1 ? "file" : "files"}`;
}