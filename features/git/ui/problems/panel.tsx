"use client";

import { ArrowSync20Regular } from "@fluentui/react-icons/headless/svg/arrow-sync";
import { Chat20Regular } from "@fluentui/react-icons/headless/svg/chat";
import { ErrorCircle20Regular } from "@fluentui/react-icons/headless/svg/error-circle";
import { Info20Regular } from "@fluentui/react-icons/headless/svg/info";
import { Warning20Regular } from "@fluentui/react-icons/headless/svg/warning";

import { FileIcon } from "@/components/ui/file-icon";
import { Icon, type IconGlyph } from "@/components/ui/icon";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import "./motion.css";
import {
    formatPosition,
    pluralFiles,
    SEVERITY_LABEL,
    type Problem,
    type ProblemGroup,
    type ProblemSeverity,
    type ProblemsState,
} from "./model";

export type ProblemTarget = { path: string; line: number; column: number };

const SEVERITY_GLYPH: Record<ProblemSeverity, IconGlyph> = {
    error: ErrorCircle20Regular,
    warning: Warning20Regular,
    info: Info20Regular,
};

/** Glyph shape carries the severity as well as hue, so colour is never the only cue. */
const SEVERITY_CLASS: Record<ProblemSeverity, string> = {
    error: "text-error",
    warning: "text-warning",
    info: "text-info",
};

function StateMessage({ title, detail }: { title: string; detail?: string }) {
    return (
        <div className="flex flex-col gap-1 px-3 py-4">
            <p className="text-sm text-text-primary">{title}</p>
            {detail ? <p className="text-xs text-text-muted">{detail}</p> : null}
        </div>
    );
}

function countLabel(count: number, noun: string): string | null {
    if (count <= 0) return null;
    return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

function dispatchChatPromptForProblem(prompt: string) {
    if (typeof window === "undefined") return;
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
}

function formatSingleProblemPrompt(problem: Problem, fileLabel: string): string {
    const pos = formatPosition(problem.line, problem.column);
    const rule = problem.ruleId ? ` (${problem.ruleId})` : "";
    return `Fix the ESLint ${problem.severity} in @${fileLabel} at ${pos}${rule}: ${problem.message}`;
}

function formatAllProblemsPrompt(groups: ProblemGroup[]): string {
    const MAX_PROMPT_PROBLEMS = 100;
    const total = groups.reduce((sum, group) => sum + group.problems.length, 0);
    const lines: string[] = ["Fix these ESLint problems:"];
    let count = 0;
    for (const group of groups) {
        for (const p of group.problems) {
            if (count >= MAX_PROMPT_PROBLEMS) break;
            const pos = formatPosition(p.line, p.column);
            const rule = p.ruleId ? ` [${p.ruleId}]` : "";
            lines.push(`- @${group.label}:${pos}${rule}: ${p.message}`);
            count += 1;
        }
        if (count >= MAX_PROMPT_PROBLEMS) break;
    }
    if (total > count) {
        lines.push(
            `(${total - count} additional ESLint problem${total - count === 1 ? "" : "s"} omitted for brevity; run ESLint to inspect and fix the remaining diagnostics.)`,
        );
    }
    return lines.join("\n");
}

function ProblemRow({
    problem,
    fileLabel,
    onOpen,
}: {
    problem: Problem;
    fileLabel: string;
    onOpen: (target: ProblemTarget) => void;
}) {
    const label = SEVERITY_LABEL[problem.severity];
    const position = formatPosition(problem.line, problem.column);
    return (
        <li className="group flex items-start gap-1 rounded-md pr-1 hover:bg-[var(--row-hover)]">
            <button
                type="button"
                onClick={() => onOpen({ path: problem.path, line: problem.line, column: problem.column })}
                aria-label={[label, problem.ruleId, problem.message, position].filter(Boolean).join(" — ")}
                className="flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-1 text-left focus-visible:bg-panel-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus-ring"
            >
                <span className={cn("mt-0.5 shrink-0", SEVERITY_CLASS[problem.severity])}>
                    <Icon icon={SEVERITY_GLYPH[problem.severity]} className="icon-sm" />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate text-xs text-text-muted">
                            {problem.ruleId ?? label}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-text-muted">{position}</span>
                    </span>
                    <span className="block truncate text-xs text-text-primary">{problem.message}</span>
                </span>
            </button>
            <Tooltip content="Fix in chat" side="left">
                <button
                    type="button"
                    aria-label={`Fix problem at ${position} in chat`}
                    onClick={() => dispatchChatPromptForProblem(formatSingleProblemPrompt(problem, fileLabel))}
                    className="mt-0.5 flex size-[24px] shrink-0 items-center justify-center rounded-md text-text-muted opacity-0 transition-[opacity,background-color,color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-primary active:scale-[0.94] group-hover:opacity-100 focus-visible:opacity-100 motion-reduce:transform-none motion-reduce:transition-none"
                >
                    <Icon icon={Chat20Regular} className="size-3.5" />
                </button>
            </Tooltip>
        </li>
    );
}

function GroupHeading({ group, onOpenFile }: { group: ProblemGroup; onOpenFile: (group: ProblemGroup) => void }) {
    const counts = [
        countLabel(group.counts.error, "error"),
        countLabel(group.counts.warning, "warning"),
        countLabel(group.counts.info, "info"),
    ].filter(Boolean);
    return (
        <div className="flex items-center gap-2 px-2 pb-1 pt-3">
            <FileIcon name={group.label} className="size-4" />
            <button
                type="button"
                onClick={() => onOpenFile(group)}
                aria-label={`Open ${group.label} at line 1`}
                className="min-w-0 flex-1 truncate text-left text-xs font-medium text-text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus-ring"
            >
                {group.label}
            </button>
            <span className="shrink-0 text-xs text-text-muted">{counts.join(", ")}</span>
        </div>
    );
}

function PartialErrors({
    errors,
    lintedCount,
}: {
    errors: { path: string; label: string; message: string }[];
    lintedCount: number;
}) {
    if (errors.length === 0) return null;
    return (
        <div className="mt-2 rounded-md border border-border-subtle px-2 py-1.5">
            <p className="text-xs text-text-primary">
                {errors.length} of {pluralFiles(lintedCount)} could not be linted.
            </p>
            <ul className="mt-1 flex flex-col gap-0.5">
                {errors.map((failure) => (
                    <li key={failure.path} className="truncate text-xs text-text-muted">
                        {failure.label}: {failure.message}
                    </li>
                ))}
            </ul>
        </div>
    );
}

export function ProblemsPanel({
    state,
    busy,
    onOpen,
    onRerun,
}: {
    state: ProblemsState;
    busy: boolean;
    onOpen: (target: ProblemTarget) => void;
    onRerun: () => void;
}) {
    return (
        <div className="flex h-full min-h-0 flex-col bg-panel">
            <div className="flex shrink-0 items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">Problems</span>
                {state.kind === "ready" ? (
                    <span className="shrink-0 text-xs tabular-nums text-text-muted">
                        {state.summary.total} {state.summary.total === 1 ? "problem" : "problems"}
                    </span>
                ) : null}
                {state.kind === "ready" && state.groups.length > 0 ? (
                    <Tooltip content="Fix all in chat" side="bottom">
                        <button
                            type="button"
                            aria-label="Fix all problems in chat"
                            onClick={() => dispatchChatPromptForProblem(formatAllProblemsPrompt(state.groups))}
                            className="flex size-[24px] shrink-0 items-center justify-center rounded-md text-text-muted transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-primary active:scale-[0.95]"
                        >
                            <Icon icon={Chat20Regular} />
                        </button>
                    </Tooltip>
                ) : null}
                <button
                    type="button"
                    aria-label="Re-run ESLint"
                    onClick={onRerun}
                    className="flex size-[24px] shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-[var(--btn-hover)] hover:text-text-primary"
                >
                    <Icon
                        icon={ArrowSync20Regular}
                        className={cn(busy && "animate-spin motion-reduce:animate-none")}
                    />
                </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {state.kind === "no-project" ? (
                    <StateMessage title="No project open" detail="Open a folder to lint its files." />
                ) : state.kind === "no-files" ? (
                    <StateMessage title="Nothing to lint" detail={state.reason} />
                ) : state.kind === "loading" ? (
                    <StateMessage title="Running ESLint..." detail={state.detail} />
                ) : state.kind === "failed" ? (
                    <StateMessage title="ESLint didn't run" detail={state.message} />
                ) : (
                    <div className="problems-enter">
                        <PartialErrors errors={state.partialErrors} lintedCount={state.lintedCount} />
                        {state.groups.length === 0 ? (
                            <StateMessage
                                title="No problems"
                                detail={`ESLint reported nothing for ${pluralFiles(state.lintedCount)}.`}
                            />
                        ) : (
                            state.groups.map((group) => (
                                <section key={group.path}>
                                    <GroupHeading
                                        group={group}
                                        onOpenFile={(target) => onOpen({ path: target.path, line: 1, column: 1 })}
                                    />
                                    <ul className="flex flex-col">
                                        {group.problems.map((problem) => (
                                            <ProblemRow
                                                key={`${problem.path}:${problem.line}:${problem.column}:${problem.message}`}
                                                problem={problem}
                                                fileLabel={group.label}
                                                onOpen={onOpen}
                                            />
                                        ))}
                                    </ul>
                                </section>
                            ))
                        )}
                    </div>
                )}
            </div>

            {state.kind === "ready" ? (
                <div className="shrink-0 border-t border-border-subtle px-3 py-1.5 text-xs text-text-muted">
                    ESLint on saved content · {pluralFiles(state.lintedCount)}
                    {state.skippedCount > 0
                        ? ` · ${state.skippedCount} more open ${state.skippedCount === 1 ? "file" : "files"} not checked`
                        : ""}
                </div>
            ) : null}
        </div>
    );
}