/**
 * FLIP (First, Last, Invert, Play) for the sidebar row list, on the Web
 * Animations API.
 *
 * FLIP normally wants a measurement before the DOM changes and one after.
 * React hands us the "after" for free inside a `useLayoutEffect`, and the
 * "before" is simply the snapshot the *previous* layout effect took, because
 * nothing has painted in between — layout effects run after commit, before
 * paint. `useFlipMotion` builds on that; its docblock spells the reasoning out.
 *
 * The "invert" step is the animation's first keyframe. A row whose layout top
 * moved by `delta` starts at `translate(-delta)` and eases to `none`, which
 * paints it back where it was and then lets go. No `fill`, no inline style, no
 * cleanup pass: by the time the animation ends the element already sits where
 * the browser thinks it sits.
 */

import {
    FLIP_DURATION_MS,
    FLIP_EASING,
    canAnimate,
    isMovingSize,
    prefersReducedMotion,
    rowTravel,
} from "./env";
import {
    cancelOwnAnimations,
    claimAnimation,
    forgetAnimations,
    hasLiveOwnAnimation,
    remainingTransform,
} from "./remaining";
import { playRowExit } from "./exit";
import { ridingDelta, ridingDirection, type RidingDelta, type RidingEvent } from "./ride";

export const MOTION_ID_ATTRIBUTE = "data-motion-id";
export const MOTION_ROW_SELECTOR = `[${MOTION_ID_ATTRIBUTE}]`;

/**
 * Above this many *fading* rows in one update the animation is skipped and the
 * list jumps.
 *
 * This is t3code's `MAX_FADED_ROWS_PER_UPDATE` and it is the upstream author's
 * number, not a threshold we measured. Their stated reason is that fades are the
 * expensive half — each one is a deep clone plus its own animation plus forced
 * reflows between the layout reads — while translating rows that are already
 * mounted is cheap. We therefore budget *fades only*. Counting plain moves too
 * would mean a 200-row sidebar refusing to animate because 41 rows shifted one
 * pixel, which is the wrong trade.
 */
export const MAX_FADED_ROWS_PER_UPDATE = 40;

export interface MotionRect {
    top: number;
    left: number;
    width: number;
    height: number;
}

export interface MotionRow {
    id: string;
    rect: MotionRect;
    /** Kept so an exit can clone a node React has already detached. */
    element: HTMLElement;
}

/** Keyed by `data-motion-id`, in DOM order. */
export type MotionSnapshot = Map<string, MotionRow>;

/**
 * Where the container itself was on screen when a snapshot was taken.
 *
 * `getBoundingClientRect` is viewport-relative, so anything that shifts the
 * container's whole box — a scroll of any ancestor, a sidebar collapse, a panel
 * opening — shifts every row's rect by the same amount and reads as the entire
 * list having moved. The list did not move relative to its own container, so it
 * must not animate. One origin recorded per snapshot cancels all of them at once.
 */
export interface ContainerOrigin {
    top: number;
    left: number;
}

export interface FlipSnapshot {
    rows: MotionSnapshot;
    origin: ContainerOrigin;
}

/** Snapshot the rows and the container's own box in one pass. */
export function takeSnapshot(container: HTMLElement | null | undefined): FlipSnapshot {
    if (!container) return { rows: new Map(), origin: { top: 0, left: 0 } };
    const box = container.getBoundingClientRect();
    return { rows: snapshotRects(container), origin: { top: box.top, left: box.left } };
}

export interface PlayFlipOptions {
    durationMs?: number;
    easing?: string;
    maxAnimatedRows?: number;
    /** Overrides the `prefers-reduced-motion` probe. */
    reducedMotion?: boolean;
}

export interface FlipReport {
    /** Rows with a live, non-remainder animation. */
    moved: number;
    entered: number;
    exited: number;
    /** True when the fade budget was blown and nothing was animated. */
    skipped: boolean;
    /** Animations started, exit clones included. */
    animations: number;
    /** Ids that did not move at all. */
    still: string[];
    /** Per-row block attribution, so callers can inspect the ride. */
    riding: Map<string, RidingDelta>;
}

interface MovePlan {
    id: string;
    element: HTMLElement;
    /** Index in the new DOM order. */
    index: number;
    /** Signed translate the animation starts at, in px. */
    x: number;
    y: number;
}

/** Rows currently in the container, keyed by `data-motion-id`, in DOM order. */
export function snapshotRects(container: HTMLElement | null | undefined): MotionSnapshot {
    const snapshot: MotionSnapshot = new Map();
    if (!container) return snapshot;
    const rows = container.querySelectorAll<HTMLElement>(MOTION_ROW_SELECTOR);
    rows.forEach((element) => {
        const id = element.getAttribute(MOTION_ID_ATTRIBUTE);
        // Duplicate ids would let one row silently overwrite another. First wins,
        // so the rest of the list still animates.
        if (!id || snapshot.has(id)) return;
        snapshot.set(id, { id, rect: rectOf(element), element });
    });
    return snapshot;
}

function rectOf(element: Element): MotionRect {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

/**
 * Where a row must start for the animation to be invisible.
 *
 * The user last saw this row at `beforeTop + residual`, where `residual` is the
 * transform an interrupted animation has not yet spent. It has to end at
 * `nowTop`. So the start offset is `beforeTop + residual - nowTop`.
 *
 * With nothing in flight the residual is 0 and this collapses to `-delta`, the
 * textbook FLIP inversion. Carrying the residual is the whole point: it turns
 * an interrupted move from a teleport into a glide.
 */
function planMoves(before: MotionSnapshot, now: MotionSnapshot, drift: MotionRect): MovePlan[] {
    const plans: MovePlan[] = [];
    let index = 0;
    for (const [id, current] of now) {
        const position = index;
        index += 1;
        const previous = before.get(id);
        if (!previous) continue;

        // Cheap rejection first. A row that neither moved nor has one of our
        // animations in flight cannot need a residual, and asking anyway would
        // force the browser to flush animation state once per row.
        const rawX = previous.rect.left - current.rect.left + drift.left;
        const rawY = previous.rect.top - current.rect.top + drift.top;
        if (!isMovingSize(rawX) && !isMovingSize(rawY) && !hasLiveOwnAnimation(current.element)) continue;

        const residual = remainingTransform(current.element);
        const x = rawX + residual.x;
        const y = rawY + residual.y;
        if (!isMovingSize(x) && !isMovingSize(y)) continue;

        plans.push({ id, element: current.element, index: position, x, y });
    }
    return plans;
}

/** Nearest moving row above, then below, the given DOM position. */
function nearestMovingDelta(moves: readonly MovePlan[], position: number): number | null {
    for (let i = moves.length - 1; i >= 0; i -= 1) {
        if (moves[i].index < position) return moves[i].y;
    }
    for (const move of moves) {
        if (move.index > position) return move.y;
    }
    return null;
}

/**
 * DOM index of the first row a removal displaces: the first surviving row that
 * used to sit below the removed one. Falls off the end of the list if nothing
 * below it survived, in which case the removal displaced nothing.
 */
function indexBelowOldPosition(before: MotionSnapshot, id: string, order: readonly string[]): number {
    const positions = new Map<string, number>();
    order.forEach((rowId, index) => positions.set(rowId, index));

    let seen = false;
    for (const rowId of before.keys()) {
        if (rowId === id) {
            seen = true;
            continue;
        }
        if (!seen) continue;
        const position = positions.get(rowId);
        if (position !== undefined) return position;
    }
    return order.length;
}

/**
 * Rounds away float tails and `-0`, and always emits a unit: `translate(0, -80)`
 * is invalid CSS — the browser drops the whole transform and the row teleports.
 */
function isFlipSnapshot(value: MotionSnapshot | FlipSnapshot): value is FlipSnapshot {
    return value instanceof Map === false && typeof (value as FlipSnapshot).rows === "object";
}

function formatPx(value: number): string {
    if (!Number.isFinite(value)) return "0px";
    const rounded = Math.round(value * 1000) / 1000;
    return `${Object.is(rounded, -0) ? 0 : rounded}px`;
}

/**
 * Animate the difference between two snapshots. Call it after React has
 * committed the new DOM, with `before` being the snapshot taken in the previous
 * layout effect.
 *
 * Accepts either a `MotionSnapshot` or a full `FlipSnapshot`. When the caller
 * only has the former — which is the common case when it took a plain
 * `snapshotRects` — no container-origin correction is applied, so a scroll
 * landing between two commits will read as a whole-list move. Prefer
 * `takeSnapshot` at both ends.
 */
export function playFlip(
    before: MotionSnapshot | FlipSnapshot,
    container: HTMLElement | null | undefined,
    options: PlayFlipOptions = {},
): FlipReport {
    // One layout read per update. Snapshotting twice would force two rounds of
    // reflows for a list that can be a few hundred rows.
    const current = takeSnapshot(container);
    const now = current.rows;
    const order = [...now.keys()];

    const previous = isFlipSnapshot(before) ? before : null;
    const beforeRows = previous ? previous.rows : (before as MotionSnapshot);

    const report: FlipReport = {
        moved: 0,
        entered: 0,
        exited: 0,
        skipped: false,
        animations: 0,
        still: [],
        riding: new Map(),
    };
    if (!container) return report;

    // How far the container itself moved between the two snapshots.
    //
    // A row at list-position `p` sits at `containerOrigin + p` in viewport
    // coordinates, so the container's own movement is in every rect and has to
    // come back out:
    //
    //   (prevTop - C1) - (curTop - C2)  ==  prevTop - curTop + (C2 - C1)
    //
    // Rows moved relative to the container; only that is an animation.
    const drift: MotionRect = previous
        ? {
              top: current.origin.top - previous.origin.top,
              left: current.origin.left - previous.origin.left,
              width: 0,
              height: 0,
          }
        : { top: 0, left: 0, width: 0, height: 0 };

    const entering: MotionRow[] = [];
    const enteringIndex = new Map<string, number>();
    order.forEach((id, index) => {
        if (beforeRows.has(id)) return;
        const row = now.get(id);
        if (!row) return;
        entering.push(row);
        enteringIndex.set(id, index);
    });

    const exiting: MotionRow[] = [];
    for (const [id, row] of beforeRows) {
        if (!now.has(id)) exiting.push(row);
    }

    report.entered = entering.length;
    report.exited = exiting.length;

    // Block attribution is computed even when the animation is skipped: it is a
    // pure function of the structural change and costs nothing to keep honest.
    const events: RidingEvent[] = [];
    for (const row of entering) {
        // A row that arrives does not displace itself; it displaces the row that
        // ends up after it.
        events.push({
            id: row.id,
            contribution: row.rect.height,
            index: (enteringIndex.get(row.id) ?? order.length - 1) + 1,
        });
    }
    for (const row of exiting) {
        events.push({
            id: row.id,
            contribution: -row.rect.height,
            index: indexBelowOldPosition(beforeRows, row.id, order),
        });
    }
    report.riding = ridingDelta(events, order);

    // Everything below is computed before the budget and preference gates, so
    // the report describes what actually changed even when nothing was drawn.
    const moves = planMoves(beforeRows, now, drift);
    report.moved = moves.length;
    const movingIds = new Set(moves.map((move) => move.id));
    report.still = order.filter((id) => beforeRows.has(id) && !movingIds.has(id));

    const fades = entering.length + exiting.length;
    const budget = options.maxAnimatedRows ?? MAX_FADED_ROWS_PER_UPDATE;
    if (fades > budget) {
        report.skipped = true;
        return report;
    }
    if (options.reducedMotion ?? prefersReducedMotion(container)) return report;

    const duration = options.durationMs ?? FLIP_DURATION_MS;
    const easing = options.easing ?? FLIP_EASING;
    const timings = { duration, easing, fill: "none" as const };

    for (const move of moves) {
        if (!canAnimate(move.element)) continue;
        cancelOwnAnimations(move.element);
        const animation = move.element.animate(
            [
                { transform: `translate(${formatPx(move.x)}, ${formatPx(move.y)})` },
                { transform: "none" },
            ],
            timings,
        );
        claimAnimation(animation, move.element);
        report.animations += 1;
    }

    for (const row of entering) {
        if (!canAnimate(row.element)) continue;
        cancelOwnAnimations(row.element);
        const index = enteringIndex.get(row.id) ?? 0;
        // A new row lands where the list already put it, so its travel is a
        // guess; riding the block's direction is what makes the guess read right.
        const direction = ridingDirection(nearestMovingDelta(moves, index));
        const travel = rowTravel(row.rect.height);
        const animation = row.element.animate(
            [
                { opacity: 0, transform: `translateY(${formatPx(direction * travel)})` },
                { opacity: 1, transform: "none" },
            ],
            timings,
        );
        claimAnimation(animation, row.element);
        report.animations += 1;
    }

    for (const row of exiting) {
        // Read the residual off the detached original *before* dropping our claim
        // on it, so a long-lived list does not accumulate dead nodes.
        const clone = playRowExit(container, row, { durationMs: duration, easing });
        forgetAnimations(row.element);
        if (clone) report.animations += 1;
    }

    return report;
}
