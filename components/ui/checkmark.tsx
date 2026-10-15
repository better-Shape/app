"use client";

import { Subtract20Regular } from "@fluentui/react-icons/headless/svg/subtract";


import * as React from "react";
import { Icon } from "./icon";

import { cn } from "@/lib/utils";

export interface CheckmarkProps {
    checked?: boolean | "indeterminate";
    onCheckedChange?: (checked: boolean | "indeterminate") => void;
    className?: string;
    disabled?: boolean;
    /** Accessible name for the checkbox (axe aria-toggle-field-name). */
    label?: string;
    /** Tab-order override; pass -1 while the control is visually collapsed. */
    tabIndex?: number;
    /**
     * How much the drawn check moves. `compact` is the dense-list case and runs in
     * about 240ms; `full` keeps the 400ms beat for a checkbox that is the main
     * action on its surface.
     */
    motion?: "compact" | "full";
}

/** Whether the box renders filled: checked or indeterminate. */
const isFilled = (checked: boolean | "indeterminate" | undefined): boolean =>
    checked === true || checked === "indeterminate";

/** Fill classes for the filled or empty state. */
const fillClass = (isOn: boolean): string =>
    isOn ? "bg-accent border-accent text-accent-fg" : "hover:border-border hover:bg-[var(--row-hover)]";

/** Tab index for the box: disabled or caller-collapsed boxes leave the tab order. */
const boxTabIndex = (disabled: boolean | undefined, tabIndex: number | undefined): number =>
    disabled ? -1 : (tabIndex ?? 0);

/**
 * The drawn check itself: `t-success-check` in `app/transitions.css` rotates, bobs
 * and blurs it in while the stroke draws itself, so the mark arrives with the click
 * rather than after it. The mark has to be a stroked path, the draw animates
 * `stroke-dashoffset`, which Fluent's filled glyph cannot show, so it lives here
 * once and every "that worked" surface mounts this instead of re-drawing it.
 *
 * `data-state="in"` plays on mount, so mount this only when the state has actually
 * changed.
 */
export const DrawnCheck = ({ motion = "compact", className }: { motion?: "compact" | "full"; className?: string }) => (
    <span className={cn("t-success-check", className)} data-state="in" data-motion={motion} aria-hidden>
        <svg viewBox="0 0 20 20">
            <path d="M4.5 10.4 8.2 14.1 15.5 6.1" />
        </svg>
    </span>
);

/** Check or dash glyph for the current state. */
const CheckmarkGlyph = ({ checked, motion }: { checked?: boolean | "indeterminate"; motion: "compact" | "full" }) => (
    <>
        {checked === true && (
            <div className="flex items-center justify-center">
                <DrawnCheck motion={motion} />
            </div>
        )}
        {checked === "indeterminate" && (
            <div className="flex items-center justify-center">
                <Icon icon={Subtract20Regular} />
            </div>
        )}
    </>
);

/** Tri-state checkbox control with keyboard and screen-reader semantics. */
export const Checkmark = React.forwardRef<HTMLDivElement, CheckmarkProps>(
    ({ className, checked, onCheckedChange, disabled, label, tabIndex, motion = "compact", ...props }, ref) => {
        /** Flip the checked state; indeterminate counts as unchecked. */
        const toggle = () => {
            if (disabled) return;
            const nextChecked = checked !== true;
            onCheckedChange?.(nextChecked);
        };

        /** Keep the click from reaching a surrounding pressable row. */
        const handleClick = (e: React.MouseEvent) => {
            e.stopPropagation();
            toggle();
        };

        // aria-checked is tri-state: "mixed" replaces indeterminate.
        const ariaChecked = checked === "indeterminate" ? "mixed" : checked;
        const isOn = isFilled(checked);

        return (
            <div
                ref={ref}
                role="checkbox"
                aria-label={label ?? "Checkbox"}
                aria-checked={ariaChecked}
                tabIndex={boxTabIndex(disabled, tabIndex)}
                onClick={handleClick}
                onKeyDown={(e) => {
                    if (e.key === " " || e.key === "Enter") {
                        e.preventDefault();
                        // Held keys auto-repeat; one press is one toggle.
                        if (!e.repeat) toggle();
                    }
                }}
                className={cn(
                    "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-panel-hover cursor-pointer overflow-hidden",
                    "transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus",
                    fillClass(isOn),
                    disabled && "cursor-not-allowed opacity-50",
                    className
                )}
                {...props}
            >
                <CheckmarkGlyph checked={checked} motion={motion} />
            </div>
        );
    }
);

Checkmark.displayName = "Checkmark";
