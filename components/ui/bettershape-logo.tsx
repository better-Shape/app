"use client";

import { cn } from "@/lib/utils";

/** The photoreal mark needs a bit of room before its highlights read. */
const PHOTOREAL_MIN_SIZE = 24;

export function BetterShapeLogo({
    size = 32,
    className,
}: {
    size?: number;
    className?: string;
}) {
    const src =
        size < PHOTOREAL_MIN_SIZE ? "/logos/logo-mono.png" : "/logos/logo.png";
    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
src={src}
            alt="BetterShape"
            width={size}
            height={size}
            style={{
                width: size,
                height: size,
                minWidth: size,
                minHeight: size,
                maxWidth: size,
                maxHeight: size,
            }}
            className={cn("logo-invert shrink-0", className)}
            draggable={false}
        />
    );
}
