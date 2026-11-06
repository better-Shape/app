"use client";

import type { KeyboardEvent, PointerEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
    WORKBENCH_TAB_CLOSE_KEYS,
    focusTabAfterClose,
    handleWorkbenchTabKey,
    isWorkbenchTabCloseTarget,
    workbenchTabClickCommand,
    type WorkbenchTabCommand,
} from "./workbench-tab-styles";

type SortableTabOptions = {
    id: string;
    selected: boolean;
    /** Whether this tab is its strip's stop in the Tab order; see `isTabStop`. */
    tabStop: boolean;
    closable: boolean;
    onSelect: () => void;
    onClose?: () => void;
};

/**
 * The props of a reorderable tab in a workbench strip, shared by the workspace and chat strips.
 * dnd-kit's attributes come first and the tab's own role, state and keys override them. Its
 * `aria-roledescription` of "sortable" is dropped, because a screen reader would say "sortable"
 * in place of "tab"; the strip's drag instructions describe reordering instead.
 */
export const useSortableTab = ({ id, selected, tabStop, closable, onSelect, onClose }: SortableTabOptions) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
    const runCommand = (command: WorkbenchTabCommand, tab: HTMLElement) => {
        if (command === "select") {
            onSelect();
            return;
        }
        focusTabAfterClose(tab);
        onClose?.();
    };
    const tabProps = {
        ...attributes,
        ...listeners,
        ref: setNodeRef,
        role: "tab",
        "aria-roledescription": undefined,
        "aria-selected": selected,
        "aria-keyshortcuts": closable ? WORKBENCH_TAB_CLOSE_KEYS : undefined,
        tabIndex: tabStop ? 0 : -1,
        style: {
            transform: transform ? CSS.Translate.toString({ x: transform.x, y: 0, scaleX: 1, scaleY: 1 }) : undefined,
            transition,
            zIndex: isDragging ? 20 : 1,
        },
        onPointerDown: (event: PointerEvent<HTMLElement>) => {
            // Pressing the close glyph must not start a drag.
            if (isWorkbenchTabCloseTarget(event.target)) return;
            listeners?.onPointerDown?.(event);
        },
        onClick: (event: React.MouseEvent<HTMLElement>) =>
            runCommand(workbenchTabClickCommand(event.target, closable), event.currentTarget),
        onKeyDown: (event: KeyboardEvent<HTMLElement>) =>
            handleWorkbenchTabKey(event, { closable, dragging: isDragging }, runCommand, (forwarded) =>
                listeners?.onKeyDown?.(forwarded),
            ),
    };
    return { tabProps, isDragging };
};
