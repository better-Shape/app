"use client";

import { Branch20Regular } from "@fluentui/react-icons/headless/svg/branch";
import { ChevronRight20Regular } from "@fluentui/react-icons/headless/svg/chevron-right";
import { Edit20Regular } from "@fluentui/react-icons/headless/svg/edit";
import { Globe20Filled } from "@fluentui/react-icons/headless/svg/globe";
import { Search20Regular } from "@fluentui/react-icons/headless/svg/search";
import { Sparkle20Filled } from "@fluentui/react-icons/headless/svg/sparkle";
import { WindowConsole20Regular } from "@fluentui/react-icons/headless/svg/window-console";



import React, { useState } from "react";
import { type IconGlyph, Icon } from "@/components/ui/icon";


import { FileIcon } from "@/components/ui/file-icon";
import { cn, createOccurrenceKeyer } from "@/lib/utils";
import { commands, getProjectPath } from "@/lib/backend";
import { countChangedLines } from "@/lib/ui/diff-count";
import { ChatPatchDiff } from "./chat-diff";
import { ActionLine, splitActionLabel } from "./action-line";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import { Chunk } from "../md/renderer";
import { ChatMarkdown } from "../md/view";
import { looksLikeProseMarkdown } from "../md/stream";
import { openProjectFile } from "@/lib/window/open-project-file";
import { resolveProjectFilePath } from "@/lib/path/utils";
import { TerminalCommandStep } from "./terminal-live";
import { parseWebSearchHits, WebSearchBlock } from "./search";
import { providerIcon } from "@/lib/ui/provider-icon";

export const WORKFLOW_CHUNK_TYPES = new Set<Chunk["type"]>([
    "search", "grep", "status", "web_search", "web_result", "web_visit", "search_result",
    "inspect_runtime",
    "ls", "cat", "create_file", "mkdir", "delete_file", "rename_file", "rename_chat",
    "think", "thought", "run", "tool_result", "edit", "edit_pending", "terminal_command", "git_operation",
    "plugin_call",
    "subagent",
    "subagent_ref",
    "browse_session",
]);

/** Resolves a workspace-relative file path against the active project root. */
function resolvePath(filePath: string): string {
    return resolveProjectFilePath(filePath, getProjectPath());
}

/** Opens a file in the workspace editor and dispatches its inline diff preview. */
function openFileEdit(file: string, original: string, replacement: string, isResolved?: boolean) {
    // Open a real editor tab (not the lightweight preview-only pane).
    const fileName = file.split(/[\\/]/).pop() || file;
    const resolved = resolvePath(file);
    openProjectFile(file, fileName).then((ok) => {
        if (!ok) return;
        window.dispatchEvent(
            new CustomEvent("bettershape-layout-toggle", {
                detail: { id: "agent-workspace", value: true },
            }),
        );
        if (isResolved) {
            window.dispatchEvent(new CustomEvent("bettershape-dismiss-diff", {
                detail: { path: resolved, rawPath: file },
            }));
            return;
        }
        setTimeout(() => {
            window.dispatchEvent(new CustomEvent("bettershape-editor-preview-diff", {
                detail: { path: resolved, original, replacement },
            }));
        }, 100);
    }).catch(() => undefined);
}

/** Extracts the staged file path from a `Staged <path>` workflow output string. */
export function parseGitStagePath(content?: string): string | null {
    if (!content?.trim()) return null;
    const trimmed = content.trim();
    const match = trimmed.match(/^Staged\s+(.+)$/i);
    return (match?.[1] ?? trimmed).trim() || null;
}

type GitStatusLine = { area: "staged" | "unstaged"; status: string; path: string };

/** Parses `git status` output lines into structured status code and path entries. */
export function parseGitStatusLines(content?: string): GitStatusLine[] {
    if (!content?.trim()) return [];
    return content.split("\n").flatMap((line) => {
        const match = line.trim().match(/^\[(\w+)\]\s+(\S+)\s+(.+)$/);
        if (!match) return [];
        const area = match[1].toLowerCase() === "staged" ? "staged" : "unstaged";
        return [{ area, status: match[2], path: match[3] }];
    });
}

type GitLogLine = { hash: string; date: string; author: string; subject: string };

/** Parses compact `git log` lines into commit hash, refs, subject, and metadata. */
export function parseGitLogLines(content?: string): GitLogLine[] {
    if (!content?.trim()) return [];
    return content.split("\n").flatMap((line) => {
        const trimmed = line.trim();
        // New structured form
        const structured = trimmed.match(/^\[commit\]\s+([^|\s][^|]*)\|([^|]*)\|([^|]*)\|(.*)$/);
        if (structured) {
            return [{
                hash: structured[1].trim(),
                date: structured[2].trim(),
                author: structured[3].trim(),
                subject: structured[4].trim(),
            }];
        }
        // Legacy: `abc1234 2024-01-01, subject (author)`
        const legacy = trimmed.match(/^([0-9a-f]{7,40})\s+(\S+)\s+—\s+(.+?)\s+\(([^)]+)\)\s*$/i);
        if (legacy) {
            return [{
                hash: legacy[1],
                date: legacy[2],
                subject: legacy[3].trim(),
                author: legacy[4].trim(),
            }];
        }
        return [];
    });
}

type GitBranchLine = { name: string; current: boolean; remote: boolean };

/** Parses `git branch` output into branch names, active flags, and tracking info. */
export function parseGitBranchLines(content?: string): GitBranchLine[] {
    if (!content?.trim()) return [];
    return content.split("\n").flatMap((line) => {
        const trimmed = line.trim();
        const match = trimmed.match(/^\[([* r!])\]\s+(.+)$/);
        if (!match) return [];
        const mark = match[1];
        if (mark === "!") return [];
        return [{
            name: match[2].trim(),
            current: mark === "*",
            remote: mark === "r",
        }];
    });
}

/** Extracts target file path, hunk scope, and unified diff body from diff output. */
export function parseGitDiffMeta(content?: string): { file?: string; scope?: string; body: string } {
    if (!content?.trim()) return { body: "" };
    const lines = content.split("\n");
    const first = lines[0]?.trim() ?? "";
    const fileMatch = first.match(/^\[file\]\s+(.+)$/);
    if (fileMatch) {
        return { file: fileMatch[1].trim(), body: lines.slice(1).join("\n") };
    }
    const scopeMatch = first.match(/^\[scope\]\s+(\w+)$/);
    if (scopeMatch) {
        return { scope: scopeMatch[1], body: lines.slice(1).join("\n") };
    }
    return { body: content };
}

type WorkflowRow =
    | { kind: "block"; block: Chunk }
    | { kind: "git_stage_group"; paths: string[] }
    | { kind: "read_group"; files: { path: string; start?: number; end?: number }[] }
    | { kind: "search_group"; queries: string[]; count: number; previews?: string[] }
    | { kind: "web_trail"; blocks: Chunk[] }
    | { kind: "write_group"; paths: string[]; count: number }
    | { kind: "list_group"; count: number }
    | { kind: "subagent_group"; blocks: Chunk[] };

/** Checks whether two optional file paths normalize to the same target. */
function sameFilePath(a?: string, b?: string): boolean {
    if (!a || !b) return false;
    return a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
}

/** Checks whether a workflow chunk is a completed file mutation eligible for coalescing. */
function isCoalescableFileEdit(block: Chunk): boolean {
    if (!block.file) return false;
    if (block.type === "edit") return true;
    return block.type === "edit_pending" && block.commandStatus === "applied";
}

/** Returns the target file path mutated by an edit or write workflow chunk. */
function mutationPath(block: Chunk): string | undefined {
    if (isCoalescableFileEdit(block)) return block.file;
    if (
        block.type === "create_file"
        || block.type === "mkdir"
        || block.type === "delete_file"
        || block.type === "rename_file"
    ) {
        return block.file || block.content;
    }
    return undefined;
}

/** Consecutive edits to the same file become one row; later patch updates original→latest (the +/-). */
function isThinkChunk(block: Chunk): boolean {
    return block.type === "think" || block.type === "thought";
}

/** Normalizes whitespace in a task or todo description string. */
function taskText(value?: string): string {
    return (value || "").replace(/\s+/g, " ").trim();
}

/** Same kind of step, back to back. A different step in between keeps both. */
function sameRepeatedTask(a: Chunk, b: Chunk): boolean {
    if (isThinkChunk(a) && isThinkChunk(b)) return true;
    if (a.type !== b.type) return false;
    switch (a.type) {
        case "grep":
        case "search":
        case "search_result":
            return taskText(a.query || a.content) === taskText(b.query || b.content);
        case "run":
        case "terminal_command":
            return taskText(a.command) !== "" && taskText(a.command) === taskText(b.command);
        case "tool_result":
            return taskText(a.content) !== "" && taskText(a.content).slice(0, 80) === taskText(b.content).slice(0, 80);
        case "ls":
        case "status":
            return taskText(a.content) === taskText(b.content);
        default:
            return false;
    }
}

/** Merges consecutive updates to the same todo item into a single chunk. */
function mergeRepeatedTask(a: Chunk, b: Chunk): Chunk {
    if (isThinkChunk(a) || isThinkChunk(b)) {
        const parts = [a.content, b.content].map((part) => (part || "").trim()).filter(Boolean);
        return {
            ...a,
            type: "thought",
            content: parts.join("\n\n"),
            isGenerating: Boolean(a.isGenerating || b.isGenerating),
        };
    }
    return { ...b, isGenerating: Boolean(a.isGenerating || b.isGenerating) };
}

/** think, think, think becomes one thought. think, edit, think stays three steps. */
export function coalesceConsecutiveSameTasks(blocks: Chunk[]): Chunk[] {
    const out: Chunk[] = [];
    for (const block of blocks) {
        const prev = out[out.length - 1];
        if (prev && sameRepeatedTask(prev, block)) {
            out[out.length - 1] = mergeRepeatedTask(prev, block);
            continue;
        }
        out.push(block);
    }
    return out;
}

/** Folds adjacent edits to the same file into a combined diff chunk. */
export function coalesceConsecutiveSameFileEdits(blocks: Chunk[]): Chunk[] {
    const out: Chunk[] = [];
    for (const block of blocks) {
        const prev = out[out.length - 1];
        const prevPath = prev ? mutationPath(prev) : undefined;
        const nextPath = mutationPath(block);
        if (prev && prevPath && nextPath && sameFilePath(prevPath, nextPath)) {
            if (isCoalescableFileEdit(prev) && isCoalescableFileEdit(block)) {
                out[out.length - 1] = {
                    ...prev,
                    type: "edit",
                    replacement: block.replacement,
                    isGenerating: block.isGenerating,
                    commandStatus: block.commandStatus,
                };
            } else {
                out[out.length - 1] = block;
            }
            continue;
        }
        out.push(block);
    }
    return out;
}

/** Group workflow rows. */
export const groupWorkflowRows = (blocks: Chunk[]): WorkflowRow[] => {
    const rows: WorkflowRow[] = [];
    let stagePaths: string[] = [];
    let readFiles: { path: string; start?: number; end?: number }[] = [];
    let searchQueries: string[] = [];
    let searchCount = 0;
    let searchPreviews: string[] = [];
    let webBlocks: Chunk[] = [];
    let writePaths: string[] = [];
    let writeCount = 0;
    let listCount = 0;
    let subagents: Chunk[] = [];

    const flushStages = () => {
        if (stagePaths.length === 0) return;
        rows.push({ kind: "git_stage_group", paths: [...stagePaths] });
        stagePaths = [];
    };
    const flushReads = () => {
        if (readFiles.length === 0) return;
        rows.push({ kind: "read_group", files: [...readFiles] });
        readFiles = [];
    };
    const flushSearches = () => {
        if (searchCount === 0 && searchQueries.length === 0) return;
        rows.push({
            kind: "search_group",
            queries: [...searchQueries],
            count: Math.max(searchCount, searchQueries.length),
            previews: searchPreviews.length > 0 ? [...searchPreviews] : undefined,
        });
        searchQueries = [];
        searchCount = 0;
        searchPreviews = [];
    };
    const flushWeb = () => {
        if (webBlocks.length === 0) return;
        rows.push({ kind: "web_trail", blocks: [...webBlocks] });
        webBlocks = [];
    };
    const flushWrites = () => {
        if (writeCount === 0) return;
        rows.push({ kind: "write_group", paths: [...writePaths], count: writeCount });
        writePaths = [];
        writeCount = 0;
    };
    const flushLists = () => {
        if (listCount === 0) return;
        rows.push({ kind: "list_group", count: listCount });
        listCount = 0;
    };
    const flushSubs = () => {
        if (subagents.length === 0) return;
        if (subagents.length === 1) rows.push({ kind: "block", block: subagents[0] });
        else rows.push({ kind: "subagent_group", blocks: [...subagents] });
        subagents = [];
    };
    const flushAll = () => {
        flushStages();
        flushReads();
        flushSearches();
        flushWeb();
        flushWrites();
        flushLists();
        flushSubs();
    };

    for (const block of coalesceConsecutiveSameTasks(coalesceConsecutiveSameFileEdits(blocks))) {
        if (block.type === "subagent" || block.type === "subagent_ref") {
            flushStages();
            flushReads();
            flushSearches();
            flushWeb();
            flushWrites();
            flushLists();
            subagents.push(block);
            continue;
        }
        flushSubs();
        if (block.type === "git_operation" && block.gitOp === "stage") {
            flushReads();
            flushSearches();
            flushWeb();
            flushWrites();
            flushLists();
            const path = parseGitStagePath(block.content);
            if (path) {
                stagePaths.push(path);
                continue;
            }
        }
        if (block.type === "cat" && block.content) {
            flushStages();
            flushSearches();
            flushWeb();
            flushWrites();
            flushLists();
            readFiles.push({
                path: block.content,
                start: block.catStartLine,
                end: block.catEndLine,
            });
            continue;
        }
        if (block.type === "web_search" || block.type === "web_result" || block.type === "web_visit") {
            flushStages();
            flushReads();
            flushSearches();
            flushWrites();
            flushLists();
            webBlocks.push(block);
            continue;
        }
        if (
            (block.type === "search" || block.type === "grep" || block.type === "search_result")
            && !block.isGenerating
        ) {
            flushStages();
            flushReads();
            flushWeb();
            flushWrites();
            flushLists();
            const q = (block.query || block.content || "").trim();
            if (q) {
                searchCount += 1;
                if (searchQueries[searchQueries.length - 1] !== q) {
                    searchQueries.push(q);
                }
            }
            const body = (block.content || "").trim();
            if (
                body &&
                (block.type === "search_result" || (Boolean(block.query) && body !== q))
            ) {
                searchPreviews.push(body);
            }
            continue;
        }
        const pendingApproval =
            (block.type === "edit_pending" || block.type === "terminal_command")
            && (block.commandStatus || "pending") === "pending";
        if (pendingApproval) {
            flushAll();
            rows.push({ kind: "block", block });
            continue;
        }

        if (isCoalescableFileEdit(block)) {
            flushAll();
            rows.push({ kind: "block", block });
            continue;
        }
        if (block.type === "ls") {
            flushStages();
            flushReads();
            flushSearches();
            flushWeb();
            flushWrites();
            listCount += 1;
            continue;
        }
        flushAll();
        rows.push({ kind: "block", block });
    }
    flushAll();
    return rows;
};

/** Renders a color-coded single-letter Git status badge. */
function GitStatusBadge({ status }: { status: string }) {
    const letter = status.trim().charAt(0).toUpperCase() || "?";
    const label =
        letter === "A"
            ? "Added"
            : letter === "D"
              ? "Deleted"
              : letter === "M"
                ? "Modified"
                : letter === "R"
                  ? "Renamed"
                  : letter === "?" || letter === "U"
                    ? "Untracked"
                    : letter === "C"
                      ? "Copied"
                      : status.trim() || "Changed";
    const color =
        letter === "A"
            ? "text-success"
            : letter === "D"
              ? "text-error"
              : letter === "M" || letter === "R"
                ? "text-warning"
                : "text-text-muted";
    return (
        <span className={cn("ml-auto shrink-0 text-xs", color)}>{label}</span>
    );
}

/** Counts added and deleted lines across a unified diff body. */
function countDiffLines(body: string): { add: number; del: number } {
    let add = 0;
    let del = 0;
    for (const line of body.split("\n")) {
        if (line.startsWith("+") && !line.startsWith("+++")) add += 1;
        else if (line.startsWith("-") && !line.startsWith("---")) del += 1;
    }
    return { add, del };
}

/** Git summary row, same text style as Visited / Edited, details in a quiet dropdown. */
function GitActionChip({
    label,
    detail,
    add,
    del,
    children,
}: {
    label: string;
    detail?: string;
    add?: number;
    del?: number;
    children?: React.ReactNode;
}) {
    const hasDelta = (add ?? 0) > 0 || (del ?? 0) > 0;
    const sentence = detail ? `${label} ${detail}` : label;
    const parts = splitActionLabel(sentence);
    const trigger = (
        <button
            type="button"
            className={cn(
                "group/line flex w-fit max-w-full items-center gap-1.5 py-0.5 text-left chat-text font-normal text-text-muted",
                children ? "cursor-pointer" : "cursor-default",
            )}
        >
            <span className="min-w-0 truncate">
                <span className="text-text-secondary group-hover/line:text-text-primary">{parts.action}</span>
                {parts.detail ? <span className="text-text-muted"> {parts.detail}</span> : null}
            </span>
            {hasDelta ? (
                <span className="inline-flex shrink-0 items-center gap-1 tabular-nums">
                    {(add ?? 0) > 0 ? <span className="text-success">+{add}</span> : null}
                    {(del ?? 0) > 0 ? <span className="text-error">-{del}</span> : null}
                </span>
            ) : null}
            {children ? (
                <Icon
                    icon={ChevronRight20Regular}
                    className="shrink-0 text-text-muted opacity-50 transition-transform duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] group-data-[state=open]/line:rotate-90"
                />
            ) : null}
        </button>
    );

    if (!children) {
        return <div className="w-fit max-w-full py-0.5">{trigger}</div>;
    }

    return (
        <div className="w-fit max-w-full py-0.5">
            <DropdownMenu>
                <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-80 max-h-96 overflow-y-auto">
                    {children}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}

/** Renders the GeneratedMediaStep UI component. */
export const GeneratedMediaStep = ({ block }: { block: Chunk }) => {
    const src = (block.content || "").trim();
    const labelNoun =
        block.type === "generated_svg" ? "SVG" : block.type === "generated_audio" ? "audio" : "image";
    if (!src && !block.isGenerating) return null;
    if (block.isGenerating && !src) {
        return <GitActionChip label={`Generating ${labelNoun}`} />;
    }
    return (
        <GitActionChip label={`Generated ${labelNoun}`}>
            <div className="flex flex-col gap-2 p-2">
                {block.type === "generated_audio" ? (
                    <div className="relative overflow-hidden rounded-lg bg-linear-to-br from-accent/20 via-surface-2 to-surface-3 p-2">
                        <div className="pointer-events-none absolute -right-6 -top-6 size-20 rounded-full bg-accent/25 blur-2xl" aria-hidden />
                        <audio controls src={src} className="relative z-10 w-full" preload="metadata" />
                    </div>
                ) : (
                    <button
                        type="button"
                        aria-label={`Open ${labelNoun} in the viewer`}
                        className="cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        onClick={() =>
                            window.dispatchEvent(
                                new CustomEvent("bettershape-open-media", {
                                    detail: { src, title: `Generated ${labelNoun}`, kind: "image" },
                                }),
                            )
                        }
                    >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={src}
                            alt={labelNoun}
                            className={cn(
                                "w-full rounded-lg bg-surface-2",
                                block.type === "generated_svg" ? "max-h-72 object-contain p-2" : "max-h-56 object-cover",
                            )}
                        />
                    </button>
                )}
            </div>
        </GitActionChip>
    );
};

/** Renders a grouped summary of files staged in Git. */
export function GitStageGroup({ paths }: { paths: string[] }) {
    const unique = [...new Set(paths.filter(Boolean))];

    return (
        <GitActionChip
            label="Staged"
            detail={`${unique.length} file${unique.length === 1 ? "" : "s"}`}
        >
            <div className="flex flex-col py-0.5">
                {unique.map((path) => (
                    <DropdownMenuItem
                        key={path}
                        className="gap-2"
                        onClick={() => {
                            const name = path.split(/[\\/]/).pop() || path;
                            openProjectFile(path, name).catch(() => undefined);
                        }}
                    >
                        <FileIcon name={path.split(/[\\/]/).pop() || path} className="size-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">
                            {path.split(/[\\/]/).pop() || path}
                        </span>
                        <GitStatusBadge status="A" />
                    </DropdownMenuItem>
                ))}
            </div>
        </GitActionChip>
    );
}

const GitStatusFileRow = ({ line }: { line: GitStatusLine }) => {
    const baseName = line.path.split(/[\\/]/).pop() || line.path;
    return (
        <DropdownMenuItem
            className="gap-2"
            onClick={() => {
                openProjectFile(line.path, baseName).catch(() => undefined);
            }}
        >
            <FileIcon name={baseName} className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{baseName}</span>
            <GitStatusBadge status={line.status} />
        </DropdownMenuItem>
    );
};

/** Renders parsed `git status` entries as a compact file list. */
function GitStatusGroup({ lines }: { lines: GitStatusLine[] }) {
    const staged = lines.filter((l) => l.area === "staged");
    const unstaged = lines.filter((l) => l.area === "unstaged");
    const total = lines.length;

    return (
        <GitActionChip
            label="Checked status"
            detail={
                total === 0
                    ? "clean"
                    : `${total} change${total === 1 ? "" : "s"}`
            }
        >
            <div className="flex flex-col gap-2">
                {staged.length > 0 ? (
                    <div className="flex flex-col py-0.5">
                        <span className="px-2 py-1 text-xs text-text-disabled">Staged</span>
                        {staged.map((line) => (
                            <GitStatusFileRow key={`staged-${line.path}`} line={line} />
                        ))}
                    </div>
                ) : null}
                {unstaged.length > 0 ? (
                    <div className="flex flex-col py-0.5">
                        {unstaged.map((line) => (
                            <GitStatusFileRow key={`unstaged-${line.path}`} line={line} />
                        ))}
                    </div>
                ) : null}
                {lines.length === 0 ? (
                    <span className="px-2 py-1.5 text-sm text-text-muted">Clean working tree</span>
                ) : null}
            </div>
        </GitActionChip>
    );
}

/** Renders parsed `git log` commits as a compact timeline list. */
function GitLogGroup({ lines }: { lines: GitLogLine[] }) {
    return (
        <GitActionChip label="Viewed log" detail={`${lines.length} commit${lines.length === 1 ? "" : "s"}`}>
            <div className="flex flex-col gap-0.5">
                {lines.map((line) => (
                    <div
                        key={`${line.hash}-${line.subject}`}
                        className="flex flex-col gap-0.5 rounded-lg px-2 py-1.5 hover:bg-[var(--row-hover)]"
                    >
                        <div className="flex min-w-0 items-center gap-2">
                            <span className="shrink-0 font-mono text-xs text-text-secondary">{line.hash}</span>
                            {line.author ? (
                                <span className="shrink-0 text-xs text-text-disabled">{line.author}</span>
                            ) : null}
                            {line.date ? (
                                <span className="ml-auto shrink-0 text-xs text-text-disabled">{line.date}</span>
                            ) : null}
                        </div>
                        <span className="text-sm text-text-primary leading-snug">{line.subject}</span>
                    </div>
                ))}
            </div>
        </GitActionChip>
    );
}

/** Renders parsed `git branch` entries with current-branch highlighting. */
function GitBranchesGroup({ lines }: { lines: GitBranchLine[] }) {
    const current = lines.find((l) => l.current);

    return (
        <GitActionChip label="Branches" detail={current?.name}>
            <div className="flex flex-col gap-0.5">
                {lines.map((line) => (
                    <div
                        key={line.name}
                        className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--row-hover)]"
                    >
                        <span
                            className={cn(
                                "h-1.5 w-1.5 shrink-0 rounded-full",
                                line.current ? "bg-success" : "bg-text-disabled/40",
                            )}
                        />
                        <span
                            className={cn(
                                "min-w-0 truncate text-sm",
                                line.current ? "text-text-primary" : "text-text-secondary",
                                line.remote && "text-text-muted",
                            )}
                        >
                            {line.name}
                        </span>
                        {line.current ? (
                            <span className="ml-auto shrink-0 text-xs text-text-disabled">current</span>
                        ) : null}
                    </div>
                ))}
            </div>
        </GitActionChip>
    );
}

/** Renders a collapsible unified diff card for Git diff output. */
function GitDiffGroup({
    file,
    scope,
    body,
}: {
    file?: string;
    scope?: string;
    body: string;
}) {
    const { add, del } = countDiffLines(body);
    const fileName = file?.split(/[\\/]/).pop();
    const label = file
        ? "Diff"
        : scope === "staged"
          ? "Staged diff"
          : "Diff";

    return (
        <GitActionChip label={label} detail={fileName} add={add} del={del}>
            <div className="flex flex-col gap-2 p-1">
                {file ? <FilePill path={file} /> : null}
                <ChatPatchDiff body={body} />
            </div>
        </GitActionChip>
    );
}

/** Formats a file read target with optional 1-based line range suffix. */
export function formatReadTarget(file: {
    path: string;
    start?: number;
    end?: number;
}): string {
    const range =
        file.start && file.end
            ? `:${file.start}-${file.end}`
            : file.start
              ? `:${file.start}`
              : "";
    return `${file.path}${range}`;
}

/** Estimates approximate token count across a batch of file read ranges. */
export function estimateReadTokens(files: { path: string; start?: number; end?: number }[]): number {
    return files.reduce((sum, file) => {
        if (file.start && file.end && file.end >= file.start) {
            return sum + Math.max(400, (file.end - file.start + 1) * 40);
        }
        return sum + 2400;
    }, 0);
}

/** Formats an integer token count using compact `k` notation when large. */
export function formatTokenCount(tokens: number): string {
    if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
    return String(tokens);
}

/** Renders a collapsible group of consecutive file-read tool calls. */
export function ReadGroup({
    files,
    tokens,
}: {
    files: { path: string; start?: number; end?: number }[];
    tokens?: number;
}) {
    const unique = files.filter((f) => f.path);
    const tokenCount = tokens ?? estimateReadTokens(unique);
    const readKey = createOccurrenceKeyer();
    return (
        <div className="flex flex-col gap-0.5 py-0.5">
            {unique.map((file) => (
                <ActionLine
                    key={readKey(file.path)}
                    action="Read"
                    detail={formatReadTarget(file)}
                    title={file.path}
                    onClick={() => { openProjectFile(file.path).catch(() => undefined); }}
                />
            ))}
            {unique.length > 0 ? (
                <div className="py-0.5 chat-text text-text-muted">
                    {unique.length} file{unique.length === 1 ? "" : "s"} read
                    {" · "}
                    {formatTokenCount(tokenCount)} tokens
                </div>
            ) : null}
        </div>
    );
}
/** Computes the summary icon and label for a collapsed workflow step group. */
function computeGroupHeader(visible: Chunk[]): { icon: IconGlyph; label: string } {
    const hasThink = visible.some((b) => b.type === "think" || b.type === "thought");
    const hasExplore = visible.some((b) =>
        ["search", "grep", "cat", "ls", "search_result", "web_search", "web_result", "web_visit", "inspect_runtime"].includes(b.type),
    );
    const hasEdit = visible.some((b) =>
        ["edit", "create_file", "mkdir", "delete_file", "rename_file"].includes(b.type),
    );
    const hasCommand = visible.some((b) => b.type === "terminal_command" || b.type === "run");

    if (hasEdit && hasExplore) return { icon: Edit20Regular, label: "Explored and edited" };
    if (hasEdit) return { icon: Edit20Regular, label: "Edited files" };
    if (hasCommand && !hasExplore) return { icon: WindowConsole20Regular, label: "Ran commands" };
    if (hasExplore) return { icon: Search20Regular, label: "Explored codebase" };
    if (hasThink) return { icon: Sparkle20Filled, label: "Thought" };
    return { icon: Sparkle20Filled, label: "Worked" };
}

/** Extracts up to 5 result URLs from a web-search markdown block. */
const extractWebSearchResultUrls = (content: string | undefined): string[] =>
    parseWebSearchHits(content || "")
        .map((hit) => hit.url)
        .filter(Boolean)
        .slice(0, 5);

/** Formats an inspect-runtime target URL into `host + path` when parseable. */
const formatInspectRuntimeDetail = (rawUrl: string): string => {
    if (!rawUrl) return "";
    try {
        const parsed = new URL(rawUrl);
        return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
    } catch {
        return rawUrl;
    }
};

const GENERATED_MEDIA_NOUNS: Partial<Record<string, string>> = {
    generated_svg: "SVG",
    generated_audio: "audio",
    generated_image: "image",
};

const EDIT_PENDING_LABELS: Partial<Record<string, string>> = {
    applied: "Edited",
    rejected: "Rejected edit",
    cancelled: "Cancelled edit",
};

const GIT_OP_LABELS: Partial<Record<string, string>> = {
    fetch: "Fetched",
    status: "Git status",
    log: "Git log",
    diff: "Git diff",
    branches: "Branches",
    stage: "Staged",
    commit: "Committed",
};

const STRUCTURED_GIT_OPS = new Set(["stage", "status", "log", "branches", "diff"]);

/** Resolves the human-readable action label for a `git_operation` chunk. */
const resolveGitOpLabel = (op: string, status: string): string => {
    if (status === "running") return `${op}...`;
    if (status === "error") return `${op} failed`;
    if (status === "pending") return "Awaiting approval";
    return GIT_OP_LABELS[op] ?? `Git ${op}`;
};

/** Builds the workflow action configuration for a `git_operation` chunk. */
const buildGitOperationActionConfig = (block: Chunk) => {
    const op = block.gitOp ?? "git";
    const status = block.gitStatus ?? "completed";
    const structured = STRUCTURED_GIT_OPS.has(op);
    const stagePath = op === "stage" ? parseGitStagePath(block.content) : null;
    const statusLines = op === "status" ? parseGitStatusLines(block.content) : [];
    const logLines = op === "log" ? parseGitLogLines(block.content) : [];
    const branchLines = op === "branches" ? parseGitBranchLines(block.content) : [];
    const diffMeta = op === "diff" ? parseGitDiffMeta(block.content) : null;
    return {
        label: resolveGitOpLabel(op, status),
        file: stagePath ?? diffMeta?.file ?? undefined,
        query: structured ? undefined : block.content?.trim() || undefined,
        expandable: !structured && Boolean(block.content && block.content.length > 80),
        content: block.content,
        icon: (status === "running" ? "refresh" : "git-branch") as "refresh" | "git-branch",
        gitStatusLines: statusLines.length > 0 ? statusLines : undefined,
        gitLogLines: logLines.length > 0 ? logLines : undefined,
        gitBranchLines: branchLines.length > 0 ? branchLines : undefined,
        gitDiffMeta: diffMeta?.body ? diffMeta : undefined,
    };
};

/** Builds the workflow action configuration for a `terminal_command` or `run` chunk. */
const buildTerminalActionConfig = (block: Chunk) => {
    const label =
        block.commandStatus === "pending"
            ? "Awaiting approval"
            : block.commandStatus === "background"
              ? "Running in background"
              : "Ran";
    return {
        label,
        query: block.command || block.content,
        expandable: Boolean(block.content && block.content.trim() !== block.command?.trim()),
        content: block.content ? block.content.replace(block.command || "", "").trim() : "",
        commandId: block.commandId,
        commandStatus: block.commandStatus,
        commandReason: block.commandReason,
    };
};

/** Builds the workflow action configuration for a `web_search` or `web_result` chunk. */
const buildWebSearchActionConfig = (block: Chunk) => ({
    label: block.type === "web_result" || !block.isGenerating ? "Searched web" : "Searching web",
    query: block.query,
    expandable: Boolean(block.content),
    content: block.content,
    resultUrls: extractWebSearchResultUrls(block.content),
});

/** Builds the workflow action configuration for an `inspect_runtime` chunk. */
const buildInspectRuntimeActionConfig = (block: Chunk, inFlight: boolean | undefined) => {
    const detail = formatInspectRuntimeDetail((block.query || "").trim());
    const kind = (block.inspectKind || "").trim();
    return {
        label: inFlight ? "Inspecting" : "Inspected",
        query: detail || kind || "runtime",
        expandable: Boolean(block.content?.trim()),
        content: block.content,
        chromiumIcon: true,
    };
};

/** Builds the workflow action configuration for generated media chunks. */
const buildGeneratedMediaActionConfig = (block: Chunk) => {
    const noun = GENERATED_MEDIA_NOUNS[block.type] ?? "image";
    return {
        label: block.isGenerating ? `Generating ${noun}` : `Generated ${noun}`,
        expandable: true,
        content: block.content,
    };
};

type WorkflowActionBuilder = (block: Chunk, inFlight: boolean | undefined) => {
    label: string;
    query?: string;
    file?: string;
    expandable: boolean;
    content?: string;
    resultUrls?: string[];
    faviconUrl?: string;
    onClick?: () => void;
    chromiumIcon?: boolean;
    original?: string;
    replacement?: string;
    commandId?: string;
    commandStatus?: Chunk["commandStatus"];
    commandReason?: string;
    icon?: "refresh" | "git-branch";
    gitStatusLines?: ReturnType<typeof parseGitStatusLines>;
    gitLogLines?: ReturnType<typeof parseGitLogLines>;
    gitBranchLines?: ReturnType<typeof parseGitBranchLines>;
    gitDiffMeta?: ReturnType<typeof parseGitDiffMeta>;
};

const WORKFLOW_ACTION_BUILDERS: Partial<Record<string, WorkflowActionBuilder>> = {
    think: (block, inFlight) => ({
        label: inFlight ? "Thinking" : "Thought",
        expandable: true,
        content: block.content,
    }),
    thought: (block, inFlight) => ({
        label: inFlight ? "Thinking" : "Thought",
        expandable: true,
        content: block.content,
    }),
    search: (block, inFlight) => ({
        label: inFlight ? "Searching" : "Searched",
        query: block.query || block.content,
        expandable: Boolean(block.content) && block.content !== block.query,
        content: block.content,
    }),
    search_result: (block) => ({
        label: "Searched",
        query: block.query,
        expandable: Boolean(block.content),
        content: block.content,
    }),
    web_search: buildWebSearchActionConfig,
    web_result: buildWebSearchActionConfig,
    browse_session: (block, inFlight) => ({
        label: inFlight ? "Opening" : "Opened",
        query: block.visitTitle || block.visitUrl || "page",
        expandable: false,
    }),
    web_visit: (block) => ({
        label: block.isGenerating ? "Visiting" : "Visited",
        query: block.visitHost || block.visitTitle || block.content,
        file: undefined,
        expandable: false,
        faviconUrl: block.visitUrl || block.visitHost,
        onClick: () => {
            const href = block.visitUrl;
            if (href) commands.openUrlExternal(href).catch(() => undefined);
        },
    }),
    inspect_runtime: buildInspectRuntimeActionConfig,
    plugin_call: (block) => ({
        label: block.pluginLabel || "Plugin",
        query: block.pluginToolkit,
        expandable: false,
        content: block.content,
    }),
    generated_svg: buildGeneratedMediaActionConfig,
    generated_image: buildGeneratedMediaActionConfig,
    generated_audio: buildGeneratedMediaActionConfig,
    subagent: (block) => ({
        label: "Spawned",
        query: block.query || "agent",
        expandable: false,
        content: block.content,
    }),
    subagent_ref: (block) => ({
        label: "Spawned",
        query: block.query || "agent",
        expandable: false,
        content: block.content,
    }),
    grep: (block, inFlight) => ({
        label: inFlight ? "Grepping" : "Grepped",
        query: block.query || block.content,
        expandable: Boolean(block.content),
        content: block.content,
    }),
    cat: (block) => ({
        label: "Read",
        file: block.content,
        expandable: false,
        onClick: () => {
            if (block.content) openProjectFile(block.content).catch(() => undefined);
        },
    }),
    ls: (block) => {
        const trimmed = (block.content || "").trim();
        return {
            label: "Listed",
            query: trimmed === "." ? "project" : trimmed.split(/[\\/]/).pop(),
            expandable: false,
        };
    },
    create_file: (block) => ({ label: "Created", file: block.content, expandable: false }),
    mkdir: (block) => ({ label: "Created directory", file: block.content, expandable: false }),
    delete_file: (block) => ({ label: "Deleted", file: block.content, expandable: false }),
    rename_file: (block) => ({ label: "Renamed", query: block.content, expandable: false }),
    rename_chat: (block) => ({ label: "Renamed chat", query: block.content, expandable: false }),
    edit: (block) => ({
        label: block.isGenerating ? "Editing" : "Edited",
        file: block.file || "",
        expandable: false,
        original: block.original,
        replacement: block.replacement,
    }),
    edit_pending: (block) => ({
        label: EDIT_PENDING_LABELS[block.commandStatus ?? ""] ?? "Proposed edit",
        file: block.file || "",
        expandable: false,
        original: block.original,
        replacement: block.replacement,
    }),
    terminal_command: buildTerminalActionConfig,
    run: buildTerminalActionConfig,
    git_operation: buildGitOperationActionConfig,
};

/** Get workflow action config. */
export const getWorkflowActionConfig = (block: Chunk, isActive?: boolean) => {
    const builder = WORKFLOW_ACTION_BUILDERS[block.type];
    return builder ? builder(block, isActive ?? block.isGenerating) : null;
};

/** Checks whether a workflow chunk has visible UI content in the transcript. */
export function isRenderableWorkflowBlock(block: Chunk, isActive?: boolean) {
    if (block.type === "browse_session") return true;
    if (block.type === "status") return false;
    if (block.type === "tool_result") return true;
    if ((block.type === "think" || block.type === "thought") && !block.content?.trim() && !isActive) return false;
    return getWorkflowActionConfig(block, isActive) !== null;
}

/** Runs up to this size render as plain inline rows; larger runs get a collapsible summary. */
const INLINE_GROUP_MAX = 3;

/**
 * One consecutive run of tool actions, rendered in place between prose
 * segments. Small runs show as flat rows; long runs collapse into a summary
 * line ("Explored codebase · 12 steps") once the turn finishes. The message's
 * single bottom status indicator owns the spinner  -  no spinner here.
 */
export const AgentWorkflow = ({
    blocks,
    isActive,
    isFileEditResolved,
}: {
    blocks: Chunk[];
    isActive?: boolean;
    isFileEditResolved?: (file: string, replacement?: string) => boolean;
}) => {
    const visibleBlocks = blocks.filter((b) => isRenderableWorkflowBlock(b, isActive));
    const collapsible = visibleBlocks.length > INLINE_GROUP_MAX;

    // Open while streaming, collapse once the run finishes. Render-time state
    // adjustment (not an effect) per React guidance.
    const [isOpen, setIsOpen] = useState(Boolean(isActive));
    const [prevActive, setPrevActive] = useState(isActive);
    if (isActive !== prevActive) {
        setPrevActive(isActive);
        setIsOpen(Boolean(isActive));
    }

    if (visibleBlocks.length === 0) return null;

    const rows = (
        <div className="flex flex-col gap-0.5">
            {/*
              The rows are a projection of the parsed message and only ever append, so a row
              keeps its position: a content key would collide when the same file is read twice.
            */}
            {(() => {
                const rowKey = createOccurrenceKeyer();
                return groupWorkflowRows(visibleBlocks).map((row) => {
                    if (row.kind === "git_stage_group") {
                        return <GitStageGroup key={rowKey(`stage:${row.paths.join(",")}`)} paths={row.paths} />;
                    }
                    if (row.kind === "read_group") {
                        const names = [
                            ...new Set(
                                row.files
                                    .map((f) => f.path.split(/[\\/]/).pop() || f.path)
                                    .filter(Boolean),
                            ),
                        ];
                        const detail =
                            names.length === 0
                                ? null
                                : names.length === 1
                                  ? names[0]
                                  : `${names[0]} and more`;
                        return (
                            <ActionLine
                                key={rowKey(`reads:${names.at(0) ?? ""}`)}
                                action="Explored"
                                detail={detail}
                            />
                        );
                    }
                    if (row.kind === "search_group") {
                        const hasDetails = row.queries.length > 0 || Boolean(row.previews?.length);
                        const summaryDetail =
                            row.count > 1 ? `${row.count} times` : row.queries[0] || undefined;
                        const queryKey = createOccurrenceKeyer();
                        const previewKey = createOccurrenceKeyer();
                        return (
                            <ActionLine
                                key={rowKey(`searches:${summaryDetail ?? ""}`)}
                                action="Searched"
                                detail={summaryDetail}
                            >
                                {hasDetails ? (
                                    <div className="flex flex-col gap-1.5 py-1 text-xs text-text-muted">
                                        {row.queries.map((queryText) => (
                                            <div
                                                key={queryKey(queryText)}
                                                className="truncate font-mono text-text-secondary"
                                            >
                                                {queryText}
                                            </div>
                                        ))}
                                        {row.previews?.slice(0, 3).map((previewText) => (
                                            <pre
                                                key={previewKey(previewText.slice(0, 48))}
                                                className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-2 px-2 py-1 font-mono text-2xs text-text-muted"
                                            >
                                                {previewText}
                                            </pre>
                                        ))}
                                    </div>
                                ) : null}
                            </ActionLine>
                        );
                    }
                    if (row.kind === "web_trail") {
                        const queries = row.blocks
                            .map((b) => (b.query || "").trim())
                            .filter(Boolean);
                        const results = row.blocks.flatMap((b) => {
                            if (b.type === "web_visit") {
                                return [{
                                    title: b.visitTitle || b.visitHost || "Visited",
                                    url: b.visitUrl || "",
                                    snippet: b.visitHost ? `Visited ${b.visitHost}` : "",
                                }];
                            }
                            return parseWebSearchHits(b.content || "");
                        });
                        const seen = new Set<string>();
                        const unique = results.filter((hit) => {
                            const key = hit.url || hit.title;
                            if (!key || seen.has(key)) return false;
                            seen.add(key);
                            return true;
                        });
                        return (
                            <WebSearchBlock
                                key={rowKey(`web:${queries.at(0) ?? ""}`)}
                                query={queries[queries.length - 1]}
                                searches={queries.length}
                                results={unique}
                                isActive={row.blocks.some((b) => b.isGenerating)}
                            />
                        );
                    }
                    if (row.kind === "write_group") {
                        const names = [...new Set(row.paths.map((p) => p.split(/[\\/]/).pop() || p).filter(Boolean))];
                        const detail =
                            names.length === 0
                                ? null
                                : names.length === 1
                                  ? names[0]
                                  : `${names[0]} and more`;
                        return (
                            <ActionLine
                                key={rowKey(`writes:${names.at(0) ?? ""}`)}
                                action="Edited"
                                detail={detail}
                            />
                        );
                    }
                    if (row.kind === "list_group") {
                        return (
                            <ActionLine
                                key={rowKey(`lists:${row.count}`)}
                                action="Listed"
                                detail={row.count > 1 ? `${row.count} folders` : "folders"}
                            />
                        );
                    }
                    if (row.kind === "subagent_group") {
                        const subKey = createOccurrenceKeyer();
                        return (
                            <div key={rowKey(`subs:${row.blocks.length}`)} className="flex flex-col">
                                <ActionLine action="Spawning" detail="subagents" />
                                {row.blocks.map((block) => (
                                    <ActionItem key={subKey(block.file || block.type)} block={block} isFileEditResolved={isFileEditResolved} />
                                ))}
                            </div>
                        );
                    }
                    return (
                        <ActionItem
                            key={rowKey(`action:${row.block.type}:${row.block.file ?? row.block.commandId ?? ""}`)}
                            block={row.block}
                            isFileEditResolved={isFileEditResolved}
                        />
                    );
                });
            })()}
        </div>
    );

    if (!collapsible) {
        return <div className="flex flex-col w-full my-1 select-none">{rows}</div>;
    }

    const header = splitActionLabel(computeGroupHeader(visibleBlocks).label);

    return (
        <div className="my-1 flex w-full select-none flex-col">
            <ActionLine
                action={header.action}
                detail={header.detail}
                open={isOpen}
                onOpenChange={setIsOpen}
            >
                {rows}
            </ActionLine>
        </div>
    );
};

/** Renders an interactive file-icon chip that opens the referenced path on click. */
function FilePill({ path, onClick }: { path: string; onClick?: () => void }) {
    const fileName = path.split(/[\\/]/).pop() || path;
    const handleOpen = onClick ?? (() => { openProjectFile(path, fileName).catch(() => undefined); });
    return (
        <span
            role="button"
            tabIndex={0}
            onClick={handleOpen}
            onAuxClick={(e) => {
                if (e.button === 1) handleOpen();
            }}
            onKeyDown={(e) => { if (e.key === "Enter") handleOpen(); }}
            className={cn(
                "inline-flex min-w-0 max-w-[200px] items-center truncate chat-text font-medium text-text-secondary",
                "cursor-pointer hover:text-text-primary",
            )}
        >
            {fileName}
        </span>
    );
}

type WorkflowActionConfig = NonNullable<ReturnType<typeof getWorkflowActionConfig>>;

const MARKDOWN_PROSE_CHUNK_TYPES = new Set([
    "think",
    "thought",
    "search_result",
    "web_result",
    "inspect_runtime",
]);

const SUBAGENT_RAW_STATUS_MAP: Partial<Record<string, "running" | "done" | "error" | "pending">> = {
    done: "done",
    completed: "done",
    error: "error",
    failed: "error",
    pending: "pending",
};

const SUBAGENT_ACTIVITY_BY_STATUS: Partial<Record<string, string>> = {
    done: "Completed",
    error: "Failed",
};

/** Renders structured `git_operation` groups (`status`, `log`, `branches`, `diff`, `stage`) when matched. */
const renderStructuredGitGroup = (block: Chunk, config: WorkflowActionConfig): React.ReactNode | null => {
    if (block.gitOp === "status" && config.gitStatusLines?.length) {
        return <GitStatusGroup lines={config.gitStatusLines} />;
    }
    if (block.gitOp === "log" && config.gitLogLines?.length) {
        return <GitLogGroup lines={config.gitLogLines} />;
    }
    if (block.gitOp === "branches" && config.gitBranchLines?.length) {
        return <GitBranchesGroup lines={config.gitBranchLines} />;
    }
    if (block.gitOp === "diff" && config.gitDiffMeta) {
        return (
            <GitDiffGroup
                file={config.gitDiffMeta.file}
                scope={config.gitDiffMeta.scope}
                body={config.gitDiffMeta.body}
            />
        );
    }
    return null;
};

/** Renders a `git_operation` chunk as either a structured git group, stage chip, or inline status line. */
const renderGitWorkflowActionItem = (block: Chunk, config: WorkflowActionConfig): React.ReactNode => {
    const structured = renderStructuredGitGroup(block, config);
    if (structured) return structured;
    if (block.gitOp === "stage" && config.file) {
        return (
            <GitActionChip label="Staged" detail={config.file.split(/[\\/]/).pop()}>
                <div className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5">
                    <FilePill path={config.file} />
                    <GitStatusBadge status="A" />
                </div>
            </GitActionChip>
        );
    }
    const failed = block.gitStatus === "error";
    const content = (config.content || "").trim();
    const fileLabel = config.file?.split(/[\\/]/).pop();
    const inlineDetail = !fileLabel && content.length > 0 && content.length < 180 ? content : "";
    return (
        <div className="flex w-fit max-w-full items-center gap-2 py-0.5 text-sm">
            <Icon
                icon={Branch20Regular}
                className={cn(
                    "icon-sm shrink-0",
                    block.gitStatus === "running" && "animate-spin",
                    failed ? "text-error" : "text-text-muted",
                )}
            />
            <span className={cn("text-text-secondary", failed && "text-error")}>{config.label}</span>
            {fileLabel ? (
                <span className="inline-flex min-w-0 items-center gap-1 text-text-muted">
                    <FileIcon name={fileLabel} className="size-4" />
                    <span className="truncate">{fileLabel}</span>
                </span>
            ) : null}
            {inlineDetail ? <span className="truncate text-text-muted">{inlineDetail}</span> : null}
        </div>
    );
};

/** Opens or upserts a subagent detail card when a `subagent` / `subagent_ref` workflow row is clicked. */
const openWorkflowSubagentCard = (block: Chunk, id: string, name: string) => {
    const rawStatus = (block.commandStatus || "").toLowerCase();
    const subStatus = SUBAGENT_RAW_STATUS_MAP[rawStatus] ?? "running";
    const subActivity = SUBAGENT_ACTIVITY_BY_STATUS[subStatus] ?? "Working...";
    import("@/features/agent/subagents/store")
        .then(({ openSubagent, upsertSubagent }) => {
            upsertSubagent({
                id,
                title: name,
                agent: name,
                model: block.command || undefined,
                activity: subActivity,
                task: block.type === "subagent_ref" ? block.content : undefined,
                transcript: block.type === "subagent" ? block.content : undefined,
                status: subStatus,
            });
            openSubagent(id);
        })
        .catch(() => undefined);
};

/** Renders a `subagent` or `subagent_ref` workflow row. */
const renderSubagentActionItem = (block: Chunk): React.ReactNode => {
    const name = block.query || "agent";
    const id = block.file || name;
    return (
        <ActionLine
            action="Spawned"
            detail={name}
            icon={providerIcon(block.command || "auto", 14)}
            onClick={() => openWorkflowSubagentCard(block, id, name)}
        />
    );
};

/** Truncates a workflow query string to 60 characters for single-line display. */
const formatShortWorkflowQuery = (query: string | undefined): string => {
    if (!query) return "";
    return query.length > 60 ? `${query.slice(0, 60)}...` : query;
};

/** Collects favicon URLs from `faviconUrl` and `resultUrls` on a workflow config. */
const collectWorkflowFavicons = (config: WorkflowActionConfig): string[] => {
    const out: string[] = [];
    if (config.faviconUrl) out.push(config.faviconUrl);
    if (config.resultUrls) out.push(...config.resultUrls);
    return out;
};

/** Checks whether an expanded workflow disclosure body should render through `ChatMarkdown`. */
const shouldRenderWorkflowMarkdown = (block: Chunk, content: string | undefined): boolean => {
    if (MARKDOWN_PROSE_CHUNK_TYPES.has(block.type)) return true;
    return block.type === "search" && Boolean(content && looksLikeProseMarkdown(content));
};

/** Builds click handler for non-expandable `edit` or link-backed workflow action lines. */
const buildWorkflowActionClick = (
    block: Chunk,
    config: WorkflowActionConfig,
    editResolved: boolean,
): (() => void) | undefined => {
    if (config.expandable) return undefined;
    if (block.type === "edit" && block.file) {
        const file = block.file;
        return () => openFileEdit(file, block.original || "", block.replacement || "", editResolved);
    }
    return config.onClick;
};

/** Renders the expandable disclosure body inside a generic `ActionLine`. */
const WorkflowActionDisclosureBody = ({
    isThink,
    useMarkdown,
    content,
}: {
    isThink: boolean;
    useMarkdown: boolean;
    content: string;
}) => {
    const toneClass = isThink
        ? "leading-relaxed text-text-muted"
        : useMarkdown
          ? "font-sans"
          : "overflow-x-auto whitespace-pre-wrap rounded-md border border-border-subtle bg-panel p-2 font-mono chat-text text-text-secondary";
    return (
        <div className={cn("mb-1 mt-1 chat-text", toneClass)}>
            {useMarkdown ? <ChatMarkdown content={content} /> : content}
        </div>
    );
};

/** Renders the generic `ActionLine` presentation for non-specialized workflow chunks. */
const renderDefaultWorkflowActionLine = ({
    block,
    config,
    editStats,
    editResolved,
}: {
    block: Chunk;
    config: WorkflowActionConfig;
    editStats: { add: number; del: number } | null;
    editResolved: boolean;
}): React.ReactNode => {
    const isThink = block.type === "think" || block.type === "thought";
    const useMarkdown = shouldRenderWorkflowMarkdown(block, config.content);
    const lead = splitActionLabel(editResolved ? "Applied" : config.label);
    const fileLabel = config.file?.split(/[\\/]/).pop() || "";
    const detail = [lead.detail, formatShortWorkflowQuery(config.query), fileLabel].filter(Boolean).join(" ");
    const delta = editResolved || !editStats ? { add: 0, del: 0 } : editStats;
    const showBody = Boolean(config.expandable && config.content);

    return (
        <ActionLine
            action={lead.action}
            detail={detail || undefined}
            add={delta.add}
            del={delta.del}
            favicons={collectWorkflowFavicons(config)}
            icon={config.chromiumIcon ? <Icon icon={Globe20Filled} className="text-text-muted" /> : undefined}
            onClick={buildWorkflowActionClick(block, config, editResolved)}
        >
            {showBody ? (
                <WorkflowActionDisclosureBody
                    isThink={isThink}
                    useMarkdown={useMarkdown}
                    content={config.content ?? ""}
                />
            ) : null}
        </ActionLine>
    );
};

/** Dispatches specialized workflow block types (`terminal_command`, `edit_pending`, media, git, subagent) before falling back to `ActionLine`. */
const renderSpecializedActionItem = (
    block: Chunk,
    config: WorkflowActionConfig,
): React.ReactNode | undefined => {
    if (block.type === "terminal_command") return <TerminalCommandStep block={block} />;
    if (block.type === "edit_pending" && (block.commandStatus || "pending") === "pending") {
        return <ActionLine action="Pending" detail={(block.file || "").split(/[\\/]/).pop() || "file"} />;
    }
    if (GENERATED_MEDIA_NOUNS[block.type]) return <GeneratedMediaStep block={block} />;
    if (block.type === "git_operation") return renderGitWorkflowActionItem(block, config);
    if (block.type === "subagent" || block.type === "subagent_ref") return renderSubagentActionItem(block);
    return undefined;
};

/** Checks whether a file edit block has already been resolved in the workspace. */
const checkEditBlockResolved = (
    block: Chunk,
    isFileEditResolved?: (file: string, replacement?: string) => boolean,
): boolean => {
    if (block.type !== "edit" || !block.file || !isFileEditResolved) return false;
    return isFileEditResolved(block.file, block.replacement);
};

/** ActionItem helper. */
export function ActionItem({
    block,
    isFileEditResolved,
}: {
    block: Chunk;
    isFileEditResolved?: (file: string, replacement?: string) => boolean;
}) {
    const config = getWorkflowActionConfig(block);
    const editStats = React.useMemo(() => {
        if (block.type !== "edit" || block.isGenerating) return null;
        return countChangedLines(block.original || "", block.replacement || "");
    }, [block.type, block.original, block.replacement, block.isGenerating]);

    if (!config) return null;

    const specialized = renderSpecializedActionItem(block, config);
    if (specialized !== undefined) return specialized;

    return renderDefaultWorkflowActionLine({
        block,
        config,
        editStats,
        editResolved: checkEditBlockResolved(block, isFileEditResolved),
    });
}
