"use client";

import { useEffect, useState } from "react";
import { Eclipse } from "loading-dev";
import { SwapText } from "@/components/ui/swap";
import { cn } from "@/lib/utils";

/** Format elapsed. */
const formatElapsed = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const rem = seconds % 60;
    return `${mins}m ${String(rem).padStart(2, "0")}s`;
};

/**
 * Contextual streaming status leader.
 *
 * Pairs `Eclipse` with the low-contrast synchronous `.t-think` shimmer and block
 * `SwapText` blur-translate morphs so status transitions ("Thinking" -> "Searching" ->
 * "Editing…") never jump surrounding layout or collapse in narrow panes.
 */
export const GeneratingIndicator = ({
    label = "Thinking",
    showTimer = true,
    startedAt: externalStartedAt,
    className,
}: {
    label?: string;
    showTimer?: boolean;
    startedAt?: number;
    className?: string;
}) => {
    const resolvedLabel = label.trim() || "Thinking";
    const [elapsedSec, setElapsedSec] = useState(() =>
        externalStartedAt ? Math.max(0, Math.floor((Date.now() - externalStartedAt) / 1000)) : 0,
    );

    useEffect(() => {
        if (!showTimer) return undefined;
        const origin = externalStartedAt ?? Date.now();
        const sync = () => {
            setElapsedSec(Math.max(0, Math.floor((Date.now() - origin) / 1000)));
        };
        sync();
        const interval = window.setInterval(sync, 1000);
        return () => window.clearInterval(interval);
    }, [showTimer, externalStartedAt]);

    const timerVisible = showTimer && elapsedSec >= 2;

    return (
        <span
            role="status"
            aria-live="polite"
            aria-label={resolvedLabel}
            className={cn(
                "inline-flex min-w-0 max-w-full items-center gap-2 py-0.5 chat-text text-text-muted select-none",
                className,
            )}
        >
            <span className="inline-flex shrink-0 items-center justify-center text-text-secondary" aria-hidden="true">
                <Eclipse size={14} />
            </span>
            <SwapText
                value={resolvedLabel}
                block
                durationMs={180}
                className="min-w-0 flex-1"
                render={(text) => (
                    <span className="t-think max-w-full truncate">
                        <span className="t-think-sizer">{text}</span>
                        <span className="t-think-text" data-text={text}>
                            {text}
                        </span>
                    </span>
                )}
            />
            {showTimer ? (
                <span
                    aria-hidden={!timerVisible || undefined}
                    className={cn(
                        "shrink-0 text-xs tabular-nums text-text-muted/75 transition-opacity duration-[var(--spring-quick-dur)] ease-[var(--spring-quick)]",
                        timerVisible ? "opacity-100" : "pointer-events-none w-0 overflow-hidden opacity-0",
                    )}
                >
                    {timerVisible ? formatElapsed(elapsedSec) : null}
                </span>
            ) : null}
        </span>
    );
};
