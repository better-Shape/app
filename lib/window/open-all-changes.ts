"use client";

/**
 * Session key that hands the file to focus over to the all-changes tab.
 * sessionStorage is per window, which matches the tab it belongs to.
 */
export const ALL_CHANGES_FOCUS_KEY = "bettershape-all-changes-focus";

/**
 * Opens the all-changes workspace tab, optionally scrolled to one file.
 *
 * Kept in its own module because the view it opens pulls in the diff editor;
 * callers must not import that bundle to raise a tab.
 */
export function openAllChangesTab(focusPath?: string) {
    if (focusPath) {
        try {
            sessionStorage.setItem(ALL_CHANGES_FOCUS_KEY, focusPath);
        } catch {
            /* unavailable storage still opens the tab, just without focus */
        }
    }
    window.dispatchEvent(new CustomEvent("bettershape-set-active-tab", { detail: "all-changes" }));
}
