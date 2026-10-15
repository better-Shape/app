"use client";

import { ArrowSortDown20Regular } from "@fluentui/react-icons/headless/svg/arrow-sort-down";
import { ArrowSync20Regular } from "@fluentui/react-icons/headless/svg/arrow-sync";
import { Checkmark20Regular } from "@fluentui/react-icons/headless/svg/checkmark";
import { Filter20Regular } from "@fluentui/react-icons/headless/svg/filter";
import { Info20Regular } from "@fluentui/react-icons/headless/svg/info";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icon";
import { SearchInput } from "@/components/ui/search";
import { selectPr, usePrUi } from "./store";
import type { PrCi, PrItem } from "./mapping";
import { applyPrOverrides, usePrOverridesSnapshot } from "./overrides";
import { matchPrQuery, parsePrQuery, unevaluableClauses } from "./query";
import { PR_SORT_MODES, sortPrItems, type PrSortMode } from "./ranking";
import { PrRow } from "./row";
import { usePrCloseSweep } from "./close-sweep";
import { useShiftHeld } from "./speed-actions";

/** Merge readiness reads CI, so those rows load their status on mount instead of on scroll. */
const EAGER_STATUS_LIMIT = 25;

export type IssueStateFilter = "open" | "closed" | "all";

type PullRequestsListProps = {
    items: PrItem[];
    loading: boolean;
    hasMore: boolean;
    onLoadMore: () => void;
    error: string | null;
    signedIn: boolean;
    repo: { owner: string; repo: string } | null;
    query: string;
    onQueryChange: (value: string) => void;
    sort: PrSortMode;
    onSortChange: (mode: PrSortMode) => void;
    state: IssueStateFilter;
    onStateChange: (value: IssueStateFilter) => void;
    onRefresh: () => void;
    onSignIn: () => void;
    onCiResolved: (id: string, ci: PrCi) => void;
};

const EMPTY_REPO = { owner: "", repo: "" };

export function PullRequestsList({
    items,
    loading,
    hasMore,
    onLoadMore,
    error,
    signedIn,
    repo,
    query,
    onQueryChange,
    sort,
    onSortChange,
    state,
    onStateChange,
    onRefresh,
    onSignIn,
    onCiResolved,
}: PullRequestsListProps) {
    const { selectedId } = usePrUi();
    const listRef = useRef<HTMLDivElement | null>(null);
    const sweep = usePrCloseSweep(listRef, `${repo?.owner}/${repo?.repo}`);
    const speedMode = useShiftHeld();
    const overrides = usePrOverridesSnapshot();

    const parsed = useMemo(() => parsePrQuery(query), [query]);

    // Derived from the query, not from the rows: the per-row `unevaluated` list stops at
    // the first clause that rejects, so it comes back empty exactly when nothing matches.
    const ignored = useMemo(
        () => unevaluableClauses(parsed).map((clause) => `${clause.negated ? "-" : ""}${clause.field}:${clause.value}`),
        [parsed],
    );

    const rows = useMemo(() => {
        const shown: PrItem[] = [];
        const bodyMatched = new Set<string>();
        for (const item of applyPrOverrides(items, undefined, overrides)) {
            if (state === "open" && item.status !== "open") continue;
            if (state === "closed" && item.status !== "closed" && item.status !== "merged") continue;
            const match = matchPrQuery(item, parsed);
            if (!match.matched) continue;
            if (match.matchedInBody) bodyMatched.add(item.id);
            shown.push(item);
        }
        return { shown: sortPrItems(shown, sort), bodyMatched };
    }, [items, parsed, sort, state, overrides]);

    const shownRows = useRef(rows.shown);
    useLayoutEffect(() => { shownRows.current = rows.shown; }, [rows.shown]);
    const startSweep = sweep.start;
    const onCloseSweepStart = useCallback((item: PrItem, event: PointerEvent) => {
        startSweep(item, shownRows.current, event);
    }, [startSweep]);

    return (
        <div className="relative flex h-full min-h-0 flex-col bg-panel">
            <div className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-3">
                <span className="text-sm font-medium text-text-primary">Pull Requests</span>
            </div>
            <div className="flex shrink-0 items-center gap-1 px-3 pb-3">
                <div className="min-w-0 flex-1">
                    <SearchInput
                        value={query}
                        onChange={(e) => onQueryChange(e.target.value)}
                        isLoading={loading}
                        aria-label="Search pull requests"
                        placeholder="Search pull requests, or label:bug -label:wip"
                    />
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            aria-label="Sort"
                            className="flex size-7 items-center justify-center rounded-md text-text-muted hover:bg-panel-hover hover:text-text-primary"
                        >
                            <Icon icon={ArrowSortDown20Regular} />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-44">
                        {PR_SORT_MODES.map((mode) => (
                            <DropdownMenuItem key={mode.id} onClick={() => onSortChange(mode.id)}>
                                {sort === mode.id ? (
                                    <Icon icon={Checkmark20Regular} />
                                ) : (
                                    <span className="size-4" />
                                )}
                                {mode.label}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            aria-label="Filters"
                            className="flex size-7 items-center justify-center rounded-md text-text-muted hover:bg-panel-hover hover:text-text-primary"
                        >
                            <Icon icon={Filter20Regular} />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-32">
                        {(["open", "closed", "all"] as const).map((value) => (
                            <DropdownMenuItem key={value} onClick={() => onStateChange(value)}>
                                {state === value ? <Icon icon={Checkmark20Regular} /> : <span className="size-4" />}
                                <span className="capitalize">{value}</span>
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
                <button
                    type="button"
                    aria-label="Refresh"
                    onClick={onRefresh}
                    className="flex size-7 items-center justify-center rounded-md text-text-muted hover:bg-panel-hover hover:text-text-primary"
                >
                    <Icon icon={ArrowSync20Regular} />
                </button>
            </div>
            {error && items.length > 0 ? (
                <p role="status" className="mx-3 mb-2 text-2xs text-text-muted">Refresh failed: {error}. Showing the last loaded data.</p>
            ) : null}
            {ignored.length > 0 ? (
                <p className="mx-3 mb-2 flex items-start gap-1.5 text-2xs leading-snug text-text-muted">
                    <Icon icon={Info20Regular} className="mt-px shrink-0" />
                    <span>
                        Ignoring {ignored.join(", ")} — a pull request list carries no review
                        decision, so that qualifier cannot be applied here.
                    </span>
                </p>
            ) : null}
            {hasMore ? <p role="status" className="mx-3 mb-2 text-2xs text-text-muted">Search and sorting apply to loaded pull requests. Load more to include older results.</p> : null}
            {sweep.selected.size > 0 ? <p role="status" className="pointer-events-none absolute inset-x-2 bottom-2 z-10 rounded-md border border-border-subtle bg-panel px-3 py-2 text-xs text-text-muted">Release to close {sweep.selected.size} pull requests · Esc to cancel</p> : null}
            {sweep.closing ? <p role="status" className="pointer-events-none absolute inset-x-2 bottom-2 z-10 rounded-md border border-border-subtle bg-panel px-3 py-2 text-xs text-text-muted">Closing pull requests…</p> : null}
            <div ref={listRef} onPointerDownCapture={sweep.resetClickSuppression} className="min-h-0 flex-1 overflow-y-auto px-2 pb-4" onClickCapture={(event) => {
                if (event.detail > 0 && sweep.suppressClick()) { event.preventDefault(); event.stopPropagation(); }
            }}>
                {loading && items.length === 0 ? (
                    <p className="px-2 py-3 text-sm text-text-muted">Loading…</p>
                ) : error && items.length === 0 ? (
                    <div className="flex flex-col gap-2 px-2 py-3">
                        <p className="text-sm text-text-muted">{error}</p>
                        {!signedIn ? (
                            <Button variant="secondary" size="sm" className="w-fit" onClick={onSignIn}>
                                Sign in with GitHub
                            </Button>
                        ) : null}
                    </div>
                ) : rows.shown.length === 0 ? (
                    <p className="px-2 py-3 text-sm text-text-muted">No pull requests</p>
                ) : (
                    <>
                        <p className="px-2.5 pb-1 text-xs text-text-muted">{rows.shown.length} of {items.length} loaded pull requests</p>
                        <ul className="flex flex-col">
                            {rows.shown.map((item, index) => (
                                <PrRow
                                    key={item.id}
                                    item={item}
                                    repo={repo ?? EMPTY_REPO}
                                    selected={item.id === selectedId}
                                    speedMode={speedMode}
                                    sweeping={sweep.selected.has(item.id)}
                                    sweepBusy={sweep.closing || sweep.selected.size > 0}
                                    onCloseSweepStart={onCloseSweepStart}
                                    eagerStatus={sort === "readiness" && index < EAGER_STATUS_LIMIT}
                                    matchedInBody={rows.bodyMatched.has(item.id)}
                                    onSelect={selectPr}
                                    onCi={onCiResolved}
                                />
                            ))}
                        </ul>
                    </>
                )}
                {hasMore ? <Button variant="secondary" size="sm" className="mt-2" disabled={loading} onClick={onLoadMore}>Load more pull requests</Button> : null}
            </div>
        </div>
    );
}