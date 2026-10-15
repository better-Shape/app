"use client";

import { BranchRequest20Regular } from "@fluentui/react-icons/headless/svg/branch-request";
import { Checkmark20Regular } from "@fluentui/react-icons/headless/svg/checkmark";
import { DocumentSearch20Regular } from "@fluentui/react-icons/headless/svg/document-search";
import { ErrorCircle20Regular } from "@fluentui/react-icons/headless/svg/error-circle";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { PrCi, PrItem } from "./mapping";
import { PrRowActions } from "./speed-actions";
import { requestCiStatus } from "./status";

function useNearViewport() {
    const ref = useRef<HTMLLIElement | null>(null);
    const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");

    useEffect(() => {
        const node = ref.current;
        if (!node || typeof IntersectionObserver === "undefined") return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (!entries.some((entry) => entry.isIntersecting)) return;
                setNear(true);
                observer.disconnect();
            },
            { rootMargin: "240px" },
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    return { ref, near };
}

type PrRowProps = {
    item: PrItem;
    repo: { owner: string; repo: string };
    selected: boolean;
    speedMode: boolean;
    sweeping: boolean;
    sweepBusy: boolean;
    onCloseSweepStart: (item: PrItem, event: PointerEvent) => void;
    /** Merge readiness reads CI, so it cannot wait for the row to scroll into view. */
    eagerStatus: boolean;
    matchedInBody: boolean;
    onSelect: (id: string, item: PrItem) => void;
    onCi: (id: string, ci: PrCi) => void;
};

function CiGlyph({ ci }: { ci: PrCi | undefined }) {
    if (ci === "success") return <Icon icon={Checkmark20Regular} className="mt-0.5 shrink-0 text-success" />;
    if (ci === "failure") return <span className="mt-1 size-2 shrink-0 rounded-full bg-error" />;
    if (ci === "pending") return <span className="mt-1 size-2 shrink-0 rounded-full bg-warning" />;
    return null;
}

function PrRowImpl({
    item,
    repo,
    selected,
    speedMode,
    sweeping,
    sweepBusy,
    onCloseSweepStart,
    eagerStatus,
    matchedInBody,
    onSelect,
    onCi,
}: PrRowProps) {
    const { ref, near } = useNearViewport();
    // Stable handler: DeepScan flags the inline callback, and a memoized handler also
    // avoids allocating a closure on every row render.
    const handleSelect = useCallback(() => {
        onSelect(item.id, item);
    }, [item, onSelect]);

    useEffect(() => {
        if (!eagerStatus && !near) return;
        if (!item.headSha || item.ci) return;
        let cancelled = false;
        void requestCiStatus(repo.owner, repo.repo, item.headSha).then(
            (ci) => {
                if (!cancelled) onCi(item.id, ci);
            },
            // A failed status read is a row that never resolves otherwise; "unknown"
            // is what the payload would have said anyway.
            () => {
                if (!cancelled) onCi(item.id, "unknown");
            },
        );
        return () => {
            cancelled = true;
        };
    }, [eagerStatus, item.ci, item.headSha, item.id, near, onCi, repo]);

    return (
        <li ref={ref} data-pr-id={item.id} className={cn("group flex items-stretch gap-0.5 rounded-lg", sweeping && "bg-error/15 ring-1 ring-error/40")}>
            <button
                type="button"
                aria-current={selected ? "true" : undefined}
                onClick={handleSelect}
                className={cn(
                    "flex min-w-0 flex-1 gap-2.5 rounded-lg px-2.5 py-2 text-left",
                    selected ? "bg-panel-active" : "hover:bg-panel-hover",
                )}
            >
                <Icon
                    icon={BranchRequest20Regular}
                    className={cn(
                        "mt-0.5 shrink-0",
                        item.status === "open" ? "text-success" : "text-text-muted",
                    )}
                />
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-text-primary">
                        {item.title}
                    </span>
                    <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-text-muted">
                        <span>#{item.number}</span>
                        <span>·</span>
                        <span className="truncate">{item.repo}</span>
                        {item.avatar ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={item.avatar} alt="" className="size-3.5 rounded-full" />
                        ) : null}
                        {matchedInBody ? (
                            <span className="flex items-center gap-1 rounded-full bg-panel-hover px-1.5 py-px text-2xs text-text-secondary">
                                <Icon icon={DocumentSearch20Regular} />
                                matched in description
                            </span>
                        ) : null}
                        {item.labels.slice(0, 2).map((label) => (
                            <span
                                key={label.name}
                                className="rounded-full px-1.5 py-px text-2xs"
                                style={{
                                    backgroundColor: `#${label.color}22`,
                                    color: `#${label.color}`,
                                }}
                            >
                                {label.name}
                            </span>
                        ))}
                        {typeof item.additions === "number" ? (
                            <span className="text-success">+{item.additions}</span>
                        ) : null}
                        {typeof item.deletions === "number" ? (
                            <span className="text-error">−{item.deletions}</span>
                        ) : null}
                        {item.updated ? <span>{item.updated}</span> : null}
                    </span>
                </span>
                {item.mergeable === "conflicting" ? (
                    <span
                        title={`Conflicts with ${item.baseRef ?? "the base branch"}`}
                        className="mt-0.5 shrink-0 text-error"
                    >
                        <Icon icon={ErrorCircle20Regular} />
                        <span className="sr-only">
                            Conflicts with {item.baseRef ?? "the base branch"}
                        </span>
                    </span>
                ) : null}
                <CiGlyph ci={item.ci} />
            </button>
            <PrRowActions item={item} repo={repo} speedMode={speedMode} sweepBusy={sweepBusy} onCloseSweepStart={onCloseSweepStart} />
        </li>
    );
}

export const PrRow = memo(PrRowImpl);