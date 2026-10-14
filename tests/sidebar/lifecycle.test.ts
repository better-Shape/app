import { describe, expect, it, vi } from "vitest";
import {
    buildChatLifecycleActions,
    type ChatLifecycleHandlers,
    type ChatLifecycleTarget,
} from "@/features/agent/sidebar/lifecycle";

function handlers(overrides: Partial<ChatLifecycleHandlers> = {}): ChatLifecycleHandlers {
    return {
        open: vi.fn(),
        setPinned: vi.fn(),
        startRename: vi.fn(),
        markUnread: vi.fn(),
        copyTitle: vi.fn(),
        revealFolder: vi.fn(),
        archive: vi.fn(),
        remove: vi.fn(),
        addToCollection: vi.fn(),
        ...overrides,
    };
}

function target(overrides: Partial<ChatLifecycleTarget> = {}): ChatLifecycleTarget {
    return { id: "chat-1", title: "Refactor auth", path: "/repo/bettershape", pinned: false, ...overrides };
}

function labels(actions: { label: string }[]): string[] {
    return actions.map((action) => action.label);
}

describe("shared chat lifecycle menu", () => {
    it("offers nothing for an empty selection", () => {
        expect(buildChatLifecycleActions([], handlers())).toEqual([]);
    });

    it("builds the full list for one unpinned chat", () => {
        const actions = buildChatLifecycleActions([target()], handlers());
        expect(labels(actions)).toEqual([
            "Open",
            "Pin",
            "Rename",
            "Mark unread",
            "Copy Title",
            "Reveal Folder",
            "Archive",
            "Delete",
        ]);
        expect(actions.find((action) => action.key === "delete")?.danger).toBe(true);
        expect(actions.find((action) => action.key === "copy")?.sep).toBe(true);
    });

    it("swaps Pin for Unpin and inverts the handler when the chat is already pinned", () => {
        const spy = handlers();
        const actions = buildChatLifecycleActions([target({ pinned: true })], spy);

        expect(labels(actions)).toContain("Unpin");
        expect(labels(actions)).not.toContain("Pin");

        actions.find((action) => action.key === "pin")?.run();
        expect(spy.setPinned).toHaveBeenCalledWith(["chat-1"], false);
    });

    it("hands each action the target it needs", () => {
        const spy = handlers();
        const actions = buildChatLifecycleActions([target()], spy);
        const run = (key: string) => actions.find((action) => action.key === key)?.run();

        run("open");
        run("rename");
        run("unread");
        run("copy");
        run("reveal");
        run("archive");
        run("delete");

        expect(spy.open).toHaveBeenCalledWith("chat-1");
        expect(spy.startRename).toHaveBeenCalledWith("chat-1");
        expect(spy.markUnread).toHaveBeenCalledWith("chat-1");
        expect(spy.copyTitle).toHaveBeenCalledWith("Refactor auth");
        expect(spy.revealFolder).toHaveBeenCalledWith("/repo/bettershape");
        expect(spy.archive).toHaveBeenCalledWith(["chat-1"]);
        expect(spy.remove).toHaveBeenCalledWith(["chat-1"]);
    });

    it("drops Reveal Folder for a chat with no folder", () => {
        const actions = buildChatLifecycleActions([target({ path: "" })], handlers());
        expect(labels(actions)).not.toContain("Reveal Folder");
    });

    it("drops Rename when no surface can start one", () => {
        const spy = handlers();
        delete (spy as Partial<ChatLifecycleHandlers>).startRename;
        const actions = buildChatLifecycleActions([target()], spy);
        expect(labels(actions)).toContain("Open");
        expect(labels(actions)).not.toContain("Rename");
    });

    it("drops every single-chat action for a multi-selection and counts the rest", () => {
        const spy = handlers();
        const actions = buildChatLifecycleActions(
            [target({ id: "a" }), target({ id: "b" }), target({ id: "c" })],
            spy,
        );

        expect(labels(actions)).toEqual(["Pin 3 sessions", "Archive 3 sessions", "Delete 3 sessions"]);

        actions.find((action) => action.key === "pin")?.run();
        actions.find((action) => action.key === "archive")?.run();
        actions.find((action) => action.key === "delete")?.run();
        expect(spy.setPinned).toHaveBeenCalledWith(["a", "b", "c"], true);
        expect(spy.archive).toHaveBeenCalledWith(["a", "b", "c"]);
        expect(spy.remove).toHaveBeenCalledWith(["a", "b", "c"]);
    });

    it("offers no pin action at all when the selection disagrees", () => {
        const mixed = buildChatLifecycleActions(
            [target({ id: "a", pinned: true }), target({ id: "b", pinned: false })],
            handlers(),
        );
        expect(labels(mixed)).toEqual(["Archive 2 sessions", "Delete 2 sessions"]);

        const allPinned = buildChatLifecycleActions(
            [target({ id: "a", pinned: true }), target({ id: "b", pinned: true })],
            handlers(),
        );
        expect(labels(allPinned)).toEqual([
            "Unpin 2 sessions",
            "Archive 2 sessions",
            "Delete 2 sessions",
        ]);
    });
});