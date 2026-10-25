"use client";

import { useEffect, useReducer, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { useSettings } from "@/lib/settings";
import { LAST_TURN_TTL_MS, resolveChatUsageDisplay } from "@/lib/chat/usage-display";
import { getLastTurnUsage, subscribeLastTurnUsage } from "@/lib/chat/last-turn-usage";

/** Renders the UsageRing UI component. */
export const UsageRing = ({
    percent,
    size = 20,
    className,
    title,
}: {
    percent: number;
    size?: number;
    className?: string;
    title?: string;
}) => {
    const clamped = Math.max(0, Math.min(100, percent));
    const stroke = 1.75;
    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (clamped / 100) * circumference;

    return (
        <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            className={cn("shrink-0 -rotate-90", className)}
            aria-hidden={title ? undefined : true}
            role={title ? "img" : undefined}
        >
            {title ? <title>{title}</title> : null}
            <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth={stroke}
                className="text-border-secondary"
            />
            <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                className={cn(
                    "transition-[stroke-dashoffset,color] duration-[var(--spring-surface-dur)] ease-[var(--spring-surface)] motion-reduce:transition-none",
                    clamped >= 90
                        ? "text-error"
                        : clamped >= 75
                          ? "text-warning"
                          : "text-accent",
                )}
            />
        </svg>
    );
};

/** Renders the ChatUsageButton UI component. */
export const ChatUsageButton = ({ compact = false }: { compact?: boolean }) => {
    const settings = useSettings();
    const lastTurnUsage = useSyncExternalStore(subscribeLastTurnUsage, getLastTurnUsage, getLastTurnUsage);
    // The last-turn figure is only re-evaluated on render, so without this the
    // ring keeps showing a turn that has already aged past its TTL.
    const [, expireTick] = useReducer((n: number) => n + 1, 0);
    const expiresAt = lastTurnUsage ? lastTurnUsage.at + LAST_TURN_TTL_MS : null;
    useEffect(() => {
        if (expiresAt === null) return undefined;
        const remaining = expiresAt - Date.now();
        if (remaining <= 0) return undefined;
        const id = setTimeout(expireTick, remaining);
        return () => clearTimeout(id);
    }, [expiresAt]);

    const usage = resolveChatUsageDisplay(settings.ai.defaultModel, lastTurnUsage);

    return (
        <Tooltip content={usage.tooltip}>
            <button
                type="button"
                className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-sm text-text-muted transition-[background-color,color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] motion-reduce:transform-none motion-reduce:transition-none hover:bg-[var(--btn-hover)] hover:text-text-primary active:scale-[0.96]"
                onClick={() =>
                    { import("@/lib/window/open-settings").then(({ openSettingsWindow }) =>
                        openSettingsWindow({ category: "providers" }),
                    ).catch(() => undefined); }
                }
                aria-label={usage.tooltip || "Usage"}
            >
                <UsageRing percent={usage.percent} size={16} />
                {compact ? null : (
                    <span className="tabular-nums">{usage.tokens ? usage.title : ""}</span>
                )}
            </button>
        </Tooltip>
    );
};
