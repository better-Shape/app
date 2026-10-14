"use client";

import { ArrowUndo20Regular } from "@fluentui/react-icons/headless/svg/arrow-undo";
import { BranchRequestClosed20Regular } from "@fluentui/react-icons/headless/svg/branch-request-closed";
import { Merge20Regular } from "@fluentui/react-icons/headless/svg/merge";
import { MoreHorizontal20Regular } from "@fluentui/react-icons/headless/svg/more-horizontal";
import { Rocket20Regular } from "@fluentui/react-icons/headless/svg/rocket";
import { useCallback, useEffect, useState } from "react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import { Icon, type IconGlyph } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { PR_ACTION_LABEL, prActionsFor, runPrAction, type PrAction } from "./actions";
import type { PrItem } from "./mapping";

const ACTION_ICON: Record<PrAction, IconGlyph> = {
    close: BranchRequestClosed20Regular,
    merge: Merge20Regular,
    reopen: ArrowUndo20Regular,
    ready: Rocket20Regular,
};

const MODIFIER_KEYS = new Set([
    "Control",
    "Meta",
    "Alt",
    "AltGraph",
    "CapsLock",
    "NumLock",
    "ScrollLock",
    "Fn",
    "FnLock",
    "Hyper",
    "Super",
    "Symbol",
    "SymbolLock",
]);

/**
 * Shift alone reveals the quick actions on every row. Any other modifier turns
 * it back off, and losing focus clears it, so the state can never outlive the
 * gesture.
 */
export function useShiftHeld(): boolean {
    const [held, setHeld] = useState(false);

    useEffect(() => {
        const update = (event: KeyboardEvent) => {
            if (event.key === "Shift") {
                setHeld(event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey);
                return;
            }
            if (MODIFIER_KEYS.has(event.key)) setHeld(false);
        };
        const clear = () => setHeld(false);
        window.addEventListener("keydown", update);
        window.addEventListener("keyup", update);
        window.addEventListener("blur", clear);
        document.addEventListener("visibilitychange", clear);
        return () => {
            window.removeEventListener("keydown", update);
            window.removeEventListener("keyup", update);
            window.removeEventListener("blur", clear);
            document.removeEventListener("visibilitychange", clear);
        };
    }, []);

    return held;
}

/** Hidden until the row is hovered, focused, or Shift is held — never display:none, so Tab still reaches it. */
const REVEAL = "opacity-0 pointer-events-none";
const REVEALED = "opacity-100 pointer-events-auto";

export function PrRowActions({
    item,
    repo,
    speedMode,
    sweepBusy,
    onCloseSweepStart,
}: {
    item: PrItem;
    repo: { owner: string; repo: string };
    speedMode: boolean;
    sweepBusy: boolean;
    onCloseSweepStart: (item: PrItem, event: PointerEvent) => void;
}) {
    const [busy, setBusy] = useState<PrAction | null>(null);
    const actions = prActionsFor(item);

    const run = useCallback(
        async (action: PrAction) => {
            if (busy) return;
            setBusy(action);
            await runPrAction(item, action, `${repo.owner}/${repo.repo}`);
            setBusy(null);
        },
        [busy, item, repo],
    );

    if (actions.length === 0) return null;

    return (
        <div
            className={cn(
                "flex shrink-0 items-center gap-0.5 transition-opacity",
                speedMode ? REVEALED : REVEAL,
                "group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto",
            )}
        >
            {actions.map((action) => (
                <button
                    key={action}
                    type="button"
                    aria-label={`${PR_ACTION_LABEL[action]} #${item.number}`}
                    title={action === "close" ? "Close, or drag across rows to close several" : PR_ACTION_LABEL[action]}
                    disabled={busy !== null || sweepBusy}
                    onPointerDown={(event) => {
                        if (action === "close") { event.stopPropagation(); onCloseSweepStart(item, event.nativeEvent); }
                    }}
                    onClick={() => void run(action)}
                    className="flex size-7 items-center justify-center rounded-md text-text-muted hover:bg-panel-hover hover:text-text-primary disabled:opacity-50"
                >
                    <Icon icon={ACTION_ICON[action]} />
                </button>
            ))}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button
                        type="button"
                        aria-label={`Actions for #${item.number}`}
                        className="flex size-7 items-center justify-center rounded-md text-text-muted hover:bg-panel-hover hover:text-text-primary"
                    >
                        <Icon icon={MoreHorizontal20Regular} />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-40">
                    {actions.map((action) => (
                        <DropdownMenuItem
                            key={action}
                            disabled={busy !== null || sweepBusy}
                            onClick={() => void run(action)}
                        >
                            <Icon icon={ACTION_ICON[action]} />
                            {PR_ACTION_LABEL[action]}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}