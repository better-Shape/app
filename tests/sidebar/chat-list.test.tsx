import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation } from "@/lib/backend/types";
import { getPinnedChatIds, setChatPinned } from "@/lib/sidebar/chat-list-meta";
import { resetChatUndoForTests } from "@/features/agent/sidebar/undo";
import {
    installAnimationStub,
    stubReducedMotion,
    type AnimationStub,
} from "../sidebar-motion/harness";

/**
 * jsdom has no layout, so `getBoundingClientRect` is answered from the DOM
 * itself: a row's box is its position in the shelf stack, stacked by the height
 * its variant declares. That is a real layout — pinning a chat genuinely moves
 * every other row — which is what makes the FLIP assertions below mean
 * something rather than being a statement that nothing happened.
 */

const CONVERSATIONS: Conversation[] = [
    { id: "a", title: "Alpha", history: [], project_path: "/repo/app", timestamp: 300 },
    { id: "b", title: "Bravo", history: [], project_path: "/repo/app", timestamp: 100 },
    { id: "c", title: "Charlie", history: [], project_path: "/repo/app", timestamp: 200 },
    { id: "d", title: "Delta", history: [], project_path: "/repo/app", timestamp: 400 },
];

const commands = {
    getConversations: vi.fn(async () => CONVERSATIONS),
    setConversationArchived: vi.fn(async () => {}),
    deleteConversation: vi.fn(async () => {}),
    revealPath: vi.fn(async () => {}),
};

vi.mock("@/lib/backend", () => ({
    commands,
    useProjectState: () => ({ project_path: "/repo/app" }),
}));

vi.mock("@tauri-apps/api/event", () => ({
    listen: vi.fn(async () => () => {}),
}));

// Only the sentinel is used, and the real module drags in the tab bar, dnd-kit
// and the message renderer.
vi.mock("@/features/chat/ui/shell/tabs", () => ({ NEW_CHAT_TAB_ID: "__new_chat__" }));

const { ChatList } = await import("@/features/agent/sidebar/chats");

const ROW_HEIGHT: Record<string, number> = { card: 78, slim: 40 };

let animation: AnimationStub;
let restoreMotion: () => void;
let restoreLayout: () => void;
let restoreResize: () => void;
let host: HTMLElement;
let root: Root;

function domRect(top: number, height: number): DOMRect {
    return {
        top,
        left: 0,
        width: 300,
        height,
        right: 300,
        bottom: top + height,
        x: 0,
        y: top,
        toJSON: () => ({ top, height }),
    } as DOMRect;
}

/** Lays the shelf stack out from the DOM on every read, so no cache goes stale. */
function installLayout(): () => void {
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
        const id = this.getAttribute("data-motion-id");
        const container = this.hasAttribute("data-chat-shelves")
            ? this
            : id
              ? this.closest("[data-chat-shelves]")
              : null;
        if (!container) return domRect(0, 0);
        if (!id) return domRect(0, 300);

        const rows = [...container.querySelectorAll<HTMLElement>("[data-motion-id]")];
        let top = 0;
        for (const row of rows) {
            const height = ROW_HEIGHT[row.getAttribute("data-row-variant") ?? "slim"];
            if (row === this) return domRect(top, height);
            top += height;
        }
        return domRect(0, 0);
    };
    return () => {
        Element.prototype.getBoundingClientRect = original;
    };
}

function row(id: string): HTMLElement {
    const found = host.querySelector<HTMLElement>(`[data-motion-id="${id}"]`);
    if (!found) throw new Error(`no row ${id}`);
    return found;
}

function rowOrder(): string[] {
    return [...host.querySelectorAll<HTMLElement>("[data-motion-id]")].map(
        (element) => element.getAttribute("data-motion-id") ?? "",
    );
}

function shelfHeaders(): HTMLElement[] {
    return [...host.querySelectorAll<HTMLElement>("[data-shelf-header]")];
}

function clickPin(id: string) {
    act(() => {
        row(id).querySelector<HTMLButtonElement>('button[aria-label="Pin"]')?.click();
    });
}

function pressUndoOn(target: EventTarget) {
    act(() => {
        target.dispatchEvent(
            new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }),
        );
    });
}

function clearPins() {
    for (const id of ["a", "b", "c", "d"]) setChatPinned(id, false);
    resetChatUndoForTests();
}

beforeEach(async () => {
    clearPins();
    restoreMotion = stubReducedMotion(false);
    animation = installAnimationStub();
    restoreLayout = installLayout();
    restoreResize = () => {};
    if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver !== "function") {
        class ResizeObserverStub {
            observe() {}
            unobserve() {}
            disconnect() {}
        }
        (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
        restoreResize = () => {
            delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
        };
    }
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
        root.render(<ChatList onNewChat={() => {}} />);
    });
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
    restoreResize();
    restoreLayout();
    restoreMotion();
    animation.restore();
    clearPins();
    document.body.innerHTML = "";
});

describe("sectioned session list", () => {
    it("renders every chat with a motion id and no headers when one shelf holds them all", () => {
        expect(rowOrder()).toEqual(["d", "a", "c", "b"]);
        expect(shelfHeaders()).toHaveLength(0);
        expect(animation.calls).toHaveLength(0);
    });

    it("feeds the motion layer a layout that is not all zeros", () => {
        // Without this the "it animated" assertions below would be vacuous: a
        // broken harness would look exactly like correct behaviour.
        expect(row("d").getBoundingClientRect().top).toBe(0);
        expect(row("a").getBoundingClientRect().top).toBe(40);
        expect(row("c").getBoundingClientRect().top).toBe(80);
        expect(row("b").getBoundingClientRect().top).toBe(120);
    });

    it("moves a pinned chat into its own card section and glides what it displaces", () => {
        const before = animation.calls.length;
        clickPin("c");
        const created = animation.calls.slice(before);

        expect(shelfHeaders().map((header) => header.getAttribute("data-shelf-header"))).toEqual([
            "pinned",
            "settled",
        ]);
        expect(shelfHeaders()[0].textContent).toContain("Pinned");
        expect(rowOrder()).toEqual(["c", "d", "a", "b"]);
        expect(row("c").getAttribute("data-row-variant")).toBe("card");

        // c left index 2 for index 0, so it starts 80px low and slides up.
        const moved = created.filter((entry) => entry.element === row("c"));
        expect(moved).toHaveLength(1);
        expect(moved[0].keyframes[0].transform).toBe("translate(0px, 80px)");
        // d and a were each pushed down by the 78px card above them; b sits below
        // both and only moves by the same 78.
        expect(created).toHaveLength(4);
        expect(created.find((entry) => entry.element === row("d"))?.keyframes[0].transform).toBe(
            "translate(0px, -78px)",
        );
        expect(created.find((entry) => entry.element === row("a"))?.keyframes[0].transform).toBe(
            "translate(0px, -78px)",
        );
        expect(created.find((entry) => entry.element === row("b"))?.keyframes[0].transform).toBe(
            "translate(0px, -38px)",
        );
    });

    it("undoes a pin with mod+Z and puts the chat back where it was", () => {
        clickPin("c");
        expect(getPinnedChatIds().has("c")).toBe(true);
        expect(rowOrder()).toEqual(["c", "d", "a", "b"]);

        pressUndoOn(window);

        expect(getPinnedChatIds().has("c")).toBe(false);
        expect(rowOrder()).toEqual(["d", "a", "c", "b"]);
        expect(shelfHeaders()).toHaveLength(0);
        expect(host.querySelector("[data-chat-undo]")).toBeNull();
    });

    it("restores the pinned position, not just the pin", () => {
        clickPin("d");
        clickPin("c");
        // Both are cards now, newest first inside the pinned shelf.
        expect(rowOrder().slice(0, 2)).toEqual(["d", "c"]);

        pressUndoOn(window);

        expect(getPinnedChatIds().has("d")).toBe(true);
        expect(getPinnedChatIds().has("c")).toBe(false);
        expect(rowOrder()).toEqual(["d", "a", "c", "b"]);
        expect(shelfHeaders()).toHaveLength(2);
    });

    it("shows an undo affordance naming the chat, and takes it away once used", () => {
        clickPin("c");

        const bar = host.querySelector<HTMLElement>("[data-chat-undo]");
        expect(bar).toBeTruthy();
        expect(bar?.getAttribute("data-chat-undo")).toBe("pin");
        expect(bar?.textContent).toContain("Charlie");
        expect(bar?.querySelectorAll("button")).toHaveLength(2);

        act(() => {
            bar?.querySelectorAll("button")[0]?.click();
        });
        expect(host.querySelector("[data-chat-undo]")).toBeNull();
        expect(getPinnedChatIds().has("c")).toBe(false);
    });

    it("collapses a section on its header and lets the rows below close the gap", () => {
        clickPin("c");
        const before = animation.calls.length;
        act(() => {
            host.querySelector<HTMLElement>('[data-shelf-header="pinned"]')?.click();
        });
        const created = animation.calls.slice(before);

        expect(rowOrder()).toEqual(["d", "a", "b"]);
        expect(
            host.querySelector('[data-shelf-header="pinned"]')?.getAttribute("aria-expanded"),
        ).toBe("false");
        // The card was the tallest thing in the list, so everything under it moved up.
        expect(created.some((entry) => entry.element === row("d"))).toBe(true);
        expect(created.find((entry) => entry.element === row("a"))?.keyframes[0].transform).toBe(
            "translate(0px, 78px)",
        );
    });

    it("leaves another surface's mod+Z alone when there is nothing to undo", () => {
        const later = vi.fn();
        window.addEventListener("keydown", later);
        try {
            pressUndoOn(row("c"));
        } finally {
            window.removeEventListener("keydown", later);
        }
        expect(later).toHaveBeenCalledTimes(1);
        expect(host.querySelector("[data-chat-undo]")).toBeNull();
    });

    it("takes the key away from other surfaces while an undo is pending", () => {
        clickPin("c");
        const later = vi.fn();
        window.addEventListener("keydown", later);
        try {
            pressUndoOn(row("c"));
        } finally {
            window.removeEventListener("keydown", later);
        }
        // The sidebar listens in the capture phase and stops propagation, so a
        // design-mode undo cannot fire on the same press.
        expect(later).not.toHaveBeenCalled();
        expect(getPinnedChatIds().has("c")).toBe(false);
    });

    it("ignores mod+Z typed into a field", () => {
        clickPin("c");
        const input = document.createElement("input");
        document.body.appendChild(input);

        pressUndoOn(input);

        expect(getPinnedChatIds().has("c")).toBe(true);
        expect(host.querySelector("[data-chat-undo]")).toBeTruthy();
        input.remove();
    });

    it("ignores a bare z and a redo chord", () => {
        clickPin("c");
        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", bubbles: true }));
        });
        act(() => {
            window.dispatchEvent(
                new KeyboardEvent("keydown", { key: "z", ctrlKey: true, shiftKey: true, bubbles: true }),
            );
        });
        expect(getPinnedChatIds().has("c")).toBe(true);
        expect(host.querySelector("[data-chat-undo]")).toBeTruthy();
    });

    it("keeps a pending undo across a remount of the whole sidebar", async () => {
        clickPin("c");
        act(() => root.unmount());
        root = createRoot(host);
        await act(async () => {
            root.render(<ChatList onNewChat={() => {}} />);
        });

        expect(rowOrder().slice(0, 1)).toEqual(["c"]);
        expect(shelfHeaders()).toHaveLength(2);
        // The window lives in the module, so a remount cannot lose it or turn the
        // pending action into a settled one.
        expect(host.querySelector("[data-chat-undo]")).toBeTruthy();
        pressUndoOn(window);
        expect(getPinnedChatIds().has("c")).toBe(false);
        expect(rowOrder()).toEqual(["d", "a", "c", "b"]);
    });
});