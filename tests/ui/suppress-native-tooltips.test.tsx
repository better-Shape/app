import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SuppressNativeTooltips } from "@/components/ui/suppress-native-tooltips";

/**
 * The suppressor removes native `title` bubbles app-wide, and it has to do that without
 * touching the DOM while React is hydrating. An earlier version swept the whole tree from
 * an effect on mount, which rewrote attributes React had not hydrated yet; the mismatch
 * that produced was reported against whichever control the sweep reached first, and it
 * failed the route audit on `/settings`.
 */

let container: HTMLDivElement;
let root: Root;

const titled = (label: string) => {
    const button = document.createElement("button");
    button.setAttribute("title", label);
    button.textContent = "Check chat";
    document.body.append(button);
    return button;
};

beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.querySelectorAll("button[title], button[data-native-title]").forEach((n) => n.remove());
});

describe("the native tooltip suppressor", () => {
    it("leaves titles alone while the tree is mounting", () => {
        const button = titled("Sends one short completion with openai/gpt-5");
        act(() => root.render(<SuppressNativeTooltips />));
        expect(button.getAttribute("title")).toBe("Sends one short completion with openai/gpt-5");
        expect(button.getAttribute("data-native-title")).toBeNull();
    });

    it("strips a title when the pointer arrives on the control", () => {
        act(() => root.render(<SuppressNativeTooltips />));
        const button = titled("Sends one short completion with openai/gpt-5");
        act(() => {
            button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        });
        expect(button.getAttribute("title")).toBeNull();
        expect(button.getAttribute("data-native-title")).toBe("Sends one short completion with openai/gpt-5");
    });

    it("sweeps what is already on screen on the first pointer movement", () => {
        // A pointer that came to rest before the page rendered fires no boundary event, so
        // the sweep waits for the user rather than running during hydration.
        const button = titled("Reload IDE");
        act(() => root.render(<SuppressNativeTooltips />));
        act(() => {
            document.dispatchEvent(new Event("pointermove", { bubbles: true }));
        });
        expect(button.getAttribute("title")).toBeNull();
        expect(button.getAttribute("data-native-title")).toBe("Reload IDE");
    });

    it("strips a title when a control takes focus from the keyboard", () => {
        act(() => root.render(<SuppressNativeTooltips />));
        const button = titled("Try again");
        act(() => {
            button.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        });
        expect(button.getAttribute("title")).toBeNull();
        expect(button.getAttribute("data-native-title")).toBe("Try again");
    });
});
