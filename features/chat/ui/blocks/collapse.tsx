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
    const [expanded, setExpanded] = React.useState(open);
    const reducedMotion = prefersReducedMotion();
    if (open && !mounted) setMounted(true);
    if (!open && expanded) setExpanded(false);
    if (!open && reducedMotion && mounted) setMounted(false);

    React.useEffect(() => {
        if (!open) return undefined;
        if (reducedMotion) {
            queueMicrotask(() => setExpanded(true));
            return undefined;
        }
        const raf = window.requestAnimationFrame(() => {
            setExpanded(true);
        });
        return () => {
            window.cancelAnimationFrame(raf);
        };
    }, [open, reducedMotion]);

    React.useEffect(() => {
        if (open || !mounted || reducedMotion) return undefined;
        const timer = window.setTimeout(() => setMounted(false), EXIT_MS);
        return () => {
            window.clearTimeout(timer);
        };
    }, [open, mounted, reducedMotion]);

    const renderChildren = open || (mounted && !reducedMotion);
    const showExpanded = open && (expanded || reducedMotion);

    return (
        <div
            id={id}
            className={cn(
                "chat-collapse",
                showExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                className,
            )}
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
