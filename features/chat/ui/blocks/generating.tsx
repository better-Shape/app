"use client";

import { Eclipse } from "loading-dev";

/** Live status — label stays readable; motion is supplemental. */
export function GeneratingIndicator({
    label = "Working",
}: {
    label?: string;
    showTimer?: boolean;
    variantSeed?: string;
}) {
    return (
        <span
            className="inline-flex min-w-0 items-center gap-2 py-0.5 text-text-muted"
            role="status"
        >
            <span className="inline-flex shrink-0" aria-hidden="true">
                <Eclipse size={14} className="text-text-muted" />
            </span>
            <span className="min-w-0 truncate text-sm font-medium text-text-secondary">
                {label}
            </span>
        </span>
    );
}
