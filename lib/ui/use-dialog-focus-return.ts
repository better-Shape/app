"use client";

import { useLayoutEffect } from "react";

/** Enough entries to step back past a closed menu, a closed dialog and the rows inside them. */
const HISTORY_LIMIT = 16;

/** Elements that have held focus, most recent last. */
const focusHistory: HTMLElement[] = [];

/** Dialog hosts that are mounted; the focus listener runs while there is at least one. */
const mountedHosts = new Set<symbol>();

/** Moves `element` to the end of the history and drops elements that left the page. */
const remember = (element: HTMLElement) => {
    const kept = focusHistory.filter((entry) => entry !== element && entry.isConnected);
    kept.push(element);
    focusHistory.splice(0, focusHistory.length, ...kept.slice(-HISTORY_LIMIT));
};

/** Records each element that receives focus. */
const recordFocus = (event: FocusEvent) => {
    if (event.target instanceof HTMLElement) remember(event.target);
};

/**
 * Starts the document-wide focus listener for one dialog host and remembers what has focus now.
 * Adding the same listener again is a no-op, and the last host to unmount removes it.
 */
const trackFocus = () => {
    const host = Symbol("dialog host");
    mountedHosts.add(host);
    document.addEventListener("focusin", recordFocus, true);
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) remember(active);
    return () => {
        mountedHosts.delete(host);
        if (mountedHosts.size === 0) document.removeEventListener("focusin", recordFocus, true);
    };
};

/**
 * Focuses the most recent remembered element that is still on the page and accepts focus. When
 * the dialog's action has already moved focus, that element is the most recent, so it keeps it.
 */
const returnFocus = (event: Event) => {
    event.preventDefault();
    const candidates = focusHistory.filter((element) => element.isConnected).reverse();
    for (const candidate of candidates) {
        candidate.focus({ preventScroll: true });
        if (document.activeElement === candidate) return;
    }
};

/**
 * The `onCloseAutoFocus` handler for a Radix dialog that opens without a `Dialog.Trigger`, from
 * a shortcut, a menu item or an event.
 *
 * Radix returns focus to the dialog's trigger. With no trigger, focus fell to the page body and
 * the next Tab started from the end of the window. This handler focuses the most recent element
 * that still exists: the control that opened the dialog, or the menu button when the menu item
 * that opened it has gone, or wherever the dialog's action sent focus. The listener starts in a
 * layout effect, before the dialog's own effects move focus inside it.
 */
export const useDialogFocusReturn = () => {
    useLayoutEffect(trackFocus, []);
    return returnFocus;
};
