"use client";

import { modKeyGlyph as modKeyLabel } from "@/lib/platform";

import { MoreHorizontal20Regular } from "@fluentui/react-icons/headless/svg/more-horizontal";
import { TaskListSquareLtr20Regular } from "@fluentui/react-icons/headless/svg/task-list-square-ltr";


import React from "react";
import { Icon } from "@/components/ui/icon";

import { commands, useProjectState } from "@/lib/backend";
import { getPlanOrigin, resolveProjectPlanPath } from "@/features/chat/lib/plan-origin";
import * as chatStreamStore from "@/features/chat/lib/chat-stream-store";
import { displayPlanName } from "@/lib/plan/preview";
import { planSlugFromPath } from "@/lib/plan/file";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown";



export function MarkdownViewSwitch({
    raw,
    onRawChange,
}: {
    raw: boolean;
    onRawChange: (raw: boolean) => void;
}) {
    return (
        <div className="flex items-center rounded-md bg-surface-1 p-0.5">
            <Button
                type="button"
                variant={raw ? "ghost" : "secondary"}
                size="xs"
                className="h-6 px-2 font-normal"
                onClick={() => onRawChange(false)}
            >
                Preview
            </Button>
            <Button
                type="button"
                variant={raw ? "secondary" : "ghost"}
                size="xs"
                className="h-6 px-2 font-normal"
                onClick={() => onRawChange(true)}
            >
                Raw
            </Button>
        </div>
    );
}

export function PlanEditorHeader({
    path,
    title: titleProp,
    raw = false,
    onRawChange,
    onSaveToWorkspace,
}: {
    path: string;
    title?: string;
    raw?: boolean;
    onRawChange?: (raw: boolean) => void;
    onSaveToWorkspace?: () => void;
}) {
    const useStatus =
        "useChatStreamStatus" in (chatStreamStore as Record<string, unknown>)
            ? chatStreamStore.useChatStreamStatus
            : chatStreamStore.useChatStream;
    const { isLoading } = useStatus();
    const { project_path } = useProjectState();
    const [checking, setChecking] = React.useState(false);
    const title = displayPlanName(titleProp || planSlugFromPath(path));
    const mod = modKeyLabel();

    const handleBuild = React.useCallback(async () => {
        if (isLoading || checking) return;
        setChecking(true);
        try {
            await commands.readFile(path);
            // This button sits outside any chat, so it builds in the chat the plan was made in.
            // With no recorded origin, the event carries no id and the active chat is used.
            const conversationId = getPlanOrigin(resolveProjectPlanPath(path, project_path));
            window.dispatchEvent(new CustomEvent("bettershape-build-plan", {
                detail: { path, title, conversationId },
            }));
        } catch {
            const { notify } = await import("@/features/notifications");
            notify.error("Plan", "Plan file not found or could not be read.");
        } finally {
            setChecking(false);
        }
    }, [checking, isLoading, path, title, project_path]);

    React.useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (!(e.ctrlKey || e.metaKey) || e.key !== "Enter") return;
            e.preventDefault();
            void handleBuild();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [handleBuild]);

    return (
        <div className="flex w-full shrink-0 items-center justify-between gap-3 border-b border-border-subtle bg-editor px-3 min-h-[36px]">
            <div className="flex min-w-0 items-center gap-2 text-sm">
                <Icon icon={TaskListSquareLtr20Regular} className="shrink-0 text-text-muted" />
                <span className="truncate text-text-primary">{title}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
                <Button
                    type="button"
                    disabled={isLoading || checking}
                    onClick={() => { void handleBuild(); }}
                    variant="default"
                    size="sm"
                >
                    {isLoading || checking ? "Building…" : "Build"}
                    <span className="inline-flex items-center gap-0.5 opacity-80">
                        <kbd className="text-[10px]">{mod}</kbd>
                        <kbd className="text-[10px]">↵</kbd>
                    </span>
                </Button>
                {onRawChange || onSaveToWorkspace ? (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-7 text-text-muted"
                                aria-label="Plan options"
                            >
                                <Icon icon={MoreHorizontal20Regular} />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-[160px]">
                            {onRawChange ? (
                                <>
                                    <DropdownMenuCheckboxItem
                                        checked={!raw}
                                        onCheckedChange={() => onRawChange(false)}
                                    >
                                        Markdown
                                    </DropdownMenuCheckboxItem>
                                    <DropdownMenuCheckboxItem
                                        checked={raw}
                                        onCheckedChange={() => onRawChange(true)}
                                    >
                                        Raw
                                    </DropdownMenuCheckboxItem>
                                </>
                            ) : null}
                            {onRawChange && onSaveToWorkspace ? <DropdownMenuSeparator /> : null}
                            {onSaveToWorkspace ? (
                                <DropdownMenuItem onClick={onSaveToWorkspace}>
                                    Save to workspace
                                </DropdownMenuItem>
                            ) : null}
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : null}
            </div>
        </div>
    );
}
