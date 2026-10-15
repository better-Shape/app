import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Checkmark } from "@/components/ui/checkmark";

/**
 * The checked state draws its mark with the `t-success-check` pattern, which only
 * works if the markup keeps the shape the stylesheet in `app/transitions.css`
 * expects: a `.t-success-check` wrapper, `data-state="in"`, and a stroked path
 * inside an `svg`. Fluent's filled glyph cannot show that draw, so a future edit
 * that swaps it back in would silently lose the animation while still looking
 * correct in a snapshot test.
 */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

function render(element: React.ReactElement) {
    act(() => root.render(element));
}

describe("checkmark draw", () => {
    it("draws a stroked path when checked", () => {
        render(<Checkmark checked onCheckedChange={() => {}} label="Stage file" />);
        const draw = container.querySelector(".t-success-check");
        expect(draw).not.toBeNull();
        expect(draw?.getAttribute("data-state")).toBe("in");
        expect(draw?.querySelector("svg path")?.getAttribute("d")).toBeTruthy();
        // A stroked path, not a filled glyph: the draw animates stroke-dashoffset.
        expect(draw?.querySelector("svg path")?.getAttribute("fill")).toBeNull();
    });

    it("defaults to the compact beat and accepts the full one", () => {
        render(<Checkmark checked onCheckedChange={() => {}} label="Stage file" />);
        expect(container.querySelector(".t-success-check")?.getAttribute("data-motion")).toBe("compact");
        render(<Checkmark checked motion="full" onCheckedChange={() => {}} label="Stage file" />);
        expect(container.querySelector(".t-success-check")?.getAttribute("data-motion")).toBe("full");
    });

    it("keeps the dash glyph, which the draw does not cover", () => {
        render(<Checkmark checked="indeterminate" onCheckedChange={() => {}} label="Stage all" />);
        expect(container.querySelector(".t-success-check")).toBeNull();
        expect(container.querySelector("svg")).not.toBeNull();
    });

    it("has no mark to draw when unchecked", () => {
        render(<Checkmark checked={false} onCheckedChange={() => {}} label="Stage file" />);
        expect(container.querySelector(".t-success-check")).toBeNull();
    });

    it("does not steal the pressed state from a surrounding row", () => {
        const onCheckedChange = vi.fn();
        render(<Checkmark checked={false} onCheckedChange={onCheckedChange} label="Stage file" />);
        const box = container.querySelector('[role="checkbox"]') as HTMLElement;
        act(() => box.click());
        expect(onCheckedChange).toHaveBeenCalledWith(true);
    });
});
