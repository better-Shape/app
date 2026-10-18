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

/**
 * Marks a panel toggle as having just committed, and clears the mark on pointer-out.
 *
 * Without it `:hover` keeps the icon pinned at the preview midpoint, so the pointer still
 * resting on the button never sees the state it just switched to. Set during render so the
 * attribute lands in the same commit as the state, with no frame of stale preview.
 */
export const usePanelCommit = () => {
    const [committed, setCommitted] = useState(false);

    /**
     * Reports a release only when there is a mark to clear. The identity result keeps a
     * pointer-out that lands in the click's own frame from scheduling a render that would
     * arrive after the click set the mark.
     */
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
};

/** Counts the sidebar's closes, which is how a close is told apart from a cold paint.
 *
 * The count lives in state rather than a ref because a render-phase update makes React
 * discard the pass a local flag was set in, so a local would never reach the committed
 * render. Both setters run in the same pass, so the pair stays consistent.
 */
const useSidebarCloseCount = (sidebarOpen: boolean) => {
    const [count, setCount] = useState(0);
    const [previousOpen, setPreviousOpen] = useState(sidebarOpen);

    if (previousOpen !== sidebarOpen) {
        setPreviousOpen(sidebarOpen);
        if (!sidebarOpen) setCount((current) => current + 1);
    }

    return count;
};

/** The label and tooltip of a panel toggle, which name the state the click moves to. */
const panelToggleLabel = (open: boolean) => (open ? "Hide panel" : "Show panel");

/** Where a collapsed toggle's tooltip points, and the size that goes with the rail. */
const togglePlacement = (collapsed?: boolean) =>
    collapsed === true
        ? { side: "right" as const, className: "size-9" }
        : { side: "bottom" as const, className: "size-7" };

/** The sidebar toggle names the state its click moves to, like the panel toggle does. */
const sidebarToggleLabel = (open: boolean) => (open ? "Hide sidebar" : "Show sidebar");

/**
 * One chrome action.
 *
 * The panel this button toggles is named on the button as a data attribute, which is what
 * the stylesheet reads to preview the other state on hover; the commit mark comes from the
 * same hook the sidebar toggle uses, so a click and a hover cannot disagree about it.
 */
const Btn = ({
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
}) => {
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
};

/**
 * The sidebar's own toggle, which is also the peek button once the sidebar has closed.
 *
 * The element is remounted by the click that closed the sidebar, so `commitOnMount` is read
 * once: whether this instance was born from a commit is a fact about its mount and not about
 * later renders. `data-panel-commit-mount` carries that fact to the stylesheet, which is
 * what lets the arriving button continue the travel its predecessor started.
 */
export const SidebarToggleBtn = ({
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
}) => {
    const { committed, commit, handlers } = usePanelCommit();
    const [bornFromCommit] = useState(Boolean(commitOnMount));
    const { side, className: sizeClass } = togglePlacement(collapsed);
    const label = sidebarToggleLabel(open);

    return (
        <Tooltip content={label} side={side} delayDuration={80}>
            <button
                type="button"
                data-panel-toggle="sidebar"
                data-panel-committed={committed ? "true" : undefined}
                data-panel-commit-mount={bornFromCommit && !committed ? "true" : undefined}
                {...handlers}
                aria-label={label}
                onClick={() => {
                    commit();
                    onToggle();
                }}
                className={cn(
                    "flex items-center justify-center rounded-md text-text-muted hover:bg-[var(--btn-hover)] hover:text-text-primary",
                    sizeClass,
                )}
            >
                <PanelGlyph side="left" open={open} />
            </button>
        </Tooltip>
    );
};

/**
 * The sidebar toggle that takes over the top-left corner while the sidebar is closed.
 *
 * It appears on the click that closed the sidebar, so it is mounted with the count of
 * closes behind it: the stylesheet uses that to decide whether the arriving rail should
 * continue the travel the preview started or simply sit at rest.
 */
const SidebarPeekToggle = ({
    closeCount,
    onToggle,
    onHoverStart,
    onHoverEnd,
}: {
    closeCount: number;
    onToggle: () => void;
    onHoverStart?: () => void;
    onHoverEnd?: () => void;
}) => (
    <div
        role="presentation"
        data-sidebar-peek-toggle=""
        className="relative z-10 flex shrink-0 items-center pl-1"
        data-no-drag
        onMouseEnter={onHoverStart}
        onMouseLeave={onHoverEnd}
    >
        <SidebarToggleBtn open={false} commitOnMount={closeCount > 0} onToggle={onToggle} />
    </div>
);

/**
 * The window buttons, which the macOS build shows inside the panel chrome rather than in a
 * separate strip. `undefined` controls mean the surface is not the desktop shell at all.
 */
const MacWindowControls = ({
    controls,
}: {
    controls?: {
        isMaximized: boolean;
        onMinimize: () => void;
        onToggleMaximize: () => void;
        onClose: () => void;
    };
}) => (controls ? <WindowControls {...controls} surface="panel" spacer={false} /> : null);

/**
 * The right end of the chrome: the slot the workspace fills, the panel toggle, and the
 * spacer that keeps the window buttons clear of it on Windows and Linux.
 */
const ChromeActions = ({
    rightOpen,
    onToggleRight,
    canToggleRight,
    showRightToggle,
    padWindowControls,
    isMac,
}: {
    rightOpen: boolean;
    onToggleRight: () => void;
    canToggleRight: boolean;
    showRightToggle: boolean;
    padWindowControls: boolean;
    isMac: boolean;
}) => (
    <div className="relative z-10 flex shrink-0 items-center gap-0.5 px-1" data-no-drag>
        <div id={AGENT_CHROME_ACTIONS_SLOT} className="flex items-center gap-0.5" />
        {showRightToggle ? (
            <Btn
                label={panelToggleLabel(rightOpen)}
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
);

/**
 * The titlebar row above the agent surface.
 *
 * It composes the pieces rather than owning them: the slots are filled by the workspace, the
 * window controls are only on macOS, and the sidebar's toggle moves to the left corner when
 * the sidebar is closed so the button the pointer just clicked does not run away from it.
 */
export const AgentChrome = ({
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
}) => {
    const isMac = usePlatform() === "macos";
    const sidebarCloseCount = useSidebarCloseCount(sidebarOpen);

    return (
        <div className="relative z-30 flex h-titlebar shrink-0 items-stretch overflow-hidden bg-transparent" data-tauri-drag-region>
            <MacWindowControls controls={isMac ? windowControls : undefined} />
            {!sidebarOpen && onToggleSidebar ? (
                <SidebarPeekToggle
                    closeCount={sidebarCloseCount}
                    onToggle={onToggleSidebar}
                    onHoverStart={onSidebarHoverStart}
                    onHoverEnd={onSidebarHoverEnd}
                />
            ) : null}
            <div
                id={AGENT_TABS_SLOT}
                className="relative z-10 flex h-full min-w-0 flex-1 items-center overflow-hidden pl-2"
            />

            <ChromeActions
                rightOpen={rightOpen}
                onToggleRight={onToggleRight}
                canToggleRight={canToggleRight}
                showRightToggle={showRightToggle}
                padWindowControls={padWindowControls}
                isMac={isMac}
            />
        </div>
    );
};
