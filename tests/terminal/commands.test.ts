import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as mod from "@/features/terminal/commands";

function customEvents(name: string) {
    const events: CustomEvent[] = [];
    const listener = (event: Event) => events.push(event as CustomEvent);
    window.addEventListener(name, listener);
    return {
        events,
        off: () => window.removeEventListener(name, listener),
    };
}

describe("terminal command queue", () => {
    beforeEach(() => {
        mod.resetTerminalCommandQueue();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("dispatches immediately while a terminal is mounted", () => {
        const shortcut = customEvents("bettershape-terminal-shortcut");
        const detach = mod.attachTerminalCommandHost();

        mod.requestTerminalCommand("split");
        expect(shortcut.events).toHaveLength(1);
        expect(shortcut.events[0]!.detail).toEqual({ action: "split" });

        detach();
        shortcut.off();
    });

    it("holds a command until the panel mounts", () => {
        mod.requestTerminalCommand("find");

        const shortcut = customEvents("bettershape-terminal-shortcut");
        const detach = mod.attachTerminalCommandHost();
        expect(shortcut.events).toHaveLength(1);
        expect(shortcut.events[0]!.detail).toEqual({ action: "find" });

        // Replaying happens once, not on every mount.
        detach();
        const second = mod.attachTerminalCommandHost();
        expect(shortcut.events).toHaveLength(1);
        second();
        shortcut.off();
    });

    it("drops a command the panel never picked up", () => {
        const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
        mod.requestTerminalCommand("new");
        now.mockReturnValue(1_000 + 10_000);

        const shortcut = customEvents("bettershape-terminal-shortcut");
        const detach = mod.attachTerminalCommandHost();
        expect(shortcut.events).toHaveLength(0);
        detach();
        shortcut.off();
    });

    it("does not open the panel for a close command", () => {
        const toggle = customEvents("bettershape-layout-toggle");
        const shortcut = customEvents("bettershape-terminal-shortcut");
        mod.requestTerminalCommand("close");
        expect(toggle.events).toHaveLength(0);
        // Still announced, so a mounted dock can act on it.
        expect(shortcut.events).toHaveLength(1);

        // And it is never replayed later.
        const detach = mod.attachTerminalCommandHost();
        expect(shortcut.events).toHaveLength(1);
        detach();
        toggle.off();
        shortcut.off();
    });

    it("stays mounted while any host remains", () => {
        const shortcut = customEvents("bettershape-terminal-shortcut");
        const first = mod.attachTerminalCommandHost();
        const second = mod.attachTerminalCommandHost();
        first();
        mod.requestTerminalCommand("clear");
        expect(shortcut.events).toHaveLength(1);
        second();
        shortcut.off();
    });

    it("opens the panel when a command is queued", () => {
        const toggle = customEvents("bettershape-layout-toggle");
        mod.requestTerminalCommand("new");
        expect(toggle.events).toHaveLength(1);
        expect(toggle.events[0]!.detail).toEqual({ id: "panel", value: true });
        toggle.off();
    });
});
