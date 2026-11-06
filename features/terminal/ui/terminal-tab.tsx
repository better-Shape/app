"use client";

import { Dismiss20Regular } from "@fluentui/react-icons/headless/svg/dismiss";
import type { KeyboardEvent } from "react";
import { Icon } from "@/components/ui/icon";
import {
    WORKBENCH_TAB_CLOSE_BUTTON_CLASS,
    focusTabAfterClose,
    handleWorkbenchTabKey,
    workbenchTabClickCommand,
    workbenchTabItemClass,
    type WorkbenchTabCommand,
} from "@/features/editor/ui/tabs/workbench-tab-styles";
import { cn } from "@/lib/utils";

type TerminalStripTabProps = {
    title: string;
    active: boolean;
    unread: boolean;
    onActivate: () => void;
    onClose: () => void;
};

const TERMINAL_TAB_STATE = { closable: true, dragging: false } as const;

/**
 * One tab in a terminal strip. It is the only interactive element inside `role="tab"`, as a
 * workbench tab is: Enter or Space opens it, since the strip has no drag-and-drop to pick a tab
 * up with Space, and Delete or a click on the close glyph closes it.
 */
export const TerminalStripTab = ({ title, active, unread, onActivate, onClose }: TerminalStripTabProps) => {
    const runCommand = (command: WorkbenchTabCommand, tab: HTMLElement) => {
        if (command === "select") {
            onActivate();
            return;
        }
        focusTabAfterClose(tab);
        onClose();
    };
    const activateOnSpace = (event: KeyboardEvent<HTMLElement>) => {
        if (event.key !== " ") return;
        event.preventDefault();
        onActivate();
    };

    return (
        <div
            role="tab"
            aria-selected={active}
            aria-keyshortcuts="Delete"
            tabIndex={0}
            onClick={(event) => runCommand(workbenchTabClickCommand(event.target, true), event.currentTarget)}
            onKeyDown={(event) => handleWorkbenchTabKey(event, TERMINAL_TAB_STATE, runCommand, activateOnSpace)}
            className={workbenchTabItemClass(active)}
        >
            <span className="max-w-[160px] truncate text-sm">{title}</span>
            {unread ? <span className="sr-only">New output</span> : null}
            {/* One 16px slot, two occupants: the unread dot hands it to the close glyph under the
                pointer or keyboard focus, at the same beat the file tabs use, so no state change
                shifts the title. */}
            <div className="relative flex h-4 w-4 shrink-0 items-center justify-center">
                <span className="t-tab-dot absolute" data-on={unread ? "true" : "false"} aria-hidden />
                <span
                    data-tab-close
                    aria-hidden="true"
                    className={cn(
                        WORKBENCH_TAB_CLOSE_BUTTON_CLASS,
                        "absolute transition-opacity duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]",
                        active
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
                    )}
                >
                    <Icon icon={Dismiss20Regular} />
                </span>
            </div>
        </div>
    );
};
