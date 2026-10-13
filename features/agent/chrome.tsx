"use client";

import { PanelLeft20Filled } from "@fluentui/react-icons/headless/svg/panel-left";
import { PanelRight20Filled } from "@fluentui/react-icons/headless/svg/panel-right";

import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon";

import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { WindowControlsSpacer } from "@/features/agent/workbench/titlebar/ui/window-controls";

export const AGENT_TABS_SLOT = "bettershape-agent-tabs";
export const AGENT_CHROME_ACTIONS_SLOT = "bettershape-agent-chrome-actions";
export const AGENT_SIDEBAR_BACK_SLOT = "bettershape-agent-sidebar-back";
export const AGENT_SIDEBAR_HISTORY_SLOT = "bettershape-agent-sidebar-history";

function Btn({
    label,
    onClick,
    disabled,
    active,
    children,
}: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    active?: boolean;
    children: ReactNode;
}) {
    return (
        <Tooltip content={label}>
            <button
                type="button"
                aria-label={label}
                aria-pressed={active}
                disabled={disabled}
                onClick={onClick}
                className={cn(
                    "flex size-7 items-center justify-center rounded-md text-text-muted press-spring",
                    "hover:bg-panel-hover hover:text-text-primary",
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
}) {
    return (
        <div className="relative z-30 flex h-titlebar shrink-0 items-stretch overflow-hidden bg-transparent" data-tauri-drag-region>
            {!sidebarOpen && onToggleSidebar ? (
                <div
                    data-sidebar-peek-toggle=""
                    className="relative z-10 flex shrink-0 items-center pl-1"
                    data-no-drag
                    onMouseEnter={onSidebarHoverStart}
                    onMouseLeave={onSidebarHoverEnd}
                >
                    <SidebarToggleBtn open={false} onToggle={onToggleSidebar} />
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
                        onClick={onToggleRight}
                    >
                        <Icon icon={PanelRight20Filled} />
                    </Btn>
                ) : null}
                {padWindowControls ? <WindowControlsSpacer /> : null}
            </div>
        </div>
    );
}

export function SidebarToggleBtn({
    open,
    onToggle,
    collapsed,
}: {
    open: boolean;
    onToggle: () => void;
    collapsed?: boolean;
}) {
    return (
        <Tooltip content={open ? "Hide sidebar" : "Show sidebar"} side={collapsed ? "right" : "bottom"} delayDuration={80}>
            <button
                type="button"
                aria-label={open ? "Hide sidebar" : "Show sidebar"}
                onClick={onToggle}
                className={cn(
                    "flex items-center justify-center rounded-md text-text-muted hover:bg-panel-hover hover:text-text-primary",
                    collapsed ? "size-9" : "size-7",
                )}
            >
                <Icon icon={PanelLeft20Filled} />
            </button>
        </Tooltip>
    );
}
