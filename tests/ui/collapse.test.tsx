import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Collapse } from "@/components/ui/collapse";

/**
 * The container reveal. `overflow: hidden` clips a collapsed section visually but
 * leaves its links and buttons focusable, so a keyboard user tabs into controls that
 * are not on screen, the closed branch has to be `inert` as well. These tests hold
 * that, the row-track animation, and the token-driven timing.
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

const track = () => container.firstElementChild as HTMLElement;
const clip = () => track().firstElementChild as HTMLElement;

describe("collapse", () => {
    it("animates the row track between 0fr and 1fr", () => {
        render(
            <Collapse open={false}>
                <p>body</p>
            </Collapse>,
        );
        expect(track().className).toContain("grid-rows-[0fr]");
        render(
            <Collapse open>
                <p>body</p>
            </Collapse>,
        );
        expect(track().className).toContain("grid-rows-[1fr]");
        expect(track().className).not.toContain("grid-rows-[0fr]");
    });

    it("takes its timing from the reveal tokens", () => {
        render(
            <Collapse open>
                <p>body</p>
            </Collapse>,
        );
        expect(track().className).toContain("duration-[var(--reveal-dur)]");
        expect(track().className).toContain("ease-[var(--reveal-ease)]");
    });

    it("takes the closed branch out of the tab order", () => {
        render(
            <Collapse open={false}>
                <a href="#x">hidden link</a>
            </Collapse>,
        );
        // Attribute present and true; React 19 writes the boolean to `inert`.
        expect(clip().hasAttribute("inert")).toBe(true);
    });

    it("lets the open branch be reached again", () => {
        render(
            <Collapse open>
                <a href="#x">visible link</a>
            </Collapse>,
        );
        expect(clip().hasAttribute("inert")).toBe(false);
        expect(container.querySelector("a")?.textContent).toBe("visible link");
    });

    it("keeps its children mounted while collapsed", () => {
        render(
            <Collapse open={false}>
                <p>body</p>
            </Collapse>,
        );
        // Reopening must not refetch or reset what is inside.
        expect(container.querySelector("p")?.textContent).toBe("body");
    });

    it("supports spring and menu timing variants without duplicating track geometry", () => {
        render(
            <Collapse open variant="spring">
                <p>spring body</p>
            </Collapse>,
        );
        expect(track().className).toContain("duration-[var(--spring-quick-dur)]");
        expect(track().className).toContain("ease-[var(--spring-quick)]");

        render(
            <Collapse open variant="menu">
                <p>menu body</p>
            </Collapse>,
        );
        expect(track().className).toContain("duration-[var(--transition-base)]");
        expect(track().className).toContain("ease-[var(--ease-out)]");
    });
});
