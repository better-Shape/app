"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function AnimatedCollapse({
    id,
    open,
    children,
}: {
    id?: string;
    open: boolean;
    children: ReactNode;
}) {
    return (
        <div
            id={id}
            aria-hidden={!open}
            inert={!open}
            className={cn(
                "grid transition-[grid-template-rows,opacity] duration-[var(--transition-base)] ease-[var(--ease-out)]",
                open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
            )}
        >
            <div className="min-h-0 overflow-hidden">{children}</div>
        </div>
    );
}
