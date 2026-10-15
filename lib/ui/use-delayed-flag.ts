"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A flag that waits before it shows, and then stays a moment once it does.
 *
 * Loading indicators have two opposite failure modes, and both read as a glitch:
 *
 * - **flashing in** for an operation that finishes in under ~200ms, which looks
 *   like a rendering fault rather than progress;
 * - **flashing out** immediately after appearing, because the work finished just
 *   past the delay, which reads as a stutter in the same place.
 *
 * `delayMs` covers the first and `minVisibleMs` the second. The underlying state
 * never changes (the caller keeps its own `active`), so a consumer that must know
 * the moment work starts - to disable a control, for example - still can.
 */
export function useDelayedFlag(
    active: boolean,
    { delayMs = 200, minVisibleMs = 300 }: { delayMs?: number; minVisibleMs?: number } = {},
): boolean {
    const [visible, setVisible] = useState(false);
    const showTimer = useRef<number | null>(null);
    const hideTimer = useRef<number | null>(null);
    const shownAt = useRef(0);

    useEffect(() => {
        const cancel = (timer: React.RefObject<number | null>) => {
            if (timer.current !== null) {
                window.clearTimeout(timer.current);
                timer.current = null;
            }
        };

        if (active) {
            // Already showing, or already counting down to show.
            if (visible || showTimer.current !== null) return;
            showTimer.current = window.setTimeout(() => {
                showTimer.current = null;
                shownAt.current = performance.now();
                setVisible(true);
            }, delayMs);
            return () => cancel(showTimer);
        }

        // Went idle before the delay elapsed: the indicator never existed, which is
        // the whole point.
        cancel(showTimer);
        if (!visible) return;

        const remaining = Math.max(0, minVisibleMs - (performance.now() - shownAt.current));
        hideTimer.current = window.setTimeout(() => {
            hideTimer.current = null;
            setVisible(false);
        }, remaining);
        return () => cancel(hideTimer);
    }, [active, visible, delayMs, minVisibleMs]);

    return visible;
}
