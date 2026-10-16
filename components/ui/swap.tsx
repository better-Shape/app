"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, Ref } from "react";

import { cn } from "@/lib/utils";

type SwapProps<T> = {
    value: T;
    /** Draws one value. Defaults to the value as text. */
    render?: (value: T) => ReactNode;
    className?: string;
    /** Fill the available width rather than shrink to the text. */
    block?: boolean;
    /** Announce the new value to screen readers. For confirmations like "Copied". */
    live?: boolean;
    durationMs?: number;
};

/**
 * Holds the outgoing value for one swap window.
 *
 * The pair is set during render rather than in an effect, so the outgoing layer is on
 * screen in the same frame the new value arrives; React re-runs this render before the
 * children mount it. This is the documented way to keep a previous value when props
 * change, not a render side effect:
 * https://react.dev/reference/react/useState#storing-information-from-previous-renders
 */
const useSwapPair = <T,>(value: T, durationMs: number) => {
    const [pair, setPair] = useState<{ current: T; previous: T | null }>({
        current: value,
        previous: null,
    });

    if (pair.current !== value) {
        setPair({ current: value, previous: pair.current });
    }

    /** The ghost is dropped on a timer rather than by the transition, because a
        cancelled transition never reports an end and the layer would stay mounted. */
    useEffect(() => {
        if (pair.previous === null) return undefined;
        const timer = window.setTimeout(() => {
            setPair((current) =>
                current.previous === null ? current : { current: current.current, previous: null },
            );
        }, durationMs);
        return () => window.clearTimeout(timer);
    }, [pair.previous, durationMs]);

    return pair;
};

/**
 * Whether the first frame after mount has passed.
 *
 * The width transition is only safe once the first measurement has settled, or the swap
 * would animate against a width the browser had not laid out yet.
 */
const useSettledFrame = () => {
    const [ready, setReady] = useState(false);

    useEffect(() => {
        const frame = window.requestAnimationFrame(() => setReady(true));
        return () => window.cancelAnimationFrame(frame);
    }, []);

    return ready;
};

/**
 * The host and incoming refs of a swap, and the effect that pins the box's width between
 * them.
 *
 * Both widths are lengths rather than keywords, because lengths are what a transition can
 * interpolate: the computed width is `auto` before and after a swap, and an unchanged
 * property is not a transition, so the box is pinned to the outgoing width in the commit
 * the new value arrives in and travels to the incoming width on the next frame. The
 * incoming layer is sized `max-content`, so its own box reports the width the value needs
 * even while the host is held at the outgoing width.
 *
 * The writes land on the node rather than in React state, which keeps this out of the
 * render cycle: a width only the compositor needs must not cost a second render. The
 * resting width is recorded between swaps only, since while one runs the box is pinned to
 * a length and its measured width is a frame of the animation. Every branch clears or
 * sets the width, so no path leaves a stale pin behind.
 */
const useSwapLayers = ({
    block,
    swapping,
    value,
}: {
    block?: boolean;
    swapping: boolean;
    value: unknown;
}) => {
    const host = useRef<HTMLSpanElement>(null);
    const incoming = useRef<HTMLSpanElement>(null);
    const settledWidth = useRef<number | null>(null);

    useLayoutEffect(() => {
        const node = host.current;
        if (!node) return undefined;
        if (block === true || !swapping) {
            node.style.width = "";
            settledWidth.current = node.getBoundingClientRect().width;
            return undefined;
        }
        const leaving = settledWidth.current ?? node.getBoundingClientRect().width;
        node.style.width = `${leaving}px`;
        const frame = window.requestAnimationFrame(() => {
            const next = incoming.current?.getBoundingClientRect().width;
            node.style.width = `${next ?? leaving}px`;
        });
        return () => window.cancelAnimationFrame(frame);
    }, [block, swapping, value]);

    return { host, incoming };
};

/** The class list of the host, which carries the inline or block layout and the caller's own. */
const swapShellClass = (block: boolean | undefined, className: string | undefined) =>
    cn("t-swap", block && "t-swap--block", className);

/**
 * The host's custom properties.
 *
 * `--swap-dur` is per instance because two surfaces can swap at different speeds, and the
 * duration is owned by the CSS so a reduced-motion media query can still override it.
 */
const swapShellStyle = (durationMs: number) =>
    ({ "--swap-dur": `${durationMs}ms` }) as CSSProperties;

/** The layer's modifier, if any: the leaving layer is always marked, the entering one
    only while a swap runs. */
const swapLayerClass = (out: boolean, swapping: boolean) =>
    cn("t-swap__layer", out ? "t-swap__layer--out" : swapping && "t-swap__layer--in");

/**
 * One layer of the swap.
 *
 * Both layers share a grid cell, so only opacity, blur and transform move and the box
 * never reflows mid-swap. `--in` is present only while a swap runs: the same markup has to
 * sit still when the value changed without one, which is what keeps a mount from playing
 * an entrance. The leaving layer is a ghost and is hidden from assistive tech.
 */
const SwapLayer = <T,>({
    value,
    render,
    out,
    swapping = false,
    ref,
}: {
    value: T;
    render?: (value: T) => ReactNode;
    out: boolean;
    swapping?: boolean;
    ref?: Ref<HTMLSpanElement>;
}) => (
    <span
        ref={ref}
        className={swapLayerClass(out, swapping)}
        aria-hidden={out || undefined}
    >
        {render ? render(value) : (value as ReactNode)}
    </span>
);

/**
 * A value that swaps in place when it changes, instead of cutting.
 *
 * The outgoing layer fades and blurs out over `--swap-dur` while the new one rises, through
 * the `t-swap` pattern in `app/transitions.css`. Both share one grid cell, so nothing
 * reflows. Only a change plays, never a mount: a control that animates on first appearance
 * makes the surface look like it is still loading.
 *
 * The box is shrink-to-fit, and a grid sizes to the widest layer the moment the new one
 * mounts, so a longer value would take its neighbours with it in one frame. `transition:
 * width` cannot help on its own: the computed value is `auto` both before and after, and
 * an unchanged property is not a transition. The outgoing width is therefore pinned as a
 * length while the incoming one is measured from the hidden copy below, and the two
 * lengths are what the transition travels between.
 */
export const SwapText = <T extends string | number>({
    value,
    render,
    className,
    block,
    live,
    durationMs = 140,
}: SwapProps<T>) => {
    const pair = useSwapPair(value, durationMs);
    const ready = useSettledFrame();
    const swapping = pair.previous !== null;
    const { host, incoming } = useSwapLayers({ block, swapping, value });

    return (
        <span
            ref={host}
            className={swapShellClass(block, className)}
            data-ready={String(ready)}
            aria-live={live ? "polite" : undefined}
            style={swapShellStyle(durationMs)}
        >
            {pair.previous === null ? null : <SwapLayer value={pair.previous} render={render} out />}
            <SwapLayer
                key={String(pair.current)}
                ref={incoming}
                value={pair.current}
                render={render}
                out={false}
                swapping={swapping}
            />
        </span>
    );
};
