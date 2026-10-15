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

    const draw = render ?? ((current: T) => current as React.ReactNode);

    return (
        <span
            className={cn("t-swap", block && "t-swap--block", className)}
            data-ready={ready ? "true" : "false"}
            aria-live={live ? "polite" : undefined}
            style={{ "--swap-dur": `${durationMs}ms` } as React.CSSProperties}
        >
            {pair.previous === null ? null : (
                <span className="t-swap__layer t-swap__layer--out" aria-hidden>
                    {draw(pair.previous)}
                </span>
            )}
            <span key={String(pair.current)} className={cn("t-swap__layer", pair.previous !== null && "t-swap__layer--in")}>
                {draw(pair.current)}
            </span>
        </span>
    );
}
