"use client";

import { modKeyGlyph as modKeyLabel } from "@/lib/platform";

import { CalendarCheckmark24Filled } from "@fluentui/react-icons/headless/svg/calendar-checkmark";
import { CheckmarkCircle20Filled } from "@fluentui/react-icons/headless/svg/checkmark-circle";
import { ChevronDown20Regular } from "@fluentui/react-icons/headless/svg/chevron-down";
import { Dismiss20Regular } from "@fluentui/react-icons/headless/svg/dismiss";
import { TaskListSquareLtr20Regular } from "@fluentui/react-icons/headless/svg/task-list-square-ltr";
import { Eclipse } from "loading-dev";
import React, { useEffect, useRef } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { commands, useProjectState } from "@/lib/backend";
import * as chatStreamStore from "@/features/chat/lib/chat-stream-store";
import { displayPlanName, parsePlanMarkdown, splitPlanDocument, type PlanPreview } from "@/lib/plan/preview";
import { ChatMarkdown } from "@/features/chat/ui/md/view";
import {
    freezeActiveSteps,
    selectPlanningPreviewSteps,
    todoCountLabel,
} from "@/lib/chat/planning-block";
import { Button } from "@/components/ui/button";
import {
    CHAT_EXPAND_FOR_FIND_EVENT,
    notifyTranscriptDisclosureToggle,
} from "../shell/find-bar";
import { Collapse } from "./collapse";
import { recordPlanOrigin, resolveProjectPlanPath } from "@/features/chat/lib/plan-origin";
import { notify } from "@/features/notifications";

type PlanStep = {
    label: string;
    status: "done" | "active" | "pending" | "cancelled";
};

export function PlanningBlock({ steps, completedCount, totalCount, isGenerating }: {
    title?: string;
    steps: PlanStep[];
    completedCount: number;
    totalCount: number;
    /** When false, freeze "active" steps so they don't spin after the turn ends. */
    isGenerating?: boolean;
}) {
    const rootRef = useRef<HTMLDivElement>(null);
    const [manualOpen, setManualOpen] = React.useState<boolean | null>(null);
    const isOpen = manualOpen ?? totalCount <= 5;
    const displaySteps = React.useMemo(
        () => freezeActiveSteps(steps, isGenerating),
        [steps, isGenerating],
    );
    const previewWindow = React.useMemo(
        () => selectPlanningPreviewSteps(displaySteps, 2),
        [displaySteps],
    );
    const visibleSteps = isOpen
        ? displaySteps
        : previewWindow.items.map((item) => item.step);

    const canToggle = totalCount > 1;

    useEffect(() => {
        if (!canToggle || isOpen) return undefined;
        const onExpandForFind = (e: Event) => {
            const detail = (
                e as CustomEvent<{
                    messageIndex?: number;
                    query?: string;
                    caseSensitive?: boolean;
                }>
            ).detail;
            const root = rootRef.current;
            if (!root || detail?.messageIndex == null) return;
            const msgEl = root.closest<HTMLElement>("[data-chat-message-index]");
            if (!msgEl || Number(msgEl.getAttribute("data-chat-message-index")) !== detail.messageIndex) {
                return;
            }
            const q = (detail.query ?? "").trim();
            if (!q) return;
            const haystack = displaySteps.map((s) => s.label).join(" ");
            const matched = detail.caseSensitive
                ? haystack.includes(q)
                : haystack.toLowerCase().includes(q.toLowerCase());
            if (matched) setManualOpen(true);
        };
        window.addEventListener(CHAT_EXPAND_FOR_FIND_EVENT, onExpandForFind as EventListener);
        return () => {
            window.removeEventListener(CHAT_EXPAND_FOR_FIND_EVENT, onExpandForFind as EventListener);
        };
    }, [canToggle, isOpen, displaySteps]);

    const handleToggle = () => {
        if (!canToggle) return;
        notifyTranscriptDisclosureToggle(rootRef.current);
        setManualOpen((prev) => !(prev ?? totalCount <= 5));
    };

    return (
        <div
            ref={rootRef}
            className="my-1.5 w-full overflow-hidden rounded-xl border border-border-subtle bg-surface-4"
        >
            <button
                type="button"
                aria-expanded={canToggle ? isOpen : undefined}
                onClick={handleToggle}
                className={cn(
                    "flex w-full items-center gap-2 px-2.5 py-2 text-left select-none",
                    canToggle &&
                        "cursor-pointer transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--row-hover)]",
                )}
            >
                <span className="flex size-4 shrink-0 items-center justify-center text-text-muted">
                    <Icon icon={TaskListSquareLtr20Regular} className="icon-sm" />
                </span>
                <span className="truncate text-sm font-medium text-text-primary">To-dos</span>
                {!isOpen && previewWindow.hiddenCount > 0 ? (
                    <span className="shrink-0 text-xs tabular-nums text-text-muted/75">
                        +{previewWindow.hiddenCount} more
                    </span>
                ) : null}
                <span className="ms-auto shrink-0 text-xs font-medium tabular-nums text-text-muted">
                    {todoCountLabel(completedCount, totalCount)}
                </span>
                {canToggle ? (
                    <Icon
                        icon={ChevronDown20Regular}
                        className={cn(
                            "icon-xs shrink-0 text-text-muted transition-transform duration-[var(--spring-quick-dur)] ease-[var(--spring-quick)] motion-reduce:transition-none",
                            isOpen && "rotate-180",
                        )}
                    />
                ) : null}
            </button>

            <Collapse open={visibleSteps.length > 0}>
                <div className="flex flex-col gap-0.5 px-2.5 pb-2">
                    {visibleSteps.map((step, i) => (
                        <div key={`${step.label}-${i}`} className="flex min-h-7 items-start gap-2 py-1">
                            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                                {step.status === "done" ? (
                                    <Icon icon={CheckmarkCircle20Filled} className="size-4 text-success" />
                                ) : step.status === "active" ? (
                                    <Eclipse size={14} className="text-accent" />
                                ) : step.status === "cancelled" ? (
                                    <Icon icon={Dismiss20Regular} className="size-4 text-text-disabled" />
                                ) : (
                                    <span className="size-3.5 rounded-full border border-text-muted/55" />
                                )}
                            </span>
                            <span
                                className={cn(
                                    "min-w-0 flex-1 break-words text-sm leading-snug",
                                    step.status === "done" && "text-text-muted",
                                    step.status === "active" && "font-medium text-text-primary",
                                    step.status === "pending" && "text-text-muted",
                                    step.status === "cancelled" && "text-text-disabled line-through",
                                )}
                            >
                                {step.label}
                            </span>
                        </div>
                    ))}
                </div>
            </Collapse>
        </div>
    );
}

function PlanBuildButton({ missing, busy, onBuild }: {
    missing: boolean;
    busy: boolean;
    onBuild: () => Promise<void>;
}) {
    const label = missing ? "Plan missing" : busy ? "Building…" : "Build";
    return (
        <Button
            disabled={busy || missing}
            onClick={() => { void onBuild(); }}
            variant={missing ? "outline" : "default"}
            size="sm"
            className={cn("gap-1", missing && "text-error border-error/40")}
        >
            {label}
            {!missing ? (
                <span className="ml-1 inline-flex items-center gap-0.5 opacity-80">
                    <kbd className="text-[10px]">{modKeyLabel()}</kbd>
                    <kbd className="text-[10px]">↵</kbd>
                </span>
            ) : null}
        </Button>
    );
}

/** Display a saved plan, recover its supplied markdown when necessary, and keep Build tied to its originating chat. */
export function PlanSavedBlock({
    title,
    path,
    markdown,
}: {
    title: string;
    path: string;
    markdown?: string;
}) {
    const rootRef = useRef<HTMLDivElement>(null);
    const { project_path } = useProjectState();
    const useStatus =
        "useChatStreamStatus" in (chatStreamStore as Record<string, unknown>)
            ? chatStreamStore.useChatStreamStatus
            : chatStreamStore.useChatStream;
    const { isLoading, viewedConversationId } = useStatus();
    const [missing, setMissing] = React.useState(false);
    const [checking, setChecking] = React.useState(false);
    const [preview, setPreview] = React.useState<PlanPreview | null>(() =>
        markdown ? parsePlanMarkdown(markdown) : null,
    );
    const [body, setBody] = React.useState(() =>
        markdown ? splitPlanDocument(markdown).body : "",
    );
    const [open, setOpen] = React.useState(true);

    const applyPlan = (content: string) => {
        setPreview(parsePlanMarkdown(content));
        setBody(splitPlanDocument(content).body);
    };

    const displayTitle = displayPlanName(title, preview?.title);
    const absPath = resolveProjectPlanPath(path, project_path);

    // The chat this plan is shown in is the chat it was made in. Recorded once: the first
    // chat to show the plan keeps it, so reopening it elsewhere does not move Build.
    React.useEffect(() => {
        recordPlanOrigin(absPath, viewedConversationId);
    }, [absPath, viewedConversationId]);

    React.useEffect(() => {
        let cancelled = false;
        void commands.readFile(absPath).then((content) => {
            if (!cancelled) {
                applyPlan(content);
                setMissing(false);
            }
        }).catch(() => {
            if (!cancelled && markdown) applyPlan(markdown);
        });
        return () => { cancelled = true; };
    }, [absPath, markdown]);

    useEffect(() => {
        if (open) return undefined;
        const onExpandForFind = (e: Event) => {
            const detail = (
                e as CustomEvent<{
                    messageIndex?: number;
                    query?: string;
                    caseSensitive?: boolean;
                }>
            ).detail;
            const root = rootRef.current;
            if (!root || detail?.messageIndex == null) return;
            const msgEl = root.closest<HTMLElement>("[data-chat-message-index]");
            if (!msgEl || Number(msgEl.getAttribute("data-chat-message-index")) !== detail.messageIndex) {
                return;
            }
            const q = (detail.query ?? "").trim();
            if (!q) return;
            const haystack = `${displayTitle} ${body} ${(preview?.todos ?? []).join(" ")}`;
            const matched = detail.caseSensitive
                ? haystack.includes(q)
                : haystack.toLowerCase().includes(q.toLowerCase());
            if (matched) setOpen(true);
        };
        window.addEventListener(CHAT_EXPAND_FOR_FIND_EVENT, onExpandForFind as EventListener);
        return () => {
            window.removeEventListener(CHAT_EXPAND_FOR_FIND_EVENT, onExpandForFind as EventListener);
        };
    }, [open, displayTitle, body, preview]);

    const ensurePlanFile = async (): Promise<boolean> => {
        try {
            await commands.readFile(absPath);
            setMissing(false);
            return true;
        } catch {
            if (!markdown?.trim()) {
                setMissing(true);
                return false;
            }
            try {
                await commands.createFile(absPath);
            } catch {
                /* may already exist */
            }
            await commands.saveFile(absPath, markdown);
            applyPlan(markdown);
            setMissing(false);
            return true;
        }
    };

    const handleBuild = async () => {
        if (isLoading || checking) return;
        setChecking(true);
        try {
            if (!(await ensurePlanFile())) return;
            // Build goes to the chat this plan was shown in, not whichever chat is active then.
            recordPlanOrigin(absPath, viewedConversationId);
            window.dispatchEvent(new CustomEvent("bettershape-build-plan", {
                detail: { path, title, conversationId: viewedConversationId },
            }));
        } catch {
            notify.error("Could not build plan", "The plan could not be saved. Check file permissions and try again.");
        } finally {
            setChecking(false);
        }
    };

    const todos = preview?.todos ?? [];
    const todoCount = todos.length;

    return (
        <div
            ref={rootRef}
            className="my-1 w-full overflow-hidden rounded-xl border border-border-subtle bg-surface-2 p-2.5"
        >
            <button
                type="button"
                aria-expanded={open}
                onClick={() => {
                    notifyTranscriptDisclosureToggle(rootRef.current);
                    setOpen((v) => !v);
                }}
                className="flex w-full items-center gap-2 text-left transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]"
            >
                <span className="flex size-4 shrink-0 items-center justify-center text-text-muted">
                    <Icon icon={CalendarCheckmark24Filled} className="icon-sm" />
                </span>
                <span className="min-w-0 flex-1 truncate text-md tracking-relaxed font-medium text-text-secondary">
                    {displayTitle}
                </span>
                <Icon
                    icon={ChevronDown20Regular}
                    className={cn(
                        "icon-sm shrink-0 text-text-muted transition-transform duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]",
                        open && "rotate-180",
                    )}
                />
            </button>

            <Collapse open={open}>
                <div className="flex flex-col gap-2 pt-2">
                    {body.trim() ? (
                        <div className="chat-markdown px-1 text-sm text-text-primary">
                            <ChatMarkdown content={body} />
                        </div>
                    ) : null}

                    {todoCount > 0 ? (
                        <ul className="flex flex-col gap-1">
                            {todos.map((todo, i) => (
                                <li key={`${todo}-${i}`} className="flex items-start gap-2">
                                    <span className="flex size-4 shrink-0 items-center justify-center">
                                        <span className="size-3.5 rounded-full border border-text-muted/55" />
                                    </span>
                                    <span className="text-sm text-text-primary leading-snug">{todo}</span>
                                </li>
                            ))}
                        </ul>
                    ) : null}

                    <div data-find-skip className="flex justify-end">
                        <PlanBuildButton missing={missing} busy={isLoading || checking} onBuild={handleBuild} />
                    </div>
                </div>
            </Collapse>
        </div>
    );
}
