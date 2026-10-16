import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SwapText } from "@/components/ui/swap";

/**
 * `SwapText` is the primitive behind every value that changes in place (the copy
 * confirmation, the status bar readings). Its contract is timing-sensitive and
 * invisible to the type checker:
 *
 * - mount must not animate, or every surface looks like it is still loading;
 * - a change must keep the outgoing layer mounted, marked as leaving, while the
 *   incoming one rises in;
 * - the outgoing layer has to leave on its own, or it stacks up and the cell keeps
 *   the width of the widest value it has ever held;
 * - the outgoing layer is a ghost and must be hidden from assistive tech, while the
 *   live region announces only the value that is really there.
 */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
});

function render(element: React.ReactElement) {
    act(() => root.render(element));
}

function layers() {
    return [...container.querySelectorAll(".t-swap__layer")];
}

describe("swap text", () => {
    it("mounts without playing an entry animation", () => {
        render(<SwapText value="Copy" />);
        expect(container.textContent).toBe("Copy");
        expect(layers()).toHaveLength(1);
        expect(layers()[0].className).not.toContain("t-swap__layer--in");
        expect(container.querySelector(".t-swap__layer--out")).toBeNull();
    });

    it("keeps the replaced value on screen as a ghost while the new one rises in", () => {
        render(<SwapText value="Copy" />);
        render(<SwapText value="Copied" />);

        const out = container.querySelector(".t-swap__layer--out");
        expect(out?.textContent).toBe("Copy");
        // The ghost is decoration: it must not be announced.
        expect(out?.getAttribute("aria-hidden")).toBe("true");
        expect(container.querySelector(".t-swap__layer--in")?.textContent).toBe("Copied");
        expect(container.textContent).toBe("CopyCopied");
    });

    it("drops the ghost when the swap finishes", () => {
        render(<SwapText value="Copy" durationMs={140} />);
        render(<SwapText value="Copied" />);
        act(() => vi.advanceTimersByTime(139));
        expect(container.querySelector(".t-swap__layer--out")).not.toBeNull();
        act(() => vi.advanceTimersByTime(2));
        expect(container.querySelector(".t-swap__layer--out")).toBeNull();
        expect(container.textContent).toBe("Copied");
    });

    it("does not stack ghosts when the value changes twice quickly", () => {
        render(<SwapText value="a" durationMs={140} />);
        render(<SwapText value="b" />);
        render(<SwapText value="c" />);
        expect(container.querySelectorAll(".t-swap__layer--out")).toHaveLength(1);
        expect(container.querySelector(".t-swap__layer--out")?.textContent).toBe("b");
        act(() => vi.advanceTimersByTime(140));
        expect(container.textContent).toBe("c");
    });

    it("carries the swap duration as the token the animation reads", () => {
        render(<SwapText value="Copy" durationMs={90} />);
        const root_ = container.querySelector(".t-swap") as HTMLElement;
        expect(root_.style.getPropertyValue("--swap-dur")).toBe("90ms");
        // The width transition is gated on the first layout settling.
        expect(root_.getAttribute("data-ready")).toBe("false");
        act(() => vi.advanceTimersByTime(20));
        expect(root_.getAttribute("data-ready")).toBe("true");
    });

    it("renders more than text, so a glyph can travel with its label", () => {
        render(<SwapText value="Copy" render={(value) => <b data-glyph>{value}</b>} />);
        const glyph = container.querySelector("[data-glyph]");
        expect(glyph?.tagName).toBe("B");
        expect(glyph?.textContent).toBe("Copy");
    });

    it("announces only when the caller asked for it", () => {
        render(<SwapText value="Copy" />);
        expect(container.querySelector(".t-swap")?.getAttribute("aria-live")).toBeNull();
        render(<SwapText value="Copy" live />);
        expect(container.querySelector(".t-swap")?.getAttribute("aria-live")).toBe("polite");
    });

    it("hands the width transition two lengths instead of leaving it on auto", () => {
        // A grid sizes to its widest layer, so without this a longer value moves its
        // neighbours in the first frame. jsdom lays nothing out, so the widths are
        // stubbed from the text length to give the pin and the hand-over real numbers.
        const real = Element.prototype.getBoundingClientRect;
        // 8px per character, with the host as wide as its widest layer, which is the rule
        // the real grid follows.
        const widthOf = (el: Element) => {
            // A pinned width wins, which is what the browser reports while the box is held.
            const pinned = (el as HTMLElement).style?.width;
            if (pinned?.endsWith("px")) return Number.parseFloat(pinned);
            const layers = [...el.querySelectorAll(".t-swap__layer")];
            const chars = layers.length
                ? Math.max(...layers.map((l) => (l.textContent ?? "").length))
                : (el.textContent ?? "").length;
            return chars * 8;
        };
        Element.prototype.getBoundingClientRect = function () {
            return { width: widthOf(this), x: 0, y: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) } as DOMRect;
        };
        try {
            const host = () => container.querySelector(".t-swap") as HTMLElement;
            render(<SwapText value="Copy" />);
            act(() => vi.advanceTimersByTime(20));

            render(<SwapText value="Copied" />);
            // Pinned to the width it is leaving, in the commit the new value arrives in.
            expect(host().style.width).toBe("32px");

            // Then released to the measured width of the value coming in.
            act(() => vi.advanceTimersByTime(20));
            expect(host().style.width).toBe("48px");

            // And handed back to the layout once the swap is over.
            act(() => vi.advanceTimersByTime(140));
            expect(host().style.width).toBe("");
        } finally {
            Element.prototype.getBoundingClientRect = real;
        }
    });
});
