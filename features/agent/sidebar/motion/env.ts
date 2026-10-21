/**
 * Environment probes shared by every animator in this folder.
 *
 * Everything here runs from a `useLayoutEffect`, so a throw does not just fail
 * an animation — it unwinds the sidebar render. Every probe therefore answers
 * "no" rather than throwing when the capability is missing (jsdom, an old
 * WebView, a detached document) and the animators treat a missing capability as
 * "jump to the final state".
 */

/** The duration t3code uses for sidebar list movement. */
export const FLIP_DURATION_MS = 150;

/** The easing t3code uses for sidebar list movement. */
export const FLIP_EASING = "ease-out";

/**
 * A row never travels further than this when it enters or exits, so a tall
 * card does not slide its own height into the list.
 *
 * The number comes from t3code's `rowTravel = (height) => Math.min(height, 40)`.
 * It is the upstream author's judgement, not a value we measured.
 */
export const MAX_ROW_TRAVEL_PX = 40;

/** Deltas smaller than this are layout noise, not movement worth animating. */
export const MOVE_EPS_PX = 0.5;

export function rowTravel(size: number): number {
    if (!Number.isFinite(size)) return 0;
    return Math.min(Math.abs(size), MAX_ROW_TRAVEL_PX);
}

export function isMovingSize(value: number): boolean {
    return Number.isFinite(value) && Math.abs(value) > MOVE_EPS_PX;
}

export { prefersReducedMotion } from "@/lib/ui/motion";

/** `Element.animate` is absent in jsdom and in pre-Chromium WebViews. */
export function canAnimate(element: Element | null | undefined): boolean {
    return !!element && typeof element.animate === "function";
}