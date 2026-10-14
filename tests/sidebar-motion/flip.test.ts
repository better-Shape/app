import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    MAX_FADED_ROWS_PER_UPDATE,
    MOTION_ROW_SELECTOR,
    playFlip,
    snapshotRects,
    takeSnapshot,
} from "@/features/agent/sidebar/motion";
import {
    installAnimationStub,
    mountList,
    stubReducedMotion,
    stubRects,
    type AnimationStub,
    type ListFixture,
    type RecordedAnimation,
    type RectStub,
} from "./harness";

/**
 * 260ms below is deliberately not the module default (150). If `durationMs`
 * were ever ignored, this fails; asserting `duration === options.duration` with
 * the same constant on both sides could never fail at all.
 */
const TEST_DURATION_MS = 260;
const ROW_HEIGHT = 40;

let animation: AnimationStub;
let rects: RectStub;

beforeEach(() => {
    rects = stubRects();
    animation = installAnimationStub();
});

afterEach(() => {
    vi.useRealTimers();
    animation.restore();
    rects.restore();
    document.body.innerHTML = "";
});

function threeRows(): ListFixture {
    return mountList(
        [
            { id: "a", top: 0, height: ROW_HEIGHT },
            { id: "b", top: ROW_HEIGHT, height: ROW_HEIGHT },
            { id: "c", top: ROW_HEIGHT * 2, height: ROW_HEIGHT },
        ],
        rects,
    );
}

/** Creates a row directly in `container`, at a known box, without going through a fixture. */
function addRow(container: HTMLElement, id: string, top: number, height = ROW_HEIGHT): HTMLElement {
    const row = document.createElement("li");
    row.setAttribute("data-motion-id", id);
    row.className = "row";
    row.textContent = id;
    rects.set(row, { top, left: 0, width: 300, height });
    container.appendChild(row);
    return row;
}

function movesFor(id: string): RecordedAnimation[] {
    return animation.calls.filter((entry) => entry.element.getAttribute("data-motion-id") === id);
}

function onlyMoveFor(id: string): RecordedAnimation {
    const found = movesFor(id);
    if (found.length !== 1) throw new Error(`expected exactly one animation for ${id}, got ${found.length}`);
    return found[0];
}

function transformOf(entry: RecordedAnimation, index: number): string {
    const keyframe = entry.keyframes[index];
    return typeof keyframe?.transform === "string" ? keyframe.transform : String(keyframe?.transform);
}

describe("snapshotRects", () => {
    it("keys rows by data-motion-id in DOM order and records the box", () => {
        const fixture = threeRows();
        const snapshot = snapshotRects(fixture.container);

        expect([...snapshot.keys()]).toEqual(["a", "b", "c"]);
        expect(snapshot.get("b")?.rect).toEqual({ top: 40, left: 0, width: 300, height: 40 });
        expect(snapshot.get("b")?.element).toBe(fixture.row("b"));
    });

    it("records the container's own box so a later scroll can be told apart from a move", () => {
        const fixture = threeRows();
        rects.set(fixture.container, { top: 120, left: 8, width: 300, height: 120 });

        const snapshot = takeSnapshot(fixture.container);

        expect(snapshot.origin).toEqual({ top: 120, left: 8 });
        expect([...snapshot.rows.keys()]).toEqual(["a", "b", "c"]);
        expect(takeSnapshot(null)).toEqual({ rows: new Map(), origin: { top: 0, left: 0 } });
    });

    it("ignores descendants without the attribute and returns empty for no container", () => {
        const fixture = threeRows();
        const stray = document.createElement("div");
        stray.textContent = "not a row";
        fixture.container.appendChild(stray);

        expect([...snapshotRects(fixture.container).keys()]).toEqual(["a", "b", "c"]);
        expect(snapshotRects(null).size).toBe(0);
    });

    it("keeps the first of two rows sharing an id rather than losing the list", () => {
        const fixture = threeRows();
        fixture.container.appendChild(fixture.row("b").cloneNode(true));

        const snapshot = snapshotRects(fixture.container);
        expect(snapshot.size).toBe(3);
        expect(snapshot.get("b")?.element).toBe(fixture.row("b"));
    });
});

describe("playFlip — moves", () => {
    it("inverts a moved row to its previous position and eases to none", () => {
        const fixture = threeRows();
        const before = takeSnapshot(fixture.container);
        fixture.reorder(["b", "c", "a"]);

        const report = playFlip(before, fixture.container, { durationMs: TEST_DURATION_MS });

        expect(report.moved).toBe(3);
        expect(report.animations).toBe(3);
        // a sat at 0 and is now at 80, so it must start 80px above where it ends.
        expect(transformOf(onlyMoveFor("a"), 0)).toBe("translate(0px, -80px)");
        expect(transformOf(onlyMoveFor("a"), 1)).toBe("none");
        // c sat at 80 and is now at 40: one row up, so 40px below where it ends.
        expect(transformOf(onlyMoveFor("c"), 0)).toBe("translate(0px, 40px)");
        // b went from index 1 to index 0.
        expect(transformOf(onlyMoveFor("b"), 0)).toBe("translate(0px, 40px)");
    });

    it("animates nothing for a row whose position did not change", () => {
        const fixture = threeRows();
        const before = takeSnapshot(fixture.container);
        const extra = addRow(fixture.container, "d", ROW_HEIGHT * 3);

        const report = playFlip(before, fixture.container, { durationMs: TEST_DURATION_MS });

        expect(report.moved).toBe(0);
        expect(report.still.sort()).toEqual(["a", "b", "c"]);
        expect(report.entered).toBe(1);
        // Exactly one animation: the enter fade. Three stationary rows must not
        // each get a no-op animation.
        expect(animation.calls).toHaveLength(1);
        expect(animation.calls[0].element).toBe(extra);
        expect(movesFor("a")).toHaveLength(0);
        expect(movesFor("b")).toHaveLength(0);
        expect(movesFor("c")).toHaveLength(0);
    });

    it("ignores sub-pixel layout noise", () => {
        const fixture = threeRows();
        const before = takeSnapshot(fixture.container);
        fixture.setRect("a", { top: 0.2, left: 0, width: 300, height: ROW_HEIGHT });

        const report = playFlip(before, fixture.container, { durationMs: TEST_DURATION_MS });

        expect(report.moved).toBe(0);
        expect(animation.calls).toHaveLength(0);
    });

    it("moves on the horizontal axis too", () => {
        const fixture = threeRows();
        const before = takeSnapshot(fixture.container);
        fixture.setRect("c", { top: 80, left: 24, width: 300, height: ROW_HEIGHT });

        playFlip(before, fixture.container, { durationMs: TEST_DURATION_MS });

        expect(transformOf(onlyMoveFor("c"), 0)).toBe("translate(-24px, 0px)");
    });

    it("uses the duration and easing it was given", () => {
        const fixture = threeRows();
        const before = takeSnapshot(fixture.container);
        fixture.reorder(["b", "c", "a"]);

        playFlip(before, fixture.container, {
            durationMs: TEST_DURATION_MS,
            easing: "cubic-bezier(0, 0, 1, 1)",
        });

        expect(animation.calls).toHaveLength(3);
        for (const entry of animation.calls) {
            expect(entry.options.duration).toBe(260);
            expect(entry.options.easing).toBe("cubic-bezier(0, 0, 1, 1)");
            expect(entry.options.fill).toBe("none");
        }
    });
});

describe("playFlip — entering rows", () => {
    it("fades and rises a row appended at the bottom", () => {
        const fixture = threeRows();
        const before = takeSnapshot(fixture.container);
        addRow(fixture.container, "d", ROW_HEIGHT * 3);

        playFlip(before, fixture.container, { durationMs: TEST_DURATION_MS });

        const entry = onlyMoveFor("d");
        expect(entry.keyframes[0].opacity).toBe(0);
        expect(entry.keyframes[0].transform).toBe("translateY(40px)");
        expect(entry.keyframes[1].opacity).toBe(1);
        expect(entry.keyframes[1].transform).toBe("none");
    });

    it("drops a row in from above when the block below it is being pushed down", () => {
        const fixture = threeRows();
        const before = takeSnapshot(fixture.container);
        addRow(fixture.container, "z", 0);
        fixture.reorder(["z", "a", "b", "c"]);

        playFlip(before, fixture.container, { durationMs: TEST_DURATION_MS });

        // a/b/c all slide down 40, so the new top row belongs at the head of
        // that block and must arrive from above rather than rise through it.
        expect(transformOf(onlyMoveFor("a"), 0)).toBe("translate(0px, -40px)");
        expect(onlyMoveFor("z").keyframes[0].transform).toBe("translateY(-40px)");
        expect(onlyMoveFor("z").keyframes[0].opacity).toBe(0);
    });

    it("clamps a tall card's travel to 40px instead of its own height", () => {
        const fixture = mountList([{ id: "tall", top: 0, height: 400 }], rects);
        const before = takeSnapshot(fixture.container);
        addRow(fixture.container, "s", 0, 400);
        fixture.setRect("tall", { top: 400, left: 0, width: 300, height: 400 });

        playFlip(before, fixture.container, { durationMs: TEST_DURATION_MS });

        expect(onlyMoveFor("s").keyframes[0].transform).toBe("translateY(-40px)");
    });
});

describe("playFlip — exiting rows", () => {
    it("clones the removed row into an inert, unidentifiable ghost", () => {
        const fixture = threeRows();
        const before = takeSnapshot(fixture.container);
        fixture.row("b").remove();

        const report = playFlip(before, fixture.container, { durationMs: TEST_DURATION_MS });

        expect(report.exited).toBe(1);
        expect(report.animations).toBe(1);

        const ghost = fixture.container.lastElementChild as HTMLElement;
        // The ghost must be invisible to the row query, or the next snapshot
        // would treat it as a real row.
        expect(fixture.container.querySelectorAll(MOTION_ROW_SELECTOR)).toHaveLength(2);
        expect(ghost.hasAttribute("data-motion-id")).toBe(false);
        expect(ghost.hasAttribute("id")).toBe(false);
        expect(ghost.getAttribute("aria-hidden")).toBe("true");
        expect(ghost.hasAttribute("inert")).toBe(true);
        // The class list is the entire visual point of cloning, so it stays.
        expect(ghost.className).toBe("row");
        expect(ghost.textContent).toBe("b");
    });

    it("collapses the ghost from full height and takes it off the DOM when it settles", () => {
        vi.useFakeTimers();
        const fixture = threeRows();
        const before = takeSnapshot(fixture.container);
        fixture.row("b").remove();

        playFlip(before, fixture.container, { durationMs: TEST_DURATION_MS });

        const ghost = animation.calls[0];
        expect(ghost.keyframes[0].height).toBe("40px");
        expect(ghost.keyframes[0].opacity).toBe(1);
        expect(ghost.keyframes[1].height).toBe("0px");
        expect(ghost.keyframes[1].opacity).toBe(0);
        expect(fixture.container.children).toHaveLength(3);

        vi.advanceTimersByTime(TEST_DURATION_MS + 1000);
        expect(fixture.container.children).toHaveLength(2);
    });

    it("takes the ghost out of the flow so the closed gap does not open again", () => {
        const fixture = threeRows();
        const before = takeSnapshot(fixture.container);
        fixture.row("b").remove();

        playFlip(before, fixture.container, { durationMs: TEST_DURATION_MS });

        const ghost = fixture.container.lastElementChild as HTMLElement;
        expect(ghost.style.position).toBe("absolute");
        expect(ghost.style.pointerEvents).toBe("none");
        expect(ghost.style.height).toBe("40px");
        // The container becomes a positioning context so the absolute ghost is
        // placed against the list, not the viewport.
        expect(fixture.container.style.position).toBe("relative");
    });

    it("does not animate a removal when reduced motion is on", () => {
        const restore = stubReducedMotion(true);
        try {
            const fixture = threeRows();
            const before = takeSnapshot(fixture.container);
            fixture.row("b").remove();

            const report = playFlip(before, fixture.container, { durationMs: TEST_DURATION_MS });

            expect(report.exited).toBe(1);
            expect(report.animations).toBe(0);
            expect(animation.calls).toHaveLength(0);
            expect(fixture.container.children).toHaveLength(2);
        } finally {
            restore();
        }
    });
});

describe("playFlip — budgets and preferences", () => {
    it("creates no animations at all when reduced motion is on", () => {
        const restore = stubReducedMotion(true);
        try {
            const fixture = threeRows();
            const before = takeSnapshot(fixture.container);
            fixture.reorder(["c", "b", "a"]);

            const report = playFlip(before, fixture.container, { durationMs: TEST_DURATION_MS });

            // Only c and a actually changed index; b stayed put at index 1.
            expect(report.moved).toBe(2);
            expect(report.still).toEqual(["b"]);
            expect(report.animations).toBe(0);
            expect(animation.calls).toHaveLength(0);
        } finally {
            restore();
        }
    });

    it("animates a fade storm of exactly 40 and jumps at 41", () => {
        // The upstream number, pinned so changing it has to be deliberate.
        expect(MAX_FADED_ROWS_PER_UPDATE).toBe(40);

        const atBudget = mountList(
            Array.from({ length: 20 }, (_, index) => ({ id: `old-${index}`, top: index * ROW_HEIGHT })),
            rects,
        );
        const before = takeSnapshot(atBudget.container);
        for (const row of atBudget.rows()) row.remove();
        for (let index = 0; index < 20; index += 1) {
            addRow(atBudget.container, `new-${index}`, index * ROW_HEIGHT);
        }

        const report = playFlip(before, atBudget.container, { durationMs: TEST_DURATION_MS });
        // 20 leaving + 20 arriving is the budget exactly.
        expect(report.skipped).toBe(false);
        expect(report.animations).toBe(40);
        expect(animation.calls).toHaveLength(40);
    });

    it("jumps the whole update when the fades exceed the budget", () => {
        const fixture = mountList(
            Array.from({ length: 21 }, (_, index) => ({ id: `old-${index}`, top: index * ROW_HEIGHT })),
            rects,
        );
        const before = takeSnapshot(fixture.container);
        for (const row of fixture.rows()) row.remove();
        for (let index = 0; index < 21; index += 1) {
            addRow(fixture.container, `new-${index}`, index * ROW_HEIGHT);
        }

        const report = playFlip(before, fixture.container, { durationMs: TEST_DURATION_MS });

        expect(report.exited).toBe(21);
        expect(report.entered).toBe(21);
        expect(report.skipped).toBe(true);
        expect(report.animations).toBe(0);
        expect(animation.calls).toHaveLength(0);
        // No ghosts either: a skipped update must not leave anything behind.
        expect(fixture.container.children).toHaveLength(21);
    });

    it("honours an explicit maxAnimatedRows and still reports what moved", () => {
        const fixture = threeRows();
        const before = takeSnapshot(fixture.container);
        fixture.row("a").remove();
        fixture.reorder(["c", "b"]);

        const report = playFlip(before, fixture.container, {
            durationMs: TEST_DURATION_MS,
            maxAnimatedRows: 0,
        });

        expect(report.skipped).toBe(true);
        expect(report.animations).toBe(0);
        expect(report.exited).toBe(1);
        // c slid from 80 to 0 and b never moved: the report says so even though
        // nothing was drawn.
        expect(report.moved).toBe(1);
        expect(report.still).toEqual(["b"]);
    });

    it("does not count plain moves against the fade budget", () => {
        const fixture = mountList(
            Array.from({ length: 60 }, (_, index) => ({ id: `r-${index}`, top: index * ROW_HEIGHT })),
            rects,
        );
        const before = takeSnapshot(fixture.container);
        const reversed = [...fixture.rows()].reverse();
        for (const row of reversed) fixture.container.appendChild(row);
        reversed.forEach((row, index) => {
            rects.set(row, { top: index * ROW_HEIGHT, left: 0, width: 300, height: ROW_HEIGHT });
        });

        const report = playFlip(before, fixture.container, { durationMs: TEST_DURATION_MS });

        // 60 rows moved and none of them faded, so the fade budget is untouched.
        expect(report.moved).toBe(60);
        expect(report.entered).toBe(0);
        expect(report.exited).toBe(0);
        expect(report.skipped).toBe(false);
        expect(report.animations).toBe(60);
    });
});

describe("playFlip — riding", () => {
    it("attributes an inserted row's height to every row it displaced", () => {
        const fixture = threeRows();
        const before = takeSnapshot(fixture.container);
        addRow(fixture.container, "n", 0);
        fixture.reorder(["n", "a", "b", "c"]);

        const report = playFlip(before, fixture.container, { durationMs: TEST_DURATION_MS });

        // The inserted row owns the block.
        expect(report.riding.get("n")).toEqual({ own: 40, inherited: 0, leader: 0 });
        // Rows it displaced cannot measure that themselves; this is where they
        // learn it.
        expect(report.riding.get("a")).toEqual({ own: 0, inherited: 40, leader: 40 });
        expect(report.riding.get("c")?.inherited).toBe(40);
    });

    it("accumulates two insertions for the rows below both of them", () => {
        const fixture = threeRows();
        const before = takeSnapshot(fixture.container);
        addRow(fixture.container, "n", 0);
        const middle = addRow(fixture.container, "m", 80);
        fixture.container.insertBefore(middle, fixture.row("b"));
        fixture.reorder(["n", "a", "m", "b", "c"]);

        const report = playFlip(before, fixture.container, { durationMs: TEST_DURATION_MS });

        expect(report.riding.get("a")?.inherited).toBe(40);
        expect(report.riding.get("m")?.inherited).toBe(40);
        expect(report.riding.get("c")?.inherited).toBe(80);
        // The second insertion leads its own sub-block.
        expect(report.riding.get("c")?.leader).toBe(40);
    });

    it("gives a removal a negative contribution", () => {
        const fixture = threeRows();
        const before = takeSnapshot(fixture.container);
        fixture.row("b").remove();
        fixture.reorder(["a", "c"]);

        const report = playFlip(before, fixture.container, { durationMs: TEST_DURATION_MS });

        expect(report.riding.get("b")?.own).toBe(-40);
        expect(report.riding.get("a")?.inherited).toBe(0);
        expect(report.riding.get("c")?.inherited).toBe(-40);
    });
});

describe("playFlip — interrupted animations", () => {
    it("resumes from the un-elapsed travel instead of snapping back", () => {
        const fixture = threeRows();
        const first = takeSnapshot(fixture.container);
        fixture.reorder(["b", "c", "a"]);
        playFlip(first, fixture.container, { durationMs: TEST_DURATION_MS });

        // a is travelling to -80 and is a quarter of the way there, so 60px is
        // still owed. 0.25 rather than 0.5 on purpose: at the halfway point
        // `progress` and `1 - progress` are equal, so a test at 0.5 cannot tell
        // a correct residual from one with the sign flipped.
        const moving = onlyMoveFor("a");
        expect(transformOf(moving, 0)).toBe("translate(0px, -80px)");
        moving.progress = 0.25;

        // The next update leaves every row exactly where it is. Textbook FLIP
        // would compute a delta of 0 and skip the row; the residual is the only
        // reason it keeps moving.
        const second = takeSnapshot(fixture.container);
        fixture.reorder(["b", "c", "a"]);
        const report = playFlip(second, fixture.container, { durationMs: TEST_DURATION_MS });

        expect(report.moved).toBe(1);
        const resumed = movesFor("a").at(-1)!;
        expect(resumed).not.toBe(moving);
        // 60 of the original 80px is unspent, so the row has 60px left to go.
        expect(transformOf(resumed, 0)).toBe("translate(0px, -60px)");
        // The animation it replaces must be cancelled, or the two composite.
        expect(moving.cancelled).toBe(true);
    });

    it("ignores a residual from an animation this module did not create", () => {
        const fixture = threeRows();
        // A foreign animation on the row: started directly, so never claimed.
        const foreign = fixture.row("a").animate(
            [{ transform: "translate(0, -500px)" }, { transform: "none" }],
            { duration: 1000 },
        ) as unknown as { progress: number | null };
        foreign.progress = 0.5;

        const before = takeSnapshot(fixture.container);
        fixture.reorder(["b", "c", "a"]);
        playFlip(before, fixture.container, { durationMs: TEST_DURATION_MS });

        // The foreign animation is on the row and is half way through, so an
        // implementation that trusted getAnimations() would carry -250px of it
        // and produce translate(0, -330px).
        const onRow = movesFor("a");
        expect(onRow).toHaveLength(2);
        expect(onRow[0]).toBe(foreign);
        expect(transformOf(onRow[1], 0)).toBe("translate(0px, -80px)");
    });
});

describe("playFlip — container drift", () => {
    it("cancels a container shift so a scroll does not animate the whole list", () => {
        const fixture = threeRows();
        const before = takeSnapshot(fixture.container);
        // Everything — container included — slides 500px up the viewport. That is
        // a scroll or a sidebar collapse, not a reorder.
        rects.set(fixture.container, { top: -500, left: 0, width: 300, height: 120 });
        for (const id of ["a", "b", "c"]) {
            const base = id === "a" ? 0 : id === "b" ? 40 : 80;
            fixture.setRect(id, { top: base - 500, left: 0, width: 300, height: 40 });
        }

        const report = playFlip(before, fixture.container, { durationMs: TEST_DURATION_MS });

        // The rows kept their positions relative to the list, so nothing moved.
        expect(report.moved).toBe(0);
        expect(report.still.sort()).toEqual(["a", "b", "c"]);
        expect(animation.calls).toHaveLength(0);
    });

    it("still animates a real move that rides along with a container shift", () => {
        const fixture = threeRows();
        const before = takeSnapshot(fixture.container);
        rects.set(fixture.container, { top: -500, left: 0, width: 300, height: 120 });
        fixture.reorder(["b", "c", "a"]);
        rects.set(fixture.container, { top: -500, left: 0, width: 300, height: 120 });
        for (const id of ["a", "b", "c"]) {
            const index = ["b", "c", "a"].indexOf(id);
            fixture.setRect(id, { top: index * 40 - 500, left: 0, width: 300, height: 40 });
        }

        const report = playFlip(before, fixture.container, { durationMs: TEST_DURATION_MS });

        // a slid from index 0 to index 2 inside the list: 80px, not 580px.
        expect(report.moved).toBe(3);
        expect(transformOf(onlyMoveFor("a"), 0)).toBe("translate(0px, -80px)");
    });
});

describe("playFlip — degenerate input", () => {
    it("returns a zeroed report for a missing container", () => {
        const report = playFlip(new Map(), null, { durationMs: TEST_DURATION_MS });
        expect(report).toMatchObject({ moved: 0, entered: 0, exited: 0, animations: 0, skipped: false });
    });

    it("creates no animations when the Web Animations API is missing", () => {
        delete (Element.prototype as unknown as Record<string, unknown>).animate;
        const fixture = threeRows();
        const before = takeSnapshot(fixture.container);
        fixture.reorder(["c", "b", "a"]);
        const removed = fixture.row("b");
        removed.remove();

        const report = playFlip(before, fixture.container, { durationMs: TEST_DURATION_MS });

        // b was reordered into the middle and then removed, so only c and a
        // survive, and both slid.
        expect(report.moved).toBe(2);
        expect(report.exited).toBe(1);
        expect(report.animations).toBe(0);
        // No clone can be animated, so no clone is created either.
        expect(fixture.container.children).toHaveLength(2);
        expect(fixture.container.querySelectorAll(MOTION_ROW_SELECTOR)).toHaveLength(2);
    });
});
