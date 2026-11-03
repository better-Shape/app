"use client";

/**
 * Tab and surface requests that arrive before their surface has mounted.
 *
 * The workspace unmounts when its panel is closed, and the design studio only
 * mounts while the Design tab is active. A command that opens the workspace and
 * asks for a tab in the same tick would otherwise be heard by nobody, and the
 * workspace would come back on whichever tab it showed last.
 */

let requestedTab: string | null = null;
const queuedIntents = new Set<string>();

/** Asks the workspace to open `tabId`, remembering the request until it lands. */
export function requestWorkspaceTab(tabId: string): void {
    requestedTab = tabId;
    window.dispatchEvent(new CustomEvent("bettershape-set-active-tab", { detail: tabId }));
}

/** Returns and clears the request the workspace has not handled yet. */
export function takeRequestedWorkspaceTab(): string | null {
    const tab = requestedTab;
    requestedTab = null;
    return tab;
}

/** Queues a one-shot intent for a surface that may not be mounted yet. */
export function queueSurfaceIntent(name: string): void {
    queuedIntents.add(name);
}

/** Consumes a queued intent, so it is applied at most once. */
export function takeSurfaceIntent(name: string): boolean {
    return queuedIntents.delete(name);
}
