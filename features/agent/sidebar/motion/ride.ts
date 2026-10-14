/**
 * `ridingDelta` — which rows are travelling as one block, and how far that block
 * has already carried them.
 *
 * There is a trap here that is worth stating, because the obvious implementation
 * is wrong. A row's *measured* displacement already contains the displacement
 * caused by everything above it: inserting a row 40px tall above a list moves
 * every row below it down by 40px, and each of those rows measures that 40px
 * for itself. So you cannot read "the delta I inherited from the row above" out
 * of a row's own delta — it is not additive, it is the whole number.
 *
 * The inherited displacement is only recoverable from the *structural* changes
 * of an update: rows that entered contribute `+height` to everything below them,
 * rows that left contribute `-height`. This module reconstructs that running
 * total and attributes it to every row in the new order, events and bystanders
 * alike.
 *
 * What it is used for:
 *
 *  - an entering row that lands inside a block which is already travelling
 *    arrives along the block's direction, so the two read as one motion instead
 *    of the row fading in against the current;
 *  - callers can see the block structure rather than inferring it.
 *
 * What it is *not* used for, and this is the honest part: a plain reorder needs
 * no ride correction at all. Every displaced row plays the same delta over the
 * same duration with the same easing, so the block is already rigid — and an
 * interrupted row re-enters its own animation at exactly the offset it had
 * reached, which keeps it in step with its neighbours. Block coherence comes
 * from the per-row residual in `remaining.ts`, not from here.
 */

export interface RidingEvent {
    /** Stable row id (`data-motion-id`). */
    id: string;
    /** Space this row adds (positive) or removes (negative) for rows below it. */
    contribution: number;
    /**
     * Index in the new order of the **first row this change displaces** — not
     * the index of the changed row itself.
     *
     * A row entering at index 2 displaces the row that ends up at index 3; it
     * does not displace itself. A row that left has no index of its own, so its
     * event sits at the new index of the first surviving row that used to be
     * below it. Getting this off by one is the whole bug this comment exists to
     * prevent.
     */
    index: number;
}

export interface RidingDelta {
    /** This row's own contribution to the block, 0 for a bystander. */
    own: number;
    /** Running total of the contributions above this row. */
    inherited: number;
    /** Contribution of the row that started the block this row belongs to. */
    leader: number;
}

const ZERO: RidingDelta = { own: 0, inherited: 0, leader: 0 };

/**
 * @param events structural changes, any order.
 * @param order every row id in the new DOM order.
 * @returns id → block attribution, including for ids in `events` that are no
 * longer in the DOM.
 */
export function ridingDelta(
    events: readonly RidingEvent[],
    order: readonly string[],
): Map<string, RidingDelta> {
    const result = new Map<string, RidingDelta>();
    if (order.length === 0) return result;

    const eventsByIndex = new Map<number, RidingEvent[]>();
    for (const event of events) {
        const list = eventsByIndex.get(event.index) ?? [];
        list.push(event);
        eventsByIndex.set(event.index, list);
    }

    // `own` is collected up front rather than inside the walk below, because an
    // event can sit one past the end of the list (a row that arrived last). Such
    // an event displaces nobody, but callers still want to see what it added.
    const own = new Map<string, number>();
    for (const event of events) {
        const contribution = Number.isFinite(event.contribution) ? event.contribution : 0;
        own.set(event.id, (own.get(event.id) ?? 0) + contribution);
    }

    const blocks = new Map<string, { inherited: number; leader: number }>();
    let carry = 0;
    let leader = 0;

    order.forEach((id, index) => {
        // Events at this index have already happened as far as this row is
        // concerned, so they are applied before the row reads its offset.
        for (const event of eventsByIndex.get(index) ?? []) {
            const contribution = Number.isFinite(event.contribution) ? event.contribution : 0;
            if (contribution === 0) continue;
            if (carry === 0) leader = contribution;
            carry += contribution;
        }
        blocks.set(id, { inherited: carry, leader });
    });

    for (const id of order) {
        const block = blocks.get(id) ?? ZERO;
        result.set(id, { own: own.get(id) ?? 0, inherited: block.inherited, leader: block.leader });
    }
    // A row that left has no position to read an offset at, but callers still
    // want to see what it took with it.
    for (const [id, contribution] of own) {
        if (!result.has(id)) result.set(id, { own: contribution, inherited: 0, leader: 0 });
    }

    return result;
}

/** Convenience accessor that never throws on an unknown id. */
export function ridingFor(
    deltas: Map<string, RidingDelta>,
    id: string,
): RidingDelta {
    return deltas.get(id) ?? ZERO;
}

/**
 * Direction an entering or exiting row should travel: `1` means it rises from
 * below, `-1` means it drops in from above.
 *
 * Read off the nearest row that is actually moving, from its animation's start
 * offset. A start offset below zero means that row slides *downwards*, so the
 * block is being pushed down and a row landing at the top of it came from above.
 * A start offset above zero means the block is moving up, so a row landing at
 * the bottom of it came from below. With nothing moving there is no signal and
 * the default is a rise.
 */
export function ridingDirection(nearestStartOffset: number | null | undefined): number {
    if (nearestStartOffset === null || nearestStartOffset === undefined) return 1;
    if (!Number.isFinite(nearestStartOffset) || nearestStartOffset === 0) return 1;
    return nearestStartOffset < 0 ? -1 : 1;
}
