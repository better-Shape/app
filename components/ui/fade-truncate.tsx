"use client";

import { useRef } from "react";
import { useHorizontalOverflow } from "@/lib/ui/use-horizontal-overflow";
import { cn } from "@/lib/utils";

/**
 * Single-line label that fades at the trailing edge when content overflows.
 * Short labels stay fully opaque; long ones, resize, zoom, and RTL are handled.
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
