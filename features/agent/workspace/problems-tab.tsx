"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { commands, useProjectState } from "@/lib/backend";
import { ProblemsPanel, type ProblemTarget } from "@/features/git/ui/problems/panel";
import {
    groupProblems,
    pluralFiles,
    relativeLabel,
    selectLintTargets,
    summarize,
    toProblem,
    type Problem,
    type ProblemsState,
} from "@/features/git/ui/problems/model";
import { openDiagnostic } from "@/features/git/ui/problems/reveal";

/**
 * Each run costs one `npx eslint` process per file, so the panel waits for the
 * editor to go quiet first. 700 ms is past the editor's own 450 ms syntax
 * linter delay, so this fires after the buffer has settled rather than in the
 * middle of a burst of keystrokes.
 */
const LINT_DEBOUNCE_MS = 700;

/** Open files only — never a repo walk — but still bounded so one run cannot fan out. */
const LINT_TARGET_LIMIT = 10;

const SIDEBAR_SURFACE = {
    "--panel": "var(--sidebar)",
    "--color-panel": "var(--sidebar)",
    "--editor": "var(--sidebar)",
    "--color-editor": "var(--sidebar)",
} as CSSProperties;

type LintRun = {
    problems: Problem[];
    lintedCount: number;
    skippedCount: number;
    partialErrors: { path: string; label: string; message: string }[];
};

/** Identity matters: a finished run always replaces this object. */
const NO_RUN: LintRun = { problems: [], lintedCount: 0, skippedCount: 0, partialErrors: [] };

function errorMessage(error: unknown): string {
    const text =
        typeof error === "string" ? error : error instanceof Error ? error.message : String(error ?? "");
    const trimmed = text.trim();
    return trimmed || "ESLint returned no output.";
}

export function ProblemsTab() {
    const { open_files, active_file, project_path } = useProjectState();
    const [run, setRun] = useState<LintRun>(NO_RUN);
    const [busy, setBusy] = useState(false);
    const [manualRun, setManualRun] = useState(0);

    const selection = useMemo(
        () =>
            project_path
                ? selectLintTargets(
                      open_files.map((file) => file.path),
                      LINT_TARGET_LIMIT,
                  )
                : { targets: [] as string[], skipped: 0 },
        [project_path, open_files],
    );

    /**
     * `open_files` identity changes when a file opens or closes and when
     * `is_dirty` flips on save, which is the only signal this window gets that
     * the text behind an open file changed on disk. `active_file` re-runs on a
     * tab switch so the panel follows the file the user is looking at; the
     * debounce below collapses a burst of switches into one run.
     */
    useEffect(() => {
        const { targets, skipped } = selection;
        if (!project_path || targets.length === 0) {
            setBusy(false);
            return;
        }

        let cancelled = false;
        setBusy(true);
        const timer = setTimeout(async () => {
            const problems: Problem[] = [];
            const partialErrors: LintRun["partialErrors"] = [];
            let lintedCount = 0;

            // Sequential on purpose: one ESLint process at a time keeps the box
            // responsive when a dozen tabs are open.
            for (const path of targets) {
                if (cancelled) return;
                try {
                    const content = await commands.readFile(path);
                    const result = await commands.eslintLintFile(project_path, path, content, false);
                    // A run that could not happen is not a clean file. Only count it as
                    // linted once ESLint actually answered.
                    if (result?.error) {
                        partialErrors.push({
                            path,
                            label: relativeLabel(project_path, path),
                            message: result.error,
                        });
                        continue;
                    }
                    lintedCount += 1;
                    for (const diagnostic of Array.isArray(result?.diagnostics) ? result.diagnostics : []) {
                        problems.push(toProblem(diagnostic, path, project_path));
                    }
                } catch (error) {
                    partialErrors.push({
                        path,
                        label: relativeLabel(project_path, path),
                        message: errorMessage(error),
                    });
                }
            }
            if (cancelled) return;
            setRun({ problems, lintedCount, skippedCount: skipped, partialErrors });
            setBusy(false);
        }, LINT_DEBOUNCE_MS);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [project_path, selection, active_file]);

    useEffect(() => {
        const onFilesChanged = () => setManualRun((token) => token + 1);
        window.addEventListener("bettershape-files-changed", onFilesChanged);
        return () => window.removeEventListener("bettershape-files-changed", onFilesChanged);
    }, []);

    const onOpen = useCallback((target: ProblemTarget) => {
        openDiagnostic(target.path, target.line, target.column);
    }, []);

    const onRerun = useCallback(() => setManualRun((token) => token + 1), []);

    const state: ProblemsState = useMemo(() => {
        if (!project_path) return { kind: "no-project" };
        if (selection.targets.length === 0) {
            return {
                kind: "no-files",
                reason:
                    open_files.length > 0
                        ? `None of the ${pluralFiles(open_files.length)} open in the editor can be linted by ESLint.`
                        : "Open a JavaScript or TypeScript file to see its ESLint problems.",
            };
        }
        if (run === NO_RUN || (busy && run.lintedCount === 0)) {
            return { kind: "loading", detail: `Linting ${pluralFiles(selection.targets.length)}.` };
        }
        if (run.lintedCount === 0 && run.partialErrors.length > 0) {
            return { kind: "failed", message: run.partialErrors[0]?.message ?? "ESLint returned no output." };
        }
        const groups = groupProblems(run.problems);
        return {
            kind: "ready",
            groups,
            summary: summarize(groups),
            lintedCount: run.lintedCount,
            skippedCount: run.skippedCount,
            partialErrors: run.partialErrors,
        };
    }, [project_path, selection, open_files.length, run, busy]);

    return (
        <div
            role="region"
            aria-label="Problems"
            className="h-full min-h-0 bg-sidebar"
            style={SIDEBAR_SURFACE}
        >
            <ProblemsPanel state={state} busy={busy} onOpen={onOpen} onRerun={onRerun} />
        </div>
    );
}