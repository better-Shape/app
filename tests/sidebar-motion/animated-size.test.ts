import { describe, expect, it, vi } from "vitest";
import {
    SIZE_FALLBACK_MS,
    SIZE_SETTLE_FRAMES,
    createAnimatedSize,
    type AnimatedSize,
    type AnimatedSizeObserver,
} from "@/features/agent/sidebar/motion";

/**
 * The controller takes its scheduler, its observer and its clock as options, so
 * the whole settle sequence can be driven deterministically. jsdom has no
 * layout, so `read` is a plain closure over a number the test moves.
 */

interface Harness {
    controller: ReturnType<typeof createAnimatedSize>;
    writes: Array<AnimatedSize | null>;
    /** Advance the "content" the observer would report. */
    setContent(size: AnimatedSize): void;
    /** Fire the observer callback, as a real ResizeObserver would. */
    fireObserver(): void;
    /** Run the next scheduled frame, as a real rAF would. */
    runFrame(): void;
    /** Run every remaining scheduled frame. */
    runFrames(n?: number): void;
    runFallback(): void;
    fallbackPending(): boolean;
    /** Frames still queued. */
    frameCount: number;
    /** Timers still queued. */
    timerCount: number;
    element: HTMLElement;
    observed: Element[];
    disposed: number;
}

function harness(
    overrides: Partial<Parameters<typeof createAnimatedSize>[0]> = {},
    content: AnimatedSize = { width: 300, height: 40 },
): Harness {
    let current = content;
    const writes: Array<AnimatedSize | null> = [];
    const frames: Array<{ callback: () => void }> = [];
    const timers: Array<{ callback: () => void }> = [];
    const observed: Element[] = [];
    let disposed = 0;

    const observer: AnimatedSizeObserver = {
        observe(element) {
            observed.push(element);
        },
        disconnect() {
            disposed += 1;
        },
    };

    // The cancel handles actually remove the callback, the way `cancelAnimationFrame`
    // and `clearTimeout` do. A stub that no-ops on cancel would let the module's
    // `clearPending()` look like it works when nothing was really dropped.
    const controller = createAnimatedSize({
        open: () => true,
        read: () => current,
        write: (next) => writes.push(next),
        createObserver: () => observer,
        scheduleFrame: (callback) => {
            const token = { callback };
            frames.push(token);
            return () => {
                const index = frames.indexOf(token);
                if (index >= 0) frames.splice(index, 1);
            };
        },
        scheduleTimer: (callback) => {
            const token = { callback };
            timers.push(token);
            return () => {
                const index = timers.indexOf(token);
                if (index >= 0) timers.splice(index, 1);
            };
        },
        ...overrides,
    });

    return {
        controller,
        writes,
        setContent(next) {
            current = next;
        },
        fireObserver() {
            controller.sync();
        },
        runFrame() {
            const token = frames.shift();
            token?.callback();
        },
        runFrames(count = 5) {
            for (let index = 0; index < count; index += 1) {
                if (frames.length === 0) break;
                this.runFrame();
            }
        },
        runFallback() {
            const token = timers.shift();
            token?.callback();
        },
        fallbackPending() {
            return timers.length > 0;
        },
        get frameCount() {
            return frames.length;
        },
        get timerCount() {
            return timers.length;
        },
        element: document.createElement("div"),
        observed,
        get disposed() {
            return disposed;
        },
    } as Harness;
}

describe("createAnimatedSize — constants", () => {
    it("uses the upstream settle budget", () => {
        // 250ms fallback and two follow-up frames, as t3code's AnimatedHeight
        // does. Changing these changes how long a box can look wrong.
        expect(SIZE_FALLBACK_MS).toBe(250);
        expect(SIZE_SETTLE_FRAMES).toBe(2);
    });
});

describe("createAnimatedSize — attaching", () => {
    it("observes the element and pins its current size on attach", () => {
        const h = harness();
        h.controller.attach(h.element);

        expect(h.observed).toEqual([h.element]);
        expect(h.writes).toEqual([{ width: 300, height: 40 }]);
        expect(h.controller.held()).toEqual({ width: 300, height: 40 });
    });

    it("does not re-attach the same element twice", () => {
        const h = harness();
        h.controller.attach(h.element);
        h.controller.attach(h.element);

        expect(h.observed).toHaveLength(1);
    });

    it("releases the wrapper and disconnects on detach", () => {
        const h = harness();
        h.controller.attach(h.element);
        h.controller.detach();

        expect(h.disposed).toBe(1);
        expect(h.writes.at(-1)).toBeNull();
        expect(h.controller.held()).toBeNull();
    });

    it("re-establishes a baseline after a detach so the next change animates", () => {
        const h = harness();
        h.controller.attach(h.element);
        h.controller.detach();

        const writesBefore = h.writes.length;
        h.controller.attach(h.element);
        expect(h.writes.length).toBe(writesBefore + 1);
        expect(h.controller.held()).toEqual({ width: 300, height: 40 });
    });

    it("ignores sync and attach after dispose, and releases what it was pinning", () => {
        const h = harness();
        h.controller.attach(h.element);
        expect(h.controller.held()).toEqual({ width: 300, height: 40 });

        h.controller.dispose();
        // Disposing must release the wrapper; a disposed controller that kept
        // pinning a size would strand the box at a stale height.
        expect(h.controller.held()).toBeNull();
        expect(h.writes.at(-1)).toBeNull();

        h.controller.attach(h.element);
        expect(h.observed).toHaveLength(1);
        h.setContent({ width: 300, height: 900 });
        h.fireObserver();
        expect(h.controller.held()).toBeNull();
    });
});

describe("createAnimatedSize — measuring and transitioning", () => {
    it("follows a content change", () => {
        const h = harness();
        h.controller.attach(h.element);

        h.setContent({ width: 300, height: 120 });
        h.fireObserver();

        expect(h.controller.held()).toEqual({ width: 300, height: 120 });
    });

    it("collapses to zero when closed, and back when reopened", () => {
        let open = false;
        const h = harness({ open: () => open });
        h.controller.attach(h.element);
        // Closed from the start: the box must start collapsed, not at its
        // content's natural height.
        expect(h.controller.held()).toEqual({ width: 0, height: 0 });

        open = true;
        h.setContent({ width: 300, height: 64 });
        h.fireObserver();
        expect(h.controller.held()).toEqual({ width: 300, height: 64 });

        open = false;
        h.fireObserver();
        expect(h.controller.held()).toEqual({ width: 0, height: 0 });
    });

    it("writes nothing when the size has not changed", () => {
        const h = harness();
        h.controller.attach(h.element);
        const before = h.writes.length;

        h.fireObserver();
        h.fireObserver();

        // A resize storm of identical sizes must not restart the transition.
        expect(h.writes).toHaveLength(before);
    });

    it("coerces a nonsense measurement instead of pinning NaN", () => {
        const h = harness({}, { width: Number.NaN, height: Number.POSITIVE_INFINITY });
        h.controller.attach(h.element);

        expect(h.controller.held()).toEqual({ width: 0, height: 0 });
    });
});

describe("createAnimatedSize — settling", () => {
    it("re-measures on each of the two settle frames and adopts what it finds", () => {
        const h = harness();
        h.controller.attach(h.element);
        const armedAfterAttach = h.timerCount;

        h.setContent({ width: 300, height: 200 });
        h.fireObserver();
        // The change is adopted immediately so the CSS transition can start.
        expect(h.controller.held()?.height).toBe(200);

        // The chain is SIZE_SETTLE_FRAMES long, not "one frame that happens to
        // be enough": a webfont can land on the *second* frame, and the asserts
        // below only hold if the chained frame actually runs.
        expect(h.frameCount).toBe(1);
        h.setContent({ width: 300, height: 240 });
        h.runFrame();
        expect(h.controller.held()?.height).toBe(240);
        // Running the first frame queues the second.
        expect(h.frameCount).toBe(SIZE_SETTLE_FRAMES - 1);
        h.setContent({ width: 300, height: 260 });
        h.runFrame();
        expect(h.controller.held()?.height).toBe(260);

        // Armed from the start, before anything has changed, so a lost observer
        // notification still gets a second look.
        expect(armedAfterAttach).toBeGreaterThan(0);

        // A frame that finds a *new* size restarts the budget rather than
        // continuing the old one, so a box that keeps changing while it settles
        // still converges: the queue drains once the content stops moving.
        h.runFrames(20);
        expect(h.frameCount).toBe(0);
        expect(h.controller.held()).toEqual({ width: 300, height: 260 });
    });

    it("stops scheduling frames once it has settled", () => {
        const h = harness();
        h.controller.attach(h.element);
        h.setContent({ width: 300, height: 200 });
        h.fireObserver();
        expect(h.frameCount).toBe(1);
        h.runFrames(SIZE_SETTLE_FRAMES);

        // The queue is drained, so the loop is genuinely bounded rather than
        // spinning forever and re-measuring every frame forever.
        expect(h.frameCount).toBe(0);
        expect(() => h.runFrames(3)).not.toThrow();
        expect(h.controller.held()?.height).toBe(200);
    });

    it("re-measures once from the fallback timer when nothing else moves", () => {
        const h = harness();
        h.controller.attach(h.element);
        h.setContent({ width: 300, height: 90 });
        h.fireObserver();
        expect(h.controller.held()?.height).toBe(90);

        // No frame runs and no observer notification: only the timer is left.
        h.setContent({ width: 300, height: 150 });
        expect(h.fallbackPending()).toBe(true);
        h.runFallback();

        expect(h.controller.held()).toEqual({ width: 300, height: 150 });
    });

    it("keeps a fallback timer armed even when nothing changed", () => {
        const h = harness();
        h.controller.attach(h.element);

        // ResizeObserver can simply not fire — a display:none parent for one
        // frame is enough — so the timer has to exist unconditionally.
        expect(h.fallbackPending()).toBe(true);
    });

    it("cancels pending work on detach so it cannot write to a released box", () => {
        const h = harness();
        h.controller.attach(h.element);
        h.setContent({ width: 300, height: 200 });
        h.fireObserver();

        h.controller.detach();
        const writesAfterDetach = h.writes.length;
        h.setContent({ width: 300, height: 400 });
        h.runFrames(4);
        h.runFallback();

        expect(h.writes).toHaveLength(writesAfterDetach);
        expect(h.controller.held()).toBeNull();
    });
});

describe("createAnimatedSize — reduced motion", () => {
    it("never pins a size, so the content sizes itself", () => {
        const h = harness({ reducedMotion: () => true });
        h.controller.attach(h.element);

        // Nothing was ever pinned, so the wrapper needs no write at all: not
        // writing is what lets a collapsed observer avoid a re-render per tick.
        expect(h.controller.held()).toBeNull();
        expect(h.writes).toEqual([]);

        h.setContent({ width: 300, height: 200 });
        h.fireObserver();

        expect(h.controller.held()).toBeNull();
        expect(h.writes).toEqual([]);
    });

    it("releases a box that was pinned before motion was turned off", () => {
        let reduced = false;
        const h = harness({ reducedMotion: () => reduced });
        h.controller.attach(h.element);
        expect(h.controller.held()).toEqual({ width: 300, height: 40 });

        reduced = true;
        h.setContent({ width: 300, height: 200 });
        h.fireObserver();

        expect(h.controller.held()).toBeNull();
        expect(h.writes.at(-1)).toBeNull();
    });

    it("starts pinning again when motion comes back", () => {
        let reduced = true;
        const h = harness({ reducedMotion: () => reduced });
        h.controller.attach(h.element);
        expect(h.controller.held()).toBeNull();

        reduced = false;
        h.fireObserver();

        expect(h.controller.held()).toEqual({ width: 300, height: 40 });
    });
});

describe("createAnimatedSize — hostile environments", () => {
    it("works when there is no ResizeObserver", () => {
        const h = harness({ createObserver: () => null });
        expect(() => h.controller.attach(h.element)).not.toThrow();
        expect(h.controller.held()).toEqual({ width: 300, height: 40 });

        h.setContent({ width: 300, height: 77 });
        h.controller.sync();
        expect(h.controller.held()).toEqual({ width: 300, height: 77 });
    });

    it("survives an observer that throws on observe", () => {
        const h = harness({
            createObserver: () => ({
                observe() {
                    throw new Error("cannot observe");
                },
                disconnect() {
                    throw new Error("cannot disconnect");
                },
            }),
        });
        // Losing the observer must not lose the box: it still tracks content.
        expect(() => h.controller.attach(h.element)).not.toThrow();
        expect(h.controller.held()).toEqual({ width: 300, height: 40 });
        expect(() => h.controller.detach()).not.toThrow();
        expect(h.controller.held()).toBeNull();
    });

    it("falls back to real timers when no scheduler is injected", () => {
        vi.useFakeTimers();
        try {
            const controller = createAnimatedSize({
                open: () => true,
                read: () => ({ width: 300, height: 40 }),
                write: () => {},
                createObserver: () => null,
            });
            const element = document.createElement("div");
            controller.attach(element);
            expect(controller.held()).toEqual({ width: 300, height: 40 });
            controller.dispose();
        } finally {
            vi.useRealTimers();
        }
    });
});
