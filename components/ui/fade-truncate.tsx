"use client";

import { useRef } from "react";
import { useHorizontalOverflow } from "@/lib/ui/use-horizontal-overflow";
import { cn } from "@/lib/utils";

/**
 * Single-line label that fades at the trailing edge when content overflows.
 * Short labels stay fully opaque; long ones, resize, zoom, and RTL are handled.
 * `dir="auto"` takes the direction from the label's own text, so a right-to-left title keeps its
 * start in view and fades at its left edge, through the `rtl:` variant's `:dir(rtl)`.
 */
export function FadeTruncate({
    children,
    className,
}: {
    children: React.ReactNode;
    className?: string;
}) {
    const ref = useRef<HTMLSpanElement>(null);
    const overflowing = useHorizontalOverflow(ref, children);

    return (
        <span
            ref={ref}
            dir="auto"
            className={cn(
                "block min-w-0 overflow-hidden whitespace-nowrap",
                overflowing &&
                    "[mask-image:linear-gradient(to_right,black_0%,black_calc(100%-1.25rem),transparent_100%)] [-webkit-mask-image:linear-gradient(to_right,black_0%,black_calc(100%-1.25rem),transparent_100%)] rtl:[mask-image:linear-gradient(to_left,black_0%,black_calc(100%-1.25rem),transparent_100%)] rtl:[-webkit-mask-image:linear-gradient(to_left,black_0%,black_calc(100%-1.25rem),transparent_100%)]",
                className,
            )}
        >
            {children}
        </span>
    );
}
