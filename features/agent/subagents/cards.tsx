"use client";

import { CheckmarkCircle20Filled } from "@fluentui/react-icons/headless/svg/checkmark-circle";
import { ChevronRight20Regular } from "@fluentui/react-icons/headless/svg/chevron-right";
import { DismissCircle20Filled } from "@fluentui/react-icons/headless/svg/dismiss-circle";
import { Sparkle20Filled } from "@fluentui/react-icons/headless/svg/sparkle";

import { useEffect, useState, useSyncExternalStore } from "react";
import { listen } from "@tauri-apps/api/event";
import { Collapse } from "@/components/ui/collapse";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { providerIcon } from "@/lib/ui/provider-icon";
import { GeneratingIndicator } from "@/features/chat/ui/blocks/generating";
import { ReadGroup } from "@/features/chat/ui/blocks/workflow";
import {
    applySubagentEvent,
    getSubagents,
    openSubagent,
    subscribeSubagents,
    type SubagentCard,
    type SubagentStatus,
} from "./store";

function statusTone(status: SubagentStatus) {
    if (status === "done") return "text-success";
    if (status === "error") return "text-error";
    return "text-text-muted";
}

function clockLabel(card: SubagentCard): string {
    const at = new Date(card.startedAt ?? card.updatedAt);
    return at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Renders the Card UI component. */
const Card = ({ card }: { card: SubagentCard }) => {
    const live = card.status === "running" || card.status === "pending";
    const reviewing = live && card.phase === "reviewing" && (card.reads?.length ?? 0) > 0;
    const editing = live && card.phase === "editing";
    const [open, setOpen] = useState(true);

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={(e) => {
                const interactive = (e.target as Element | null)?.closest(
                    "button, a, [data-subagent-disclosure]",
                );
                if (interactive && interactive !== e.currentTarget) return;
                openSubagent(card.id);
            }}
            onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openSubagent(card.id);
                }
            }}
            className="flex cursor-pointer flex-col gap-1 rounded-xl border border-border-subtle bg-surface-3 p-2.5 text-left transition-[background-color,border-color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:border-border hover:bg-[var(--btn-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border active:scale-[0.985]"
        >
            <div className="flex items-center gap-2">
                <span className="flex size-4 shrink-0 items-center justify-center">
                    {providerIcon(card.model || "auto", 14)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
                    {card.title}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-text-disabled">
                    {clockLabel(card)}
                </span>
                {card.status === "done" ? (
                    <Icon icon={CheckmarkCircle20Filled} className={cn("shrink-0", statusTone(card.status))} />
                ) : card.status === "error" ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-error">
                        <span>Failed</span>
                        <Icon icon={DismissCircle20Filled} className={cn("shrink-0", statusTone(card.status))} />
                    </span>
                ) : null}
            </div>

            {editing ? (
                <GeneratingIndicator
                    label={card.activity || "Editing file"}
                    showTimer
                    startedAt={card.startedAt}
                />
            ) : reviewing ? (
                <div className="flex flex-col gap-0.5">
                    <button
                        type="button"
                        aria-expanded={open}
                        onClick={(e) => {
                            e.stopPropagation();
                            setOpen((v) => !v);
                        }}
                        className="flex min-h-[24px] w-full items-center gap-2 py-0.5 text-left text-sm font-medium text-text-secondary transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:text-text-primary"
                    >
                        <Icon icon={Sparkle20Filled} className="shrink-0 text-text-secondary" />
                        <span className="min-w-0 flex-1 truncate">Reviewing changes...</span>
                        <Icon
                            icon={ChevronRight20Regular}
                            className={cn(
                                "shrink-0 opacity-50 transition-transform duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]",
                                open && "rotate-90",
                            )}
                        />
                    </button>
                    <Collapse open={open}>
                        <div data-subagent-disclosure className="flex flex-col gap-0.5 pl-0.5">
                            <ReadGroup files={card.reads ?? []} tokens={card.tokens} />
                        </div>
                    </Collapse>
                </div>
            ) : live ? (
                <GeneratingIndicator
                    label={card.activity || "Working"}
                    showTimer
                    startedAt={card.startedAt}
                />
            ) : (
                <p className="truncate text-sm text-text-muted">{card.activity}</p>
            )}
        </div>
    );
};

/** Renders the SubagentCards UI component. */
export const SubagentCards = ({ className }: { className?: string }) => {
    const cards = useSyncExternalStore(subscribeSubagents, getSubagents, getSubagents);

    useEffect(() => {
        let unlisten: (() => void) | undefined;
        const tauri = (
            window as unknown as {
                __TAURI_INTERNALS__?: { invoke?: unknown; transformCallback?: unknown };
            }
        ).__TAURI_INTERNALS__;
        if (!tauri || typeof tauri.invoke !== "function" || typeof tauri.transformCallback !== "function") {
            return undefined;
        }
        listen<{
            id?: string;
            title?: string;
            activity?: string;
            status?: string;
        }>("agent-subagent", (event) => {
            applySubagentEvent(event.payload);
        }).then((fn) => {
            unlisten = fn;
        }).catch(() => undefined);
        return () => unlisten?.();
    }, []);

    const runningCount = cards.filter((c) => c.status === "running" || c.status === "pending").length;

    if (cards.length === 0) {
        return (
            <div className={cn("flex flex-col items-start gap-1 px-4 py-6", className)}>
                <p className="text-sm text-text-muted">No agents running</p>
                <p className="text-xs text-text-disabled">
                    The AI can spawn subagents in the background while it keeps working. Shared checkout is the default; worktree isolation is for parallel edits.
                </p>
            </div>
        );
    }

    return (
        <div className={cn("flex flex-col gap-2 overflow-y-auto p-2", className)}>
            <div className="flex items-center justify-between px-1">
                <span className="text-xs font-medium text-text-muted">Agents</span>
                <span className="text-xs tabular-nums text-text-disabled">
                    {runningCount > 0 ? `${runningCount} active` : `${cards.length} total`}
                </span>
            </div>
            {cards.map((card) => (
                <Card key={card.id} card={card} />
            ))}
        </div>
    );
};
