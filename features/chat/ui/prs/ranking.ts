/** Client-side ordering for the pull-request list. Pure: no React, no network. */

import type { PrItem } from "./mapping";

export type PrSortMode = "updated" | "created" | "readiness";

export const PR_SORT_MODES: { id: PrSortMode; label: string }[] = [
    { id: "updated", label: "Recently updated" },
    { id: "created", label: "Newest" },
    { id: "readiness", label: "Merge readiness" },
];

/** GitHub can only sort by recency, so merge readiness is ranked here instead. */
export function apiSortParam(mode: PrSortMode): "created" | "updated" {
    return mode === "created" ? "created" : "updated";
}

/** Lower sorts first. A conflicting pull request is never ready, so it goes last. */
export function readinessTier(item: PrItem): number {
    if (item.mergeable === "conflicting") return 4;
    if (item.status !== "open") return 3;
    if (item.draft) return 2;
    if (item.ci === "success") return 0;
    return 1;
}

/** `undefined` means the counts were never fetched, which must not beat a real size. */
function diffSize(item: PrItem): number {
    if (typeof item.additions !== "number" || typeof item.deletions !== "number") {
        return Number.POSITIVE_INFINITY;
    }
    return item.additions + item.deletions;
}

function timeOf(iso: string | undefined): number {
    if (!iso) return Number.NEGATIVE_INFINITY;
    const parsed = Date.parse(iso);
    return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/** Sort order by recency: negative puts `a` first, so the newer date wins and an unknown one loses. */
function newerFirst(a: number, b: number): number {
    if (a === b) return 0;
    if (a === Number.NEGATIVE_INFINITY) return 1;
    if (b === Number.NEGATIVE_INFINITY) return -1;
    return b - a;
}

export function comparePrItems(mode: PrSortMode): (a: PrItem, b: PrItem) => number {
    if (mode === "created") {
        return (a, b) => newerFirst(timeOf(a.createdAt), timeOf(b.createdAt));
    }
    if (mode === "updated") {
        return (a, b) => newerFirst(timeOf(a.updatedAt), timeOf(b.updatedAt));
    }
    return (a, b) => {
        const tier = readinessTier(a) - readinessTier(b);
        if (tier !== 0) return tier;
        const size = diffSize(a) - diffSize(b);
        if (!Number.isNaN(size) && size !== 0) return size;
        return newerFirst(timeOf(a.updatedAt), timeOf(b.updatedAt));
    };
}

export function sortPrItems(items: PrItem[], mode: PrSortMode): PrItem[] {
    return [...items].sort(comparePrItems(mode));
}