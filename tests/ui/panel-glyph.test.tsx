import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PanelGlyph } from "@/components/ui/panel-glyph";

/**
 * `PanelGlyph` hides the rail's excess behind a mask whose scale comes from
 * `--panel-rail-hide` in `app/transitions.css`. Every part of that contract is
 * invisible at the type level and easy to break silently:
 *
 * - two glyphs can be on screen at once, so each mask id has to be unique or the
 *   second toggle inherits the first one's rail;
 * - the mask's `transform-origin` is written in viewBox units, because a
 *   percentage would resolve against the element bbox under `fill-box` and the
 *   viewBox under `view-box` and land on a different edge;
 * - the rects the mask paints must carry the classes the stylesheet raises above
 *   `.bettershape-icon *`, whose `fill: currentColor` would otherwise turn the
 *   black rect translucent and stop it hiding anything.
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

function q(selector: string): SVGElement {
    const node = container.querySelector(selector);
    if (!node) throw new Error(`missing ${selector}`);
    return node as SVGElement;
}

describe("panel glyph", () => {
    it("references its own mask and masks the silhouette with it", () => {
        render(<PanelGlyph side="left" open />);
        const svg = q("svg.panel-glyph");
        const mask = q("mask");
        const path = q("path");

        expect(mask.id).toBeTruthy();
        expect(path.getAttribute("mask")).toBe(`url(#${mask.id})`);
        expect(svg.getAttribute("data-open")).toBe("true");
    });

    it("gives each side and each instance a distinct mask id", () => {
        render(
            <>
                <PanelGlyph side="left" open />
                <PanelGlyph side="right" open />
                <PanelGlyph side="left" open={false} />
            </>,
        );
        const ids = [...container.querySelectorAll("mask")].map((m) => m.id);
        expect(ids).toHaveLength(3);
        expect(new Set(ids).size).toBe(3);
    });

    it("pivots the hide scale on the rail's free edge, in viewBox units", () => {
        render(<PanelGlyph side="left" open />);
        const hide = q(".panel-glyph__hide");
        // Left rail runs x2→8.5, box y4→16: the free edge is x8.5, mid-height y10.
        expect(hide.style.transformOrigin).toBe("8.5px 10px");

        render(<PanelGlyph side="right" open />);
        const rightHide = q(".panel-glyph__hide");
        // Right rail runs x11.5→18, box y3→16.
        expect(rightHide.style.transformOrigin).toBe("11.5px 9.5px");
    });

    it("hides exactly the rail's excess, leaving the frame band", () => {
        render(<PanelGlyph side="left" open />);
        const hide = q(".panel-glyph__hide");
        // x3→8.5 (5.5 wide), y5→15 (10 tall): everything but the 1-unit band.
        expect([hide.getAttribute("x"), hide.getAttribute("y")]).toEqual(["3", "5"]);
        expect([hide.getAttribute("width"), hide.getAttribute("height")]).toEqual(["5.5", "10"]);

        render(<PanelGlyph side="right" open />);
        const rightHide = q(".panel-glyph__hide");
        // x11.5→17 (5.5 wide), y4→15 (11 tall).
        expect([rightHide.getAttribute("x"), rightHide.getAttribute("y")]).toEqual(["11.5", "4"]);
        expect([rightHide.getAttribute("width"), rightHide.getAttribute("height")]).toEqual(["5.5", "11"]);
    });

    it("keeps the luminance fills on classes the stylesheet can override", () => {
        render(<PanelGlyph side="left" open />);
        expect(q(".panel-glyph__keep")).toBeTruthy();
        expect(q(".panel-glyph__hide")).toBeTruthy();
        // The fill itself belongs to `app/transitions.css`, not to inline attributes,
        // because `.bettershape-icon *` sets `fill: currentColor` with lower
        // specificity than those class rules.
        expect(q(".panel-glyph__hide").getAttribute("fill")).toBeNull();
    });

    it("reports the closed state, and still draws the rail as a hairline", () => {
        render(<PanelGlyph side="left" open={false} />);
        const svg = q("svg.panel-glyph");
        expect(svg.getAttribute("data-open")).toBe("false");
        // The scale that produces the hairline lives in CSS; the geometry keeps the
        // rail's full travel, so the same markup serves both states.
        expect(q(".panel-glyph__hide").getAttribute("width")).toBe("5.5");
    });
});
