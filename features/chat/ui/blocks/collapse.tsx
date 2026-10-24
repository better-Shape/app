"use client";

import React from "react";
import { cn } from "@/lib/utils";

/**
 * Spring-animated expand/collapse wrapper for chat workflow & disclosure bodies.
 *
 * Uses `grid-template-rows: 0fr ↔ 1fr` on `--reveal-dur` / `--reveal-ease` (`--spring-quick`)
 * so height transitions are interruptible mid-flight and never guess `max-height`.
 * Defers initial mount until the first time `open` becomes `true`, then mounts at `0fr`
 * and promotes to `1fr` on the next animation frame so even the very first open transitions
 * smoothly instead of snapping in 0ms.
 */
export function Collapse({
    open,
    children,
    className,
    innerClassName,
}: {
    open: boolean;
    children: React.ReactNode;
    className?: string;
    innerClassName?: string;
}) {
    const [mounted, setMounted] = React.useState(open);
    const [expanded, setExpanded] = React.useState(open);

    if (open && !mounted) {
        setMounted(true);
    }
    if (!open && expanded) {
        setExpanded(false);
    }

    React.useEffect(() => {
        if (!open || expanded) return undefined;
        const id = window.requestAnimationFrame(() => {
            setExpanded(true);
        });
        return () => window.cancelAnimationFrame(id);
    }, [open, expanded]);

    if (!mounted && !open) return null;

    const active = open && expanded;

    return (
        <div
            className={cn(
                "grid transition-[grid-template-rows,opacity] duration-[var(--reveal-dur)] ease-[var(--reveal-ease)]",
                active ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                className,
            )}
            data-open={open ? "true" : "false"}
        >
            <div className={cn("min-h-0 overflow-hidden", innerClassName)} inert={!open}>
                {children}
            </div>
        </div>
    );
}
