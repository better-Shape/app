import { createElement, type ReactElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listenCustomEvent } from "../helpers/events";
import { mockInvoke } from "../helpers/tauri";

/**
 * `useProjectState` is the only collaborator replaced here; `commands` stays the
 * real one, so the lint goes through the same `invoke` path the app uses.
 */
const projectState = vi.hoisted(() => ({
    current: {
        project_path: "/repo" as string | null,
        open_files: [] as { path: string; is_dirty: boolean }[],
        active_file: null as string | null,
    },
}));

vi.mock("@/lib/backend", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/backend")>();
    return { ...actual, useProjectState: () => projectState.current };
});

import { commands, type EslintDiagnostic, type EslintLintResult } from "@/lib/backend";
import { ProblemsTab } from "@/features/agent/workspace/problems-tab";
import { ProblemsPanel, type ProblemTarget } from "@/features/git/ui/problems/panel";
import {
    formatPosition,
    groupProblems,
    normalizeSeverity,
    pluralFiles,
    relativeLabel,
    safePosition,
    selectLintTargets,
    summarize,
    toProblem,
} from "@/features/git/ui/problems/model";
import { openDiagnostic } from "@/features/git/ui/problems/reveal";

const A = "/repo/src/a.tsx";
const B = "/repo/src/b.ts";

/** Shape the Rust command actually returns: snake_case fields, severity as a string. */
function raw(overrides: Partial<EslintDiagnostic> = {}): EslintDiagnostic {
    return {
        line: 1,
        column: 1,
        end_line: 1,
        end_column: 2,
        message: "message",
        severity: "error",
        rule_id: "some/rule",
        ...overrides,
    };
}

const A_DIAGNOSTICS: EslintDiagnostic[] = [
    raw({
        line: 40,
        column: 3,
        severity: "warning",
        rule_id: "react-hooks/exhaustive-deps",
        message: "Missing dep.",
    }),
    raw({ line: 12, column: 9, severity: "error", rule_id: "eqeqeq", message: "Expected ===." }),
    raw({ line: 12, column: 1, severity: "error", rule_id: "no-unused-vars", message: "Unused var." }),
];
const B_DIAGNOSTICS: EslintDiagnostic[] = [
    raw({ line: 3, column: 5, severity: "warning", rule_id: "prefer-const", message: "Use const." }),
];

function problemsFrom(path: string, diagnostics: EslintDiagnostic[]) {
    return diagnostics.map((diagnostic) => toProblem(diagnostic, path, "/repo"));
}

function mount(node: ReactElement) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
        root.render(node);
    });
    return { host, root };
}

function unmount(root: Root, host: HTMLElement) {
    act(() => root.unmount());
    host.remove();
}

async function pause(ms: number) {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
    });
}

async function waitFor(host: HTMLElement, needle: string, timeoutMs = 4000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (host.textContent?.includes(needle)) return;
        await pause(25);
    }
    throw new Error(`Timed out waiting for "${needle}". Saw: ${host.textContent}`);
}

async function waitUntil(predicate: () => boolean, what: string, timeoutMs = 4000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return;
        await pause(25);
    }
    throw new Error(`Timed out waiting for ${what}`);
}

function panel(props: {
    state: Parameters<typeof ProblemsPanel>[0]["state"];
    busy?: boolean;
    onOpen?: (target: ProblemTarget) => void;
    onRerun?: () => void;
}): ReactElement {
    return createElement(ProblemsPanel, {
        state: props.state,
        busy: props.busy ?? false,
        onOpen: props.onOpen ?? (() => {}),
        onRerun: props.onRerun ?? (() => {}),
    });
}

describe("problem severity normalisation", () => {
    it("maps the strings eslint_lint_file produces (2 error, 1 warning, anything else info)", () => {
        expect(normalizeSeverity("error")).toBe("error");
        expect(normalizeSeverity("warning")).toBe("warning");
        expect(normalizeSeverity("info")).toBe("info");
    });

    it("falls back to info instead of leaking an unknown severity", () => {
        for (const value of ["", "   ", "fatal-ish", null, undefined, {}, []]) {
            expect(normalizeSeverity(value)).toBe("info");
        }
    });
});

describe("problem positions", () => {
    it("keeps real coordinates", () => {
        expect(formatPosition(12, 9)).toBe("12:9");
    });

    it("never renders undefined or NaN for a missing coordinate", () => {
        expect(safePosition(undefined)).toBe(1);
        expect(safePosition(Number.NaN)).toBe(1);
        expect(safePosition(0)).toBe(1);
        expect(safePosition(-3)).toBe(1);
        expect(safePosition("7")).toBe(7);
        const rendered = formatPosition(undefined, Number.NaN);
        expect(rendered).toBe("1:1");
        expect(rendered).not.toContain("NaN");
        expect(rendered).not.toContain("undefined");
    });

    it("replaces a blank message and a blank rule rather than rendering nothing", () => {
        expect(toProblem(raw({ message: "   " }), A, "/repo").message.length).toBeGreaterThan(0);
        expect(toProblem(raw({ rule_id: "  " }), A, "/repo").ruleId).toBeNull();
        expect(toProblem(raw({ rule_id: null }), A, "/repo").ruleId).toBeNull();
    });
});

describe("problem grouping", () => {
    it("groups by file and sorts errors first, then by line, then by column", () => {
        const groups = groupProblems([
            ...problemsFrom(B, B_DIAGNOSTICS),
            ...problemsFrom(A, A_DIAGNOSTICS),
        ]);

        expect(groups.map((group) => group.label)).toEqual(["src/a.tsx", "src/b.ts"]);
        expect(
            groups[0].problems.map((problem) => [problem.line, problem.column, problem.ruleId]),
        ).toEqual([
            [12, 1, "no-unused-vars"],
            [12, 9, "eqeqeq"],
            [40, 3, "react-hooks/exhaustive-deps"],
        ]);
    });

    it("puts a file that has an error above a warning-only file even when its name sorts later", () => {
        const groups = groupProblems([
            toProblem(raw({ severity: "warning" }), "/repo/aaa.ts", "/repo"),
            toProblem(raw({ severity: "error" }), "/repo/zzz.ts", "/repo"),
        ]);
        expect(groups.map((group) => group.label)).toEqual(["zzz.ts", "aaa.ts"]);
    });

    it("counts every severity across the groups", () => {
        const summary = summarize(
            groupProblems([...problemsFrom(A, A_DIAGNOSTICS), ...problemsFrom(B, B_DIAGNOSTICS)]),
        );
        expect(summary).toEqual({ error: 2, warning: 2, info: 0, total: 4 });
        expect(pluralFiles(summary.total)).toBe("4 files");
        expect(pluralFiles(1)).toBe("1 file");
    });
});

describe("problem paths", () => {
    it("shows a project-relative label for posix, windows and case-mismatched roots", () => {
        expect(relativeLabel("/repo", "/repo/src/a.tsx")).toBe("src/a.tsx");
        expect(relativeLabel("C:\\repo", "C:\\repo\\src\\a.tsx")).toBe("src/a.tsx");
        expect(relativeLabel("C:/Repo", "c:/repo/src/a.tsx")).toBe("src/a.tsx");
        expect(relativeLabel("/repo/", "/repo/src/a.tsx")).toBe("src/a.tsx");
    });

    it("keeps a path outside the project absolute instead of truncating it", () => {
        expect(relativeLabel("/repo", "/elsewhere/b.ts")).toBe("/elsewhere/b.ts");
        expect(relativeLabel("/repo", "/repository-other/b.ts")).toBe("/repository-other/b.ts");
        expect(relativeLabel(null, "/repo/b.ts")).toBe("/repo/b.ts");
    });

    it("lints only open JavaScript and TypeScript files, case-insensitively de-duplicated", () => {
        const { targets, skipped } = selectLintTargets(
            [
                A,
                "/repo/src/b.md",
                "/repo/logo.png",
                "bettershape://browser",
                "diff:working:a1b2c3:/repo/src/b.ts",
                "C:\\repo\\src\\A.TSX",
                A,
            ],
            10,
        );
        expect(targets).toEqual([A, "C:\\repo\\src\\A.TSX"]);
        expect(skipped).toBe(0);
    });

    it("caps how many ESLint processes a single run may spawn", () => {
        const many = Array.from({ length: 14 }, (_, index) => `/repo/src/f${index}.ts`);
        const { targets, skipped } = selectLintTargets(many, 10);
        expect(targets).toHaveLength(10);
        expect(skipped).toBe(4);
    });
});

describe("problems panel", () => {
    const groups = groupProblems([
        ...problemsFrom(A, A_DIAGNOSTICS),
        ...problemsFrom(B, B_DIAGNOSTICS),
    ]);
    const ready = {
        kind: "ready" as const,
        groups,
        summary: summarize(groups),
        lintedCount: 2,
        skippedCount: 3,
        partialErrors: [],
    };

    it("renders one section per file with the rule, message and position from the input", () => {
        const { host, root } = mount(panel({ state: ready }));
        try {
            const text = host.textContent ?? "";
            expect(text).toContain("src/a.tsx");
            expect(text).toContain("src/b.ts");
            expect(text).toContain("no-unused-vars");
            expect(text).toContain("Missing dep.");
            expect(text).toContain("12:9");
            expect(text).toContain("3:5");
            expect(text.indexOf("src/a.tsx")).toBeLessThan(text.indexOf("src/b.ts"));
            expect(text).toContain("2 errors");
            expect(text).toContain("ESLint on saved content");
            expect(text).toContain("3 more open files not checked");
        } finally {
            unmount(root, host);
        }
    });

    it("names the severity in text so it is not carried by colour alone", () => {
        const { host, root } = mount(panel({ state: ready }));
        try {
            const labels = Array.from(host.querySelectorAll("button[aria-label]")).map((el) =>
                el.getAttribute("aria-label") ?? "",
            );
            expect(labels.filter((label) => label.startsWith("Error — "))).toHaveLength(2);
            expect(labels.filter((label) => label.startsWith("Warning — "))).toHaveLength(2);
            expect(labels.filter((label) => label.includes("eqeqeq"))[0]).toBe(
                "Error — eqeqeq — Expected ===. — 12:9",
            );
            for (const label of labels.filter((text) => text.includes("—"))) {
                expect(label).toMatch(/^(Error|Warning|Info) — /);
            }
        } finally {
            unmount(root, host);
        }
    });

    it("reports the clicked row's path, line and column", () => {
        const opened: ProblemTarget[] = [];
        const { host, root } = mount(panel({ state: ready, onOpen: (target) => opened.push(target) }));
        try {
            const row = host.querySelector<HTMLButtonElement>("button[aria-label^='Error — eqeqeq']");
            expect(row).toBeTruthy();
            act(() => row?.click());
            expect(opened).toEqual([{ path: A, line: 12, column: 9 }]);
        } finally {
            unmount(root, host);
        }
    });

    it("says how many files ESLint checked when there is nothing to show", () => {
        const { host, root } = mount(
            panel({ state: { ...ready, groups: [], summary: summarize([]), skippedCount: 0 } }),
        );
        try {
            const text = host.textContent ?? "";
            expect(text).toContain("No problems");
            expect(text).toContain("ESLint reported nothing for 2 files.");
        } finally {
            unmount(root, host);
        }
    });

    it("shows the backend failure instead of an empty list when ESLint could not run", () => {
        const { host, root } = mount(
            panel({
                state: { kind: "failed", message: "Failed to run eslint: No such file or directory (os error 2)" },
            }),
        );
        try {
            const text = host.textContent ?? "";
            expect(text).toContain("ESLint didn't run");
            expect(text).toContain("Failed to run eslint");
            expect(text).not.toContain("No problems");
        } finally {
            unmount(root, host);
        }
    });

    it("lists the files that could not be linted alongside the ones that could", () => {
        const { host, root } = mount(
            panel({
                state: {
                    ...ready,
                    partialErrors: [{ path: B, label: "src/b.ts", message: "Failed to run eslint: boom" }],
                },
            }),
        );
        try {
            const text = host.textContent ?? "";
            expect(text).toContain("1 of 2 files could not be linted.");
            expect(text).toContain("src/b.ts: Failed to run eslint: boom");
        } finally {
            unmount(root, host);
        }
    });

    it("still shows the failures when the files that did lint were clean", () => {
        const { host, root } = mount(
            panel({
                state: {
                    ...ready,
                    groups: [],
                    summary: summarize([]),
                    partialErrors: [{ path: B, label: "src/b.ts", message: "Failed to run eslint: boom" }],
                },
            }),
        );
        try {
            const text = host.textContent ?? "";
            expect(text).toContain("1 of 2 files could not be linted.");
            expect(text).toContain("src/b.ts: Failed to run eslint: boom");
        } finally {
            unmount(root, host);
        }
    });

    it("re-runs on request", () => {
        let reruns = 0;
        const { host, root } = mount(panel({ state: ready, onRerun: () => (reruns += 1) }));
        try {
            const button = host.querySelector<HTMLButtonElement>("button[aria-label='Re-run ESLint']");
            expect(button).toBeTruthy();
            act(() => button?.click());
            expect(reruns).toBe(1);
        } finally {
            unmount(root, host);
        }
    });
});

describe("opening a problem", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("activates the file and replays the jump with the row's coordinates", async () => {
        const jumps = listenCustomEvent<{ path: string; line: number; column: number }>(
            "bettershape-editor-jump",
        );
        const setActiveFile = vi.spyOn(commands, "setActiveFile").mockResolvedValue(undefined);

        openDiagnostic(A, 12, 9);
        await pause(600);

        expect(setActiveFile).toHaveBeenCalledWith(A);
        expect(jumps.events.length).toBeGreaterThan(0);
        for (const event of jumps.events) {
            expect(event.detail).toEqual({ path: A, line: 12, column: 9 });
        }
        jumps.off();
    });

    it("drops the previous replay when another row is clicked", async () => {
        const jumps = listenCustomEvent<{ path: string }>("bettershape-editor-jump");
        vi.spyOn(commands, "setActiveFile").mockResolvedValue(undefined);

        openDiagnostic(A, 12, 9);
        await pause(50);
        jumps.events.length = 0;

        openDiagnostic(B, 3, 5);
        await pause(600);

        expect(jumps.events.length).toBeGreaterThan(0);
        for (const event of jumps.events) expect(event.detail.path).toBe(B);
        jumps.off();
    });
});

describe("problems tab", () => {
    const calls = { read: 0, lint: [] as string[] };
    let lintResult: (path: string) => EslintLintResult | string = () => ({ diagnostics: [], content: null });

    beforeEach(() => {
        calls.read = 0;
        calls.lint = [];
        lintResult = () => ({ diagnostics: [], content: null });
        // `readFile` memoises per path for the whole process, so the cache has to
        // go or the second test would never reach the backend.
        commands.invalidateAllFileCaches();
        projectState.current = {
            project_path: "/repo",
            open_files: [
                { path: A, is_dirty: false },
                { path: B, is_dirty: false },
                { path: "/repo/notes.md", is_dirty: false },
            ],
            active_file: A,
        };
        mockInvoke((cmd, args) => {
            const payload = (args ?? {}) as { filePath?: string };
            if (cmd === "read_file") {
                calls.read += 1;
                return "const a = 1;\n";
            }
            if (cmd === "eslint_lint_file") {
                const path = payload.filePath ?? "";
                calls.lint.push(path);
                const result = lintResult(path);
                return typeof result === "string" ? Promise.reject(result) : result;
            }
            return undefined;
        });
    });

    afterEach(() => {
        projectState.current = { project_path: null, open_files: [], active_file: null };
    });

    it("reruns for the toolbar and external file-change events without changing tabs", async () => {
        const { host, root } = mount(createElement(ProblemsTab));
        try {
            await waitUntil(() => calls.lint.length === 2, "initial lint");
            const rerun = host.querySelector<HTMLButtonElement>('[aria-label="Re-run ESLint"]');
            expect(rerun).not.toBeNull();
            act(() => rerun?.click());
            await waitUntil(() => calls.lint.length === 4, "toolbar rerun");
            act(() => window.dispatchEvent(new Event("bettershape-files-changed")));
            await waitUntil(() => calls.lint.length === 6, "external-change rerun");
            expect(calls.lint).toEqual([A, B, A, B, A, B]);
        } finally {
            unmount(root, host);
        }
    });

    it("waits for the editor to settle, then lints only the JS/TS files that are open", async () => {
        const { host, root } = mount(createElement(ProblemsTab));
        try {
            await pause(200);
            expect(calls.read).toBe(0);

            await waitFor(host, "ESLint reported nothing for 2 files.");
            expect(calls.read).toBe(2);
            expect(calls.lint).toEqual([A, B]);
        } finally {
            unmount(root, host);
        }
    });

    it("renders the diagnostics the backend returned", async () => {
        lintResult = (path) => ({ diagnostics: path === A ? A_DIAGNOSTICS : B_DIAGNOSTICS, content: null });
        const { host, root } = mount(createElement(ProblemsTab));
        try {
            await waitFor(host, "no-unused-vars");
            const text = host.textContent ?? "";
            expect(text).toContain("src/a.tsx");
            expect(text).toContain("react-hooks/exhaustive-deps");
            expect(text).toContain("40:3");
            expect(text).toContain("4 problems");
        } finally {
            unmount(root, host);
        }
    });

    it("says ESLint failed instead of reporting zero problems", async () => {
        lintResult = () => "Failed to run eslint: No such file or directory (os error 2)";
        const { host, root } = mount(createElement(ProblemsTab));
        try {
            await waitFor(host, "ESLint didn't run");
            const text = host.textContent ?? "";
            expect(text).toContain("Failed to run eslint");
            expect(text).not.toContain("No problems");
        } finally {
            unmount(root, host);
        }
    });

    it("treats a successful response carrying an error as a failure, not a clean file", async () => {
        // The backend answers Ok(vec![]) both for "clean" and for "nothing ran". The
        // `error` field is what separates them, so a response with an empty diagnostics
        // list AND an error must never be counted as a linted, problem-free file.
        lintResult = () => ({
            diagnostics: [],
            content: null,
            error: "This folder is not trusted, so linting was skipped.",
        });
        const { host, root } = mount(createElement(ProblemsTab));
        try {
            await waitFor(host, "not trusted");
            const text = host.textContent ?? "";
            expect(text).toContain("This folder is not trusted");
            expect(text).not.toContain("No problems");
            expect(calls.lint).toEqual([A, B]);
        } finally {
            unmount(root, host);
        }
    });

    it("does not spawn ESLint when no JavaScript or TypeScript file is open", async () => {
        projectState.current = {
            project_path: "/repo",
            open_files: [{ path: "/repo/notes.md", is_dirty: false }],
            active_file: "/repo/notes.md",
        };
        const { host, root } = mount(createElement(ProblemsTab));
        try {
            await pause(900);
            expect(calls.read).toBe(0);
            expect(host.textContent).toContain("Nothing to lint");
            expect(host.textContent).toContain(
                "None of the 1 file open in the editor can be linted by ESLint.",
            );
        } finally {
            unmount(root, host);
        }
    });

    it("does not re-lint on a plain re-render, but does after the dirty flag flips", async () => {
        const { host, root } = mount(createElement(ProblemsTab));
        try {
            await waitFor(host, "ESLint reported nothing for 2 files.");
            expect(calls.lint).toEqual([A, B]);

            act(() => {
                root.render(createElement(ProblemsTab));
            });
            await pause(200);
            expect(calls.lint).toEqual([A, B]);

            act(() => {
                projectState.current = {
                    ...projectState.current,
                    open_files: [
                        { path: A, is_dirty: true },
                        { path: B, is_dirty: false },
                    ],
                };
                root.render(createElement(ProblemsTab));
            });
            await pause(200);
            expect(calls.lint).toEqual([A, B]);
            await waitUntil(() => calls.lint.length > 2, "a second ESLint run after the dirty flip");
        } finally {
            unmount(root, host);
        }
    });
});