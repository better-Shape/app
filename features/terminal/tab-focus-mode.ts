"use client";

import { useSyncExternalStore } from "react";
import { eventToKeyChord, getShortcutForLabel, onKeybindingsChanged } from "@/lib/ui/shortcuts";

/** The keybinding label of the switch, as VS Code names its command. */
export const TAB_FOCUS_TOGGLE_LABEL = "Toggle Tab Key Moves Focus";

/**
 * Whether Tab moves focus out of a terminal instead of reaching the shell. One switch for every
 * terminal in the window, kept for the session, as VS Code's is.
 */
let tabMovesFocus = false;
const listeners = new Set<() => void>();

export const isTabMovingFocus = (): boolean => tabMovesFocus;

export const toggleTabMovesFocus = (): void => {
    tabMovesFocus = !tabMovesFocus;
    for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

/** The switch's state, for the terminal's indicator and description. */
export const useTabMovesFocus = (): boolean => useSyncExternalStore(subscribe, isTabMovingFocus, () => false);

let toggleChord: string | undefined;
let followsKeybindings = false;

/** The switch's chord, read once and again whenever the keybindings change. */
export const tabFocusToggleChord = (): string | undefined => {
    if (!followsKeybindings && typeof window !== "undefined") {
        followsKeybindings = true;
        toggleChord = getShortcutForLabel(TAB_FOCUS_TOGGLE_LABEL);
        onKeybindingsChanged(() => {
            toggleChord = getShortcutForLabel(TAB_FOCUS_TOGGLE_LABEL);
        });
    }
    return toggleChord;
};

/** Bare Ctrl or Cmd plus J, which shows and hides the terminal dock. */
const isDockToggle = (event: KeyboardEvent): boolean =>
    (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "j";

/** Tab or Shift+Tab with no other modifier. */
const isFocusTab = (event: KeyboardEvent): boolean =>
    event.key === "Tab" && !event.ctrlKey && !event.altKey && !event.metaKey;

/**
 * xterm's custom key handler. Returning false keeps a key from the shell, so the app acts on it:
 * the switch's own chord, which the window's shortcut handler has already run, Ctrl+J, and Tab
 * while the switch is on, which the browser then uses to move focus.
 */
export const terminalKeepsKey = (event: KeyboardEvent): boolean => {
    const chord = tabFocusToggleChord();
    if (chord && eventToKeyChord(event) === chord) return false;
    if (isDockToggle(event)) return false;
    return !(tabMovesFocus && isFocusTab(event));
};
