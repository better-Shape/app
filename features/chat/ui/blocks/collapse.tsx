"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { prefersReducedMotion } from "@/lib/ui/motion";

const EXIT_MS = 140;

/**
 * Height-animated expand/collapse wrapper for workflow dropdowns.
 * Children stay mounted during the closing transition, then unmount.
 */
export function Collapse({
    open,
    children,
    className,
    id,
}: {
    open: boolean;
    children: React.ReactNode;
    className?: string;
    id?: string;
}) {
    const [mounted, setMounted] = React.useState(open);
    const reducedMotion = prefersReducedMotion();
    if (open && !mounted) setMounted(true);
    if (!open && reducedMotion && mounted) setMounted(false);

    React.useEffect(() => {
        if (open || !mounted || reducedMotion) return;
        const t = window.setTimeout(() => setMounted(false), EXIT_MS);
        return () => window.clearTimeout(t);
    }, [open, mounted, reducedMotion]);

    const renderChildren = open || (mounted && !reducedMotion);

    return (
        <div
            id={id}
            className="chat-collapse"
            data-open={open ? "true" : "false"}
            aria-hidden={!open}
            inert={!open}
            hidden={!renderChildren}
        >
            {renderChildren ? <div className={cn("chat-collapse-inner", className)}>{children}</div> : null}
        </div>
    );
}
