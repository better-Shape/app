"use client";

import { useLoading } from "@/features/loading/context";
import { useDelayedFlag } from "@/lib/ui/use-delayed-flag";
import { cn } from "@/lib/utils";

/**
 * The one indeterminate bar for work with no measurable end.
 *
 * Git work can finish in well under a second. Without the delay the bar blinks in and out
 * on every fast stage or fetch, which reads as a fault rather than progress; the minimum
 * visible time keeps it from stuttering back out once it has appeared.
 */
export const LoadingBar = ({ className }: { className?: string }) => {
    const { isLoading } = useLoading();
    const showBar = useDelayedFlag(isLoading, { delayMs: 200, minVisibleMs: 400 });

    return (
        <div
            role={isLoading ? "progressbar" : undefined}
            aria-label={isLoading ? "Loading" : undefined}
            aria-hidden={isLoading ? undefined : true}
            className={cn("h-[4px] w-full bg-transparent overflow-hidden relative", className)}
        >
            <div
                className={cn(
                    "absolute top-0 left-0 h-full bg-accent",
                    showBar ? "bettershape-loading-progress" : "w-0",
                )}
            />
        </div>
    );
};
