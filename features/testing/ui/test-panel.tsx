"use client";

import { ArrowSync20Regular } from "@fluentui/react-icons/headless/svg/arrow-sync";
import { Bug20Regular } from "@fluentui/react-icons/headless/svg/bug";
import { Chat20Regular } from "@fluentui/react-icons/headless/svg/chat";
import { CheckmarkCircle20Filled } from "@fluentui/react-icons/headless/svg/checkmark-circle";
import { ChevronDown20Regular } from "@fluentui/react-icons/headless/svg/chevron-down";
import { ChevronRight20Regular } from "@fluentui/react-icons/headless/svg/chevron-right";
import { Circle20Regular } from "@fluentui/react-icons/headless/svg/circle";
import { DismissCircle20Filled } from "@fluentui/react-icons/headless/svg/dismiss-circle";
import { DocumentText20Regular } from "@fluentui/react-icons/headless/svg/document-text";
import { Play20Filled } from "@fluentui/react-icons/headless/svg/play";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useProjectState } from "@/lib/backend";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Collapse } from "@/components/ui/collapse";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
    discoverProjectTests,
    initTestRunnerEvents,
    runAllTests,
    runFailedTests,
} from "../runner";
import { getFailedPattern, useTestStore } from "../store";
import type { TestCase, TestStatus } from "../types";

function relativeSuitePath(filePath: string, projectPath: string | null): string {
    const cleanFile = filePath.replace(/\\/g, "/");
    const cleanRoot = (projectPath ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
    if (cleanRoot && cleanFile.toLowerCase().startsWith(`${cleanRoot.toLowerCase()}/`)) {
        return cleanFile.slice(cleanRoot.length + 1);
    }
    return cleanFile;
}

/** Builds a targeted prompt asking the agent to fix one or more failing tests. */
export function buildFailingTestPrompt(
    failures: ReadonlyArray<{ suiteFile: string; testName: string; error?: string }>,
    projectPath: string | null,
): string {
    if (failures.length === 0) return "";
    if (failures.length === 1) {
        const f = failures[0];
        if (!f) return "";
        const rel = relativeSuitePath(f.suiteFile, projectPath);
        const snippet = (f.error ?? "").trim().slice(0, 600);
        return snippet
            ? `Fix failing test "${f.testName}" in @${rel} :\n\`\`\`\n${snippet}\n\`\`\``
            : `Fix failing test "${f.testName}" in @${rel}`;
    }
    const shown = failures.slice(0, 8);
    const remaining = failures.length - shown.length;
    const header =
        remaining > 0
            ? `Fix all ${failures.length} failing tests (${shown.length} listed below; run the test suite to inspect the remaining ${remaining}):`
            : `Fix ${failures.length} failing tests:`;
    const lines = shown.map((f) => {
        const rel = relativeSuitePath(f.suiteFile, projectPath);
        const firstErrLine = (f.error ?? "").trim().split("\n")[0]?.slice(0, 140) ?? "";
        return firstErrLine
            ? `- @${rel} :: "${f.testName}" (${firstErrLine})`
            : `- @${rel} :: "${f.testName}"`;
    });
    return `${header}\n${lines.join("\n")}`;
}

function sendTestPromptToChat(prompt: string) {
    if (!prompt.trim() || typeof window === "undefined") return;
    try {
        localStorage.setItem("bettershape-chat-input", prompt);
    } catch {
        /* ignore */
    }
    window.dispatchEvent(
        new CustomEvent("bettershape-center-view", {
            detail: "chat",
        }),
    );
    window.dispatchEvent(
        new CustomEvent("bettershape-chat-insert-prompt", {
            detail: { prompt, send: false },
        }),
    );
    window.dispatchEvent(new CustomEvent("bettershape-chat-focus-input"));
    if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => {
            window.dispatchEvent(
                new CustomEvent("bettershape-chat-insert-prompt", {
                    detail: { prompt, send: false },
                }),
            );
            window.dispatchEvent(new CustomEvent("bettershape-chat-focus-input"));
        });
    }
}

function StatusIcon({ status }: { status: TestStatus }) {
    switch (status) {
        case "passed":
            return <Icon icon={CheckmarkCircle20Filled} className="shrink-0 text-success" />;
        case "failed":
            return <Icon icon={DismissCircle20Filled} className="shrink-0 text-error" />;
        case "running":
            return <Icon icon={ArrowSync20Regular} className="shrink-0 animate-spin text-info" />;
        default:
            return <Icon icon={Circle20Regular} className="shrink-0 text-text-muted" />;
    }
}

function TestRow({
    test,
    suiteFile,
    projectPath,
}: {
    test: TestCase;
    suiteFile: string;
    projectPath: string | null;
}) {
    const [expanded, setExpanded] = useState(() => test.status === "failed");
    const isFailed = test.status === "failed";

    return (
        <div className="group/test select-none">
            <div className="flex w-full items-center gap-1 pr-3 transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--row-hover)]">
                <button
                    type="button"
                    aria-expanded={Boolean(test.error) ? expanded : undefined}
                    className="flex min-w-0 flex-1 items-start gap-2 py-1.5 pl-6 pr-2 text-left"
                    onClick={() => setExpanded((v) => !v)}
                >
                    <StatusIcon status={test.status} />
                    <span
                        className={cn(
                            "min-w-0 flex-1 truncate text-sm",
                            isFailed ? "text-text-primary" : "text-text-secondary",
                        )}
                    >
                        {test.name}
                    </span>
                    {test.duration_ms != null ? (
                        <span className="shrink-0 text-xs tabular-nums text-text-muted">
                            {test.duration_ms}ms
                        </span>
                    ) : null}
                </button>
                {isFailed ? (
                    <Tooltip content="Fix failing test in Chat">
                        <button
                            type="button"
                            aria-label={`Fix ${test.name} in Chat`}
                            onClick={() =>
                                sendTestPromptToChat(
                                    buildFailingTestPrompt(
                                        [{ suiteFile, testName: test.name, error: test.error }],
                                        projectPath,
                                    ),
                                )
                            }
                            className="inline-flex min-h-[24px] shrink-0 items-center gap-1 rounded-md px-1.5 text-xs text-text-muted opacity-0 transition-[opacity,background-color,color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] group-hover/test:opacity-100 focus-visible:opacity-100 hover:bg-[var(--btn-hover)] hover:text-text-primary active:scale-[0.96]"
                        >
                            <Icon icon={Chat20Regular} className="size-3.5" />
                            <span>Fix</span>
                        </button>
                    </Tooltip>
                ) : null}
            </div>
            <Collapse open={expanded && Boolean(test.error)}>
                {test.error ? (
                    <pre className="mx-6 mb-2 max-h-36 overflow-auto rounded-lg border border-border-subtle bg-surface-2 px-3 py-2 font-mono text-xs text-error whitespace-pre-wrap custom-scrollbar">
                        {test.error}
                    </pre>
                ) : null}
            </Collapse>
        </div>
    );
}

export default function TestPanel() {
    const { project_path } = useProjectState();
    const { discovery, suites, summary, running, error } = useTestStore();
    const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});

    useEffect(() => {
        void initTestRunnerEvents();
    }, []);

    useEffect(() => {
        if (!project_path) return;
        void discoverProjectTests(project_path).catch(() => {
            /* ignore discovery errors */
        });
    }, [project_path]);

    const framework = discovery?.framework ?? "none";
    const hasFramework = framework !== "none";

    const totals = useMemo(() => {
        if (summary) return summary;
        let passed = 0,
            failed = 0,
            skipped = 0;
        for (const suite of suites) {
            passed += suite.passed;
            failed += suite.failed;
            skipped += suite.skipped;
        }
        return { passed, failed, skipped, total: passed + failed + skipped };
    }, [summary, suites]);

    const allFailures = useMemo(() => {
        const list: Array<{ suiteFile: string; testName: string; error?: string }> = [];
        for (const suite of suites) {
            for (const t of suite.tests) {
                if (t.status === "failed") {
                    list.push({ suiteFile: suite.file, testName: t.name, error: t.error });
                }
            }
        }
        return list;
    }, [suites]);

    const toggleFile = useCallback((file: string) => {
        setExpandedFiles((prev) => ({ ...prev, [file]: !prev[file] }));
    }, []);

    const handleRunAll = () => {
        if (!project_path || !hasFramework) return;
        void runAllTests(project_path, framework);
    };

    const handleRunFailed = () => {
        if (!project_path || !hasFramework) return;
        const pattern = getFailedPattern();
        if (!pattern) return;
        void runFailedTests(project_path, framework, pattern);
    };

    const hasFailed = totals.failed > 0;

    return (
        <div className="flex h-full flex-col overflow-hidden">
            <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle px-3 py-2">
                <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-[24px] gap-1.5 px-2 text-sm"
                    disabled={!project_path || !hasFramework || running}
                    onClick={handleRunAll}
                >
                    <Icon icon={Play20Filled} />
                    Run All
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-[24px] gap-1.5 px-2 text-sm"
                    disabled={!project_path || !hasFramework || running || !hasFailed}
                    onClick={handleRunFailed}
                >
                    <Icon icon={Bug20Regular} />
                    Run Failed
                </Button>
                {hasFailed && !running && allFailures.length > 0 ? (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="min-h-[24px] gap-1.5 px-2 text-sm text-text-secondary hover:text-text-primary"
                        onClick={() =>
                            sendTestPromptToChat(buildFailingTestPrompt(allFailures, project_path))
                        }
                    >
                        <Icon icon={Chat20Regular} />
                        <span className="tabular-nums">Fix {allFailures.length} in Chat</span>
                    </Button>
                ) : null}
                <div className="flex-1" />
                {running ? <span className="text-xs text-text-muted">Running tests...</span> : null}
                {!running && totals.total > 0 ? (
                    <span className="text-xs tabular-nums text-text-muted">
                        {totals.passed} passed, {totals.failed} failed, {totals.skipped} skipped
                    </span>
                ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
                {!project_path ? (
                    <div className="px-4 py-6 text-sm text-text-muted">Open a project to run tests.</div>
                ) : null}
                {project_path && !hasFramework ? (
                    <div className="px-4 py-6 text-sm text-text-muted">
                        No Vitest or Jest configuration found in this project.
                    </div>
                ) : null}
                {error ? (
                    <div className="mx-3 mt-3 rounded-md bg-error/10 px-3 py-2 text-sm text-error">
                        {error}
                    </div>
                ) : null}
                {suites.map((suite) => {
                    const expanded = expandedFiles[suite.file] ?? true;
                    return (
                        <div key={suite.id} className="border-b border-border-subtle/50">
                            <button
                                type="button"
                                aria-expanded={expanded}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--row-hover)]"
                                onClick={() => toggleFile(suite.file)}
                            >
                                <Icon
                                    icon={expanded ? ChevronDown20Regular : ChevronRight20Regular}
                                    className="shrink-0 text-text-muted"
                                />
                                <Icon icon={DocumentText20Regular} className="shrink-0 text-text-muted" />
                                <span className="flex-1 truncate text-sm text-text-primary">
                                    {suite.name}
                                </span>
                                <span className="text-xs tabular-nums text-text-muted">
                                    {suite.passed}/{suite.tests.length}
                                </span>
                            </button>
                            <Collapse open={expanded}>
                                <div className={cn("pb-1", running && "opacity-90")}>
                                    {suite.tests.length === 0 ? (
                                        <div className="px-6 py-1.5 text-xs italic text-text-muted">
                                            {running ? "Running..." : "Not run yet"}
                                        </div>
                                    ) : null}
                                    {suite.tests.map((test) => (
                                        <TestRow
                                            key={test.id}
                                            test={test}
                                            suiteFile={suite.file}
                                            projectPath={project_path}
                                        />
                                    ))}
                                </div>
                            </Collapse>
                        </div>
                    );
                })}
                {project_path && hasFramework && suites.length === 0 && !running && !error ? (
                    <div className="px-4 py-6 text-sm text-text-muted">
                        {discovery?.test_files.length
                            ? `${discovery.test_files.length} test file(s) found. Click Run All to execute.`
                            : "No test files found. Click Run All to scan and run tests."}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
