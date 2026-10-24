"use client";

import { ArrowLeft20Regular } from "@fluentui/react-icons/headless/svg/arrow-left";
import { CheckmarkCircle20Filled } from "@fluentui/react-icons/headless/svg/checkmark-circle";
import { DismissCircle20Filled } from "@fluentui/react-icons/headless/svg/dismiss-circle";

import { useEffect, useSyncExternalStore } from "react";
import { Eclipse } from "loading-dev";
import { Icon } from "@/components/ui/icon";
import { CopyButton } from "@/components/ui/copy-button";
import { Tooltip } from "@/components/ui/tooltip";
import { providerIcon } from "@/lib/ui/provider-icon";
import { UserMessageCard } from "@/features/chat/ui/message/bubble";
import { MessageRenderer } from "@/features/chat/ui/md/renderer";
import { extractSearchableMessageText } from "@/lib/chat/transcript-search";
import {
    closeSubagent,
    getActiveSubagent,
    subagentWorkflowContent,
    subscribeSubagents,
} from "./store";

export function SubagentChatView() {
    const card = useSyncExternalStore(subscribeSubagents, getActiveSubagent, getActiveSubagent);

    useEffect(() => {
        if (!card) return undefined;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || e.defaultPrevented) return;
            const target = e.target instanceof HTMLElement ? e.target : null;
            if (target?.closest("[role='dialog'], [role='menu'], input, textarea")) return;
            e.preventDefault();
            closeSubagent();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [card]);

    if (!card) return null;

    const live = card.status === "running" || card.status === "pending";
    const task = card.task?.trim() || card.title;
    const workflow = subagentWorkflowContent(card);
    const copyableOutput = extractSearchableMessageText(workflow);

    return (
        <div className="mx-auto flex min-h-full w-full min-w-0 max-w-4xl flex-col gap-4 pb-16 pt-5">
            <div className="flex items-center justify-between gap-2">
                <Tooltip content="Back to main conversation (Esc)" side="bottom">
                    <button
                        type="button"
                        onClick={() => closeSubagent()}
                        aria-label="Back to main conversation"
                        className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-text-secondary transition-[background-color,color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-primary active:scale-[0.97]"
                    >
                        <Icon icon={ArrowLeft20Regular} className="size-3.5 shrink-0" />
                        <span>Back to chat</span>
                    </button>
                </Tooltip>
                <div className="flex min-w-0 items-center gap-2">
                    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-border-subtle bg-surface-3 px-2.5 py-0.5 text-xs text-text-secondary">
                        <span className="flex size-3.5 shrink-0 items-center justify-center">
                            {providerIcon(card.model || "auto", 12)}
                        </span>
                        <span className="max-w-44 truncate font-medium text-text-primary">
                            {card.title}
                        </span>
                        {live ? (
                            <Eclipse size={11} className="shrink-0 text-text-muted" aria-hidden />
                        ) : card.status === "done" ? (
                            <Icon icon={CheckmarkCircle20Filled} className="size-3.5 shrink-0 text-success" />
                        ) : card.status === "error" ? (
                            <Icon icon={DismissCircle20Filled} className="size-3.5 shrink-0 text-error" />
                        ) : null}
                    </span>
                    {!live && copyableOutput ? (
                        <CopyButton text={copyableOutput} label="Copy subagent output" />
                    ) : null}
                </div>
            </div>
            <UserMessageCard className="w-full max-w-none">
                {task}
            </UserMessageCard>
            <div className="min-w-0 chat-text text-text-primary">
                <MessageRenderer
                    content={workflow}
                    isGenerating={live}
                    skipSubagentSync
                    activityLabel={live ? card.activity : undefined}
                />
            </div>
        </div>
    );
}
