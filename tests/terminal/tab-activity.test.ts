import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    lookupByProjectPath,
    projectPathKey,
    sameProjectPath,
    terminalSessionStore,
    type TerminalTab,
} from "@/features/terminal/session";

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
    terminalSessionStore.instances.clear();
    // Most cases below assume the panel is open on the project under test. The cases
    // about what happens while it is closed set this themselves.
    terminalSessionStore.panel = { visible: true, cwd: "/repo" };
});

describe("terminal tab activity", () => {
    it("marks the active tab when the panel is closed", () => {
        terminalSessionStore.setTabs(() => [tab("a", 1)]);
        terminalSessionStore.setActive("/repo", "a");
        terminalSessionStore.setPanel({ visible: false, cwd: "/repo" });

        terminalSessionStore.noteOutput(1);
        expect([...terminalSessionStore.unreadTabs]).toEqual(["a"]);
    });

    it("marks the active tab of a project that is not on screen", () => {
        terminalSessionStore.setTabs(() => [tab("a", 1), tab("b", 2)]);
        terminalSessionStore.setActive("/other", "b");
        terminalSessionStore.setActive("/repo", "a");

        terminalSessionStore.noteOutput(2);
        expect([...terminalSessionStore.unreadTabs]).toEqual(["b"]);
    });

    it("marks a shell tab through the pty its instance holds", () => {
        // A shell tab is created with no bound pty; the instance is what remembers it.
        terminalSessionStore.setTabs(() => [tab("shell")]);
        terminalSessionStore.setActive("/repo", "shell");
        terminalSessionStore.instances.set("shell", {
            term: null,
            fitAddon: null,
            ptyId: 7,
            unlistenOutput: () => {},
        });
        // Shell tabs are always active in their own group in this case, so the dot has to
        // come from the panel being closed; what this asserts is that the pty was matched
        // at all, which the boundPtyId-only lookup could not do.
        terminalSessionStore.setPanel({ visible: false, cwd: "/repo" });

        terminalSessionStore.noteOutput(7);
        expect([...terminalSessionStore.unreadTabs]).toEqual(["shell"]);
    });

    it("ignores output on an instance whose tab is being read", () => {
        terminalSessionStore.setTabs(() => [tab("shell")]);
        terminalSessionStore.setActive("/repo", "shell");
        terminalSessionStore.instances.set("shell", {
            term: null,
            fitAddon: null,
            ptyId: 7,
            unlistenOutput: () => {},
        });

        terminalSessionStore.noteOutput(7);
        expect(terminalSessionStore.unreadTabs.size).toBe(0);
    });

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

    it("clears newly visible tabs when the closed dock reopens while keeping background tabs unread", () => {
        terminalSessionStore.setTabs(() => [tab("a", 1), tab("b", 2)]);
        terminalSessionStore.setActive("/repo", "a");
        terminalSessionStore.setPanel({ visible: false, cwd: "/repo" });

        terminalSessionStore.noteOutput(1);
        terminalSessionStore.noteOutput(2);
        expect(terminalSessionStore.hasUnreadForProject("/repo")).toBe(true);
        expect(terminalSessionStore.hasUnreadForProject("/repo/")).toBe(true);
        expect(terminalSessionStore.hasUnreadForProject("/other")).toBe(false);

        terminalSessionStore.setPanel({ visible: true, cwd: "/repo" });
        expect(terminalSessionStore.unreadTabs.has("a")).toBe(false);
        expect(terminalSessionStore.unreadTabs.has("b")).toBe(true);
        expect(terminalSessionStore.hasUnreadForProject("/repo")).toBe(true);

        terminalSessionStore.setActive("/repo", "b");
        expect(terminalSessionStore.hasUnreadForProject("/repo")).toBe(false);
    });

    it("matches Windows project paths case-insensitively while keeping POSIX paths case-sensitive", () => {
        terminalSessionStore.setTabs(() => [
            { ...tab("win", 11), cwd: "C:\\Users\\Ada\\Repo" },
            { ...tab("posix", 12), cwd: "/home/ada/Repo" },
        ]);
        terminalSessionStore.setActive("C:\\Users\\Ada\\Repo", "win");
        terminalSessionStore.setPanel({ visible: false, cwd: "c:\\users\\ada\\repo" });

        terminalSessionStore.noteOutput(11);
        terminalSessionStore.noteOutput(12);

        expect(terminalSessionStore.hasUnreadForProject("c:\\users\\ada\\repo\\")).toBe(true);
        expect(terminalSessionStore.hasUnreadForProject("/home/ada/Repo")).toBe(true);
        expect(terminalSessionStore.hasUnreadForProject("/home/ada/repo")).toBe(false);

        terminalSessionStore.setPanel({ visible: true, cwd: "c:/users/ada/repo" });
        expect(terminalSessionStore.unreadTabs.has("win")).toBe(false);
        expect(sameProjectPath("C:\\Users\\Ada\\Repo", "c:/users/ada/repo/")).toBe(true);
        expect(sameProjectPath("/home/ada/Repo", "/home/ada/repo")).toBe(false);
        // POSIX double-leading-slash paths stay case-sensitive outside Windows.
        expect(sameProjectPath("//Work/App", "//work/app")).toBe(false);

        terminalSessionStore.setActive("c:/users/ada/repo", "win-next");
        expect(lookupByProjectPath(terminalSessionStore.activeProjectTabs, "C:\\Users\\Ada\\Repo")).toBe("win-next");

        // Windows drive roots stay distinct from bare drive-relative specifiers, and POSIX literal backslashes stay intact.
        expect(projectPathKey("C:\\")).toBe("c:/");
        expect(projectPathKey("C:")).toBe("c:");
        expect(sameProjectPath("C:\\", "C:")).toBe(false);
        expect(sameProjectPath("C:\\Users\\\\Ada\\Repo\\", "c:/users/ada/repo")).toBe(true);
        expect(sameProjectPath("/home/Ada/my\\repo", "/home/ada/my\\repo")).toBe(false);
        expect(sameProjectPath("/home/Ada//my\\repo/", "/home/Ada/my\\repo")).toBe(true);
    });
});
