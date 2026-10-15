"use client";

import { Checkmark20Regular } from "@fluentui/react-icons/headless/svg/checkmark";
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
}

/** Whether the box renders filled: checked or indeterminate. */
const isFilled = (checked: boolean | "indeterminate" | undefined): boolean =>
    checked === true || checked === "indeterminate";

/** Fill classes for the filled or empty state. */
const fillClass = (isOn: boolean): string =>
    isOn ? "bg-accent border-accent text-accent-fg" : "hover:border-border hover:bg-panel-hover";

/** Tab index for the box: disabled or caller-collapsed boxes leave the tab order. */
const boxTabIndex = (disabled: boolean | undefined, tabIndex: number | undefined): number =>
    disabled ? -1 : (tabIndex ?? 0);

/** Check or dash glyph for the current state. */
const CheckmarkGlyph = ({ checked }: { checked?: boolean | "indeterminate" }) => (
    <>
        {checked === true && (
            <div className="flex items-center justify-center">
                <Icon icon={Checkmark20Regular} />
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
    ({ className, checked, onCheckedChange, disabled, label, tabIndex, ...props }, ref) => {
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
                    "transition-colors duration-[var(--transition-fast)] ease-[var(--ease-out)]",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus",
                    fillClass(isOn),
                    disabled && "cursor-not-allowed opacity-50",
                    className
                )}
                {...props}
            >
                <CheckmarkGlyph checked={checked} />
            </div>
        );
    }
);

Checkmark.displayName = "Checkmark";
