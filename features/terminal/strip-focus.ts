"use client";

/** How long a hold waits for the activation it was made for. */
const HOLD_MS = 1000;

let hold: { tabId: string; until: number } | null = null;

/**
 * Asks the terminal `tabId`, when it becomes active next, to leave focus where it is. A tab closed
 * from its strip hands focus to the next tab, as the WAI-ARIA tabs pattern asks, and activating a
 * terminal would otherwise pull focus into it.
 */
export const holdStripFocusFor = (tabId: string): void => {
    hold = { tabId, until: Date.now() + HOLD_MS };
};

/** Whether activating `tabId` should leave focus alone. Reading the hold releases it. */
export const takeStripFocusHold = (tabId: string): boolean => {
    const held = hold !== null && hold.tabId === tabId && Date.now() <= hold.until;
    if (hold?.tabId === tabId) hold = null;
    return held;
};
