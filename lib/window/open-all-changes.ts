"use client";

import { requestWorkspaceTab } from "@/lib/window/workspace-intent";

/**
 * Session key that hands the file to focus over to the all-changes tab.
 * sessionStorage is per window, which matches the tab it belongs to.
 */
export const ALL_CHANGES_FOCUS_KEY = "bettershape-all-changes-focus";

/**
 * Event that moves an already-mounted all-changes view to a file.
 *
 * sessionStorage covers the case where the tab is not mounted yet; this event
 * covers the case where it is, which storage alone cannot signal.
 */
export const ALL_CHANGES_FOCUS_EVENT = "bettershape-all-changes-focus";

/**
 * Opens the all-changes workspace tab, optionally scrolled to one file.
 *
 * Kept in its own module because the view it opens pulls in the diff editor;
 * callers must not import that bundle to raise a tab.
 */
export function openAllChangesTab(focusPath?: string) {
    try {
        // A call without a path means "no file in particular": keeping the
        // previous one would scroll a later visit to a file nobody asked for.
        if (focusPath) sessionStorage.setItem(ALL_CHANGES_FOCUS_KEY, focusPath);
        else sessionStorage.removeItem(ALL_CHANGES_FOCUS_KEY);
    } catch {
        /* unavailable storage still opens the tab, just without focus */
    }
    // The view may already be mounted, in which case storage is not a signal.
    window.dispatchEvent(new CustomEvent(ALL_CHANGES_FOCUS_EVENT, { detail: focusPath }));
    window.dispatchEvent(
        new CustomEvent("bettershape-layout-toggle", { detail: { id: "agent-workspace", value: true } }),
    );
    requestWorkspaceTab("all-changes");
}
