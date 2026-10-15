import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation } from "@/lib/backend/types";
import { getPinnedChatIds, setChatPinned } from "@/lib/sidebar/chat-list-meta";
import { getChatDispositions, setChatDisposition } from "@/lib/sidebar/chat-disposition";
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
let shortcutModifier: "ctrlKey" | "metaKey" = "ctrlKey";

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
            new KeyboardEvent("keydown", { key: "z", [shortcutModifier]: true, bubbles: true, cancelable: true }),
        );
    });
}

function clearPins() {
    for (const id of Object.keys(getChatDispositions())) setChatDisposition(id, undefined);
    for (const id of ["a", "b", "c", "d"]) setChatPinned(id, false);
    resetChatUndoForTests();
}

describe.each([["Windows", "ctrlKey"], ["Darwin", "metaKey"]] as const)("sectioned session list on %s", (userAgent, modifier) => {
beforeEach(async () => {
    shortcutModifier = modifier;
    vi.stubGlobal("navigator", { userAgent });
    clearPins();
    restoreMotion = stubReducedMotion(false);
    animation = installAnimationStub();
    restoreLayout = installLayout();
    restoreResize = () => {};
    if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver !== "function") {
        class ResizeObserverStub {
            constructor(_onResize: ResizeObserverCallback) {}
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
    vi.unstubAllGlobals();
});


    it.each(["settled", "snoozed"] as const)("viewing a %s history row preserves its disposition", (state) => {
        const value = state === "snoozed" ? { state, until: Date.now() + 60_000 } as const : { state };
        act(() => setChatDisposition("a", value));
        const open = [...row("a").querySelectorAll("button")].find(button => button.textContent?.includes("Alpha"));
        expect(open).toBeDefined();
        act(() => open!.click());
        expect(getChatDispositions().a).toEqual(value);
    });

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
                new KeyboardEvent("keydown", { key: "z", [shortcutModifier]: true, shiftKey: true, bubbles: true }),
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

it("moves snoozed rows through the existing animated shelf layout", () => {
    const before = animation.calls.length;
    act(() => setChatDisposition("c", { state: "snoozed", until: Date.now() + 60_000 }));
    expect(shelfHeaders().map((header) => header.getAttribute("data-shelf-header"))).toEqual(["snoozed", "settled"]);
    expect(rowOrder()).toEqual(["c", "d", "a", "b"]);
    expect(animation.calls.slice(before).some((call) => call.element === row("c"))).toBe(true);
});

it("jumps in visible shelf order and ignores composition and editable fields", () => {
    const opened = vi.fn();
    window.addEventListener("bettershape-chat-load", opened);
    const input = document.createElement("input");
    document.body.appendChild(input);
    try {
        clickPin("c");
        act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "1", [shortcutModifier]: true, bubbles: true })));
        expect(opened.mock.calls[0][0].detail.id).toBe("c");
        act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "2", [shortcutModifier]: true, isComposing: true, bubbles: true })));
        act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "2", [shortcutModifier]: true, bubbles: true })));
        expect(opened).toHaveBeenCalledTimes(1);
        act(() => host.querySelector<HTMLElement>('[data-shelf-header="pinned"]')?.click());
        act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "1", [shortcutModifier]: true, bubbles: true })));
        expect(opened.mock.calls[1][0].detail.id).toBe("d");
    } finally { window.removeEventListener("bettershape-chat-load", opened); input.remove(); }
});

it("supports real keyboard dragging to an empty shelf with undo", async () => {
    const original = Element.prototype.getBoundingClientRect;
    const scrollBy = HTMLElement.prototype.scrollBy;
    const scrollTo = HTMLElement.prototype.scrollTo;
    // This finite test layout has no overflow; jsdom omits the browser scroll APIs.
    HTMLElement.prototype.scrollBy = () => {};
    HTMLElement.prototype.scrollTo = () => {};
    Element.prototype.getBoundingClientRect = function () {
        if (this.hasAttribute("data-chat-drag-preview")) {
            return domRect(Number.parseFloat((this.parentElement as HTMLElement).style.top) || 0, 40);
        }
        const parent = this.closest("[data-chat-shelves]");
        if (!parent) return original.call(this);
        const children = [...parent.children] as HTMLElement[];
        const index = children.indexOf(this as HTMLElement);
        if (index < 0) return original.call(this);
        const top = children.slice(0, index).reduce((sum, node) => sum + (node.hasAttribute("data-shelf-header") ? 24 : 40), 0);
        return domRect(top, this.hasAttribute("data-shelf-header") ? 24 : 40);
    };
    try {
        const button = row("a").querySelector<HTMLButtonElement>('[aria-roledescription="draggable session"]')!;
        expect(button).not.toBeNull();
        await act(async () => {
            button.focus();
            button.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true }));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(host.querySelectorAll("[data-drop-shelf]")).toHaveLength(4);
        expect(host.querySelector('[data-drop-shelf="snoozed"]')?.textContent).toContain("Snooze");
        await act(async () => {
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", code: "ArrowUp", bubbles: true, cancelable: true }));
        });
        await act(async () => {
            document.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true }));
        });
        expect(getChatDispositions()["a"]?.state).toBe("snoozed");
        expect(host.querySelector("[data-chat-undo]")?.textContent).toContain("Snoozed");
        pressUndoOn(window);
        expect(getChatDispositions()["a"]).toBeUndefined();
    } finally {
        Element.prototype.getBoundingClientRect = original;
        HTMLElement.prototype.scrollBy = scrollBy;
        HTMLElement.prototype.scrollTo = scrollTo;
    }
});

it("filters sessions only after IME composition ends and does not open on composing Enter", async () => {
    const opened = vi.fn();
    window.addEventListener("bettershape-chat-load", opened);
    try {
        act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Search"]')?.click());
        const input = host.querySelector<HTMLInputElement>('input[aria-label="Search sessions"]')!;
        expect(document.activeElement).toBe(input);
        act(() => input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
        act(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Alpha");
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(rowOrder()).toEqual(["d", "a", "c", "b"]);
        act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", isComposing: true, bubbles: true })));
        expect(opened).not.toHaveBeenCalled();
        act(() => input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "Alpha" })));
        expect(rowOrder()).toEqual(["a"]);
        act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true })));
        expect(opened.mock.calls[0][0].detail.id).toBe("a");
        act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true })));
        expect(host.querySelector('input[aria-label="Search sessions"]')).toBeNull();
        expect(rowOrder()).toEqual(["d", "a", "c", "b"]);
    } finally { window.removeEventListener("bettershape-chat-load", opened); }
});

});
