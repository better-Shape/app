/**
 * `AnimatedHeight` / `AnimatedWidth` — CSS-transitioned size for a box whose
 * content changes without the box's own box changing.
 *
 * Why a `ResizeObserver` and not a `height` transition on the content: the
 * wrapper cannot transition to a height it does not know yet. The observer
 * measures the content, the wrapper is pinned to the size the content had
 * before, and the next frame the pin moves to the new size, which the
 * transition then eases.
 *
 * The two follow-up frames exist because the *first* observer callback reports
 * the size after the change but often not the settled size: a webfont lands, an
 * image decodes, a `content-visibility` row paints. t3code re-measures on the
 * next two `requestAnimationFrame`s for the same reason. A ~250ms fallback timer
 * covers the case where `ResizeObserver` never fires at all — an element that is
 * `display: none` for one frame, or a browser that drops the notification.
 *
 * Everything is injectable so the primitive is testable without a layout engine.
 */

import {
    type CSSProperties,
    type ReactElement,
    type ReactNode,
    type RefObject,
    useEffect,
    useRef,
    useState,
} from "react";
import { cn } from "@/lib/utils";
import { FLIP_EASING, prefersReducedMotion } from "./env";

/** Re-measure this long after a change if nothing else says the size settled. */
export const SIZE_FALLBACK_MS = 250;

/** How many follow-up frames to re-measure after a change. */
export const SIZE_SETTLE_FRAMES = 2;

/** Default transition length. Matches the sidebar's existing hover timings. */
export const SIZE_DURATION_MS = 200;

export interface AnimatedSize {
    /** Width and height of the measured content. */
    width: number;
    height: number;
}

export interface AnimatedSizeObserver {
    observe(element: Element): void;
    disconnect(): void;
}

export interface AnimatedSizeOptions {
    /** Whether the box is open; closed measures as zero on both axes. */
    open: () => boolean;
    /** Measures the content box. */
    read: () => AnimatedSize;
    /** Pins the wrapper to a size, or `null` to release it back to `auto`. */
    write: (size: AnimatedSize | null) => void;
    /** Root element for the `prefers-reduced-motion` probe. */
    root?: () => Node | null;
    durationMs?: number;
    fallbackMs?: number;
    settleFrames?: number;
    reducedMotion?: () => boolean;
    /** Defaults to `globalThis.ResizeObserver`, or `null` when absent. */
    createObserver?: (onResize: () => void) => AnimatedSizeObserver | null;
    /** Schedules one frame; the returned function cancels it. */
    scheduleFrame?: (callback: () => void) => () => void;
    /** Schedules a timer; the returned function cancels it. */
    scheduleTimer?: (callback: () => void, ms: number) => () => void;
}

export interface AnimatedSizeController {
    /** Starts observing `element`. Safe to call again with the same element. */
    attach(element: Element): void;
    /** Stops observing and releases the wrapper. */
    detach(): void;
    /** Call after a commit that may have changed the content size. */
    sync(): void;
    /** The size currently pinned, or `null`. */
    held(): AnimatedSize | null;
    dispose(): void;
}

const RELEASED: AnimatedSize = { width: 0, height: 0 };

function sameSize(a: AnimatedSize | null, b: AnimatedSize | null): boolean {
    if (a === null || b === null) return a === b;
    return a.width === b.width && a.height === b.height;
}

function defaultScheduleFrame(callback: () => void): () => void {
    if (typeof requestAnimationFrame !== "function") {
        const timer = setTimeout(callback, 16);
        return () => clearTimeout(timer);
    }
    const handle = requestAnimationFrame(() => callback());
    return () => cancelAnimationFrame(handle);
}

function defaultScheduleTimer(callback: () => void, ms: number): () => void {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
}

export function createAnimatedSize(options: AnimatedSizeOptions): AnimatedSizeController {
    const duration = options.durationMs ?? SIZE_DURATION_MS;
    const fallbackMs = options.fallbackMs ?? SIZE_FALLBACK_MS;
    const settleFrames = options.settleFrames ?? SIZE_SETTLE_FRAMES;
    const scheduleFrame = options.scheduleFrame ?? defaultScheduleFrame;
    const scheduleTimer = options.scheduleTimer ?? defaultScheduleTimer;

    let observer: AnimatedSizeObserver | null = null;
    let attached: Element | null = null;
    let held: AnimatedSize | null = null;
    let lastMeasured: AnimatedSize | null = null;
    let established = false;
    let disposed = false;
    let cancelFrames: (() => void) | null = null;
    let cancelFallback: (() => void) | null = null;
    let settleGeneration = 0;

    const reduced = (): boolean =>
        options.reducedMotion ? options.reducedMotion() : prefersReducedMotion(options.root?.() ?? null);

    const apply = (next: AnimatedSize | null) => {
        held = next;
        options.write(next);
    };

    const clearPending = () => {
        cancelFrames?.();
        cancelFrames = null;
        cancelFallback?.();
        cancelFallback = null;
        // Bump the generation so a callback that is already queued and cannot be
        // cancelled still knows it belongs to a chain that is over.
        settleGeneration += 1;
    };

    const measure = (): AnimatedSize => {
        const raw = options.read() ?? RELEASED;
        const size = {
            width: Number.isFinite(raw.width) ? raw.width : 0,
            height: Number.isFinite(raw.height) ? raw.height : 0,
        };
        // A collapsed box has to collapse; otherwise its content would keep the
        // wrapper open and the transition would have nothing to animate.
        return options.open() ? size : RELEASED;
    };

    const remeasure = () => {
        if (disposed || attached === null) return;
        const next = measure();
        if (sameSize(next, held)) return;
        lastMeasured = next;
        hold(next);
    };

    const hold = (next: AnimatedSize) => {
        if (disposed || attached === null) return;
        apply(next);
        scheduleSettle();
    };

    /**
     * The transition is a CSS transition on the wrapper, so nothing tells us
     * when it lands. Two frames catch late layout; the timer catches everything
     * else, including a lost observer notification.
     */
    const scheduleSettle = () => {
        clearPending();
        // A generation counter rather than a `cancelFrames` flag: `step` calls
        // `remeasure`, which may call `hold`, which calls back into here and
        // bumps the counter. Without it the restarted chain and the tail of the
        // old one both run, so a single late-settling change would keep
        // re-measuring for twice as long as the budget says. `clearPending`
        // above already bumped it, so this captures the current value.
        const generation = settleGeneration;
        cancelFallback = scheduleTimer(remeasure, fallbackMs);
        let remaining = settleFrames;
        const step = () => {
            if (disposed || attached === null) return;
            cancelFrames = null;
            if (generation !== settleGeneration) return;
            remeasure();
            remaining -= 1;
            if (remaining > 0 && generation === settleGeneration) cancelFrames = scheduleFrame(step);
        };
        cancelFrames = scheduleFrame(step);
    };

    const controller: AnimatedSizeController = {
        attach(element: Element) {
            if (disposed || attached === element) return;
            controller.detach();
            attached = element;
            const create = options.createObserver ?? defaultCreateObserver;
            observer = create(() => controller.sync());
            try {
                observer?.observe(element);
            } catch {
                observer = null;
            }
            controller.sync();
        },
        detach() {
            clearPending();
            try {
                observer?.disconnect();
            } catch {
                /* already gone */
            }
            observer = null;
            if (attached !== null) {
                attached = null;
                established = false;
                lastMeasured = null;
                apply(null);
            }
        },
        sync() {
            if (disposed || attached === null) return;
            if (reduced()) {
                established = true;
                lastMeasured = null;
                // Only write when something is actually pinned, so a collapsed
                // observer does not re-render the wrapper on every tick.
                if (held !== null) apply(null);
                return;
            }
            if (!established) {
                // First measurement: pin the current size so the *next* change
                // has something to transition away from. Releasing instead would
                // mean the first collapse of a freshly mounted box never animates.
                established = true;
                lastMeasured = measure();
                hold(lastMeasured);
                return;
            }
            remeasure();
        },
        held() {
            return held;
        },
        dispose() {
            controller.detach();
            disposed = true;
        },
    };

    return controller;
}

function defaultCreateObserver(onResize: () => void): AnimatedSizeObserver | null {
    if (typeof ResizeObserver === "undefined") return null;
    return new ResizeObserver(() => onResize());
}

export interface AnimatedSizeProps {
    /** Collapses to zero when false. */
    open: boolean;
    children: ReactNode;
    className?: string;
    innerClassName?: string;
    durationMs?: number;
    easing?: string;
    fallbackMs?: number;
}

function useAnimatedAxis(
    axis: "height" | "width",
    options: { open: boolean; children: ReactNode; durationMs?: number; easing?: string; fallbackMs?: number },
): { innerRef: RefObject<HTMLDivElement | null>; style: CSSProperties } {
    const { open, children, durationMs, fallbackMs } = options;
    const innerRef = useRef<HTMLDivElement>(null);
    const [held, setHeld] = useState<AnimatedSize | null>(null);

    // The controller is built once but has to see the current props. Keeping
    // them in a ref updated by an effect avoids rebuilding (and re-attaching)
    // the observer on every render; the ref is written after commit, which is
    // early enough — `sync` below runs in the same commit's later effects.
    const latest = useRef({ open, durationMs, fallbackMs });
    useEffect(() => {
        latest.current = { open, durationMs, fallbackMs };
    }, [open, durationMs, fallbackMs]);

    const [controller] = useState(() =>
        createAnimatedSize({
            open: () => latest.current.open,
            root: () => innerRef.current,
            durationMs,
            fallbackMs,
            read: () => {
                const element = innerRef.current;
                if (!element) return RELEASED;
                const rect = element.getBoundingClientRect();
                return { width: rect.width, height: rect.height };
            },
            write: setHeld,
        }),
    );

    useEffect(() => {
        const element = innerRef.current;
        if (!element) return;
        controller.attach(element);
        return () => controller.detach();
    }, [controller]);

    // `children` is a dependency on purpose: any re-render of new content is a
    // chance for the content's natural size to have changed, and ResizeObserver
    // will not tell us about content that changed without changing its box.
    useEffect(() => {
        controller.sync();
    }, [controller, open, children]);

    const value = held === null ? undefined : held[axis];
    const style: CSSProperties =
        value === undefined
            ? {}
            : {
                  [axis]: value,
                  transition: `${axis} ${durationMs ?? SIZE_DURATION_MS}ms ${
                      options.easing ?? FLIP_EASING
                  }`,
              };

    return { innerRef, style };
}

/**
 * Animates its own height to follow its content.
 *
 * The inner div is the measured element; the wrapper is what clips and what
 * carries the transition. Reduced motion releases the wrapper outright and the
 * content sizes itself, so the box is exactly as tall as its content with no
 * transition class in the way.
 */
export function AnimatedHeight({
    open,
    children,
    className,
    innerClassName,
    durationMs,
    easing,
    fallbackMs,
}: AnimatedSizeProps): ReactElement {
    const { innerRef, style } = useAnimatedAxis("height", {
        open,
        children,
        durationMs,
        easing,
        fallbackMs,
    });
    return (
        <div
            data-motion-size="height"
            className={cn("w-full min-h-0 overflow-hidden", className)}
            style={style}
        >
            <div ref={innerRef} data-motion-size-content="height" className={cn("min-h-0", innerClassName)}>
                {children}
            </div>
        </div>
    );
}

/** The width-axis twin of {@link AnimatedHeight}. */
export function AnimatedWidth({
    open,
    children,
    className,
    innerClassName,
    durationMs,
    easing,
    fallbackMs,
}: AnimatedSizeProps): ReactElement {
    const { innerRef, style } = useAnimatedAxis("width", {
        open,
        children,
        durationMs,
        easing,
        fallbackMs,
    });
    return (
        <div
            data-motion-size="width"
            className={cn("h-full min-w-0 overflow-hidden", className)}
            style={style}
        >
            <div ref={innerRef} data-motion-size-content="width" className={cn("min-w-0", innerClassName)}>
                {children}
            </div>
        </div>
    );
}
