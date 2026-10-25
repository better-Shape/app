"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { prefersReducedMotion } from "@/lib/ui/motion";

const EXIT_MS = 180;

/**
 * Spring-animated expand/collapse wrapper for chat workflow & disclosure bodies.
 *
 * Uses `grid-template-rows: 0fr ↔ 1fr` on `.chat-collapse` (`--spring-quick`) so height
 * transitions are interruptible mid-flight and collapsed bodies cost zero child DOM
 * nodes until expanded.
 */
export const Collapse = ({
    open,
    children,
    className,
    innerClassName,
    id,
}: {
    open: boolean;
    children: React.ReactNode;
    className?: string;
    innerClassName?: string;
    id?: string;
}) => {
    const [mounted, setMounted] = React.useState(open);
    const reducedMotion = prefersReducedMotion();
    if (open && !mounted) setMounted(true);
    if (!open && reducedMotion && mounted) setMounted(false);

    React.useEffect(() => {
        if (open || !mounted || reducedMotion) return undefined;
        const timer = window.setTimeout(() => setMounted(false), EXIT_MS);
        return () => {
            window.clearTimeout(timer);
        };
    }, [open, mounted, reducedMotion]);

    const renderChildren = open || (mounted && !reducedMotion);

    return (
        <div
            id={id}
            className={cn("chat-collapse", className)}
            data-open={open ? "true" : "false"}
            aria-hidden={!open}
            inert={!open}
            hidden={!renderChildren}
        >
            {renderChildren ? (
                <div className={cn("chat-collapse-inner", innerClassName)}>{children}</div>
            ) : null}
        </div>
    );
};
