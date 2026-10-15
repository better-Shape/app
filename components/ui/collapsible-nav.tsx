"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Collapse } from "./collapse";
import { cn } from "@/lib/utils";

/** Shared animated nav group used by Git Manager, Settings, and Stats sidebars. */
export function CollapsibleNavGroup({
    label,
    open,
    onToggle,
    children,
}: {
    label: string;
    open: boolean;
    onToggle: () => void;
    children: ReactNode;
}) {
    return (
        <div>
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                className="flex h-8 w-full items-center gap-3 rounded-md px-1.5 text-left text-xs font-semibold text-text-muted hover:bg-panel-hover/40 hover:text-text-primary"
            >
                <span className="min-w-0 truncate">{label}</span>
            </button>
            <Collapse open={open}>
                <div className="space-y-0.5 pb-0.5">{children}</div>
            </Collapse>
        </div>
    );
}

export function NavLeafButton({
    active,
    onClick,
    children,
    className,
    disabled,
}: {
    active?: boolean;
    onClick: () => void;
    children: React.ReactNode;
    className?: string;
    disabled?: boolean;
}) {
    return (
        <Button
            variant="ghost"
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={cn(
                // A nav row, so it uses the row ladder rather than numbers of its own:
                // it used to hover at 60% of a 4% fill and commit at 4%, which is a
                // hand-rolled approximation of the same idea with the wrong values at
                // both ends. Hover is the midpoint of the way to the committed fill, and
                // a committed row still steps up so it never goes inert.
                "h-9 w-full justify-start gap-1 px-1.5! font-medium transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]",
                active
                    ? "bg-[var(--row-selected)] text-text-primary hover:bg-[var(--row-selected-hover)]"
                    : "text-text-secondary hover:bg-[var(--row-hover)] hover:text-text-primary",
                disabled && "pointer-events-none opacity-40",
                className,
            )}
        >
            {children}
        </Button>
    );
}
