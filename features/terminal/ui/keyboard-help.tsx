"use client";

import { useState } from "react";
import { tabFocusToggleChord, useTabMovesFocus } from "@/features/terminal/tab-focus-mode";

/**
 * What Tab does in a terminal and how to leave it. WCAG 2.1.2 allows a key other than Tab to
 * leave a component only when the user is told which one, so the terminal input points here.
 */
export const terminalKeyboardDescription = (tabMovesFocus: boolean, toggleChord: string | undefined): string => {
    if (tabMovesFocus) {
        return toggleChord
            ? `Tab moves focus out of the terminal. Press ${toggleChord} to send Tab to the shell again.`
            : "Tab moves focus out of the terminal.";
    }
    return toggleChord
        ? `Tab goes to the shell. Press ${toggleChord} so Tab moves focus, or Ctrl+J to hide the terminal.`
        : "Tab goes to the shell. Press Ctrl+J to hide the terminal.";
};

/**
 * The hidden description each terminal input points to through `aria-describedby`, and a status
 * line that announces the switch when it changes, not when the terminal opens.
 */
export function TerminalKeyboardHelp({ id }: { id: string }) {
    const tabMovesFocus = useTabMovesFocus();
    const [seen, setSeen] = useState(tabMovesFocus);
    const [announcement, setAnnouncement] = useState("");
    if (seen !== tabMovesFocus) {
        setSeen(tabMovesFocus);
        setAnnouncement(tabMovesFocus ? "Tab moves focus" : "Tab goes to the terminal");
    }
    return (
        <>
            <p id={id} hidden>
                {terminalKeyboardDescription(tabMovesFocus, tabFocusToggleChord())}
            </p>
            <p role="status" className="sr-only">
                {announcement}
            </p>
        </>
    );
}

/** Shown in the terminal strip while Tab moves focus, as VS Code shows it in its status bar. */
export function TabFocusBadge() {
    const tabMovesFocus = useTabMovesFocus();
    if (!tabMovesFocus) return null;
    return <span className="shrink-0 whitespace-nowrap px-1.5 text-xs text-text-secondary">Tab moves focus</span>;
}
