"use client";

import { useLoading } from "@/features/loading/context";
import { cn } from "@/lib/utils";

export function LoadingBar({ className }: { className?: string }) {
    const { isLoading } = useLoading();

    return (
        <div
            role={isLoading ? "progressbar" : undefined}
            aria-label={isLoading ? "Loading" : undefined}
            aria-hidden={isLoading ? undefined : true}
            className={cn("h-[4px] w-full bg-transparent overflow-hidden relative", className)}
        >
            <div
                className={cn(
                    "absolute top-0 left-0 h-full bg-accent transition-[width] duration-[var(--transition-base)] ease-[var(--ease-out)]",
                    isLoading ? "bettershape-loading-progress" : "w-0"
                )}
            />
        </div>
    );
}
