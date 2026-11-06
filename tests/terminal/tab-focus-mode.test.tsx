import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetKeybindingOverrides, setKeybindingOverride } from "@/lib/ui/shortcuts";

type TabFocusMode = typeof import("@/features/terminal/tab-focus-mode");

const key = (init: KeyboardEventInit & { key: string }) => new KeyboardEvent("keydown", { bubbles: true, ...init });

/** A fresh module, so the switch starts off and the chord is read again. */
const freshMode = async (): Promise<TabFocusMode> => {
    vi.resetModules();
    return import("@/features/terminal/tab-focus-mode");
};

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    resetKeybindingOverrides();
    localStorage.clear();
});

describe("keys the terminal leaves to the app", () => {
    it("keeps Tab for the shell until Ctrl+M turns the switch on", async () => {
        const mode = await freshMode();
        expect(mode.terminalKeepsKey(key({ key: "Tab" }))).toBe(true);
        expect(mode.terminalKeepsKey(key({ key: "Tab", shiftKey: true }))).toBe(true);
        // The switch's chord never reaches the shell, where Ctrl+M is a carriage return.
        expect(mode.terminalKeepsKey(key({ key: "m", ctrlKey: true }))).toBe(false);

        mode.toggleTabMovesFocus();

        expect(mode.isTabMovingFocus()).toBe(true);
        expect(mode.terminalKeepsKey(key({ key: "Tab" }))).toBe(false);
        expect(mode.terminalKeepsKey(key({ key: "Tab", shiftKey: true }))).toBe(false);
        // Tab with another modifier is a shortcut, not focus movement.
        expect(mode.terminalKeepsKey(key({ key: "Tab", ctrlKey: true }))).toBe(true);
        expect(mode.terminalKeepsKey(key({ key: "Tab", altKey: true }))).toBe(true);
        expect(mode.terminalKeepsKey(key({ key: "a" }))).toBe(true);
    });

    it("lets Ctrl+J and Cmd+J through to the dock, and nothing else with J", async () => {
        const mode = await freshMode();
        expect(mode.terminalKeepsKey(key({ key: "j", ctrlKey: true }))).toBe(false);
        expect(mode.terminalKeepsKey(key({ key: "j", metaKey: true }))).toBe(false);
        expect(mode.terminalKeepsKey(key({ key: "J", ctrlKey: true, shiftKey: true }))).toBe(true);
        expect(mode.terminalKeepsKey(key({ key: "j" }))).toBe(true);
    });

    it("follows a rebinding of the switch", async () => {
        const mode = await freshMode();
        expect(mode.tabFocusToggleChord()).toBe("Ctrl+M");

        setKeybindingOverride(mode.TAB_FOCUS_TOGGLE_LABEL, "Ctrl+Alt+T");

        expect(mode.tabFocusToggleChord()).toBe("Ctrl+Alt+T");
        expect(mode.terminalKeepsKey(key({ key: "m", ctrlKey: true }))).toBe(true);
        expect(mode.terminalKeepsKey(key({ key: "t", ctrlKey: true, altKey: true }))).toBe(false);
    });

    it("turns the switch from the keybinding's action", async () => {
        const mode = await freshMode();
        const { dispatchShortcutAction } = await import("@/lib/ui/shortcut-actions");

        expect(dispatchShortcutAction(mode.TAB_FOCUS_TOGGLE_LABEL, "Ctrl+M")).toBe(true);
        expect(mode.isTabMovingFocus()).toBe(true);
        dispatchShortcutAction(mode.TAB_FOCUS_TOGGLE_LABEL, "Ctrl+M");
        expect(mode.isTabMovingFocus()).toBe(false);
    });
});

describe("terminal keyboard help", () => {
    let host: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        host = document.createElement("div");
        document.body.append(host);
        root = createRoot(host);
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
    });

    it("tells the terminal input how to leave, and announces the switch only when it changes", async () => {
        const mode = await freshMode();
        const { TabFocusBadge, TerminalKeyboardHelp } = await import("@/features/terminal/ui/keyboard-help");
        act(() =>
            root.render(
                <>
                    <TerminalKeyboardHelp id="terminal-help" />
                    <TabFocusBadge />
                </>,
            ),
        );
        const description = () => host.querySelector("#terminal-help")?.textContent;
        const status = () => host.querySelector('[role="status"]')?.textContent;

        expect(description()).toBe("Tab goes to the shell. Press Ctrl+M so Tab moves focus, or Ctrl+J to hide the terminal.");
        expect(status()).toBe("");
        expect(host.querySelector("span")).toBeNull();

        act(() => mode.toggleTabMovesFocus());

        expect(description()).toBe("Tab moves focus out of the terminal. Press Ctrl+M to send Tab to the shell again.");
        expect(status()).toBe("Tab moves focus");
        expect(host.querySelector("span")?.textContent).toBe("Tab moves focus");

        act(() => mode.toggleTabMovesFocus());

        expect(status()).toBe("Tab goes to the terminal");
        expect(host.querySelector("span")).toBeNull();
    });

    it("leaves the switch out of the description when it has no chord", async () => {
        const { terminalKeyboardDescription } = await import("@/features/terminal/ui/keyboard-help");
        expect(terminalKeyboardDescription(false, undefined)).toBe("Tab goes to the shell. Press Ctrl+J to hide the terminal.");
        expect(terminalKeyboardDescription(true, undefined)).toBe("Tab moves focus out of the terminal.");
    });
});
