import { beforeEach, describe, expect, it, vi } from "vitest";
import { terminalSessionStore, type TerminalTab } from "@/features/terminal/session";

/**
 * The terminal strip's unread dot. The store sits on the pty output path, so the
 * contract has two halves: which tab earns a dot, and how often the subscription is
 * woken. A hot path that notifies per chunk would re-render the terminal on every
 * line a build prints.
 */

const tab = (id: string, ptyId?: number, group: "left" | "right" = "left"): TerminalTab => ({
    id,
    title: id,
    shell: "pwsh",
    cwd: "/repo",
    boundPtyId: ptyId,
    group,
});

beforeEach(() => {
    // setTabs prunes unread ids that no longer exist, so this empties both.
    terminalSessionStore.setTabs(() => []);
    terminalSessionStore.activeProjectTabs = {};
    terminalSessionStore.activeSecondaryTabs = {};
    terminalSessionStore.focusedGroup = {};
});

describe("terminal tab activity", () => {
    it("marks a background tab that produced output", () => {
        terminalSessionStore.setTabs(() => [tab("a", 1), tab("b", 2)]);
        terminalSessionStore.setActive("/repo", "a");

        terminalSessionStore.noteOutput(2);
        expect([...terminalSessionStore.unreadTabs]).toEqual(["b"]);
    });

    it("leaves the tab the user is reading alone", () => {
        terminalSessionStore.setTabs(() => [tab("a", 1)]);
        terminalSessionStore.setActive("/repo", "a");

        terminalSessionStore.noteOutput(1);
        expect(terminalSessionStore.unreadTabs.size).toBe(0);
    });

    it("treats both split panes as visible", () => {
        terminalSessionStore.setTabs(() => [tab("a", 1), tab("b", 2, "right")]);
        terminalSessionStore.setActive("/repo", "a");
        terminalSessionStore.setSecondaryActive("/repo", "b");

        terminalSessionStore.noteOutput(1);
        terminalSessionStore.noteOutput(2);
        expect(terminalSessionStore.unreadTabs.size).toBe(0);
    });

    it("clears the dot when its tab becomes active", () => {
        terminalSessionStore.setTabs(() => [tab("a", 1), tab("b", 2)]);
        terminalSessionStore.setActive("/repo", "a");
        terminalSessionStore.noteOutput(2);
        expect(terminalSessionStore.unreadTabs.has("b")).toBe(true);

        terminalSessionStore.setActive("/repo", "b");
        expect(terminalSessionStore.unreadTabs.has("b")).toBe(false);
    });

    it("wakes subscribers once per tab, not once per chunk", () => {
        terminalSessionStore.setTabs(() => [tab("a", 1), tab("b", 2)]);
        terminalSessionStore.setActive("/repo", "a");
        const listener = vi.fn();
        const unsubscribe = terminalSessionStore.subscribe(listener);

        for (let i = 0; i < 500; i++) terminalSessionStore.noteOutput(2);

        // One notification for the state change, none for the 499 chunks after it.
        expect(listener).toHaveBeenCalledTimes(1);
        unsubscribe();
    });

    it("ignores output from a pty that owns no tab", () => {
        terminalSessionStore.setTabs(() => [tab("a", 1)]);
        terminalSessionStore.noteOutput(99);
        expect(terminalSessionStore.unreadTabs.size).toBe(0);
    });

    it("drops the dot with the tab it belonged to", () => {
        terminalSessionStore.setTabs(() => [tab("a", 1), tab("b", 2)]);
        terminalSessionStore.setActive("/repo", "a");
        terminalSessionStore.noteOutput(2);
        expect(terminalSessionStore.unreadTabs.has("b")).toBe(true);

        terminalSessionStore.setTabs((tabs) => tabs.filter((t) => t.id !== "b"));
        expect(terminalSessionStore.unreadTabs.size).toBe(0);
    });

    it("does not resurrect a dot for a closed tab id", () => {
        terminalSessionStore.setTabs(() => [tab("a", 1), tab("b", 2)]);
        terminalSessionStore.setActive("/repo", "a");
        terminalSessionStore.noteOutput(2);
        terminalSessionStore.setTabs((tabs) => tabs.filter((t) => t.id !== "b"));

        // The pty keeps printing after its tab is gone.
        terminalSessionStore.noteOutput(2);
        expect(terminalSessionStore.unreadTabs.size).toBe(0);
    });
});
