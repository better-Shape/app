import { act, useCallback, useLayoutEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useFlipMotion } from "@/features/agent/sidebar/motion";
import {
    installAnimationStub,
    stubRects,
    type AnimationStub,
    type RecordedAnimation,
    type RectStub,
    type StubRect,
} from "./harness";

/**
 * `useFlipMotion` has one subtle contract — that the previous layout effect's
 * snapshot is a valid "First" — and it is invisible at the type level. These
 * tests drive real React commits through `act` and assert on what the module
 * actually animated, which is the only way that contract can be checked.
 *
 * jsdom has no layout, so each row's box is published by hand right before the
 * layout effect that would normally have produced it.
 */

const ROW_HEIGHT = 40;
const TEST_DURATION_MS = 260;

let animation: AnimationStub;
let rects: RectStub;

beforeEach(() => {
    rects = stubRects();
    animation = installAnimationStub();
});

afterEach(() => {
    animation.restore();
    rects.restore();
    document.body.innerHTML = "";
});

/**
 * Stands in for layout: publishes a box for every row that just committed.
 * Declared before the motion effect so it runs first, which is exactly the
 * ordering the hook's docblock depends on.
 */
/**
 * Stands in for layout: publishes a box for every row that just committed.
 * Declared before the motion effect so it runs first, which is exactly the
 * ordering the hook's docblock depends on.
 *
 * `useFlipMotion` hands back a CALLBACK ref, not a ref object -- it uses the ref
 * callback to notice a container change and drop the stale baseline. So the
 * container has to be captured through a ref of our own alongside it. Reading
 * `.current` off the callback silently yields `undefined`, which makes every
 * row measure zero and the motion code correctly animate nothing.
 */
function usePublishedRects(
    containerRef: (element: HTMLUListElement | null) => void,
    ids: readonly string[],
): (element: HTMLUListElement | null) => void {
    const local = useRef<HTMLUListElement | null>(null);
    useLayoutEffect(() => {
        const container = local.current;
        if (!container) return;
        const rows = container.querySelectorAll<HTMLElement>("[data-motion-id]");
        rows.forEach((row, index) => {
            const box: StubRect = { top: index * ROW_HEIGHT, left: 0, width: 300, height: ROW_HEIGHT };
            rects.set(row, box);
        });
    }, [ids]);
    // Stable identity, or React detaches and reattaches the ref on every commit,
    // and `useFlipMotion` drops its baseline each time it sees a container change.
    return useCallback(
        (element: HTMLUListElement | null) => {
            local.current = element;
            containerRef(element);
        },
        [containerRef],
    );
}

interface Props {
    ids: string[];
    durationMs?: number;
    enabled?: boolean;
    /** Skips the `trackRender` call, as an unmounted container would. */
    detached?: boolean;
    /** Changing this remounts the list element, i.e. a different container. */
    containerKey?: string;
}

function Sidebar({ ids, durationMs, enabled, detached, containerKey }: Props) {
    const { containerRef, trackRender } = useFlipMotion<HTMLUListElement>({ durationMs, enabled });
    const ref = usePublishedRects(containerRef, ids);

    useLayoutEffect(() => {
        // The documented pattern: a layout effect in the same component, after
        // the DOM for this commit is in place.
        trackRender();
    });

    if (detached) return <ul />;
    return (
        <ul ref={ref} key={containerKey}>
            {ids.map((id) => (
                <li key={id} data-motion-id={id}>
                    {id}
                </li>
            ))}
        </ul>
    );
}

function host(): HTMLElement {
    const element = document.createElement("div");
    document.body.appendChild(element);
    return element;
}

/** Mounts with `first`, commits, re-renders with `next`, and returns the new animations. */
function renderTwice(
    container: HTMLElement,
    first: string[],
    next: string[],
    durationMs?: number,
): RecordedAnimation[] {
    const root: Root = createRoot(container);
    act(() => root.render(<Sidebar ids={first} durationMs={durationMs} />));
    const before = animation.calls.length;
    act(() => root.render(<Sidebar ids={next} durationMs={durationMs} />));
    const created = animation.calls.slice(before);
    act(() => root.unmount());
    return created;
}

function startsFor(created: readonly RecordedAnimation[], id: string): string[] {
    return created
        .filter((entry) => entry.element.getAttribute("data-motion-id") === id)
        .map((entry) => String(entry.keyframes[0]?.transform));
}

/**
 * Renders, swaps the container element, then re-orders inside the new one.
 * Returns the animations created after the swap.
 */
function renderAcrossContainerSwap(
    container: HTMLElement,
    first: string[],
    next: string[],
): { swap: RecordedAnimation[]; created: RecordedAnimation[] } {
    const root: Root = createRoot(container);
    act(() => root.render(<Sidebar ids={first} containerKey="one" durationMs={TEST_DURATION_MS} />));
    const before = animation.calls.length;
    // A new key remounts the <ul>, so the ref sees a genuinely different element.
    act(() => root.render(<Sidebar ids={first} containerKey="two" durationMs={TEST_DURATION_MS} />));
    const afterSwap = animation.calls.length;
    // Now reorder inside the brand new container. Every row is at the same box as it
    // was in the old one, so nothing should move -- and crucially nothing should
    // replay against the old container's geometry.
    act(() => root.render(<Sidebar ids={next} containerKey="two" durationMs={TEST_DURATION_MS} />));
    const created = animation.calls.slice(afterSwap);
    act(() => root.unmount());
    return { swap: animation.calls.slice(before, afterSwap), created };
}

describe("useFlipMotion", () => {
    it("does not replay a reorder against a container it no longer owns", () => {
        const { swap, created } = renderAcrossContainerSwap(host(), ["a", "b", "c"], ["c", "b", "a"]);

        // Swapping the container establishes a fresh baseline rather than animating.
        // Without the reset, every row would slide from the old list's geometry.
        expect(swap).toEqual([]);
        // A reorder inside the NEW container still works, and only the rows that
        // actually moved animate -- "c" travels further than the travel clamp, so it
        // is not among them. The point is that it is not zero and not all three.
        expect(created.length).toBeGreaterThan(0);
        expect(created.length).toBeLessThan(3);
    });

    it("animates a reorder between two commits", () => {
        const created = renderTwice(host(), ["a", "b", "c"], ["c", "b", "a"], TEST_DURATION_MS);

        // c sat at 80 and is now at 0, so it starts 80px low and slides up.
        expect(startsFor(created, "c")).toEqual(["translate(0px, 80px)"]);
        // a sat at 0 and is now at 80.
        expect(startsFor(created, "a")).toEqual(["translate(0px, -80px)"]);
        // b never moved and must not get a no-op animation.
        expect(startsFor(created, "b")).toEqual([]);
        expect(created).toHaveLength(2);
    });

    it("animates nothing on the first mount or an unchanged re-render", () => {
        const created = renderTwice(host(), ["a", "b"], ["a", "b"], TEST_DURATION_MS);
        expect(created).toHaveLength(0);
    });

    it("fades only the row an append added", () => {
        const created = renderTwice(host(), ["a", "b"], ["a", "b", "c"], TEST_DURATION_MS);

        expect(created).toHaveLength(1);
        expect(created[0].element.getAttribute("data-motion-id")).toBe("c");
        expect(created[0].keyframes[0].opacity).toBe(0);
        expect(startsFor(created, "a")).toEqual([]);
        expect(startsFor(created, "b")).toEqual([]);
    });

    it("clones a row React removed and keeps the real list free of ghosts", () => {
        const container = host();
        const root = createRoot(container);
        act(() => root.render(<Sidebar ids={["a", "b", "c"]} />));
        const before = animation.calls.length;
        act(() => root.render(<Sidebar ids={["a", "c"]} />));
        const created = animation.calls.slice(before);

        const ghosts = container.querySelectorAll("[inert]");
        expect(ghosts).toHaveLength(1);
        expect(ghosts[0].hasAttribute("data-motion-id")).toBe(false);
        expect(ghosts[0].getAttribute("aria-hidden")).toBe("true");
        // a kept its index and c rose into b's place; only c is animated.
        expect(startsFor(created, "a")).toEqual([]);
        expect(startsFor(created, "c")).toEqual(["translate(0px, 40px)"]);
        expect(container.querySelectorAll("[data-motion-id]")).toHaveLength(2);
        act(() => root.unmount());
    });

    it("passes its own duration through instead of using the default", () => {
        const created = renderTwice(host(), ["a", "b", "c"], ["c", "b", "a"], TEST_DURATION_MS);
        expect(created).toHaveLength(2);
        for (const entry of created) expect(entry.options.duration).toBe(260);
    });

    it("uses the 150ms default when no duration is given", () => {
        const created = renderTwice(host(), ["a", "b", "c"], ["c", "b", "a"]);
        expect(created).toHaveLength(2);
        expect(created[0].options.duration).toBe(150);
    });

    it("keeps a baseline while disabled so re-enabling does not replay every commit", () => {
        const container = host();
        const root = createRoot(container);
        act(() => root.render(<Sidebar ids={["a", "b", "c"]} enabled={false} />));
        act(() => root.render(<Sidebar ids={["c", "b", "a"]} enabled={false} />));
        expect(animation.calls).toHaveLength(0);

        // Going back to the original order is a real 80px move for a and c, and
        // it is animated once — not the sum of the two suppressed updates. a
        // was left at index 2 by the suppressed commit and is now back at 0, so
        // it starts 80px low and slides up.
        act(() => root.render(<Sidebar ids={["a", "b", "c"]} enabled />));
        const created = animation.calls;
        expect(created).toHaveLength(2);
        expect(startsFor(created, "a")).toEqual(["translate(0px, 80px)"]);
        expect(startsFor(created, "c")).toEqual(["translate(0px, -80px)"]);
        act(() => root.unmount());
    });

    it("survives a container ref that was never populated", () => {
        const container = host();
        const root = createRoot(container);
        act(() => root.render(<Sidebar ids={["a", "b"]} detached />));
        act(() => root.render(<Sidebar ids={["b", "a"]} detached />));

        // No container means no snapshot and no animation, and certainly no throw
        // out of a layout effect.
        expect(animation.calls).toHaveLength(0);
        act(() => root.unmount());
    });

    it("fades in a row that lands in an empty container", () => {
        const created = renderTwice(host(), [], ["a"]);

        expect(created).toHaveLength(1);
        expect(created[0].element.getAttribute("data-motion-id")).toBe("a");
        // Nothing is moving, so the default is a rise.
        expect(created[0].keyframes[0].transform).toBe("translateY(40px)");
    });

    it("drops a row in from above when the list below it is pushed down", () => {
        const created = renderTwice(host(), ["a", "b"], ["n", "a", "b"]);

        const n = created.find((entry) => entry.element.getAttribute("data-motion-id") === "n");
        expect(n?.keyframes[0].transform).toBe("translateY(-40px)");
        // a and b slid down 40, so they start 40 above where they end.
        expect(startsFor(created, "a")).toEqual(["translate(0px, -40px)"]);
        expect(startsFor(created, "b")).toEqual(["translate(0px, -40px)"]);
    });
});
