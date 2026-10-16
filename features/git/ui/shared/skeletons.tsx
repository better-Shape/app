"use client";

import { cn } from "@/lib/utils";
import { GIT_ROW, GIT_ROW_TEXT, type GitRowVariant } from "./row-shell";

/** A block placeholder: toolbars, headers, avatars, anything that is not a text line. */
export function Skeleton({ className }: { className?: string }) {
    return (
        <div
            className={cn(
                "animate-pulse rounded-md bg-panel-hover/80",
                className,
            )}
            aria-hidden
        />
    );
}

/**
 * A placeholder for one line of text.
 *
 * The height comes from the line box itself rather than from a guessed `h-*`: the
 * span carries the same type classes as the text it replaces and holds one
 * transparent glyph, so its height is whatever the real line measures, a hard-coded
 * height drifts the moment either the font scale or the type class changes.
 */
export function SkeletonLine({
    text,
    width = "w-[70%]",
    className,
}: {
    /** Type classes of the line being stood in for, e.g. `text-sm leading-snug`. */
    text: string;
    width?: string;
    className?: string;
}) {
    return (
        <span
            aria-hidden
            className={cn("block select-none animate-pulse truncate rounded-md bg-panel-hover/80 text-transparent", text, width, className)}
        >
            M
        </span>
    );
}

/**
 * Matches Git Manager list rows.
 *
 * `variant` selects the row recipe in `row-shell.ts` that the loaded list will use,
 * so the placeholder and the rows it precedes share one geometry.
 */
export const GitListSkeleton = ({ rows = 8, variant = "run" }: { rows?: number; variant?: GitRowVariant }) => {
    const text = GIT_ROW_TEXT[variant];
    // Stable ids: the placeholders never reorder, and an index key would tell React to
    // reuse a row for a different one the moment the list does.
    const placeholders = Array.from({ length: rows }, (_, i) => `${variant}-placeholder-${i}`);
    return (
        <ul className="flex flex-col gap-0.5 p-1" aria-busy aria-label="Loading">
            {placeholders.map((id, index) => (
                <li key={id} className={cn(GIT_ROW[variant], "pointer-events-none")}>
                    {variant === "dense" ? (
                        <SkeletonLine text={text.title} width="w-[70%]" />
                    ) : (
                        <div className="flex w-full flex-col gap-0.5">
                            {/* One line box per line the live title can occupy: a wrapped
                                title that lands on two lines must not make the row taller
                                than the placeholder that stood in for it. */}
                            {Array.from({ length: text.titleLines }, (_, line) => (
                                <SkeletonLine
                                    key={line}
                                    text={text.title}
                                    width={line > 0 ? "w-[55%]" : index % 3 === 0 ? "w-[85%]" : "w-[65%]"}
                                />
                            ))}
                            <SkeletonLine text={text.meta} width="w-[40%]" className="ml-4" />
                        </div>
                    )}
                </li>
            ))}
        </ul>
    );
}

/** Matches PR/issue detail header + conversation cards. */
export function GitDetailSkeleton() {
    return (
        <div className="flex h-full min-h-0 flex-col gap-3 p-3" aria-busy aria-label="Loading details">
            <div className="flex items-start gap-2">
                <Skeleton className="mt-0.5 h-7 w-7 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-5 w-[75%]" />
                    <SkeletonLine text="text-xs" width="w-[50%]" />
                </div>
                <Skeleton className="h-7 w-24 shrink-0 rounded-lg" />
            </div>
            <Skeleton className="h-8 w-64 rounded-lg" />
            <div className="flex gap-3 pt-2">
                <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2 rounded-xl border border-border-subtle p-3">
                    <SkeletonLine text="text-xs" width="w-24" />
                    <SkeletonLine text="text-xs" width="w-full" />
                    <SkeletonLine text="text-xs" width="w-[90%]" />
                    <SkeletonLine text="text-xs" width="w-[60%]" />
                </div>
            </div>
            <div className="flex gap-3">
                <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2 rounded-xl border border-border-subtle p-3">
                    <SkeletonLine text="text-xs" width="w-28" />
                    <SkeletonLine text="text-xs" width="w-full" />
                    <SkeletonLine text="text-xs" width="w-[80%]" />
                </div>
            </div>
        </div>
    );
}

/** Full Git Manager shell placeholder while repos resolve. */
export function GitManagerShellSkeleton() {
    return (
        <div className="flex h-full w-full min-w-0 overflow-hidden bg-editor" aria-busy aria-label="Loading Git Manager">
            <aside className="flex w-64 shrink-0 flex-col p-2">
                <Skeleton className="mb-2 h-9 w-full rounded-lg" />
                <div className="space-y-3 px-1 pt-2">
                    {Array.from({ length: 4 }, (_, g) => (
                        <div key={g} className="space-y-1.5">
                            <Skeleton className="h-4 w-20" />
                            <Skeleton className="h-7 w-full rounded-lg" />
                            <Skeleton className="h-7 w-full rounded-lg" />
                            <Skeleton className="h-7 w-[85%] rounded-lg" />
                        </div>
                    ))}
                </div>
            </aside>
            <section className="min-h-0 min-w-0 flex-1 border-l border-border-subtle/40 p-3">
                <Skeleton className="mb-3 h-9 w-48" />
                <GitListSkeleton rows={10} variant="dense" />
            </section>
        </div>
    );
};
