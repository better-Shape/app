"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type CollapseVariant = "reveal" | "spring" | "menu";

export interface CollapseProps {
    open: boolean;
    children: ReactNode;
    className?: string;
    /** Id for `aria-controls` on the trigger that owns this region. */
    id?: string;
    /** Classes on the clipping wrapper, when a surface needs its own layout. */
    innerClassName?: string;
    /** Timing preset: `reveal` (default), `spring` (panel sections), or `menu` (nested menus). */
    variant?: CollapseVariant;
}

const collapseVariantClasses: Record<CollapseVariant, string> = {
    reveal: "duration-[var(--reveal-dur)] ease-[var(--reveal-ease)]",
    spring: "duration-[var(--spring-quick-dur)] ease-[var(--spring-quick)]",
    menu: "duration-[var(--transition-base)] ease-[var(--ease-out)]",
};

/**
 * The one container reveal: a section, accordion body or disclosure growing to its
 * natural height.
 *
 * Three things make this the shared version rather than six local copies:
 *
 * 1. `grid-template-rows: 0fr → 1fr` animates to the content's own height without
 *    measuring it in JS, so nothing has to guess a `max-height` and nothing gets
 *    clipped when the content is taller than the guess.
 * 2. The closed branch is marked `inert`, so links and buttons inside a collapsed
 *    section leave the tab order. Clipping with `overflow: hidden` alone hides them
 *    visually while they stay focusable, which strands keyboard users on controls
 *    they cannot see.
 * 3. Children stay mounted either way, so opening again does not refetch or reset
 *    what is inside.
 */
export const Collapse = ({
    open,
    children,
    className,
    innerClassName,
    id,
    variant = "reveal",
}: CollapseProps) => {
    return (
        <div
            id={id}
            aria-hidden={!open}
            className={cn(
                "grid transition-[grid-template-rows,opacity]",
                collapseVariantClasses[variant],
                open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                className,
            )}
        >
            <div className={cn("min-h-0 overflow-hidden", innerClassName)} inert={!open}>
                {children}
            </div>
        </div>
    );
};
