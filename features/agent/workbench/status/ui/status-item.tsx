"use client";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * One entry in the status bar: a tooltip, a label and whatever the caller renders inside.
 *
 * A status entry without a handler is disabled rather than interactive, so a read-only
 * reading never looks clickable.
 */
export const StatusItem = ({
    label,
    children,
    onClick,
    className,
}: {
    label: string;
    children: React.ReactNode;
    onClick?: () => void;
    className?: string;
}) => {
    return (
        <Tooltip content={label}>
            <button
                type="button"
                disabled={!onClick}
                onClick={onClick}
                className={cn(
                    "h-full px-2 text-xs font-normal text-text-primary hover:bg-[var(--row-hover)] transition-colors",
                    !onClick && "cursor-default hover:bg-transparent",
                    className,
                )}
            >
                {children}
            </button>
        </Tooltip>
    );
};
