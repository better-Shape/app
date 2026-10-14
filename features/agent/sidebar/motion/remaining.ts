/**
 * Interrupted-animation continuity.
 *
 * When a FLIP animation is interrupted mid-flight — the user pins a second chat
 * while the first reorder is still easing — the naive thing to do is read the
 * new layout positions and animate from `-delta`. That teleports the row: the
 * user watched it travel halfway across the list and it jumps back to its
 * untransformed slot before sliding off again.
 *
 * The fix, borrowed from t3code's `remainingOffset`, is to read the transform
 * the running animation has *not yet spent* and add it to the next animation's
 * starting offset. The row then continues from exactly where the eye left it.
 *
 * Only animations this module created are carried forward. dnd-kit owns the drag
 * transform and CSS transitions own hover states; folding either into a layout
 * animation would make a row jump to the pointer.
 */

/** Transform still owed to the element, relative to its final (identity) state. */
export interface ResidualTransform {
    /** Outstanding translateX in px. */
    x: number;
    /** Outstanding translateY in px. */
    y: number;
    /** Outstanding scale on X, as a delta from 1 (0.5 means still at 1.5×). */
    scaleX: number;
    /** Outstanding scale on Y, as a delta from 1. */
    scaleY: number;
}

export const NO_RESIDUAL: ResidualTransform = Object.freeze({
    x: 0,
    y: 0,
    scaleX: 0,
    scaleY: 0,
});

const IDENTITY_EPS = 1e-4;

type Claimable = object;

/**
 * Animations this module created, per element.
 *
 * A `WeakMap` rather than a marker on the animation: WAAPI has no user-data
 * slot and `Animation.id` is not settable. Keying by element as well matters
 * for cost — `Element.getAnimations()` forces the browser to flush pending
 * animation state, and doing that once per row of a few-hundred-row sidebar on
 * every keystroke-induced reorder is the kind of cost nobody notices until the
 * list stutters. A `WeakMap` lookup is free.
 */
const OWN_BY_ELEMENT = new WeakMap<Element, Set<Claimable>>();

/** Ownership, independent of the element index below. */
const OWN_ANIMATIONS = new WeakSet<Claimable>();

export function isOwnAnimation(animation: unknown): boolean {
    return !!animation && typeof animation === "object" && OWN_ANIMATIONS.has(animation as Claimable);
}

/** Tag an animation created by this module so `remainingTransform` trusts it. */
export function claimAnimation(animation: unknown, element?: Element | null): void {
    if (!animation || typeof animation !== "object") return;
    const claimed = animation as Claimable;
    OWN_ANIMATIONS.add(claimed);
    if (!element) return;
    const set = OWN_BY_ELEMENT.get(element) ?? new Set<Claimable>();
    set.add(claimed);
    OWN_BY_ELEMENT.set(element, set);
}

/** Forget every animation recorded against `element`. Called once it is gone. */
export function forgetAnimations(element: Element | null | undefined): void {
    if (element) OWN_BY_ELEMENT.delete(element);
}

function isLive(animation: Claimable): boolean {
    const state = (animation as Animation).playState;
    // An unknown playState (a test double, an engine mid-implementation) is
    // treated as live: assuming "finished" would silently drop continuity.
    return state !== "finished" && state !== "idle";
}

/**
 * Animations this module started on `element`, newest last.
 *
 * Falls back to `getAnimations()` filtered by ownership, so a second instance
 * of this module (a dev hot reload, a duplicated chunk) still contributes its
 * residual to a shared element. Returns `[]` rather than throwing when WAAPI is
 * absent, which is the case in jsdom and in old WebViews.
 */
export function ownAnimations(element: Element | null | undefined): Claimable[] {
    if (!element) return [];
    const recorded = OWN_BY_ELEMENT.get(element);
    if (recorded && recorded.size > 0) return [...recorded];

    if (typeof element.getAnimations !== "function") return [];
    let found: unknown;
    try {
        found = element.getAnimations();
    } catch {
        return [];
    }
    if (!Array.isArray(found)) return [];
    return found.filter(isOwnAnimation);
}

/**
 * Whether this module instance has a live animation on `element`.
 *
 * A `WeakMap` read plus a `playState` check — no layout, no style flush — so
 * this is safe to call for every row on every update. It cannot see another
 * module instance's animations, which only costs continuity across a hot
 * reload.
 */
export function hasLiveOwnAnimation(element: Element | null | undefined): boolean {
    if (!element) return false;
    const recorded = OWN_BY_ELEMENT.get(element);
    if (recorded) {
        for (const animation of recorded) {
            if (isLive(animation)) return true;
        }
    }
    if (typeof element.getAnimations !== "function") return false;
    try {
        return element.getAnimations().length > 0;
    } catch {
        return false;
    }
}

function numbers(body: string): number[] {
    const out: number[] = [];
    for (const part of body.split(",")) {
        const parsed = Number.parseFloat(part);
        if (Number.isFinite(parsed)) out.push(parsed);
    }
    return out;
}

const TRANSLATE_RE = /translate(3d|X|Y|Z)?\(([^)]*)\)/g;
const SCALE_RE = /scale(3d|X|Y|Z)?\(([^)]*)\)/g;

/**
 * Reads the subset of CSS transform functions this module writes or consumes.
 * Deliberately not a general parser: it handles `translate`, `translateX/Y`,
 * `translate3d`, `scale`, `scaleX/Y` and `scale3d`, and ignores anything else
 * rather than guessing.
 */
export function parseTransform(value: string | null | undefined): {
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
} {
    const out = { x: 0, y: 0, scaleX: 1, scaleY: 1 };
    if (typeof value !== "string" || value === "") return out;

    for (const match of value.matchAll(TRANSLATE_RE)) {
        const args = numbers(match[2]);
        if (match[1] === "X") out.x += args[0] ?? 0;
        else if (match[1] === "Y") out.y += args[0] ?? 0;
        else {
            out.x += args[0] ?? 0;
            out.y += args[1] ?? 0;
        }
    }

    for (const match of value.matchAll(SCALE_RE)) {
        const args = numbers(match[2]);
        if (match[1] === "X") out.scaleX *= args[0] ?? 1;
        else if (match[1] === "Y") out.scaleY *= args[0] ?? 1;
        else if (match[1] === "3d") {
            out.scaleX *= args[0] ?? 1;
            out.scaleY *= args[1] ?? 1;
        } else {
            const scalar = args[0] ?? 1;
            out.scaleX *= scalar;
            out.scaleY *= scalar;
        }
    }

    return out;
}

function isIdentity(value: string | null | undefined): boolean {
    const parsed = parseTransform(value);
    return (
        Math.abs(parsed.x) < IDENTITY_EPS &&
        Math.abs(parsed.y) < IDENTITY_EPS &&
        Math.abs(parsed.scaleX - 1) < IDENTITY_EPS &&
        Math.abs(parsed.scaleY - 1) < IDENTITY_EPS
    );
}

/**
 * Residual of one animation.
 *
 * Only an animation that *ends at identity* can be expressed this way: at
 * progress `p` its current transform is `start + (0 - start) * p`, so the
 * distance still owed to reach `0` is exactly `start * (1 - p)`. For a scale the
 * same algebra gives `(start - 1) * (1 - p)`, measured from 1.
 */
function residualOf(animation: Claimable): ResidualTransform {
    try {
        const effect = (animation as Animation).effect as KeyframeEffect | null;
        if (!effect || typeof effect.getComputedTiming !== "function") return NO_RESIDUAL;
        if (!isLive(animation)) return NO_RESIDUAL;

        const progress = effect.getComputedTiming().progress;
        if (typeof progress !== "number" || !Number.isFinite(progress)) return NO_RESIDUAL;
        if (progress < 0 || progress >= 1) return NO_RESIDUAL;

        if (typeof effect.getKeyframes !== "function") return NO_RESIDUAL;
        const frames = effect.getKeyframes();
        if (!Array.isArray(frames) || frames.length === 0) return NO_RESIDUAL;

        const first = frames[0] as Keyframe;
        const last = frames[frames.length - 1] as Keyframe;
        if (!isIdentity(typeof last.transform === "string" ? last.transform : null)) return NO_RESIDUAL;

        const remaining = 1 - progress;
        const start = parseTransform(typeof first.transform === "string" ? first.transform : null);
        return {
            x: start.x * remaining,
            y: start.y * remaining,
            scaleX: (start.scaleX - 1) * remaining,
            scaleY: (start.scaleY - 1) * remaining,
        };
    } catch {
        return NO_RESIDUAL;
    }
}

/**
 * How far the element still owes travel, summed over every in-flight animation
 * this module owns. Returns zeros — never throws — when the element has no
 * animations, when WAAPI is missing, or when nothing can be trusted.
 */
export function remainingTransform(element: Element | null | undefined): ResidualTransform {
    const animations = ownAnimations(element);
    if (animations.length === 0) return NO_RESIDUAL;

    let x = 0;
    let y = 0;
    let scaleX = 0;
    let scaleY = 0;
    for (const animation of animations) {
        const residual = residualOf(animation);
        x += residual.x;
        y += residual.y;
        scaleX += residual.scaleX;
        scaleY += residual.scaleY;
    }
    if (x === 0 && y === 0 && scaleX === 0 && scaleY === 0) return NO_RESIDUAL;
    return { x, y, scaleX, scaleY };
}

/** Outstanding vertical travel, which is all a sidebar row ever needs. */
export function remainingOffset(element: Element | null | undefined): number {
    return remainingTransform(element).y;
}

/**
 * Drop this module's animations on `element` so a replacement does not
 * composite against them. Read `remainingTransform` *first* — cancelling sets
 * `playState` to `idle`, which zeroes the residual.
 */
export function cancelOwnAnimations(element: Element | null | undefined): void {
    for (const animation of ownAnimations(element)) {
        try {
            (animation as Animation).cancel();
        } catch {
            /* an animation that already ended throws on some engines */
        }
    }
    // Drop the per-element index as well, or it grows by one dead animation on
    // every update of the same row.
    if (element) OWN_BY_ELEMENT.delete(element);
}
