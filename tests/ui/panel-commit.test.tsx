import fs from "node:fs";
import path from "node:path";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePanelCommit } from "@/features/agent/chrome";

/**
 * The panel toggle's preview-versus-commit contract. Measured before the fix: a pointer
 * that stayed on the button after clicking left the rail pinned at the midpoint with the
 * state already flipped, so the user never saw the state they had just switched to.
 *
 * Three things stay true: the click marks the button committed, pointer-out and blur
 * release the mark so the preview returns, and a button that appears because a panel
 * closed mounts already committed. The stylesheet half is asserted below, because a
 * specificity mistake is invisible in the component tree.
 */

const CSS = fs.readFileSync(path.join(process.cwd(), "app/transitions.css"), "utf8");

function Probe({ open, commitOnMount }: { open: boolean; commitOnMount?: boolean }) {
    const { committed, commit, handlers } = usePanelCommit();
    // Mirrors `SidebarToggleBtn`: the prop is read once, on the first render, because
    // "this element was born from a commit" is a fact about the mount.
    const [bornFromCommit] = useState(Boolean(commitOnMount));
    return (
        <button
            type="button"
            data-panel-toggle="test"
            data-panel-committed={committed ? "true" : undefined}
            data-panel-commit-mount={bornFromCommit && !committed ? "true" : undefined}
            onClick={commit}
            {...handlers}
        >
            {open ? "open" : "closed"}
        </button>
    );
}

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

const button = () => container.querySelector("button") as HTMLButtonElement;
const render = (element: React.ReactElement) => act(() => root.render(element));

describe("usePanelCommit", () => {
    it("does not claim a commit before the user acts", () => {
        render(<Probe open />);
        expect(button().getAttribute("data-panel-committed")).toBeNull();
    });

    it("marks the button committed when it is clicked", () => {
        const onClick = vi.fn();
        render(<Probe open />);
        button().addEventListener("click", onClick);
        act(() => button().click());
        expect(button().getAttribute("data-panel-committed")).toBe("true");
        expect(onClick).toHaveBeenCalled();
    });

    // React derives `onPointerLeave` from `pointerout` and `onBlur` from `focusout`, so
    // these dispatch those. A `relatedTarget` outside the button makes it a departure.
    it("releases the mark on pointer-out so the preview is reversible", () => {
        render(<Probe open />);
        act(() => button().click());
        expect(button().getAttribute("data-panel-committed")).toBe("true");
        act(() =>
            button().dispatchEvent(
                new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body }),
            ),
        );
        expect(button().getAttribute("data-panel-committed")).toBeNull();
    });

    it("releases the mark on blur, which is the keyboard equivalent", () => {
        render(<Probe open />);
        act(() => button().click());
        act(() => button().dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
        expect(button().getAttribute("data-panel-committed")).toBeNull();
    });

    it("does not treat a state change the user did not make as a commit", () => {
        // Watching `open` instead of the click marked the button committed during boot,
        // which suppressed the hover preview for the rest of the session.
        render(<Probe open={false} />);
        render(<Probe open />);
        render(<Probe open={false} />);
        expect(button().getAttribute("data-panel-committed")).toBeNull();
    });

    it("marks a button born from a commit so its rail finishes the travel", () => {
        render(<Probe open={false} commitOnMount />);
        expect(button().getAttribute("data-panel-commit-mount")).toBe("true");
    });
});

describe("panel preview and commit in the stylesheet", () => {
    it("excludes a committed button from the hover and focus preview", () => {
        // Both branches of the peek rule must carry the exclusion. A rule that keeps
        // only one of them leaves keyboard users with the stale preview.
        const hoverRule = CSS.match(/\[data-panel-toggle\][^{]*:hover[^{]*\{/g) ?? [];
        const focusRule = CSS.match(/\[data-panel-toggle\][^{]*:focus-visible[^{]*\{/g) ?? [];
        expect(hoverRule.length).toBeGreaterThan(0);
        expect(focusRule.length).toBeGreaterThan(0);
        for (const rule of [...hoverRule, ...focusRule]) {
            expect(rule).toContain('[data-panel-committed="true"]');
        }
    });

    it("plays the commit from the preview for a button that was just mounted", () => {
        expect(CSS).toContain('[data-panel-commit-mount="true"] .panel-glyph__hide');
        // The end must stay implicit, or one rule could not serve both panel sides.
        const keyframes = CSS.match(/@keyframes t-panel-rail-commit \{[^}]*\}/s);
        expect(keyframes).not.toBeNull();
        expect(keyframes?.[0]).toContain("scaleX(var(--panel-rail-peek))");
        expect(keyframes?.[0]).not.toMatch(/\bto\s*\{/);
    });

    it("guards the new rail animation in the reduced-motion block", () => {
        const guarded = CSS.slice(CSS.indexOf("@media (prefers-reduced-motion: reduce)"));
        expect(guarded).toContain(".panel-glyph__hide");
        expect(guarded).toMatch(/animation:\s*none\s*!important/);
    });
});
