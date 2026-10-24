"use client";

import { ArrowEnter20Filled } from "@fluentui/react-icons/headless/svg/arrow-enter";
import { WindowConsole20Regular } from "@fluentui/react-icons/headless/svg/window-console";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { Arc } from "loading-dev";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { getPlatform } from "@/lib/platform";

/**
 * Ordered registry of mounted actionable approval surfaces (`ApprovalCard` and
 * pending `PluginActivityCard`) so global `Cmd/Ctrl+Enter` and `Escape`
 * shortcuts route strictly to one card at a time.
 */
const activeApprovalStack: symbol[] = [];

const EDITABLE_SHORTCUT_SELECTOR =
    "textarea, input, select, [contenteditable='true'], [role='dialog'], [data-radix-popper-content-wrapper]";

/** True when a keyboard event originates from an editable control or IME composition. */
const isBlockedApprovalKeyEvent = (e: KeyboardEvent): boolean => {
    const composing = e.defaultPrevented || e.isComposing || e.keyCode === 229;
    if (composing) return true;
    const target = e.target instanceof Element ? e.target : null;
    return Boolean(target?.closest(EDITABLE_SHORTCUT_SELECTOR));
};

/** Resolves the currently focused approval card element when focus is inside one. */
const getFocusedApprovalCard = (active: Element | null): Element | null =>
    active instanceof HTMLElement ? active.closest("[data-approval-card='true']") : null;

/** True when `selfId` owns global approval keyboard shortcuts. */
const isShortcutOwner = (cardEl: HTMLElement | null, selfId: symbol): boolean => {
    const focusedCard = getFocusedApprovalCard(document.activeElement);
    if (focusedCard) return focusedCard === cardEl;
    return activeApprovalStack[0] === selfId;
};

/** Maps a keyboard event to its approval decision (`"accept"`, `"skip"`, or `null`). */
const resolveApprovalAction = (e: KeyboardEvent): "accept" | "skip" | null => {
    if (e.shiftKey || e.altKey) return null;
    const cmdOrCtrl = e.metaKey || e.ctrlKey;
    if (cmdOrCtrl) return e.key === "Enter" ? "accept" : null;
    return e.key === "Escape" ? "skip" : null;
};

/** Dispatches the matching callback for a pending approval hotkey press. */
const dispatchApprovalHotkey = (
    e: KeyboardEvent,
    cardEl: HTMLElement | null,
    selfId: symbol,
    handlers: { accept?: () => void; skip?: () => void },
): void => {
    if (isBlockedApprovalKeyEvent(e)) return;
    if (!isShortcutOwner(cardEl, selfId)) return;
    const action = resolveApprovalAction(e);
    const handler = action ? handlers[action] : undefined;
    if (!handler) return;
    e.preventDefault();
    e.stopPropagation();
    handler();
};

/** Registers `Cmd/Ctrl+Enter` and `Escape` hotkeys for a pending approval card. */
export const useApprovalKeyboardShortcut = (opts: {
    enabled?: boolean;
    isProcessing?: boolean;
    cardRef: RefObject<HTMLElement | null>;
    onAccept?: () => void;
    onSkip?: () => void;
}): void => {
    const { enabled, isProcessing, cardRef, onAccept, onSkip } = opts;
    const instanceIdRef = useRef<symbol | null>(null);
    if (instanceIdRef.current === null) {
        instanceIdRef.current = Symbol("approval-card");
    }
    const handlersRef = useRef({ accept: onAccept, skip: onSkip });
    useEffect(() => {
        handlersRef.current = { accept: onAccept, skip: onSkip };
    }, [onAccept, onSkip]);

    const isEnabled = enabled !== false && !isProcessing;
    const actionable = isEnabled && Boolean(onAccept) && Boolean(onSkip);

    useEffect(() => {
        const selfId = instanceIdRef.current;
        if (!actionable || selfId === null) return undefined;
        if (!activeApprovalStack.includes(selfId)) {
            activeApprovalStack.push(selfId);
        }

        /** Window capture listener routing approval hotkeys to the owning card. */
        const onKey = (e: KeyboardEvent) => {
            dispatchApprovalHotkey(e, cardRef.current, selfId, handlersRef.current);
        };

        window.addEventListener("keydown", onKey, true);
        return () => {
            window.removeEventListener("keydown", onKey, true);
            const idx = activeApprovalStack.indexOf(selfId);
            if (idx !== -1) activeApprovalStack.splice(idx, 1);
        };
    }, [actionable, cardRef]);
};

/** Renders the leading icon or busy spinner and title row of an approval card. */
const ApprovalCardHeader = ({
    icon,
    title,
    trailing,
    isProcessing,
}: {
    icon?: ReactNode;
    title: ReactNode;
    trailing?: ReactNode;
    isProcessing?: boolean;
}) => (
    <div className="flex items-center gap-2 px-3 py-2">
        {isProcessing ? <Arc size={12} className="shrink-0 text-text-muted" /> : icon}
        <div className="min-w-0 flex-1">{title}</div>
        {trailing}
    </div>
);

/** Renders the Skip and Allow action buttons for an approval card. */
const ApprovalActionButtons = ({
    skipLabel,
    acceptLabel,
    acceptShortcut,
    isProcessing,
    onSkip,
    onAccept,
}: {
    skipLabel: string;
    acceptLabel: string;
    acceptShortcut: string;
    isProcessing?: boolean;
    onSkip: () => void;
    onAccept: () => void;
}) => (
    <div data-find-skip className="flex shrink-0 items-center gap-1.5">
        <Tooltip content={skipLabel} shortcut="Esc">
            <Button type="button" variant="ghost" size="sm" disabled={isProcessing} onClick={onSkip}>
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
);

/** Shared chrome for edit / command / plugin approval cards. */
export const ApprovalCard = (props: {
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
}) => {
    const {
        icon,
        title,
        trailing,
        children,
        footerLeft,
        isProcessing,
        onSkip,
        onAccept,
        className,
    } = props;
    const skipLabel = props.skipLabel ?? "Skip";
    const acceptLabel = props.acceptLabel ?? "Allow";
    const cardRef = useRef<HTMLDivElement>(null);
    const acceptShortcut = getPlatform() === "macos" ? "⌘↵" : "Ctrl+↵";
    const pendingAttr = isProcessing ? undefined : "true";
    const pendingKind = isProcessing ? undefined : "approval";
    const ariaLabel = typeof title === "string" ? title : "Action approval";

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
            data-approval-card="true"
            data-pending-approval={pendingAttr}
            data-pending-approval-kind={pendingKind}
            aria-label={ariaLabel}
            className={cn(
                "my-1.5 overflow-hidden rounded-xl border border-border-subtle bg-surface-3 transition-colors duration-[var(--spring-quick-dur)] ease-[var(--spring-quick)]",
                className,
            )}
        >
            <ApprovalCardHeader
                icon={icon}
                title={title}
                trailing={trailing}
                isProcessing={isProcessing}
            />
            {children}
            <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                <div className="min-w-0">{footerLeft}</div>
                <ApprovalActionButtons
                    skipLabel={skipLabel}
                    acceptLabel={acceptLabel}
                    acceptShortcut={acceptShortcut}
                    isProcessing={isProcessing}
                    onSkip={onSkip}
                    onAccept={onAccept}
                />
            </div>
        </div>
    );
};

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

/** Renders the command subject preview inside `ApprovalBar`. */
const ApprovalSubjectPreview = ({
    subject,
    promptPrefix,
}: {
    subject: string;
    promptPrefix: string;
}) => (
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
);

/** Inline chat approval bar for pending terminal commands. */
export const ApprovalBar = (props: ApprovalBarProps) => {
    const acceptLabel = props.acceptLabel ?? "Run";
    const rejectLabel = props.rejectLabel ?? "Skip";
    const promptPrefix = props.promptPrefix ?? "$ ";
    return (
        <ApprovalCard
            icon={<Icon icon={WindowConsole20Regular} className="text-text-muted" />}
            title={props.label}
            isProcessing={props.isProcessing}
            onSkip={props.onReject}
            onAccept={props.onAccept}
            skipLabel={rejectLabel}
            acceptLabel={acceptLabel}
            className={props.className}
        >
            <ApprovalSubjectPreview subject={props.subject} promptPrefix={promptPrefix} />
        </ApprovalCard>
    );
};
