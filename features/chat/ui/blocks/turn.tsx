"use client";

import { CheckmarkCircle20Regular } from "@fluentui/react-icons/headless/svg/checkmark-circle";
import { ChevronRight20Regular } from "@fluentui/react-icons/headless/svg/chevron-right";
import { ChevronUp20Regular } from "@fluentui/react-icons/headless/svg/chevron-up";
import { DocumentSearch20Regular } from "@fluentui/react-icons/headless/svg/document-search";
import { Edit20Regular } from "@fluentui/react-icons/headless/svg/edit";
import { Folder20Regular } from "@fluentui/react-icons/headless/svg/folder";
import { Open20Regular } from "@fluentui/react-icons/headless/svg/open";
import { Wrench20Regular } from "@fluentui/react-icons/headless/svg/wrench";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { FileIcon } from "@/components/ui/file-icon";
import { Icon } from "@/components/ui/icon";


import { cn, createOccurrenceKeyer } from "@/lib/utils";
import type { Chunk } from "../md/renderer";
import { openProjectFile } from "@/lib/window/open-project-file";
import { commands } from "@/lib/backend/commands";
import { notifyTranscriptDisclosureToggle } from "../shell/find-bar";
import { Collapse } from "./collapse";
import { TerminalCommandStep } from "./terminal-live";
import {
    ActionItem,
    GitStageGroup,
    groupWorkflowRows,
    coalesceConsecutiveSameFileEdits,
    coalesceConsecutiveSameTasks,
    isRenderableWorkflowBlock,
    parseGitStagePath,
    GeneratedMediaStep,
} from "./workflow";
import { providerIcon } from "@/lib/ui/provider-icon";
import { humanizePluginActionName } from "@/lib/plugins/logos";
import { PluginActivityCard } from "./plugin-card";
import { parseWebSearchHits, WebSearchBlock, WebSearchTrail } from "./search";
import { countChangedLines } from "@/lib/ui/diff-count";
import { ChatEditDiff } from "./chat-diff";
import { ActionLine, splitActionLabel } from "./action-line";
import { joinThoughtLines } from "@/lib/chat/thought-text";
import { PluginLogo } from "@/components/ui/plugin-logo";
import { ApprovalCard } from "./approval";
import { humanizeToolName } from "@/lib/mcp/oauth";
import { BrowseChatCard } from "./browse-frame";
import { openSubagent, upsertSubagent } from "@/features/agent/subagents/store";

/** Estimates reasoning duration in seconds from thought character length when untimed. */
function estimateThoughtSeconds(content: string): number {
    const words = content.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 12));
}

/** Returns the trailing basename of a file path. */
function fileName(path: string): string {
    return path.split(/[\\/]/).pop() || path;
}

/** Format turn duration. */
const formatTurnDuration = (ms: number): string => {
    const clamped = Math.max(0, ms);
    if (clamped < 10_000) {
        const tenths = Math.max(0.1, Math.round(clamped / 100) / 10);
        return `${tenths.toFixed(tenths % 1 === 0 ? 0 : 1)}s`;
    }
    const sec = Math.round(clamped / 1000);
    if (sec < 60) return `${sec}s`;
    const mins = Math.floor(sec / 60);
    const rem = sec % 60;
    return `${mins}m ${String(rem).padStart(2, "0")}s`;
};

/** Format line range. */
const formatLineRange = (start?: number, end?: number): string | null => {
    if (typeof start !== "number" || !Number.isFinite(start)) return null;
    if (typeof end === "number" && Number.isFinite(end) && end > start) {
        return `L${start}-${end}`;
    }
    return `L${start}`;
};

/** Action word bright; detail muted, with optional expandable file/query drill-down. */
const GroupActionLabel = ({
    action,
    detail,
    icon,
    files,
    queries,
    previews,
}: {
    action: string;
    detail?: string | null;
    icon?: React.ReactNode;
    files?: Array<{
        path: string;
        start?: number;
        end?: number;
        startLine?: number;
        endLine?: number;
    }>;
    queries?: string[];
    previews?: string[];
}) => {
    const cleanFiles = (files ?? []).filter((f) => Boolean(f.path));
    const cleanQueries = [...new Set((queries ?? []).map((q) => q.trim()).filter(Boolean))];
    const cleanPreviews = (previews ?? []).map((p) => p.trim()).filter(Boolean);
    const singleFile =
        cleanFiles.length === 1 && cleanQueries.length === 0 && cleanPreviews.length === 0
            ? cleanFiles[0]
            : null;
    const expandable =
        cleanFiles.length > 1 || cleanQueries.length > 1 || cleanPreviews.length > 0;

    return (
        <ActionLine
            action={action}
            detail={detail}
            icon={icon}
            onClick={singleFile ? () => { openProjectFile(singleFile.path).catch(() => undefined); } : undefined}
        >
            {expandable ? (
                <div className="mt-0.5 mb-1 flex flex-col gap-0.5 pl-3.5">
                    {(() => {
                        const fileKey = createOccurrenceKeyer();
                        return cleanFiles.map((f) => {
                            const name = fileName(f.path);
                            const lineStart = f.start ?? f.startLine;
                            const lineEnd = f.end ?? f.endLine;
                            const range = formatLineRange(lineStart, lineEnd);
                            return (
                                <button
                                    key={fileKey(`${f.path}:${lineStart ?? ""}:${lineEnd ?? ""}`)}
                                    type="button"
                                    onClick={() => { openProjectFile(f.path).catch(() => undefined); }}
                                    className="flex w-fit max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-xs text-text-muted transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--row-hover)] hover:text-text-primary"
                                >
                                    <FileIcon name={name} className="size-3.5 shrink-0 opacity-85" />
                                    <span className="min-w-0 truncate">{name}</span>
                                    {range ? (
                                        <span className="shrink-0 font-mono text-2xs tabular-nums text-text-muted/75">
                                            {range}
                                        </span>
                                    ) : null}
                                </button>
                            );
                        });
                    })()}
                    {cleanQueries.length > 1
                        ? (() => {
                              const queryKey = createOccurrenceKeyer();
                              return cleanQueries.map((q) => (
                                  <div
                                      key={queryKey(q)}
                                      className="flex min-w-0 items-center gap-1.5 px-1 py-0.5 text-xs text-text-muted"
                                  >
                                      <Icon
                                          icon={DocumentSearch20Regular}
                                          className="size-3.5 shrink-0 text-text-muted/75"
                                      />
                                      <span className="min-w-0 truncate font-mono text-2xs">{q}</span>
                                  </div>
                              ));
                          })()
                        : null}
                    {(() => {
                        const previewKey = createOccurrenceKeyer();
                        return cleanPreviews.map((preview) => (
                            <pre
                                key={previewKey(preview.slice(0, 64))}
                                className="mt-0.5 max-h-36 overflow-y-auto rounded-md border border-border-subtle/50 bg-surface-2/60 px-2 py-1.5 font-mono text-2xs leading-relaxed text-text-muted whitespace-pre-wrap break-words"
                            >
                                {preview}
                            </pre>
                        ));
                    })()}
                </div>
            ) : null}
        </ActionLine>
    );
};

const groupDetail = (names: string[]): string | null => {
    const unique = [...new Set(names.map(fileName).filter(Boolean))];
    if (unique.length === 0) return null;
    if (unique.length === 1) return unique[0] ?? null;
    return `${unique[0]} + ${unique.length - 1} more`;
};

/** Formats a model identifier into a compact human-readable badge label. */
function modelChipLabel(model?: string): string {
    const bare = (model || "").split("/").pop()?.trim() || "";
    if (!bare || bare === "auto") return bare === "auto" ? "Auto" : "";
    return bare.replace(/[-_]/g, " ");
}

const openSpawnedAgent = (block: Chunk) => {
    const name = block.query || "agent";
    const id = block.file || name;
    upsertSubagent({
        id,
        title: name,
        agent: name,
        model: block.command,
        activity: "Working...",
        task: block.type === "subagent_ref" ? block.content : undefined,
        transcript: block.type === "subagent" ? block.content : undefined,
        status: (block.commandStatus as "running" | "done" | "error" | "pending") || "running",
    });
    openSubagent(id);
};

/** Renders a single delegated subagent status row inside a workflow turn. */
function SubagentRow({ block }: { block: Chunk }) {
    const name = block.query || "agent";
    const task = (block.type === "subagent_ref" ? block.content : "")?.trim();
    const model = modelChipLabel(block.command);
    return (
        <ActionLine
            action="Spawned"
            detail={task || name}
            icon={providerIcon(block.command || "auto", 14)}
            onClick={() => openSpawnedAgent(block)}
            extra={
                model ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-text-muted">
                        {providerIcon(block.command || "auto", 12)}
                        {model}
                    </span>
                ) : null
            }
        />
    );
}

/** Renders a grouped stack of parallel subagent invocations. */
function SubagentSpawnGroup({ blocks }: { blocks: Chunk[] }) {
    const rowKey = createOccurrenceKeyer();
    return (
        <ActionLine action="Spawning" detail="subagents" defaultOpen>
            <div className="flex flex-col">
                {blocks.map((block) => (
                    <SubagentRow key={rowKey(`${block.type}-${block.file || block.query || ""}`)} block={block} />
                ))}
            </div>
        </ActionLine>
    );
}

/** Counts added and removed lines for a file-edit workflow chunk. */
function editDelta(block: Chunk): { add: number; del: number } {
    return countChangedLines(block.original || "", block.replacement || "");
}

/** Checks whether a shell command string invokes a linter or static typechecker. */
function isLintCommand(cmd: string): boolean {
    const lower = cmd.toLowerCase();
    return (
        lower.includes("eslint")
        || lower.includes("read_lints")
        || lower.includes("npm run lint")
        || lower.includes("cargo clippy")
        || lower.includes("tsc --noemit")
        || lower.includes("tsc -p")
    );
}

const CLEAN_LINT_PATTERNS = [
    /no linter errors/i,
    /(?:^|[^0-9])0 errors?(?:$|[^a-z])/i,
    /✓ no problems/i,
    /no problems found/i,
];

/** Classifies terminal lint output as `"clean"`, `"errors"`, or `null` when inconclusive. */
const lintStatusFromOutput = (output: string): "clean" | "errors" | null => {
    const trimmed = output.trim();
    if (!trimmed) return null;
    if (CLEAN_LINT_PATTERNS.some((re) => re.test(trimmed))) return "clean";
    return /error|✖/i.test(trimmed) ? "errors" : null;
};

const FAILED_PLUGIN_CALL_STATUSES = new Set(["error", "failed", "rejected", "cancelled"]);
const TERMINAL_TURN_TYPES = new Set(["terminal_command", "run"]);

/** True when a command block failed by status or non-zero exit code. */
const isFailedCommandBlock = (b: Chunk): boolean => {
    if (b.commandStatus === "failed") return true;
    return typeof b.exitCode === "number" ? b.exitCode !== 0 : false;
};

/** True when a visible workflow step finished in an error/failed/rejected state. */
const isFailedWorkflowBlock = (b: Chunk): boolean => {
    if (TERMINAL_TURN_TYPES.has(b.type)) return isFailedCommandBlock(b);
    if (b.type === "plugin_call") return FAILED_PLUGIN_CALL_STATUSES.has(b.commandStatus ?? "");
    return false;
};

/** Compute turn stats. */
const computeTurnStats = (blocks: Chunk[]) => {
    const readFiles = new Set<string>();
    let searches = 0;
    const editedFiles = new Set<string>();
    let commands = 0;
    let linesAdded = 0;
    let linesRemoved = 0;
    const stagedPaths: string[] = [];
    let lintChecks = 0;
    let lintClean = false;

    for (const block of blocks) {
        switch (block.type) {
            case "cat":
                if (block.content) readFiles.add(block.content);
                break;
            case "search":
            case "grep":
            case "search_result":
            case "web_search":
            case "web_result":
            case "web_visit":
            case "inspect_runtime":
                searches += 1;
                break;
            case "edit":
                if (block.file) {
                    editedFiles.add(block.file);
                    const { add, del } = editDelta(block);
                    linesAdded += add;
                    linesRemoved += del;
                }
                break;
            case "edit_pending":
                if (block.file && block.commandStatus === "applied") {
                    editedFiles.add(block.file);
                    const { add, del } = editDelta(block);
                    linesAdded += add;
                    linesRemoved += del;
                }
                break;
            case "create_file":
            case "mkdir":
            case "delete_file":
            case "rename_file":
                if (block.content) editedFiles.add(block.content);
                break;
            case "terminal_command":
            case "run": {
                commands += 1;
                const cmd = (block.command || block.content || "").trim();
                if (isLintCommand(cmd)) {
                    lintChecks += 1;
                    const status = lintStatusFromOutput(block.content || "");
                    if (status === "clean") lintClean = true;
                }
                break;
            }
            case "git_operation":
                if (block.gitOp === "stage") {
                    const path = parseGitStagePath(block.content);
                    if (path) stagedPaths.push(path);
                }
                break;
            default:
                break;
        }
    }

    return {
        reads: readFiles.size,
        searches,
        editFileCount: editedFiles.size,
        commands,
        linesAdded,
        linesRemoved,
        stagedCount: [...new Set(stagedPaths)].length,
        lintChecks,
        lintClean,
    };
};

/** Renders the ThoughtStep UI component. */
const ThoughtStep = ({
    content,
    isActive,
}: {
    content: string;
    isActive?: boolean;
}) => {
    const [open, setOpen] = useState(false);
    const trimmed = joinThoughtLines(content).trim();
    if (!trimmed) {
        return isActive ? <ActionLine action="Thinking" busy /> : null;
    }

    const lines = trimmed.split("\n").filter(Boolean);
    const lastLine = (lines[lines.length - 1] ?? "").trim();
    const livePreview =
        lastLine.length > 64 ? `${lastLine.slice(0, 61).trimEnd()}...` : lastLine;

    if (isActive) {
        return (
            <ActionLine
                action="Thinking"
                detail={!open && livePreview ? livePreview : undefined}
                shimmer
                open={open}
                onOpenChange={setOpen}
            >
                <div className="mt-1 mb-1 max-h-56 w-full min-w-0 overflow-y-auto pl-3.5 whitespace-pre-wrap chat-text leading-relaxed text-text-muted custom-scrollbar">
                    {trimmed}
                </div>
            </ActionLine>
        );
    }

    const expandable = trimmed.length >= 60 || lines.length >= 2;
    const detail = trimmed.length < 40 ? "briefly" : `${estimateThoughtSeconds(trimmed)}s`;
    return (
        <ActionLine
            action="Thought"
            detail={detail}
            open={expandable ? open : undefined}
            onOpenChange={expandable ? setOpen : undefined}
        >
            {expandable ? (
                <div className="mt-1 mb-1 flex w-full min-w-0 flex-col gap-1 pl-3.5">
                    <div className="w-full min-w-0 whitespace-pre-wrap chat-text leading-relaxed text-text-muted">
                        {trimmed}
                    </div>
                    {lines.length >= 10 ? (
                        <div>
                            <button
                                type="button"
                                onClick={(event) => {
                                    notifyTranscriptDisclosureToggle(event.currentTarget);
                                    setOpen(false);
                                }}
                                className="inline-flex min-h-[24px] items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-text-muted transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-primary"
                            >
                                <Icon icon={ChevronUp20Regular} className="size-3.5" />
                                <span>Collapse</span>
                            </button>
                        </div>
                    ) : null}
                </div>
            ) : null}
        </ActionLine>
    );
};

/** Renders an expandable inline diff preview for a proposed or applied file edit. */
function WorkflowEditPreview({
    original,
    replacement,
}: {
    original: string;
    replacement: string;
}) {
    return <ChatEditDiff original={original} replacement={replacement} />;
}

/** Subscribes a pending approval card to backend resolution events so cross-window decisions sync immediately. */
const useBackendResolutionStatus = (
    eventName: string,
    commandId: string | undefined,
    enabled: boolean,
    approvedStatus: string,
    onStatus: (status: string) => void,
) => {
    const onStatusRef = React.useRef(onStatus);
    useEffect(() => {
        onStatusRef.current = onStatus;
    });
    useEffect(() => {
        if (!enabled || !commandId) return undefined;
        let disposed = false;
        const unlistenPromise = Promise.resolve()
            .then(() =>
                listen<{ id?: string; approved?: boolean }>(eventName, (event) => {
                    if (disposed || event.payload.id !== commandId) return;
                    onStatusRef.current(event.payload.approved ? approvedStatus : "rejected");
                }),
            )
            .catch(() => () => undefined);
        return () => {
            disposed = true;
            unlistenPromise.then((unlisten) => unlisten()).catch(() => undefined);
        };
    }, [approvedStatus, commandId, enabled, eventName]);
};

/**
 * Approval card for a staged file edit (require-edit-approval mode):
 * header with filename and +/− counts, expandable diff preview, Skip / Accept.
 */
const resolvedEditStatus = (current: string | null, approved: boolean): string => {
    if (current === "failed") return current;
    return approved ? "approved" : "rejected";
};

function EditApprovalRow({ block }: { block: Chunk }) {
    const [localStatus, setLocalStatus] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [diffOpen, setDiffOpen] = useState(true);
    const diffId = React.useId();
    const { add, del } = editDelta(block);
    const file = block.file || "";

    const resolve = useCallback(
        (approved: boolean) => {
            if (!block.commandId || isProcessing) return;
            setIsProcessing(true);
            commands
                .resolveEditApproval(block.commandId, approved)
                .then(() => setLocalStatus((current) => resolvedEditStatus(current, approved)))
                .catch(() => { /* backend upsert corrects the card */ })
                .finally(() => setIsProcessing(false)).catch(() => undefined);
        },
        [block.commandId, isProcessing],
    );

    // Backend resolution (or another window) flips the card instantly.
    useEffect(() => {
        if (!block.commandId) return;
        let disposed = false;
        const unlistenPromise = listen<{ id?: string; approved?: boolean }>(
            "agent-edit-resolved",
            (event) => {
                if (disposed || event.payload?.id !== block.commandId) return;
                setLocalStatus((current) => resolvedEditStatus(current, event.payload?.approved === true));
            },
        );
        const failureListenerPromise = listen<{ id?: string }>(
            "agent-edit-application-failed",
            (event) => {
                if (disposed || event.payload?.id !== block.commandId) return;
                setLocalStatus("failed");
            },
        );
        return () => {
            disposed = true;
            void unlistenPromise.then((unlisten) => unlisten()).catch(() => { /* ignore */ });
            void failureListenerPromise.then((unlisten) => unlisten()).catch(() => { /* ignore */ });
        };
    }, [block.commandId]);

    const terminalStatus = ["applied", "rejected", "cancelled"].includes(block.commandStatus ?? "")
        ? block.commandStatus
        : null;
    const status = terminalStatus ?? localStatus ?? block.commandStatus ?? "pending";
    if (status === "approved") {
        return <ActionLine action="Approved" detail={`${fileName(file)} · Applying…`} />;
    }
    if (status === "failed") {
        return <ActionLine action="Edit failed" detail={fileName(file)} />;
    }
    if (status !== "pending") {
        return (
            <ActionLine
                action={status === "applied" ? "Edited" : "Rejected"}
                detail={fileName(file)}
            />
        );
    }

    return (
        <ApprovalCard
            icon={<Icon icon={Edit20Regular} className="text-text-muted" />}
            title={
                <button
                    type="button"
                    aria-expanded={diffOpen}
                    aria-controls={diffId}
                    onClick={() => setDiffOpen((v) => !v)}
                    className="group/line flex min-w-0 items-center gap-1.5 text-left chat-text font-normal text-text-muted focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus"
                >
                    <span className="text-text-secondary group-hover/line:text-text-primary">Edit</span>
                    <span className="min-w-0 truncate text-text-muted">{fileName(file)}</span>
                    {add > 0 || del > 0 ? (
                        <span className="flex shrink-0 items-center gap-1 tabular-nums">
                            {add > 0 ? <span className="text-success">+{add}</span> : null}
                            {del > 0 ? <span className="text-error">-{del}</span> : null}
                        </span>
                    ) : null}
                    <Icon
                        icon={ChevronRight20Regular}
                        className={cn(
                            "shrink-0 text-text-muted opacity-50 transition-transform duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]",
                            diffOpen && "rotate-90",
                        )}
                    />
                </button>
            }
            isProcessing={isProcessing}
            onSkip={() => resolve(false)}
            onAccept={() => resolve(true)}
            skipLabel="Skip"
            acceptLabel="Accept"
        >
            <Collapse id={diffId} open={diffOpen}>
                <WorkflowEditPreview
                    original={block.original || ""}
                    replacement={block.replacement || ""}
                />
            </Collapse>
        </ApprovalCard>
    );
};

/** Applied (previously gated) edit, same presentation as a normal edit row. */
const StepRowAppliedEdit = ({ block }: { block: Chunk }) => {
    const { add, del } = editDelta(block);
    const file = block.file || "";
    const shortName = fileName(file);
    return (
        <ActionLine
            action="Edited"
            detail={shortName}
            icon={<FileIcon name={shortName} className="size-3.5 shrink-0 opacity-85" />}
            add={add}
            del={del}
            secondaryAction={
                file
                    ? {
                          label: `Open ${shortName}`,
                          icon: <Icon icon={Open20Regular} className="size-3.5" />,
                          onClick: () => { openProjectFile(file).catch(() => undefined); },
                      }
                    : undefined
            }
        >
            {add > 0 || del > 0 ? (
                <WorkflowEditPreview
                    original={block.original || ""}
                    replacement={block.replacement || ""}
                />
            ) : null}
        </ActionLine>
    );
};

const PluginCallStep = ({ block }: { block: Chunk }) => {
    const [localStatus, setLocalStatus] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const status = localStatus ?? block.commandStatus ?? "ok";
    const toolkit = block.pluginToolkit || "";
    const slug = block.pluginSlug || "";
    const label = humanizePluginActionName(slug, block.pluginLabel) || "Plugin";
    const discovery = slug === "plugin_list" || slug === "plugin_search" || slug === "plugin_tools";

    useBackendResolutionStatus(
        "agent-command-resolved",
        block.commandId,
        status === "pending",
        "ok",
        setLocalStatus,
    );

    const handleAccept = useCallback(() => {
        if (!block.commandId || isProcessing) return;
        setIsProcessing(true);
        commands
            .approveTerminalCommand(block.commandId)
            .then(() => setLocalStatus("ok"))
            .catch(() => setLocalStatus("error"))
            .finally(() => setIsProcessing(false)).catch(() => undefined);
    }, [block.commandId, isProcessing]);

    const handleReject = useCallback(() => {
        if (!block.commandId || isProcessing) return;
        setIsProcessing(true);
        commands
            .rejectTerminalCommand(block.commandId)
            .then(() => setLocalStatus("rejected"))
            .catch(() => setLocalStatus("error"))
            .finally(() => setIsProcessing(false)).catch(() => undefined);
    }, [block.commandId, isProcessing]);

    if (discovery || status !== "pending") {
        const lead = splitActionLabel(label);
        const failed = status === "error" || status === "rejected" || status === "cancelled";
        return (
            <ActionLine
                action={failed ? "Failed" : lead.action}
                detail={failed ? lead.detail || label : lead.detail}
            />
        );
    }

    return (
        <PluginActivityCard
            toolkit={toolkit}
            slug={slug}
            label={label}
            body={block.content || ""}
            status={status}
            pending={status === "pending"}
            busy={isProcessing}
            onAllow={handleAccept}
            onReject={handleReject}
        />
    );
};

const FILE_MUTATION_STEP_LABELS: Partial<Record<string, string>> = {
    create_file: "Created",
    mkdir: "Created directory",
    delete_file: "Deleted",
    rename_file: "Renamed",
};

/** Parses structured browse-session JSON payload safely. */
const parseBrowseSessionPayload = (raw: string | undefined) => {
    try {
        const parsed = JSON.parse(raw || "") as {
            image?: string;
            x?: number;
            y?: number;
            console?: string[];
        };
        return {
            image: parsed.image || "",
            x: parsed.x,
            y: parsed.y,
            consoleLines: parsed.console,
        };
    } catch {
        return { image: "", x: undefined, y: undefined, consoleLines: undefined };
    }
};

/** Renders a `browse_session` chunk inside `StepRow`. */
const renderBrowseSessionStep = (block: Chunk): React.ReactNode => {
    const payload = parseBrowseSessionPayload(block.content);
    return (
        <div className="py-0.5">
            <div className="mt-1.5">
                <BrowseChatCard
                    url={block.visitUrl}
                    title={block.visitTitle}
                    status={block.commandStatus}
                    image={payload.image}
                    x={payload.x}
                    y={payload.y}
                    consoleLines={payload.consoleLines}
                    followLive={Boolean(block.isGenerating) || !payload.image.trim()}
                />
            </div>
        </div>
    );
};

/** Parses an `[MCP server__tool]` prefix from a `tool_result` chunk when present. */
const parseMcpToolResult = (raw: string): { mcp: string; body: string } => {
    const closeIdx = /^\[MCP\s/i.test(raw) ? raw.indexOf("]") : -1;
    const mcp = closeIdx > 4 ? raw.slice(4, closeIdx).trim() : "";
    return {
        mcp,
        body: mcp ? raw.slice(closeIdx + 1).trim() : raw.trim(),
    };
};

/** Renders a `tool_result` chunk (MCP call or generic tool output) inside `StepRow`. */
const renderToolResultStep = (block: Chunk): React.ReactNode => {
    const raw = block.content || "";
    const parsed = parseMcpToolResult(raw);
    const wrenchIcon = <Icon icon={Wrench20Regular} className="size-3.5 text-text-muted/80" />;
    if (parsed.mcp) {
        const label = humanizeToolName(parsed.mcp.replace(/^mcp__/i, "").replace(/__/g, " "));
        return (
            <ActionLine action="Called" detail={label} icon={wrenchIcon}>
                {parsed.body ? (
                    <pre className="mt-1 mb-1 max-h-48 overflow-auto rounded-lg border border-border-subtle bg-surface-2/50 px-2.5 py-2 font-mono text-2xs text-text-secondary whitespace-pre-wrap custom-scrollbar">
                        {parsed.body}
                    </pre>
                ) : null}
            </ActionLine>
        );
    }
    const collapsed = raw.replace(/\s+/g, " ").trim();
    const truncated = collapsed.length > 72;
    const detail = collapsed ? `${collapsed.slice(0, 72)}${truncated ? "..." : ""}` : "tool";
    return (
        <ActionLine action="Ran" detail={detail} icon={wrenchIcon}>
            {truncated ? (
                <pre className="mt-1 mb-1 max-h-48 overflow-auto rounded-lg border border-border-subtle bg-surface-2/50 px-2.5 py-2 font-mono text-2xs text-text-secondary whitespace-pre-wrap custom-scrollbar">
                    {raw.trim()}
                </pre>
            ) : null}
        </ActionLine>
    );
};

/** Renders a `cat` file-read chunk inside `StepRow`. */
const renderCatStep = (block: Chunk): React.ReactNode => {
    const path = block.content || "";
    const shortName = path.split(/[\\/]/).pop() || path || "file";
    const range = formatLineRange(block.catStartLine, block.catEndLine);
    return (
        <ActionLine
            action="Read"
            detail={shortName}
            icon={<FileIcon name={shortName} className="size-3.5 shrink-0 opacity-85" />}
            extra={
                range ? (
                    <span className="shrink-0 font-mono text-2xs tabular-nums text-text-muted/75">
                        {range}
                    </span>
                ) : null
            }
            onClick={() => {
                if (path) openProjectFile(path).catch(() => undefined);
            }}
        />
    );
};

/** Extracts distinct search/grep result output when different from the query string. */
const extractSearchStepOutput = (block: Chunk): string => {
    if (!block.query || !block.content) return "";
    const trimmed = block.content.trim();
    return trimmed !== block.query.trim() ? trimmed : "";
};

/** Renders a `grep`, `search`, or `search_result` chunk inside `StepRow`. */
const renderSearchLikeStep = (block: Chunk, action: "Grepped" | "Searched"): React.ReactNode => {
    const query = (block.query || block.content || "").trim();
    const output = extractSearchStepOutput(block);
    return (
        <ActionLine
            action={action}
            detail={query}
            icon={<Icon icon={DocumentSearch20Regular} className="size-3.5 text-text-muted/80" />}
        >
            {output ? (
                <pre className="mt-1 mb-1 max-h-44 overflow-auto rounded-lg border border-border-subtle bg-surface-2/50 px-2.5 py-2 font-mono text-2xs text-text-secondary whitespace-pre-wrap custom-scrollbar">
                    {output}
                </pre>
            ) : null}
        </ActionLine>
    );
};

/** Formats an `inspect_runtime` URL or fallback runtime kind label. */
const formatInspectStepDetail = (block: Chunk): string => {
    const rawUrl = (block.query || "").trim();
    if (rawUrl) {
        try {
            const parsed = new URL(rawUrl);
            return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
        } catch {
            return rawUrl;
        }
    }
    return (block.inspectKind || "runtime").trim();
};

/** Renders an `inspect_runtime` chunk inside `StepRow`. */
const renderInspectRuntimeStep = (block: Chunk): React.ReactNode => (
    <ActionLine
        action={block.isGenerating ? "Inspecting" : "Inspected"}
        detail={formatInspectStepDetail(block)}
    />
);

/** Renders a `web_visit` chunk inside `StepRow`. */
const renderWebVisitStep = (block: Chunk): React.ReactNode => {
    const host = block.visitHost || block.visitTitle || block.content || "";
    const favicon = block.visitUrl || block.visitHost || "";
    const visitUrl = block.visitUrl;
    return (
        <ActionLine
            action={block.isGenerating ? "Visiting" : "Visited"}
            detail={host}
            favicons={favicon ? [favicon] : undefined}
            busy={Boolean(block.isGenerating)}
            onClick={
                visitUrl
                    ? () => {
                          commands.openUrlExternal(visitUrl).catch(() => undefined);
                      }
                    : undefined
            }
        />
    );
};

/** Renders an `edit` chunk inside `StepRow` when `block.file` is present. */
const renderEditStep = (block: Chunk): React.ReactNode => {
    if (!block.file) return <ActionItem block={block} />;
    const { add, del } = editDelta(block);
    const file = block.file;
    const shortName = fileName(file);
    const hasDiff = add > 0 || del > 0;
    return (
        <ActionLine
            action="Edited"
            detail={shortName}
            icon={<FileIcon name={shortName} className="size-3.5 shrink-0 opacity-85" />}
            add={add}
            del={del}
            secondaryAction={{
                label: `Open ${shortName}`,
                icon: <Icon icon={Open20Regular} className="size-3.5" />,
                onClick: () => {
                    openProjectFile(file).catch(() => undefined);
                },
            }}
        >
            {hasDiff ? (
                <WorkflowEditPreview
                    original={block.original || ""}
                    replacement={block.replacement || ""}
                />
            ) : null}
        </ActionLine>
    );
};

/** Checks whether a terminal command completed cleanly and ran a recognized lint check. */
const isCleanFinishedLintBlock = (block: Chunk): boolean => {
    if (block.isGenerating) return false;
    const status = block.commandStatus;
    const finishedFine = !status || status === "completed" || status === "background";
    if (!finishedFine) return false;
    const cmd = (block.command || block.content || "").trim();
    return isLintCommand(cmd) && lintStatusFromOutput(block.content || "") === "clean";
};

/** Renders a `terminal_command` or `run` chunk inside `StepRow`. */
const renderTerminalStep = (block: Chunk): React.ReactNode => {
    if (isCleanFinishedLintBlock(block)) {
        return (
            <ActionLine
                action="Checked"
                detail="no linter errors"
                icon={<Icon icon={CheckmarkCircle20Regular} className="size-3.5 text-success/85" />}
            />
        );
    }
    return <TerminalCommandStep block={block} />;
};

/** Renders an `edit_pending` approval/applied/cancelled/rejected chunk inside `StepRow`. */
const renderEditPendingStep = (block: Chunk): React.ReactNode => {
    const status = block.commandStatus || "pending";
    if (status === "pending") return <EditApprovalRow block={block} />;
    if (status === "applied" && block.file) return <StepRowAppliedEdit block={block} />;
    return (
        <ActionLine
            action={status === "cancelled" ? "Cancelled" : "Rejected"}
            detail={block.file ? fileName(block.file) : "file"}
        />
    );
};

/** Renders a `create_file`, `mkdir`, `delete_file`, or `rename_file` chunk inside `StepRow`. */
const renderFileMutationStep = (block: Chunk): React.ReactNode => (
    <ActionLine
        action={FILE_MUTATION_STEP_LABELS[block.type] ?? "Modified"}
        detail={block.content ? fileName(block.content) : undefined}
    />
);

/** Renders a `web_search` or `web_result` chunk inside `StepRow`. */
const renderWebSearchStep = (block: Chunk): React.ReactNode => (
    <WebSearchBlock
        query={(block.query || "").trim()}
        results={parseWebSearchHits(block.content || "")}
        isActive={block.isGenerating}
    />
);

const STEP_ROW_RENDERERS: Partial<Record<string, (block: Chunk) => React.ReactNode>> = {
    browse_session: renderBrowseSessionStep,
    think: (block) => <ThoughtStep content={block.content || ""} isActive={block.isGenerating} />,
    thought: (block) => <ThoughtStep content={block.content || ""} isActive={block.isGenerating} />,
    tool_result: renderToolResultStep,
    plugin_call: (block) => <PluginCallStep block={block} />,
    generated_svg: (block) => <GeneratedMediaStep block={block} />,
    generated_image: (block) => <GeneratedMediaStep block={block} />,
    generated_audio: (block) => <GeneratedMediaStep block={block} />,
    cat: renderCatStep,
    subagent: (block) => <SubagentRow block={block} />,
    subagent_ref: (block) => <SubagentRow block={block} />,
    grep: (block) => renderSearchLikeStep(block, "Grepped"),
    search: (block) => renderSearchLikeStep(block, "Searched"),
    search_result: (block) => renderSearchLikeStep(block, "Searched"),
    inspect_runtime: renderInspectRuntimeStep,
    web_search: renderWebSearchStep,
    web_result: renderWebSearchStep,
    web_visit: renderWebVisitStep,
    edit: renderEditStep,
    terminal_command: renderTerminalStep,
    run: renderTerminalStep,
    edit_pending: renderEditPendingStep,
    create_file: renderFileMutationStep,
    mkdir: renderFileMutationStep,
    delete_file: renderFileMutationStep,
    rename_file: renderFileMutationStep,
};

/** Renders the StepRow UI component. */
const StepRow = ({ block }: { block: Chunk }) => {
    const render = STEP_ROW_RENDERERS[block.type];
    return render ? render(block) : <ActionItem block={block} />;
};

/** Builds the collapsed summary headline for a completed assistant workflow turn. */
function turnSummary(blocks: Chunk[], stats: ReturnType<typeof computeTurnStats>, isActive?: boolean, activityLabel?: string | null) {
    const status = [...blocks].reverse().find((b) => b.type === "status" && b.content?.trim());
    if (status?.content?.trim()) return status.content.trim();
    if (isActive && activityLabel?.trim() && !/^(working|thinking)$/i.test(activityLabel.trim())) {
        return activityLabel.trim();
    }
    const parts: string[] = [];
    if (stats.editFileCount > 0) {
        parts.push(`Edited ${stats.editFileCount} file${stats.editFileCount === 1 ? "" : "s"}`);
    }
    if (stats.reads > 0) {
        parts.push(`${parts.length ? "explored" : "Explored"} ${stats.reads} file${stats.reads === 1 ? "" : "s"}`);
    }
    if (stats.searches > 0 && stats.reads === 0) {
        parts.push(`${parts.length ? "searched" : "Searched"} ${stats.searches} time${stats.searches === 1 ? "" : "s"}`);
    }
    if (parts.length > 0) return parts.join(", ");
    return isActive ? "Working" : "Worked";
}

/** Collects compact status badges and diff counters for a collapsed workflow turn. */
function turnMarks(blocks: Chunk[]) {
    const urls: string[] = [];
    const toolkits: string[] = [];
    for (const block of blocks) {
        if (block.type === "web_visit" && (block.visitUrl || block.visitHost)) {
            urls.push(block.visitUrl || `https://${block.visitHost}`);
        }
        if (block.type === "inspect_runtime" && block.query) urls.push(block.query);
        if (block.type === "web_search" || block.type === "web_result") {
            for (const hit of parseWebSearchHits(block.content || "")) {
                if (hit.url) urls.push(hit.url);
            }
        }
        if (
            block.type === "plugin_call"
            && block.pluginToolkit
            && block.pluginToolkit !== "plugins"
            && block.pluginSlug !== "plugin_list"
            && block.pluginSlug !== "plugin_search"
            && block.pluginSlug !== "plugin_tools"
        ) {
            toolkits.push(block.pluginToolkit);
        }
    }
    return {
        urls: [...new Set(urls.filter(Boolean))].slice(0, 4),
        toolkits: [...new Set(toolkits.filter(Boolean))].slice(0, 4),
    };
}

/** Renders the TurnWorkflowSummary UI component. */
function TurnWorkflowSummaryInner({
    blocks,
    isActive,
    durationMs,
    showHeader = true,
    activityLabel,
    children,
}: {
    blocks: Chunk[];
    isActive?: boolean;
    durationMs?: number;
    activityLabel?: string | null;
    /** When false, only the step pile is shown (for interleaved mid-turn groups). */
    showHeader?: boolean;
    children?: React.ReactNode;
}) {
    const visible = blocks.filter((b) => isRenderableWorkflowBlock(b, isActive));
    const pendingBlocks = visible.filter(
        (b) =>
            (b.type === "terminal_command" || b.type === "edit_pending" || b.type === "plugin_call")
            && b.commandStatus === "pending",
    );
    const failedCount = visible.filter(isFailedWorkflowBlock).length;

    const summaryRootRef = useRef<HTMLDivElement>(null);
    const pointerInsideRef = useRef(false);
    const deferredCollapseRef = useRef(false);
    const startedAtRef = useRef<number | null>(null);
    const [liveElapsedMs, setLiveElapsedMs] = useState(0);
    const [measuredDurationMs, setMeasuredDurationMs] = useState<number | null>(null);
    const [open, setOpen] = useState(() => Boolean(isActive || failedCount > 0));
    const [prevActive, setPrevActive] = useState(isActive);
    const [userToggled, setUserToggled] = useState(false);

    if (isActive !== prevActive) {
        setPrevActive(isActive);
        if (isActive) {
            setUserToggled(false);
            setOpen(true);
        } else if (failedCount > 0) {
            setOpen(true);
        }
    }

    useEffect(() => {
        if (isActive) {
            const origin = startedAtRef.current ?? Date.now();
            startedAtRef.current = origin;
            const interval = window.setInterval(() => {
                setLiveElapsedMs(Math.max(0, Date.now() - origin));
            }, 500);
            return () => window.clearInterval(interval);
        }
        if (startedAtRef.current !== null) {
            const finalElapsed = Math.max(0, Date.now() - startedAtRef.current);
            startedAtRef.current = null;
            if (finalElapsed >= 1000) {
                setMeasuredDurationMs(finalElapsed);
            }
        }
        return undefined;
    }, [isActive]);

    useEffect(() => {
        if (isActive || !open || userToggled || failedCount > 0) {
            deferredCollapseRef.current = false;
            return undefined;
        }
        const timer = window.setTimeout(() => {
            if (!pointerInsideRef.current) {
                deferredCollapseRef.current = false;
                notifyTranscriptDisclosureToggle(summaryRootRef.current);
                setOpen(false);
            } else {
                deferredCollapseRef.current = true;
            }
        }, 360);
        return () => window.clearTimeout(timer);
    }, [isActive, open, userToggled, failedCount]);

    if (visible.length === 0) return children;

    const coalesced = coalesceConsecutiveSameTasks(coalesceConsecutiveSameFileEdits(visible));
    const stats = computeTurnStats(coalesced);
    const rows = groupWorkflowRows(
        coalesced.filter(
            (b) =>
                !((b.type === "terminal_command" || b.type === "edit_pending" || b.type === "plugin_call")
                    && b.commandStatus === "pending"),
        ),
    );
    const thoughtBlocks = coalesced.filter((b) => b.type === "think" || b.type === "thought");
    const leadThought = thoughtBlocks.at(0);
    const showLintFooter = stats.lintClean && stats.lintChecks > 0;
    const lintShownInSteps = visible.some((b) => {
        if (b.type !== "terminal_command" && b.type !== "run") return false;
        const cmd = (b.command || b.content || "").trim();
        return isLintCommand(cmd) && lintStatusFromOutput(b.content || "") === "clean";
    });
    const headline = splitActionLabel(turnSummary(blocks, stats, isActive, activityLabel));
    const marks = turnMarks(blocks);
    const effectiveDurationMs = durationMs ?? measuredDurationMs ?? undefined;
    let timingBadge: string | null = null;
    if (isActive && liveElapsedMs >= 2000) {
        timingBadge = formatTurnDuration(liveElapsedMs);
    } else if (!isActive && effectiveDurationMs && effectiveDurationMs >= 1000) {
        timingBadge = formatTurnDuration(effectiveDurationMs);
    }

    const pendingApprovalRows = (() => {
        const pendingKey = createOccurrenceKeyer();
        return (
            <div className="my-1 flex flex-col gap-1">
                {pendingBlocks.map((b) =>
                    b.type === "edit_pending" ? (
                        <EditApprovalRow key={b.commandId || pendingKey(`pending-edit:${b.file ?? ""}`)} block={b} />
                    ) : b.type === "plugin_call" ? (
                        <PluginCallStep key={b.commandId || pendingKey(`pending-plugin:${b.query ?? ""}`)} block={b} />
                    ) : (
                        <TerminalCommandStep key={b.commandId || pendingKey(`pending-cmd:${b.command ?? ""}`)} block={b} />
                    ),
                )}
            </div>
        );
    })();

    const leadThoughtSlot = leadThought
        ? rows.findIndex(
              (r) =>
                  r.kind === "block" &&
                  (r.block.type === "think" || r.block.type === "thought") &&
                  r.block.content === leadThought.content,
          )
        : -1;

    const stepPile = (
        <>
            {leadThought?.content?.trim() || leadThought?.isGenerating ? (
                <ThoughtStep content={leadThought.content || ""} isActive={leadThought.isGenerating} />
            ) : null}
            {(() => {
                const rowKey = createOccurrenceKeyer();
                return rows.map((row, pos) => {
                    if (pos === leadThoughtSlot) return null;
                    const enterClass = isActive && pos === rows.length - 1 ? "t-step-enter" : undefined;
                    if (row.kind === "subagent_group") {
                        return (
                            <div key={rowKey(`subs:${row.blocks.length}`)} className={enterClass}>
                                <SubagentSpawnGroup blocks={row.blocks} />
                            </div>
                        );
                    }
                    if (row.kind === "git_stage_group") {
                        return (
                            <div key={rowKey(`stage:${row.paths.join(",")}`)} className={enterClass}>
                                <GitStageGroup paths={row.paths} />
                            </div>
                        );
                    }
                    if (row.kind === "read_group") {
                        const firstRead = row.files.at(0);
                        const firstName = firstRead ? fileName(firstRead.path) : "file.txt";
                        return (
                            <div key={rowKey(`reads:${firstRead?.path ?? ""}`)} className={enterClass}>
                                <GroupActionLabel
                                    action="Explored"
                                    detail={groupDetail(row.files.map((f) => f.path))}
                                    icon={<FileIcon name={firstName} className="size-3.5 shrink-0 opacity-85" />}
                                    files={row.files}
                                />
                            </div>
                        );
                    }
                    if (row.kind === "search_group") {
                        return (
                            <div key={rowKey(`searches:${row.queries.at(0) ?? ""}`)} className={enterClass}>
                                <GroupActionLabel
                                    action="Searched"
                                    detail={row.count > 1 ? `${row.count} times` : groupDetail(row.queries)}
                                    icon={
                                        <Icon
                                            icon={DocumentSearch20Regular}
                                            className="size-3.5 text-text-muted/80"
                                        />
                                    }
                                    queries={row.queries}
                                    previews={row.previews}
                                />
                            </div>
                        );
                    }
                    if (row.kind === "write_group") {
                        const firstPath = row.paths.at(0);
                        const firstName = firstPath ? fileName(firstPath) : "file.txt";
                        return (
                            <div key={rowKey(`writes:${firstPath ?? ""}`)} className={enterClass}>
                                <GroupActionLabel
                                    action="Edited"
                                    detail={groupDetail(row.paths)}
                                    icon={<FileIcon name={firstName} className="size-3.5 shrink-0 opacity-85" />}
                                    files={row.paths.map((p) => ({ path: p }))}
                                />
                            </div>
                        );
                    }
                    if (row.kind === "list_group") {
                        return (
                            <div key={rowKey(`lists:${row.count}`)} className={enterClass}>
                                <GroupActionLabel
                                    action="Listed"
                                    detail={row.count > 1 ? `${row.count} folders` : "folders"}
                                    icon={<Icon icon={Folder20Regular} className="size-3.5 text-text-muted/80" />}
                                />
                            </div>
                        );
                    }
                    if (row.kind === "web_trail") {
                        return (
                            <div key={rowKey(`web:${row.blocks.at(0)?.query ?? ""}`)} className={enterClass}>
                                <WebSearchTrail
                                    blocks={row.blocks}
                                    isActive={row.blocks.some((b) => b.isGenerating)}
                                />
                            </div>
                        );
                    }
                    return (
                        <div key={rowKey(`step:${row.block.type}:${row.block.file ?? row.block.commandId ?? ""}`)} className={enterClass}>
                            <StepRow block={row.block} />
                        </div>
                    );
                });
            })()}
            {showLintFooter && !lintShownInSteps ? (
                <ActionLine
                    action="Checked"
                    detail="no linter errors"
                    icon={<Icon icon={CheckmarkCircle20Regular} className="size-3.5 text-success/85" />}
                />
            ) : null}
        </>
    );

    return (
        <div
            ref={summaryRootRef}
            className="mb-2 select-none"
            onPointerEnter={() => {
                pointerInsideRef.current = true;
            }}
            onPointerLeave={() => {
                pointerInsideRef.current = false;
                if (
                    deferredCollapseRef.current &&
                    !isActive &&
                    open &&
                    !userToggled &&
                    failedCount === 0
                ) {
                    deferredCollapseRef.current = false;
                    notifyTranscriptDisclosureToggle(summaryRootRef.current);
                    setOpen(false);
                }
            }}
        >
            {showHeader ? (
                <ActionLine
                    action={headline.action}
                    detail={headline.detail}
                    add={stats.linesAdded}
                    del={stats.linesRemoved}
                    favicons={marks.urls}
                    busy={Boolean(isActive)}
                    open={open}
                    onOpenChange={(next) => {
                        deferredCollapseRef.current = false;
                        setUserToggled(true);
                        setOpen(next);
                    }}
                    extra={
                        marks.toolkits.length > 0 || failedCount > 0 || timingBadge ? (
                            <span className="inline-flex shrink-0 items-center gap-1.5">
                                {marks.toolkits.length > 0 ? (
                                    <span className="inline-flex shrink-0 items-center -space-x-1.5">
                                        {marks.toolkits.map((toolkit) => (
                                            <span
                                                key={toolkit}
                                                className="inline-flex size-4 items-center justify-center overflow-hidden rounded-full border border-border-subtle bg-panel"
                                            >
                                                <PluginLogo toolkit={toolkit} name={toolkit} size={12} />
                                            </span>
                                        ))}
                                    </span>
                                ) : null}
                                {failedCount > 0 ? (
                                    <span className="text-2xs font-medium tabular-nums text-error">
                                        {failedCount} failed
                                    </span>
                                ) : null}
                                {timingBadge ? (
                                    <span className="text-2xs tabular-nums text-text-muted/75">
                                        {timingBadge}
                                    </span>
                                ) : null}
                            </span>
                        ) : null
                    }
                >
                    <div className="mt-0.5 flex flex-col gap-0.5 pl-3.5">
                        {stepPile}
                    </div>
                </ActionLine>
            ) : (
                <div className="flex flex-col gap-0.5">{stepPile}</div>
            )}

            {pendingBlocks.length > 0 ? pendingApprovalRows : null}

            {children}
        </div>
    );
}

/**
 * Memoized: a turn keeps several workflow groups, and streaming only changes
 * the last one. Earlier groups skip coalescing and stats on every token.
 */
export const TurnWorkflowSummary = React.memo(TurnWorkflowSummaryInner);
