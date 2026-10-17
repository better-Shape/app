"use client";

/**
 * The React surface of the sidebar motion system.
 *
 * Everything here is dependency-free on purpose. `@dnd-kit` is already a
 * dependency and owns drag transforms; there is no animation library in this
 * app, and adding one for a 150ms list reorder would be the largest dependency
 * in the bundle for the smallest effect.
 */

import { useCallback, useLayoutEffect, useRef } from "react";
import { playFlip, takeSnapshot, type FlipSnapshot } from "./flip";

export {
    FLIP_DURATION_MS,
    FLIP_EASING,
    MAX_ROW_TRAVEL_PX,
    MOVE_EPS_PX,
    canAnimate,
    isMovingSize,
    prefersReducedMotion,
    rowTravel,
} from "./env";
export {
    MAX_FADED_ROWS_PER_UPDATE,
    MOTION_ID_ATTRIBUTE,
    MOTION_ROW_SELECTOR,
    playFlip,
    snapshotRects,
    takeSnapshot,
    type ContainerOrigin,
    type FlipReport,
    type FlipSnapshot,
    type MotionRect,
    type MotionRow,
    type MotionSnapshot,
    type PlayFlipOptions,
} from "./flip";
export {
    NO_RESIDUAL,
    cancelOwnAnimations,
    claimAnimation,
    forgetAnimations,
    hasLiveOwnAnimation,
    isOwnAnimation,
    ownAnimations,
    parseTransform,
    remainingOffset,
    remainingTransform,
    type ResidualTransform,
} from "./remaining";
export {
    ridingDelta,
    ridingDirection,
    ridingFor,
    type RidingDelta,
    type RidingEvent,
} from "./ride";
export { playRowExit, type ExitOptions } from "./exit";
export {
    AnimatedHeight,
    AnimatedWidth,
    SIZE_DURATION_MS,
    SIZE_FALLBACK_MS,
    SIZE_SETTLE_FRAMES,
    createAnimatedSize,
    type AnimatedSize,
    type AnimatedSizeController,
    type AnimatedSizeObserver,
    type AnimatedSizeOptions,
    type AnimatedSizeProps,
} from "./animated-size";

export interface FlipMotionOptions {
    /** Length of a move. Default 150ms, matching the sidebar's other timings. */
    durationMs?: number;
    /** Default `ease-out`. */
    easing?: string;
    /** Fade budget per update. Default 40. See `MAX_FADED_ROWS_PER_UPDATE`. */
    maxAnimatedRows?: number;
    /**
     * Set false to keep taking snapshots but animate nothing. Use this while a
     * drag is live: dnd-kit owns the transforms then, and replaying the
     * committed order would animate the drop twice.
     */
    enabled?: boolean;
}

export interface FlipMotion<T extends HTMLElement> {
    /** Attach to the element that *contains* the rows. */
    containerRef: (element: T | null) => void;
    /**
     * Call from a `useLayoutEffect` in the same component, after any render
     * that can add, remove or reorder rows.
     */
    trackRender: () => void;
}

/**
 * FLIP for a container of rows tagged with `data-motion-id`.
 *
 * ## Why `trackRender` looks like it is missing the "First"
 *
 * A FLIP implementation normally has to measure the rows *before* the DOM
 * changes, which means a `useLayoutEffect` that runs on every render but reads
 * the layout, then a second one after the commit reads it again. That is two
 * layout reads per update and it is fragile: anything that mutates the DOM
 * between the two (a portal, a sibling effect, dnd-kit's own cleanup) silently
 * invalidates the pair.
 *
 * This does not need one. React commits the whole tree, *then* runs layout
 * effects, *then* paints — so at the moment `trackRender` runs, the DOM is
 * already the new DOM and nothing has been shown to the user. Therefore:
 *
 * - the snapshot taken during the **previous** `trackRender` is the "First",
 *   because the browser has not painted anything since;
 * - the snapshot taken **now** is the "Last";
 * - the animation is the "Invert and Play" that turns one into the other.
 *
 * Holding the previous snapshot in a ref is the entire mechanism, and the
 * alternative — measuring in a pre-commit hook — is not available in React at
 * all. The one assumption this makes is that `trackRender` is called in the
 * *same* component as the hook, so that a render which changes row order always
 * passes through it. Call it from a child's effect and the pair is off by one
 * commit.
 *
 * The first call after mount only establishes the baseline: there is no
 * previous snapshot to diff against, so nothing animates. That is deliberate —
 * animating the initial list into place would be noise the user never asked for.
 */
export function useFlipMotion<T extends HTMLElement = HTMLDivElement>(
    options: FlipMotionOptions = {},
): FlipMotion<T> {
    const { durationMs, easing, maxAnimatedRows, enabled } = options;
    const elementRef = useRef<T | null>(null);
    const snapshotRef = useRef<FlipSnapshot | null>(null);
    const configRef = useRef({ durationMs, easing, maxAnimatedRows, enabled });

    // No dependency list: this must be current by the time `trackRender` runs
    // later in the same component's layout effects, and hooks fire in
    // declaration order, so an every-render update is both cheap and correct.
    useLayoutEffect(() => {
        configRef.current = { durationMs, easing, maxAnimatedRows, enabled };
    });

    const containerRef = useCallback((element: T | null) => {
        if (elementRef.current === element) return;
        elementRef.current = element;
        // A new container is a new list. Diffing the old snapshot against it
        // would teleport every row that happens to share an id.
        snapshotRef.current = null;
    }, []);

    const trackRender = useCallback(() => {
        const container = elementRef.current;
        if (!container) return;

        const before = snapshotRef.current;
        const now = takeSnapshot(container);
        // Snapshot even while disabled: re-enabling mid-session must not replay
        // every intermediate layout as one enormous jump.
        snapshotRef.current = now;

        if (!before || configRef.current.enabled === false) return;
        playFlip(before, container, configRef.current);
    }, []);

    return { containerRef, trackRender };
}
