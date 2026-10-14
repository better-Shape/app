/**
 * Exit animation for a row React has already removed.
 *
 * The row is gone from the document the moment React commits — the DOM node it
 * owned is detached and React will reuse or drop that exact object on the next
 * render. Animating it is impossible. t3code's solution, and the one here, is to
 * deep-clone the detached node, strip everything that identifies it, and let the
 * copy fade out on its own clock while the list has already closed the gap.
 *
 * The clone must not be discoverable: React still owns the original, so a second
 * node carrying the same `id` or the same `data-*` markers would break
 * `getElementById`, break `querySelector('[data-motion-id]')` for the next
 * snapshot, and put a phantom row in the tab order. So the clone keeps its class
 * list (that is the entire visual point) and loses every identifier.
 */

import { FLIP_DURATION_MS, FLIP_EASING, canAnimate, prefersReducedMotion, rowTravel } from "./env";
import { claimAnimation, remainingTransform } from "./remaining";
import type { MotionRow } from "./flip";

export interface ExitOptions {
    durationMs?: number;
    easing?: string;
    /** Overrides the `prefers-reduced-motion` probe. */
    reducedMotion?: boolean;
}

/** Milliseconds a clone is allowed to linger past its animation. */
const EXIT_CLEANUP_GRACE_MS = 400;

/**
 * Strip identifiers from the clone.
 *
 * `inert` is what actually removes it from tab order and from pointer
 * targeting; `aria-hidden` is belt and braces for the same reason, because not
 * every engine has shipped `inert` yet. Setting the attribute rather than the
 * property is deliberate: the IDL reflection is missing in older WebViews and in
 * jsdom, the content attribute is not.
 */
function stripClone(clone: HTMLElement): void {
    for (const attribute of Array.from(clone.attributes)) {
        if (attribute.name === "id" || attribute.name.startsWith("data-")) {
            clone.removeAttribute(attribute.name);
        }
    }
    clone.setAttribute("inert", "");
    clone.setAttribute("aria-hidden", "true");
    try {
        (clone as HTMLElement & { inert: boolean }).inert = true;
    } catch {
        /* older WebView: the content attribute above is the fallback */
    }
}

/**
 * Pin the clone where the row visually was.
 *
 * The container is made a positioning context if it is not already one — the
 * clone is taken out of flow so the collapsed list is not pushed around by a
 * row that is on its way out.
 */
function placeClone(clone: HTMLElement, container: HTMLElement, top: number, left: number, height: number): void {
    // `getComputedStyle` reports an empty `position` in an engine with no default
    // stylesheet, so treat that the same as `static`.
    const position = getComputedStyle(container).position;
    if (!position || position === "static") {
        container.style.position = "relative";
    }
    const box = clone.style;
    box.position = "absolute";
    box.top = `${top}px`;
    box.left = `${left}px`;
    box.width = `${clone.offsetWidth}px`;
    box.height = `${height}px`;
    box.margin = "0";
    box.overflow = "hidden";
    box.pointerEvents = "none";
    box.zIndex = "0";
}

/**
 * Fade and collapse `row`'s clone out of `container`.
 *
 * @returns the clone, or `null` when nothing was animated (reduced motion, no
 * WAAPI, no node to clone).
 */
export function playRowExit(
    container: HTMLElement | null | undefined,
    row: MotionRow,
    options: ExitOptions = {},
): HTMLElement | null {
    if (!container || !row.element) return null;
    if (options.reducedMotion ?? prefersReducedMotion(container)) return null;
    if (!canAnimate(row.element)) return null;

    const clone = row.element.cloneNode(true) as HTMLElement;
    if (typeof clone?.animate !== "function") return null;
    stripClone(clone);

    // The row may have been mid-flight when React removed it. Its residual is
    // read from the detached original — WAAPI keeps running animations on a
    // detached node — so the clone starts where the eye last saw the row.
    const residual = remainingTransform(row.element);
    const origin = container.getBoundingClientRect();
    const height = row.rect.height;
    placeClone(
        clone,
        container,
        row.rect.top - origin.top + residual.y,
        row.rect.left - origin.left + residual.x,
        height,
    );
    container.appendChild(clone);

    const duration = options.durationMs ?? FLIP_DURATION_MS;
    const easing = options.easing ?? FLIP_EASING;

    let done = false;
    const remove = () => {
        if (done) return;
        done = true;
        clone.remove();
    };

    let animation: Animation;
    try {
        animation = clone.animate(
            [
                { height: `${height}px`, opacity: 1, transform: "none" },
                { height: "0px", opacity: 0, transform: `translateY(${-rowTravel(height)}px)` },
            ],
            { duration, easing, fill: "none" },
        );
    } catch {
        remove();
        return null;
    }
    claimAnimation(animation, clone);

    // `finished` rejects when the animation is cancelled, and never settles at
    // all if the document is torn down mid-flight. Both need the timer.
    void Promise.resolve(animation.finished).then(remove, remove);
    setTimeout(remove, duration + EXIT_CLEANUP_GRACE_MS);

    return clone;
}
