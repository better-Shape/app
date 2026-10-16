"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

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
export function SwapText<T extends string | number>({
    value,
    render,
    className,
    block,
    live,
    durationMs = 140,
}: {
    value: T;
    /** Draws one value. Defaults to the value as text. */
    render?: (value: T) => React.ReactNode;
    className?: string;
    /** Fill the available width rather than shrink to the text. */
    block?: boolean;
    /** Announce the new value to screen readers. For confirmations like "Copied". */
    live?: boolean;
    durationMs?: number;
}) {
    const [pair, setPair] = React.useState<{ current: T; previous: T | null }>({
        current: value,
        previous: null,
    });
    const [ready, setReady] = React.useState(false);
    // The width the box settled at, and the width it is travelling to. Both are lengths
    // rather than keywords, because those are what a transition can interpolate.
    const [settledWidth, setSettledWidth] = React.useState<number | null>(null);
    const [targetWidth, setTargetWidth] = React.useState<number | null>(null);
    const host = React.useRef<HTMLSpanElement>(null);
    const incoming = React.useRef<HTMLSpanElement>(null);

    // Set during render, not in an effect, so the outgoing layer is on screen in the same
    // frame the new value arrives.
    if (pair.current !== value) {
        setPair({ current: value, previous: pair.current });
    }

    React.useEffect(() => {
        if (pair.previous === null) return;
        const timer = window.setTimeout(() => {
            setPair((current) => (current.previous === null ? current : { current: current.current, previous: null }));
        }, durationMs);
        return () => window.clearTimeout(timer);
    }, [pair.previous, durationMs]);

    // The width transition is only safe once the first measurement has settled,
    // or the swap would animate against a width the browser had not laid out yet.
    React.useEffect(() => {
        const frame = window.requestAnimationFrame(() => setReady(true));
        return () => window.cancelAnimationFrame(frame);
    }, []);

    const swapping = pair.previous !== null;

    // Record where the box came to rest, so the swap that starts next has somewhere to
    // start from.
    React.useLayoutEffect(() => {
        if (block || !host.current) return;
        setSettledWidth(host.current.getBoundingClientRect().width);
    }, [block, value]);

    React.useLayoutEffect(() => {
        if (block || !swapping || !incoming.current) {
            setTargetWidth(null);
            return;
        }
        // The incoming layer is sized `max-content`, so its own box reports the width the
        // value needs even while the host is held at the outgoing width.
        const next = incoming.current.getBoundingClientRect().width;
        const frame = window.requestAnimationFrame(() => setTargetWidth(next));
        return () => window.cancelAnimationFrame(frame);
    }, [block, swapping, value]);

    const draw = render ?? ((current: T) => current as React.ReactNode);

    // Pinned while the swap runs, released when it is over. Releasing hands the box back to
    // `auto` at the width it already has, so nothing moves.
    const pinnedWidth = !block && ready && swapping ? (targetWidth ?? settledWidth) : null;

    return (
        <span
            ref={host}
            className={cn("t-swap", block && "t-swap--block", className)}
            data-ready={ready ? "true" : "false"}
            aria-live={live ? "polite" : undefined}
            style={
                {
                    "--swap-dur": `${durationMs}ms`,
                    width: pinnedWidth === null ? undefined : `${pinnedWidth}px`,
                } as React.CSSProperties
            }
        >
            {pair.previous === null ? null : (
                <span className="t-swap__layer t-swap__layer--out" aria-hidden>
                    {draw(pair.previous)}
                </span>
            )}
            <span
                key={String(pair.current)}
                ref={incoming}
                className={cn("t-swap__layer", pair.previous !== null && "t-swap__layer--in")}
            >
                {draw(pair.current)}
            </span>
        </span>
    );
}
