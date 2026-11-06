"use client";

import { Dismiss20Regular } from "@fluentui/react-icons/headless/svg/dismiss";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { Icon } from "@/components/ui/icon";
import {
    WORKBENCH_TAB_CLOSE_BUTTON_CLASS,
    WORKBENCH_TAB_CLOSE_KEYS,
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
    /** Whether this tab is its strip's stop in the Tab order; see `isTabStop`. */
    tabStop: boolean;
    unread: boolean;
    onActivate: () => void;
    /** `keepFocus` is true when the tab had focus, which then stays on the strip. */
    onClose: (keepFocus: boolean) => void;
};

const TERMINAL_TAB_STATE = { closable: true, dragging: false } as const;

/** The other pane's tab strip in a split terminal, or nothing when the terminal is not split. */
const otherPaneStrip = (tab: HTMLElement): Element | undefined => {
    const strip = tab.closest('[role="tablist"]');
    const root = tab.closest("[data-terminal-root]");
    return root ? Array.from(root.querySelectorAll('[role="tablist"]')).find((candidate) => candidate !== strip) : undefined;
};

/** The tab a strip hands focus to: its selected tab, else its first. */
const preferredTab = (strip: Element): HTMLElement | null =>
    strip.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? strip.querySelector<HTMLElement>('[role="tab"]');

/**
 * When the closing tab was the last one in its pane of a split terminal, hands focus to the other
 * pane's selected tab, so it does not fall to the page with the closed pane.
 */
const focusOtherPaneTab = (tab: HTMLElement) => {
    if (!tab.contains(document.activeElement)) return;
    const other = otherPaneStrip(tab);
    if (other) preferredTab(other)?.focus();
};

/**
 * One tab in a terminal strip. It is the only interactive element inside `role="tab"`, as a
 * workbench tab is: Enter or Space opens it, since the strip has no drag-and-drop to pick a tab
 * up with Space, and Delete or a click on the close glyph closes it.
 */
export const TerminalStripTab = ({ title, active, tabStop, unread, onActivate, onClose }: TerminalStripTabProps) => {
    const tabRef = useRef<HTMLDivElement>(null);
    // A new terminal opens active at the end of the strip, which may be past its visible edge.
    useEffect(() => {
        if (active) tabRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, [active]);
    const runCommand = (command: WorkbenchTabCommand, tab: HTMLElement) => {
        if (command === "select") {
            onActivate();
            return;
        }
        const hadFocus = tab.contains(document.activeElement);
        focusTabAfterClose(tab);
        focusOtherPaneTab(tab);
        onClose(hadFocus);
    };
    const activateOnSpace = (event: KeyboardEvent<HTMLElement>) => {
        if (event.key !== " ") return;
        event.preventDefault();
        onActivate();
    };

    return (
        <div
            ref={tabRef}
            role="tab"
            aria-selected={active}
            aria-keyshortcuts={WORKBENCH_TAB_CLOSE_KEYS}
            tabIndex={tabStop ? 0 : -1}
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
