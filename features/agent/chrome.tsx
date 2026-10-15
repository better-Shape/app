"use client";

import { useState, type ReactNode } from "react";
import { PanelGlyph } from "@/components/ui/panel-glyph";

import { cn } from "@/lib/utils";
import { usePlatform } from "@/lib/platform";
import { Tooltip } from "@/components/ui/tooltip";
import {
    WindowControls,
    WindowControlsSpacer,
} from "@/features/agent/workbench/titlebar/ui/window-controls";

export const AGENT_TABS_SLOT = "bettershape-agent-tabs";
export const AGENT_CHROME_ACTIONS_SLOT = "bettershape-agent-chrome-actions";
export const AGENT_SIDEBAR_BACK_SLOT = "bettershape-agent-sidebar-back";
export const AGENT_SIDEBAR_HISTORY_SLOT = "bettershape-agent-sidebar-history";

function Btn({
    label,
    onClick,
    disabled,
    active,
    panelToggle,
    children,
}: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    active?: boolean;
    /** Names the panel this button toggles, so the stylesheet can preview it on hover. */
    panelToggle?: string;
    children: ReactNode;
}) {
    const { committed, commit, handlers } = usePanelCommit();

    return (
        <Tooltip content={label}>
            <button
                type="button"
                data-panel-toggle={panelToggle}
                data-panel-committed={committed ? "true" : undefined}
                aria-label={label}
                aria-pressed={active}
                disabled={disabled}
                onClick={() => {
                    commit();
                    onClick();
                }}
                {...handlers}
                className={cn(
                    "flex size-7 items-center justify-center rounded-md text-text-muted press-spring",
                    "hover:bg-[var(--btn-hover)] hover:text-text-primary",
                    active && "text-text-primary",
                    "disabled:pointer-events-none disabled:text-text-disabled",
                )}
            >
                {children}
            </button>
        </Tooltip>
    );
}

export function AgentChrome({
    rightOpen,
    onToggleRight,
    canToggleRight = true,
    showRightToggle = true,
    padWindowControls = false,
    sidebarOpen = true,
    onToggleSidebar,
    onSidebarHoverStart,
    onSidebarHoverEnd,
    windowControls,
}: {
    rightOpen: boolean;
    onToggleRight: () => void;
    canToggleRight?: boolean;
    showRightToggle?: boolean;
    padWindowControls?: boolean;
    sidebarOpen?: boolean;
    onToggleSidebar?: () => void;
    onSidebarHoverStart?: () => void;
    onSidebarHoverEnd?: () => void;
    windowControls?: {
        isMaximized: boolean;
        onMinimize: () => void;
        onToggleMaximize: () => void;
        onClose: () => void;
    };
}) {
    const isMac = usePlatform() === "macos";

    // The peek toggle is mounted by the click that closed the sidebar, so detecting that
    // transition lets the arriving button continue the travel its predecessor started.
    // The count lives in state because a render-phase update makes React discard the pass
    // a local flag was set in, so a local would never reach the committed render.
    const [sidebarCloseCount, setSidebarCloseCount] = useState(0);
    const [previousSidebarOpen, setPreviousSidebarOpen] = useState(sidebarOpen);
    if (previousSidebarOpen !== sidebarOpen) {
        setPreviousSidebarOpen(sidebarOpen);
        if (!sidebarOpen) setSidebarCloseCount((count) => count + 1);
    }

    return (
        <div className="relative z-30 flex h-titlebar shrink-0 items-stretch overflow-hidden bg-transparent" data-tauri-drag-region>
            {isMac && windowControls ? (
                <WindowControls {...windowControls} surface="panel" spacer={false} />
            ) : null}
            {!sidebarOpen && onToggleSidebar ? (
                <div
                    data-sidebar-peek-toggle=""
                    className="relative z-10 flex shrink-0 items-center pl-1"
                    data-no-drag
                    onMouseEnter={onSidebarHoverStart}
                    onMouseLeave={onSidebarHoverEnd}
                >
                    <SidebarToggleBtn open={false} commitOnMount={sidebarCloseCount > 0} onToggle={onToggleSidebar} />
                </div>
            ) : null}
            <div
                id={AGENT_TABS_SLOT}
                className="relative z-10 flex h-full min-w-0 flex-1 items-center overflow-hidden pl-2"
            />

            <div className="relative z-10 flex shrink-0 items-center gap-0.5 px-1" data-no-drag>
                <div id={AGENT_CHROME_ACTIONS_SLOT} className="flex items-center gap-0.5" />
                {showRightToggle ? (
                    <Btn
                        label={rightOpen ? "Hide panel" : "Show panel"}
                        disabled={!canToggleRight}
                        active={rightOpen}
                        panelToggle="workspace"
                        onClick={onToggleRight}
                    >
                        <PanelGlyph side="right" open={rightOpen} />
                    </Btn>
                ) : null}
                {padWindowControls && !isMac ? <WindowControlsSpacer /> : null}
            </div>
        </div>
    );
}

/**
 * Marks a panel toggle as having just committed, and clears the mark on pointer-out.
 *
 * Without it `:hover` keeps the icon pinned at the preview midpoint, so the pointer still
 * resting on the button never sees the state it just switched to. Set during render so the
 * attribute lands in the same commit as the state, with no frame of stale preview.
 */
export function usePanelCommit() {
    const [committed, setCommitted] = useState(false);

    const release = () => setCommitted((current) => (current ? false : current));
    return {
        committed,
        /**
         * Called from the toggle's own click, not from watching the state prop: state also
         * moves on its own, and treating those changes as commits suppressed the hover
         * preview for the rest of the session.
         */
        commit: () => setCommitted(true),
        release,
        handlers: { onPointerLeave: release, onBlur: release },
    };
}

export function SidebarToggleBtn({
    open,
    onToggle,
    collapsed,
    commitOnMount,
}: {
    open: boolean;
    onToggle: () => void;
    collapsed?: boolean;
    /**
     * Set when this button appeared because a panel just closed, so its rail starts where
     * the preview left off. Unset on a cold paint: nothing was committed, so nothing plays.
     */
    commitOnMount?: boolean;
}) {
    const { committed, commit, handlers } = usePanelCommit();
    // Captured on the first render and then left alone: whether this element was born
    // from a commit is a fact about its mount, not about later renders.
    const [bornFromCommit] = useState(Boolean(commitOnMount));

    return (
        <Tooltip content={open ? "Hide sidebar" : "Show sidebar"} side={collapsed ? "right" : "bottom"} delayDuration={80}>
            <button
                type="button"
                data-panel-toggle="sidebar"
                data-panel-committed={committed ? "true" : undefined}
                data-panel-commit-mount={bornFromCommit && !committed ? "true" : undefined}
                {...handlers}
                aria-label={open ? "Hide sidebar" : "Show sidebar"}
                onClick={() => {
                    commit();
                    onToggle();
                }}
                className={cn(
                    "flex items-center justify-center rounded-md text-text-muted hover:bg-[var(--btn-hover)] hover:text-text-primary",
                    collapsed ? "size-9" : "size-7",
                )}
            >
                <PanelGlyph side="left" open={open} />
            </button>
        </Tooltip>
    );
}
