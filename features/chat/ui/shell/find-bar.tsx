"use client";

import { ChevronDown20Regular } from "@fluentui/react-icons/headless/svg/chevron-down";
import { ChevronUp20Regular } from "@fluentui/react-icons/headless/svg/chevron-up";
import { Dismiss16Regular } from "@fluentui/react-icons/headless/svg/dismiss";
import { Search20Regular } from "@fluentui/react-icons/headless/svg/search";

import React, { useEffect, useRef } from "react";
import { Icon } from "@/components/ui/icon";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const CHAT_FIND_OPEN_EVENT = "bettershape-chat-open-find";
export const CHAT_EXPAND_FOR_FIND_EVENT = "bettershape-chat-expand-for-find";
export const CHAT_COPY_MARKDOWN_EVENT = "bettershape-chat-copy-markdown";
export const CHAT_EXPORT_MARKDOWN_EVENT = "bettershape-chat-export-markdown";

let mountedChatSurfaceCount = 0;
const pendingChatSurfaceActions: Array<{ run: () => void; timer: number }> = [];

/**
 * Registers an active `<Chat />` listener mount and flushes any palette/menu
 * actions that dismissed an overlay to reach the chat surface.
 */
export function registerMountedChatSurface(): () => void {
    mountedChatSurfaceCount += 1;
    if (pendingChatSurfaceActions.length > 0 && typeof window !== "undefined") {
        const queued = pendingChatSurfaceActions.splice(0, pendingChatSurfaceActions.length);
        queueMicrotask(() => {
            for (const entry of queued) {
                window.clearTimeout(entry.timer);
                entry.run();
            }
        });
    }
    return () => {
        mountedChatSurfaceCount = Math.max(0, mountedChatSurfaceCount - 1);
    };
}

/**
 * Switches center view to `"chat"` and runs `action` immediately if `<Chat />`
 * is mounted, or queues `action` until `<Chat />` registers its listeners.
 */
export function dispatchToChatSurface(action: () => void) {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("bettershape-center-view", { detail: "chat" }));
    if (mountedChatSurfaceCount > 0) {
        action();
        return;
    }
    const entry = {
        run: action,
        timer: window.setTimeout(() => {
            const idx = pendingChatSurfaceActions.indexOf(entry);
            if (idx !== -1) pendingChatSurfaceActions.splice(idx, 1);
        }, 2000),
    };
    pendingChatSurfaceActions.push(entry);
}

/** Opens the in-conversation Find bar, switching back from overlays if needed. */
export function openChatFindBar(initialQuery?: string) {
    if (typeof window === "undefined") return;
    dispatchToChatSurface(() => {
        window.dispatchEvent(
            new CustomEvent(CHAT_FIND_OPEN_EVENT, {
                detail: initialQuery ? { query: initialQuery } : undefined,
            }),
        );
    });
}

/** Signals that a transcript disclosure toggled so Stick-to-Bottom preserves scroll anchor. */
export function notifyTranscriptDisclosureToggle(element?: HTMLElement | null) {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
        new CustomEvent("bettershape-transcript-disclosure-toggle", {
            detail: { element: element ?? null },
        }),
    );
}

/** Compact floating search bar for finding text within the active chat transcript. */
export function ChatFindBar({
    open,
    query,
    matchCount,
    activeMatchIndex,
    matchCase = false,
    onMatchCaseChange,
    onQueryChange,
    onNext,
    onPrev,
    onClose,
}: {
    open: boolean;
    query: string;
    matchCount: number;
    activeMatchIndex: number;
    matchCase?: boolean;
    onMatchCaseChange?: (next: boolean) => void;
    onQueryChange: (value: string) => void;
    onNext: () => void;
    onPrev: () => void;
    onClose: () => void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [everOpened, setEverOpened] = React.useState(open);

    if (open && !everOpened) {
        setEverOpened(true);
    }

    useEffect(() => {
        if (!open) return undefined;
        const id = requestAnimationFrame(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
        });
        return () => cancelAnimationFrame(id);
    }, [open]);

    if (!everOpened && !open) return null;

    const hasQuery = query.trim().length > 0;
    const hasMatches = matchCount > 0;
    const countLabel = !hasQuery
        ? ""
        : hasMatches
          ? `${activeMatchIndex + 1} / ${matchCount}`
          : "0 matches";

    return (
        <div
            role="search"
            aria-label="Find in conversation"
            aria-hidden={!open || undefined}
            inert={!open || undefined}
            data-chat-find-bar
            className="pointer-events-auto flex h-[32px] items-center gap-1 rounded-xl border border-border-secondary bg-surface-3 px-2.5 shadow-md"
        >
            <Icon icon={Search20Regular} className="size-3.5 shrink-0 text-text-muted" />
            <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                    if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        onClose();
                        return;
                    }
                    if (e.key === "Enter") {
                        e.preventDefault();
                        if (e.shiftKey) onPrev();
                        else onNext();
                    }
                }}
                placeholder="Find in chat..."
                aria-label="Find in conversation"
                className="w-36 bg-transparent text-xs text-text-primary placeholder:text-text-muted focus:outline-none sm:w-44"
            />
            {hasQuery ? (
                <span
                    aria-live="polite"
                    className={cn(
                        "shrink-0 px-1 text-2xs tabular-nums select-none",
                        hasMatches ? "text-text-muted" : "text-warning",
                    )}
                >
                    {countLabel}
                </span>
            ) : null}
            <div className="flex shrink-0 items-center gap-1">
                {onMatchCaseChange ? (
                    <Tooltip content="Match case" side="bottom">
                        <button
                            type="button"
                            aria-label="Match case"
                            aria-pressed={matchCase}
                            onClick={() => onMatchCaseChange(!matchCase)}
                            className={cn(
                                "flex size-[24px] items-center justify-center rounded-md font-mono text-2xs font-semibold transition-[background-color,color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] active:scale-[0.94]",
                                matchCase
                                    ? "bg-[var(--btn-open)] text-text-primary hover:bg-[var(--btn-open-hover)]"
                                    : "text-text-muted hover:bg-[var(--btn-hover)] hover:text-text-primary",
                            )}
                        >
                            Aa
                        </button>
                    </Tooltip>
                ) : null}
                <Tooltip content="Previous match (Shift+Enter)" side="bottom">
                    <button
                        type="button"
                        aria-label="Previous match"
                        disabled={!hasMatches}
                        onClick={onPrev}
                        className="flex size-[24px] items-center justify-center rounded-md text-text-muted transition-[background-color,color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] enabled:hover:bg-[var(--btn-hover)] enabled:hover:text-text-primary enabled:active:scale-[0.94] disabled:opacity-35"
                    >
                        <Icon icon={ChevronUp20Regular} className="size-3.5" />
                    </button>
                </Tooltip>
                <Tooltip content="Next match (Enter)" side="bottom">
                    <button
                        type="button"
                        aria-label="Next match"
                        disabled={!hasMatches}
                        onClick={onNext}
                        className="flex size-[24px] items-center justify-center rounded-md text-text-muted transition-[background-color,color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] enabled:hover:bg-[var(--btn-hover)] enabled:hover:text-text-primary enabled:active:scale-[0.94] disabled:opacity-35"
                    >
                        <Icon icon={ChevronDown20Regular} className="size-3.5" />
                    </button>
                </Tooltip>
                <Tooltip content="Close find (Esc)" side="bottom">
                    <button
                        type="button"
                        aria-label="Close find in conversation"
                        onClick={onClose}
                        className="flex size-[24px] items-center justify-center rounded-md text-text-muted transition-[background-color,color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-primary active:scale-[0.94]"
                    >
                        <Icon icon={Dismiss16Regular} className="size-3.5" />
                    </button>
                </Tooltip>
            </div>
        </div>
    );
}
