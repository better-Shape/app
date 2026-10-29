"use client";

import { Button } from "@/components/ui/button";
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
            <Button
                variant="ghost"
                size="xs"
                disabled={!onClick}
                onClick={onClick}
                className={cn(
                    "h-full min-h-0 shrink-0 rounded-none squircle-none px-2 text-xs font-normal text-text-primary hover:bg-[var(--row-hover)] hover:text-text-primary disabled:text-text-primary aria-disabled:text-text-primary",
                    !onClick && "cursor-default hover:bg-transparent",
                    className,
                )}
            >
                {children}
            </Button>
        </Tooltip>
    );
};
