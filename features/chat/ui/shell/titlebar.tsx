"use client";

import { People20Filled } from "@fluentui/react-icons/headless/svg/people";
import { Eclipse } from "loading-dev";
import { memo, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useStoredFlag } from "@/lib/ui/use-stored-flag";
import { useElementById } from "@/lib/ui/use-element-by-id";
import { Icon } from "@/components/ui/icon";
import { SwapText } from "@/components/ui/swap";
import { Tooltip } from "@/components/ui/tooltip";
import { Breadcrumb, BreadcrumbItem } from "@/components/ui/breadcrumb";
import { getRepoName } from "@/lib/workspace/repo-history";
import { useProjectState } from "@/lib/backend";
import { AGENT_CHROME_ACTIONS_SLOT, usePanelCommit } from "@/features/agent/chrome";
import { PanelGlyph } from "@/components/ui/panel-glyph";
import { CommitMenu } from "@/features/agent/workspace/commit-menu";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import { providerIcon } from "@/lib/ui/provider-icon";
import {
    getSubagents,
    openSubagent,
    subscribeSubagents,
    type SubagentCard,
} from "@/features/agent/subagents/store";
import { cn } from "@/lib/utils";

function isGenericChatTitle(title: string | null | undefined): boolean {
    const value = (title || "").trim().toLowerCase();
    return !value || value === "new chat" || value === "chat";
}

function latestRename(messages: { content?: string }[] | undefined): string | null {
    if (!messages) return null;
    for (let i = messages.length - 1; i >= 0; i--) {
        const match = messages[i]?.content?.match(/<rename_chat>([^<]+)<\/rename_chat>/i);
        const title = match?.[1]?.trim();
        if (title) return title;
    }
    return null;
}

/** First prompt title. */
const firstPromptTitle = (messages: { role?: string; content?: string }[] | undefined): string | null => {
    const user = messages?.find((m) => m.role === "user")?.content || "";
    const line = user
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!line) return null;
    const codePoints = Array.from(line);
    return codePoints.length > 48
        ? `${codePoints.slice(0, 48).join("").trimEnd()}...`
        : line;
};

export function resolveChatCrumbTitle(opts: {
    chatTitle: string;
    tabTitle?: string;
    convTitle?: string;
    messages?: { role?: string; content?: string }[];
}): string {
    const renamed = latestRename(opts.messages);
    const picks = [opts.chatTitle, renamed, opts.convTitle, opts.tabTitle, firstPromptTitle(opts.messages)];
    return picks.find((title) => !isGenericChatTitle(title))?.trim() || "New chat";
}

function shortModelName(model?: string): string {
    const id = (model || "").trim();
    if (!id || id === "auto" || id.endsWith("/auto")) return "Auto";
    const leaf = id.split("/").pop() || id;
    if (/\s/.test(leaf)) return leaf;
    return leaf.replace(/[-_]+/g, " ");
}

function ModelMark({ model, pin = false }: { model?: string; pin?: boolean }) {
    return (
        <span className={cn("flex shrink-0 items-center gap-1 text-xs text-text-muted", pin && "ml-auto")}>
            {providerIcon(model || "auto", 12)}
            <span className="max-w-[7rem] truncate">{shortModelName(model)}</span>
        </span>
    );
}

function chatSubagents(parentId: string | null, extra: SubagentCard[]): SubagentCard[] {
    const live = getSubagents();
    const map = new Map<string, SubagentCard>();
    for (const card of live) {
        if (!parentId || !card.parentId || card.parentId === parentId) {
            map.set(card.id, card);
        }
    }
    for (const card of extra) {
        if (!map.has(card.id)) map.set(card.id, card);
    }
    return [...map.values()];
}

/** Renders the ChatTitlebar UI component. */
export const ChatTitlebar = memo(function ChatTitlebar({
    title,
    conversationId,
    subagentTitle,
    subagentModel,
    onCloseSubagent,
    extractedSubagents = [],
}: {
    title: string;
    conversationId: string | null;
    subagentTitle?: string | null;
    subagentModel?: string | null;
    onCloseSubagent?: () => void;
    extractedSubagents?: SubagentCard[];
}) {
    const { project_path } = useProjectState();
    const repo = project_path ? getRepoName(project_path) : null;
    const terminalCommit = usePanelCommit();
    const actionsSlot = useElementById(AGENT_CHROME_ACTIONS_SLOT);
    const terminalOpen = useStoredFlag("bettershape-agent-terminal-open", "bettershape-terminal-open");
    useSyncExternalStore(subscribeSubagents, getSubagents, getSubagents);
    const subagents = chatSubagents(conversationId, extractedSubagents);
    const runningSubagentCount = subagents.filter((c) => c.status === "running").length;
    const failedSubagentCount = subagents.filter((c) => c.status === "error").length;

    const toggleTerminal = () => {
        window.dispatchEvent(
            new CustomEvent("bettershape-layout-toggle", {
                detail: { id: "terminal", value: !terminalOpen },
            }),
        );
    };

    const actions = (
        <div className="flex items-center gap-2">
            {project_path ? <CommitMenu projectPath={project_path} /> : null}
            <Tooltip content={terminalOpen ? "Hide terminal" : "Show terminal"}>
                <button
                    type="button"
                    aria-label={terminalOpen ? "Hide terminal" : "Show terminal"}
                    aria-pressed={terminalOpen}
                    data-panel-toggle="terminal"
                    data-panel-committed={terminalCommit.committed ? "true" : undefined}
                    {...terminalCommit.handlers}
                    onClick={() => {
                        terminalCommit.commit();
                        toggleTerminal();
                    }}
                    className="flex size-7 items-center justify-center rounded-md text-text-muted transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-primary data-[active=true]:text-text-primary"
                    data-active={terminalOpen}
                >
                    <PanelGlyph side="bottom" open={terminalOpen} />
                </button>
            </Tooltip>
        </div>
    );

    const chatCrumb = subagents.length > 0 ? (
        <li className="flex min-w-0 flex-1 items-center">
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button
                        type="button"
                        className={cn(
                            "-mx-1 flex min-w-0 max-w-[260px] items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-sm whitespace-nowrap transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]",
                            "data-[state=open]:bg-[var(--btn-open)] data-[state=open]:hover:bg-[var(--btn-open-hover)] data-[state=open]:text-text-primary",
                            subagentTitle
                                ? "text-text-muted hover:bg-[var(--btn-hover)] hover:text-text-secondary"
                                : "font-medium text-text-primary hover:bg-[var(--btn-hover)]",
                        )}
                    >
                        <SwapText block value={title} durationMs={180} className="min-w-0" />
                        {runningSubagentCount > 0 ? (
                            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-normal tabular-nums text-text-muted">
                                <Eclipse size={11} className="shrink-0 text-text-secondary" />
                                <span>{runningSubagentCount}</span>
                            </span>
                        ) : failedSubagentCount > 0 ? (
                            <span className="shrink-0 text-xs font-normal tabular-nums text-error">
                                {failedSubagentCount} failed
                            </span>
                        ) : null}
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-52">
                    <DropdownMenuItem onClick={() => onCloseSubagent?.()}>
                        {title}
                    </DropdownMenuItem>
                    {subagents.map((card) => (
                        <DropdownMenuItem
                            key={card.id}
                            onClick={() => openSubagent(card.id)}
                            className="gap-2"
                        >
                            {card.status === "running" ? (
                                <Eclipse size={12} className="shrink-0 text-text-secondary" />
                            ) : (
                                <Icon icon={People20Filled} className="text-text-muted" />
                            )}
                            <span className="min-w-0 flex-1 truncate">{card.title}</span>
                            {card.status === "error" ? (
                                <span className="shrink-0 text-2xs text-error">Failed</span>
                            ) : null}
                            <ModelMark model={card.model} pin />
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
        </li>
    ) : subagentTitle ? (
        <BreadcrumbItem onClick={() => onCloseSubagent?.()} className="min-w-0 max-w-[200px]">
            <SwapText block value={title} durationMs={180} className="min-w-0" />
        </BreadcrumbItem>
    ) : (
        <BreadcrumbItem current className="min-w-0 max-w-[26rem] flex-1">
            <SwapText block value={title} durationMs={180} className="min-w-0" />
        </BreadcrumbItem>
    );

    return (
        <div className="flex h-full min-w-0 flex-1 items-center overflow-hidden pl-1">
            <Breadcrumb className="hidden min-[440px]:flex w-auto min-w-0 max-w-full flex-1 overflow-hidden" aria-label="Project">
                {repo ? (
                    <BreadcrumbItem
                        onClick={() => window.dispatchEvent(new Event("bettershape-open-project-pick"))}
                        className="min-w-0 max-w-28 shrink sm:max-w-48"
                    >
                        <span className="min-w-0 truncate">{repo}</span>
                    </BreadcrumbItem>
                ) : null}
                {chatCrumb}
                {subagentTitle ? (
                    <BreadcrumbItem current className="min-w-0 max-w-[24rem] flex-1">
                        <span className="flex min-w-0 items-center gap-1.5">
                            <Icon icon={People20Filled} className="shrink-0 text-text-muted" />
                            <SwapText block value={subagentTitle} durationMs={180} className="min-w-0" />
                            <ModelMark model={subagentModel || undefined} />
                        </span>
                    </BreadcrumbItem>
                ) : null}
            </Breadcrumb>
            <div className="h-full min-w-2 shrink-0" />
            {actionsSlot && actionsSlot.isConnected ? createPortal(actions, actionsSlot) : null}
        </div>
    );
});
