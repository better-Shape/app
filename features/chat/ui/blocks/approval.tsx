"use client";

import { ArrowEnter20Filled } from "@fluentui/react-icons/headless/svg/arrow-enter";
import { WindowConsole20Regular } from "@fluentui/react-icons/headless/svg/window-console";

import React, { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { Arc } from "loading-dev";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { getPlatform } from "@/lib/platform";

/**
 * Ordered registry of mounted pending approval surfaces (`ApprovalCard` and
 * pending `PluginActivityCard`) so global `Cmd/Ctrl+Enter` and `Escape`
 * shortcuts route strictly to one card at a time (the focused card if focus is
 * inside one, otherwise the earliest pending card).
 */
const activeApprovalStack: symbol[] = [];

/** Registers `Cmd/Ctrl+Enter` and `Escape` hotkeys for a pending approval card. */
export function useApprovalKeyboardShortcut({
    enabled = true,
    isProcessing = false,
    cardRef,
    onAccept,
    onSkip,
}: {
    enabled?: boolean;
    isProcessing?: boolean;
    cardRef: RefObject<HTMLElement | null>;
    onAccept?: () => void;
    onSkip?: () => void;
}) {
    const instanceIdRef = useRef<symbol | null>(null);
    if (instanceIdRef.current === null) {
        instanceIdRef.current = Symbol("approval-card");
    }
    const onAcceptRef = useRef(onAccept);
    const onSkipRef = useRef(onSkip);
    const isProcessingRef = useRef(isProcessing);
    useEffect(() => {
        onAcceptRef.current = onAccept;
        onSkipRef.current = onSkip;
        isProcessingRef.current = isProcessing;
    }, [onAccept, onSkip, isProcessing]);

    const hasHandlers = Boolean(onAccept && onSkip);

    useEffect(() => {
        if (!enabled || !hasHandlers) return undefined;
        const selfId = instanceIdRef.current;
        if (selfId === null) return undefined;
        if (!activeApprovalStack.includes(selfId)) {
            activeApprovalStack.push(selfId);
        }

        const onKey = (e: KeyboardEvent) => {
            const acceptFn = onAcceptRef.current;
            const skipFn = onSkipRef.current;
            if (
                isProcessingRef.current
                || !acceptFn
                || !skipFn
                || e.defaultPrevented
                || e.isComposing
                || e.keyCode === 229
            ) {
                return;
            }
            const t = e.target instanceof Element ? e.target : null;
            if (
                t?.closest(
                    "textarea, input, select, [contenteditable='true'], [role='dialog'], [data-radix-popper-content-wrapper]",
                )
            ) {
                return;
            }

            const cardEl = cardRef.current;
            const containsFocus = Boolean(
                cardEl && document.activeElement && cardEl.contains(document.activeElement),
            );
            if (!containsFocus) {
                const anyCardFocused = Boolean(
                    document.activeElement instanceof HTMLElement &&
                        document.activeElement.closest("[data-pending-approval='true']"),
                );
                if (anyCardFocused || activeApprovalStack[0] !== selfId) {
                    return;
                }
            }

            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !e.shiftKey && !e.altKey) {
                e.preventDefault();
                e.stopPropagation();
                acceptFn();
                return;
            }
            if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                skipFn();
            }
        };

        window.addEventListener("keydown", onKey, true);
        return () => {
            window.removeEventListener("keydown", onKey, true);
            const idx = activeApprovalStack.indexOf(selfId);
            if (idx !== -1) activeApprovalStack.splice(idx, 1);
        };
    }, [enabled, hasHandlers, cardRef]);
}

/** Shared chrome for edit / command / plugin approval cards. */
export function ApprovalCard({
    icon,
    title,
    trailing,
    children,
    footerLeft,
    skipLabel = "Skip",
    acceptLabel = "Allow",
    isProcessing,
    onSkip,
    onAccept,
    className,
}: {
    icon?: ReactNode;
    title: ReactNode;
    trailing?: ReactNode;
    children?: ReactNode;
    footerLeft?: ReactNode;
    skipLabel?: string;
    acceptLabel?: string;
    isProcessing?: boolean;
    onSkip: () => void;
    onAccept: () => void;
    className?: string;
}) {
    const cardRef = useRef<HTMLDivElement>(null);
    const acceptShortcut = getPlatform() === "macos" ? "⌘↵" : "Ctrl+↵";

    useApprovalKeyboardShortcut({
        enabled: true,
        isProcessing,
        cardRef,
        onAccept,
        onSkip,
    });

    return (
        <div
            ref={cardRef}
            role="group"
            data-pending-approval={!isProcessing ? "true" : undefined}
            data-pending-approval-kind={!isProcessing ? "approval" : undefined}
            aria-label={typeof title === "string" ? title : "Action approval"}
            className={cn(
                "my-1.5 overflow-hidden rounded-xl border border-border-subtle bg-surface-3 transition-colors duration-[var(--spring-quick-dur)] ease-[var(--spring-quick)]",
                className,
            )}
        >
            <div className="flex items-center gap-2 px-3 py-2">
                {isProcessing ? (
                    <Arc size={12} className="shrink-0 text-text-muted" />
                ) : (
                    icon
                )}
                <div className="min-w-0 flex-1">{title}</div>
                {trailing}
            </div>
            {children}
            <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                <div className="min-w-0">{footerLeft}</div>
                <div data-find-skip className="flex shrink-0 items-center gap-1.5">
                    <Tooltip content={skipLabel} shortcut="Esc">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={isProcessing}
                            onClick={onSkip}
                        >
                            <span>{skipLabel}</span>
                        </Button>
                    </Tooltip>
                    <Tooltip content={acceptLabel} shortcut={acceptShortcut}>
                        <Button
                            type="button"
                            variant="default"
                            size="sm"
                            disabled={isProcessing}
                            onClick={onAccept}
                            className="gap-1.5"
                        >
                            <span>{acceptLabel}</span>
                            <Icon icon={ArrowEnter20Filled} />
                        </Button>
                    </Tooltip>
                </div>
            </div>
        </div>
    );
}

export type ApprovalBarProps = {
    label: string;
    subject: string;
    acceptLabel?: string;
    rejectLabel?: string;
    isProcessing?: boolean;
    onAccept: () => void;
    onReject: () => void;
    className?: string;
    /** Shown before the subject. Pass empty string to hide (plugin actions). */
    promptPrefix?: string;
};

/** Inline chat approval bar for pending terminal commands. */
export function ApprovalBar({
    label,
    subject,
    acceptLabel = "Run",
    rejectLabel = "Skip",
    isProcessing = false,
    onAccept,
    onReject,
    className,
    promptPrefix = "$ ",
}: ApprovalBarProps) {
    return (
        <ApprovalCard
            icon={<Icon icon={WindowConsole20Regular} className="text-text-muted" />}
            title={label}
            isProcessing={isProcessing}
            onSkip={onReject}
            onAccept={onAccept}
            skipLabel={rejectLabel}
            acceptLabel={acceptLabel}
            className={className}
        >
            <div className="px-3 pb-2">
                <Tooltip content={subject} side="top">
                    <span className="block truncate font-mono text-sm text-text-primary">
                        {promptPrefix ? (
                            <span className="select-none text-text-disabled">{promptPrefix}</span>
                        ) : null}
                        {subject}
                    </span>
                </Tooltip>
            </div>
        </ApprovalCard>
    );
}
