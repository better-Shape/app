import type { KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export const WORKBENCH_TAB_HEIGHT = 36;

export const WORKBENCH_TAB_BAR_CLASS =
    "workbench-tab-bar relative box-border flex h-[36px] shrink-0 w-full items-center gap-1 bg-panel-hover px-2";

export const WORKBENCH_TAB_SCROLL_CLASS =
    "workbench-tab-scroll flex h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden no-scrollbar";

/** Fills unused width in the tab row */
export const WORKBENCH_TAB_TRAIL_CLASS =
    "min-w-[8px] flex-1 self-stretch";

export const WORKBENCH_TAB_ROW_CLASS =
    "flex h-full min-w-full w-max items-center gap-1";

export const WORKBENCH_TAB_LIST_CLASS = "flex h-full w-max shrink-0 items-center gap-1";

export const WORKBENCH_TAB_FADE_CLASS =
    "pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-linear-to-r from-transparent to-panel-hover";

export const WORKBENCH_TAB_ACTIONS_CLASS =
    "box-border flex h-full shrink-0 items-center gap-0.5 px-1";

export function workbenchTabItemClass(active: boolean, dragging?: boolean, compact?: boolean) {
    return cn(
        "workbench-tab-item group relative box-border flex h-7 shrink-0 cursor-pointer select-none items-center overflow-hidden whitespace-nowrap squircle-lg font-normal press-spring",
        compact ? "gap-1 px-1.5" : "gap-2 px-2.5",
        active
            ? "is-active min-w-[60px] bg-white/10 text-text-primary"
            : "text-text-muted hover:bg-[var(--row-hover)] hover:text-text-secondary",
        // `scale` is its own property, so the lift composes with the transform dnd-kit
        // writes inline on the dragged tab instead of replacing it.
        dragging && "opacity-40 [scale:1.02] shadow-lg",
    );
}

export const WORKBENCH_TAB_CLOSE_BUTTON_CLASS =
    "flex h-4 w-4 items-center justify-center text-text-muted hover:text-text-primary";

export const WORKBENCH_TAB_CONTENT_CLASS =
    "workbench-tab-content relative z-[1] flex h-full min-w-0 items-center gap-1.5";

export const WORKBENCH_TAB_CONTENT_ACTIVE_CLASS = "workbench-tab-content is-active";

export const WORKBENCH_TAB_ACTION_BUTTON_CLASS =
    "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-[var(--row-hover)] hover:text-text-primary";

/**
 * The close glyph inside a workbench tab is decoration the tab itself acts on: a focusable
 * button nested in `role="tab"` is invalid (nested interactive control), so the tab closes on
 * Delete, on a click that lands on the glyph, and from its context menu.
 */
export const isWorkbenchTabCloseTarget = (target: EventTarget | null): boolean =>
    target instanceof Element && target.closest("[data-tab-close]") !== null;

export type WorkbenchTabCommand = "select" | "close";

/**
 * Keys a focused workbench tab handles itself, after the WAI-ARIA tabs pattern: Enter opens it
 * and Delete closes it. Every other key belongs to drag-and-drop reordering, which picks a tab
 * up with Space and moves it with the arrows.
 */
const WORKBENCH_TAB_KEYS: ReadonlyMap<string, WorkbenchTabCommand> = new Map([
    ["Enter", "select"],
    ["Delete", "close"],
]);

/** The command a key press on a focused tab requests: none mid-drag, Delete only when closable. */
export const workbenchTabKeyCommand = (
    key: string,
    state: { closable: boolean; dragging: boolean },
): WorkbenchTabCommand | undefined => {
    const command = state.dragging ? undefined : WORKBENCH_TAB_KEYS.get(key);
    return command === "close" && !state.closable ? undefined : command;
};

/** The command a click on a tab requests: close when it lands on a closable tab's glyph. */
export const workbenchTabClickCommand = (
    target: EventTarget | null,
    closable: boolean,
): WorkbenchTabCommand => (closable && isWorkbenchTabCloseTarget(target) ? "close" : "select");

/**
 * A key press on a focused tab: the tab's own command runs first, so drag-and-drop never takes
 * Enter or Delete, and every other key goes on to reordering through `forward`.
 */
export const handleWorkbenchTabKey = (
    event: KeyboardEvent<HTMLElement>,
    state: { closable: boolean; dragging: boolean },
    run: (command: WorkbenchTabCommand, tab: HTMLElement) => void,
    forward?: (event: KeyboardEvent<HTMLElement>) => void,
): void => {
    if (event.target !== event.currentTarget) return;
    const command = workbenchTabKeyCommand(event.key, state);
    if (!command) {
        forward?.(event);
        return;
    }
    event.preventDefault();
    run(command, event.currentTarget);
};

/**
 * Before a focused tab closes, moves focus to the tab after it, or to the one before it when it
 * is last, as the WAI-ARIA tabs pattern describes for Delete. Otherwise focus would fall to the
 * document body with the removed tab. Does nothing when focus is not on the tab.
 */
export const focusTabAfterClose = (tab: HTMLElement): void => {
    if (!tab.contains(document.activeElement)) return;
    const strip = tab.closest('[role="tablist"]');
    const tabs = strip ? Array.from(strip.querySelectorAll<HTMLElement>('[role="tab"]')) : [];
    const index = tabs.indexOf(tab);
    (tabs[index + 1] ?? tabs[index - 1])?.focus();
};
