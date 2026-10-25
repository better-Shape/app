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

/** Closes the active subagent detail view when Escape is pressed outside interactive inputs. */
const useSubagentEscapeClose = (active: boolean) => {
    useEffect(() => {
        if (!active) return undefined;
        /** Dismisses the subagent view on bare Escape outside menus, dialogs, and text fields. */
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || e.defaultPrevented) return;
            const target = e.target instanceof HTMLElement ? e.target : null;
            if (target?.closest("[role='dialog'], [role='menu'], input, textarea")) return;
            e.preventDefault();
            closeSubagent();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [active]);
};

/** Renders the trailing status glyph inside the subagent header badge. */
const SubagentBadgeStatus = ({ live, status }: { live: boolean; status: string }) => {
    if (live) return <Eclipse size={11} className="shrink-0 text-text-muted" aria-hidden />;
    if (status === "done") {
        return <Icon icon={CheckmarkCircle20Filled} className="size-3.5 shrink-0 text-success" />;
    }
    if (status === "error") {
        return <Icon icon={DismissCircle20Filled} className="size-3.5 shrink-0 text-error" />;
    }
    return null;
};

/** Checks whether a subagent status represents an in-flight execution (`running` or `pending`). */
const isSubagentLive = (status: string): boolean => status === "running" || status === "pending";

/** Computes display view-model fields for an active `SubagentCard`. */
const deriveSubagentViewProps = (card: NonNullable<ReturnType<typeof getActiveSubagent>>) => {
    const live = isSubagentLive(card.status);
    const workflow = subagentWorkflowContent(card);
    const copyableOutput = extractSearchableMessageText(workflow);
    return {
        live,
        task: card.task?.trim() || card.title,
        workflow,
        copyableOutput,
        iconModel: card.model || "auto",
        activityLabel: live ? card.activity : undefined,
        showCopy: !live && Boolean(copyableOutput),
    };
};

/** Renders the SubagentChatView UI component. */
export const SubagentChatView = () => {
    const card = useSyncExternalStore(subscribeSubagents, getActiveSubagent, getActiveSubagent);
    useSubagentEscapeClose(Boolean(card));

    if (!card) return null;

    const view = deriveSubagentViewProps(card);

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
                            {providerIcon(view.iconModel, 12)}
                        </span>
                        <span className="max-w-44 truncate font-medium text-text-primary">
                            {card.title}
                        </span>
                        <SubagentBadgeStatus live={view.live} status={card.status} />
                    </span>
                    {view.showCopy ? (
                        <CopyButton text={view.copyableOutput} label="Copy subagent output" />
                    ) : null}
                </div>
            </div>
            <UserMessageCard className="w-full max-w-none">
                {view.task}
            </UserMessageCard>
            <div className="min-w-0 chat-text text-text-primary">
                <MessageRenderer
                    content={view.workflow}
                    isGenerating={view.live}
                    skipSubagentSync
                    activityLabel={view.activityLabel}
                />
            </div>
        </div>
    );
};
