"use client";

import { ArrowMinimize20Regular } from "@fluentui/react-icons/headless/svg/arrow-minimize";
import { ArrowSync20Regular } from "@fluentui/react-icons/headless/svg/arrow-sync";
import { ArrowUpload20Regular } from "@fluentui/react-icons/headless/svg/arrow-upload";
import { CloudOff20Regular } from "@fluentui/react-icons/headless/svg/cloud-off";
import { Filter20Regular } from "@fluentui/react-icons/headless/svg/filter";
import { Target20Regular } from "@fluentui/react-icons/headless/svg/target";


import React, { useState, useCallback, useEffect, useRef, useMemo, useDeferredValue, useLayoutEffect } from "react";
import { Icon } from "@/components/ui/icon";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import {
    commands,
    useProjectState,
    GitFileParams,
    GitLogEntry,
} from "@/lib/backend";
import { notify } from "@/features/notifications";
import { computeGraphRowLayout, computeVisibleRange, GRAPH_LOG_SOFT_CAP, GRAPH_OVERSCAN_PX, rowTop } from "@/lib/git/graph-virtual";
import { Tooltip } from "@/components/ui/tooltip";
import {
    SidebarPanelHeaderFrame,
} from "@/features/panels";
import { useLoading } from "@/features/loading/context";
import { useOptionalFilter } from "@/features/git/ui/manager/filter-context";
import { useGitRepos } from "@/lib/git/repos";
import { resolveGithubAvatarUrl } from "@/lib/git/github-avatar";
import { useSettings } from "@/lib/settings";
import { graphCache } from "./cache";
import { EMPTY_ARRAY, EMPTY_NODE, commitIsHead } from "./constants";
import { FilterMenu } from "./filter-menu";
import { GraphCommitRow } from "./commit-row";
import { GraphDetailPanel, type GraphDetailSelection } from "./graph-detail-panel";
import type { RefInfo } from "./ref-pill";
import { Panel } from "@/features/panels";
import { GitManagerTrigger } from "@/features/git/ui/manager/git-manager-trigger";
import { GitChromeActions } from "@/features/git/ui/manager/chrome";
import { GraphLoadingStatus } from "./graph-loading-status";

// ── VIRTUAL SCROLL CONSTANTS ──
/**
 * Named placeholder lanes. A keyed row survives a re-render, so an index would tell React
 * that the third skeleton is the same lane as whatever replaces it.
 */

const OVERSCAN_PX = GRAPH_OVERSCAN_PX;

export type GraphPendingBaseline = {
    cacheKey: string | null;
    topHash: string | null;
    known: Set<string>;
    headRef?: string | null;
};

export type GraphHeadSnapshot = {
    cacheKey: string | null;
    topHash: string | null;
    known: Set<string>;
    headRef?: string | null;
    logsRef?: GitLogEntry[] | null;
    ignoredLogsRef?: GitLogEntry[] | null;
    pendingTopHash?: string | null;
    pendingBaseline?: GraphPendingBaseline | null;
};

const parseSingleHeadRef = (raw: string): string | null => {
    const trimmed = raw.trim();
    const match = /^head\s*->\s*(.+)$/i.exec(trimmed);
    if (match) return `branch:${match[1].trim()}`;
    return trimmed.toLowerCase() === "head" ? "detached" : null;
};

const extractEntryHeadRef = (refs: readonly string[] | undefined): string | null => {
    if (!refs) return null;
    for (const ref of refs) {
        const parsed = parseSingleHeadRef(ref);
        if (parsed) return parsed;
    }
    return null;
};

export const resolveGraphHeadRef = (
    logs: readonly Pick<GitLogEntry, "refs">[],
): string | null => {
    for (const entry of logs) {
        const found = extractEntryHeadRef(entry.refs);
        if (found) return found;
    }
    return null;
};

type GraphCommitLineage = Pick<GitLogEntry, "hash" | "parents">;

const isLineageList = (
    value: GraphCommitLineage | readonly GraphCommitLineage[],
): value is readonly GraphCommitLineage[] => Array.isArray(value);

const normalizeLineageSlice = (
    candidate: GraphCommitLineage | readonly GraphCommitLineage[] | undefined,
): readonly GraphCommitLineage[] => {
    if (!candidate) return EMPTY_ARRAY;
    return isLineageList(candidate) ? candidate : [candidate];
};

const MAX_ARRIVING_COMMITS = 12;
const EMPTY_ARRIVAL_SET: ReadonlySet<string> = new Set<string>();

type GraphForwardWalk = {
    ordered: string[];
    knownAnchors: Set<string>;
    reverseChildren: Map<string, string[]>;
    hasMissingParent: boolean;
};

type GraphWalkContext = GraphForwardWalk & {
    freshByHash: ReadonlyMap<string, readonly string[]>;
    known: ReadonlySet<string>;
    visited: Set<string>;
};

type GraphArrivalEvaluation = {
    freshHashes: ReadonlySet<string>;
    hasMissingParent: boolean;
};

const EMPTY_ARRIVAL_EVALUATION: GraphArrivalEvaluation = {
    freshHashes: EMPTY_ARRIVAL_SET,
    hasMissingParent: false,
};

const indexFreshLineage = (
    commits: readonly GraphCommitLineage[],
    known: ReadonlySet<string>,
): Map<string, readonly string[]> => {
    const freshByHash = new Map<string, readonly string[]>();
    for (const commit of commits) {
        if (!known.has(commit.hash)) freshByHash.set(commit.hash, commit.parents);
    }
    return freshByHash;
};

const appendReverseChild = (
    reverseChildren: Map<string, string[]>,
    parentHash: string,
    childHash: string,
): void => {
    const existing = reverseChildren.get(parentHash);
    if (existing) existing.push(childHash);
    else reverseChildren.set(parentHash, [childHash]);
};

const recordLineageEdge = (
    childHash: string,
    parentHash: string,
    context: GraphWalkContext,
): void => {
    if (context.known.has(parentHash)) {
        context.knownAnchors.add(childHash);
        return;
    }
    appendReverseChild(context.reverseChildren, parentHash, childHash);
    if (!context.freshByHash.has(parentHash)) {
        context.hasMissingParent = true;
        return;
    }
    if (context.visited.has(parentHash)) return;
    context.visited.add(parentHash);
    context.ordered.push(parentHash);
};

const walkForwardFreshCommits = (
    topHash: string,
    freshByHash: ReadonlyMap<string, readonly string[]>,
    known: ReadonlySet<string>,
): GraphForwardWalk => {
    const context: GraphWalkContext = {
        ordered: [topHash],
        knownAnchors: new Set<string>(),
        reverseChildren: new Map<string, string[]>(),
        hasMissingParent: false,
        freshByHash,
        known,
        visited: new Set<string>([topHash]),
    };
    for (let index = 0; index < context.ordered.length; index += 1) {
        const current = context.ordered[index];
        const parents = freshByHash.get(current) ?? EMPTY_ARRAY;
        for (const parentHash of parents) {
            recordLineageEdge(current, parentHash, context);
        }
    }
    return context;
};

const walkConfirmedAncestors = (
    knownAnchors: ReadonlySet<string>,
    reverseChildren: ReadonlyMap<string, readonly string[]>,
): Set<string> => {
    const confirmed = new Set<string>(knownAnchors);
    const queue = Array.from(knownAnchors);
    for (let index = 0; index < queue.length; index += 1) {
        const children = reverseChildren.get(queue[index]) ?? EMPTY_ARRAY;
        for (const childHash of children) {
            if (confirmed.has(childHash)) continue;
            confirmed.add(childHash);
            queue.push(childHash);
        }
    }
    return confirmed;
};

const capOrderedArrivals = (
    ordered: readonly string[],
    confirmed: ReadonlySet<string>,
): Set<string> => {
    const selected = new Set<string>();
    for (const hash of ordered) {
        if (!confirmed.has(hash)) continue;
        selected.add(hash);
        if (selected.size >= MAX_ARRIVING_COMMITS) break;
    }
    return selected;
};

const hasMatchingGraphContext = (
    prev: GraphPendingBaseline,
    cacheKey: string | null,
    nextHeadRef: string | null,
): boolean => {
    if (!cacheKey || prev.cacheKey !== cacheKey || !prev.topHash) return false;
    return (prev.headRef ?? null) === nextHeadRef;
};

const resolveConfirmedFreshHashes = (forward: GraphForwardWalk): ReadonlySet<string> => {
    if (forward.knownAnchors.size === 0) return EMPTY_ARRIVAL_SET;
    const confirmed = walkConfirmedAncestors(forward.knownAnchors, forward.reverseChildren);
    return capOrderedArrivals(forward.ordered, confirmed);
};

const evaluateFreshGraphLineage = (
    prev: GraphPendingBaseline,
    cacheKey: string | null,
    commits: readonly GraphCommitLineage[],
    nextHeadRef: string | null,
): GraphArrivalEvaluation => {
    if (commits.length === 0 || !hasMatchingGraphContext(prev, cacheKey, nextHeadRef)) {
        return EMPTY_ARRIVAL_EVALUATION;
    }
    const topHash = commits[0].hash;
    if (prev.known.has(topHash)) return EMPTY_ARRIVAL_EVALUATION;
    const freshByHash = indexFreshLineage(commits, prev.known);
    const forward = walkForwardFreshCommits(topHash, freshByHash, prev.known);
    return {
        freshHashes: resolveConfirmedFreshHashes(forward),
        hasMissingParent: forward.hasMissingParent,
    };
};

/**
 * Collects the contiguous newly arrived head commits that descend from previously known
 * history on the same graph key and checked-out `HEAD` ref, bounded to `MAX_ARRIVING_COMMITS`.
 */
export const collectFreshGraphArrivals = (
    prev: GraphPendingBaseline,
    cacheKey: string | null,
    candidate: GraphCommitLineage | readonly GraphCommitLineage[] | undefined,
    nextHeadRef: string | null = null,
): ReadonlySet<string> =>
    evaluateFreshGraphLineage(prev, cacheKey, normalizeLineageSlice(candidate), nextHeadRef)
        .freshHashes;

/**
 * Returns true when `candidate` begins with newly arrived commits connected to `prev.known`
 * on the same graph cache key and checked-out `HEAD` ref.
 */
export const detectFreshGraphArrival = (
    prev: GraphHeadSnapshot,
    cacheKey: string | null,
    candidate: GraphCommitLineage | readonly GraphCommitLineage[] | undefined,
    nextHeadRef: string | null = null,
): boolean => collectFreshGraphArrivals(prev, cacheKey, candidate, nextHeadRef).size > 0;

const resolveIgnoredLogsRef = (
    prev: GraphHeadSnapshot,
    keyChanged: boolean,
    gitLogs: GitLogEntry[],
): GitLogEntry[] | null => {
    if (!keyChanged) {
        return prev.ignoredLogsRef === gitLogs ? prev.ignoredLogsRef : null;
    }
    const carriedOver = prev.cacheKey !== null && prev.logsRef === gitLogs && gitLogs.length > 0;
    return carriedOver ? gitLogs : null;
};

const buildNextKnownSet = (
    prevKnown: Set<string>,
    keyChanged: boolean,
    staleCarryOver: boolean,
    gitLogs: GitLogEntry[],
): Set<string> => {
    const nextKnown = keyChanged ? new Set<string>() : new Set(prevKnown);
    if (staleCarryOver) return nextKnown;
    for (const entry of gitLogs) nextKnown.add(entry.hash);
    return nextKnown;
};

const resolveArrivalBaseline = (
    prev: GraphHeadSnapshot,
    keyChanged: boolean,
    effectiveTopHash: string | null,
): GraphPendingBaseline => {
    if (!keyChanged && prev.pendingBaseline && prev.pendingTopHash === effectiveTopHash) {
        return prev.pendingBaseline;
    }
    return prev;
};

const toPendingBaseline = (baseline: GraphPendingBaseline): GraphPendingBaseline => ({
    cacheKey: baseline.cacheKey,
    topHash: baseline.topHash,
    known: baseline.known,
    headRef: baseline.headRef ?? null,
});

const resolveNextPendingBaseline = (
    baseline: GraphPendingBaseline,
    evaluation: GraphArrivalEvaluation,
): GraphPendingBaseline | null => {
    if (!evaluation.hasMissingParent) return null;
    if (evaluation.freshHashes.size >= MAX_ARRIVING_COMMITS) return null;
    return toPendingBaseline(baseline);
};

const resolveEffectiveSlice = (
    gitLogs: GitLogEntry[],
    staleCarryOver: boolean,
): {
    effectiveLogs: GitLogEntry[];
    effectiveTopHash: string | null;
    effectiveHeadRef: string | null;
} => {
    if (staleCarryOver) {
        return { effectiveLogs: EMPTY_ARRAY, effectiveTopHash: null, effectiveHeadRef: null };
    }
    return {
        effectiveLogs: gitLogs,
        effectiveTopHash: gitLogs.length > 0 ? gitLogs[0].hash : null,
        effectiveHeadRef: resolveGraphHeadRef(gitLogs),
    };
};

const computeNextSnapshot = (
    prev: GraphHeadSnapshot,
    cacheKey: string | null,
    gitLogs: GitLogEntry[],
    nextIgnoredLogsRef: GitLogEntry[] | null,
): { nextSnapshot: GraphHeadSnapshot; freshHashes: ReadonlySet<string> } => {
    const keyChanged = prev.cacheKey !== cacheKey;
    const staleCarryOver = nextIgnoredLogsRef !== null;
    const { effectiveLogs, effectiveTopHash, effectiveHeadRef } = resolveEffectiveSlice(
        gitLogs,
        staleCarryOver,
    );
    const baseline = resolveArrivalBaseline(prev, keyChanged, effectiveTopHash);
    const evaluation = evaluateFreshGraphLineage(
        baseline,
        cacheKey,
        effectiveLogs,
        effectiveHeadRef,
    );
    const nextPending = resolveNextPendingBaseline(baseline, evaluation);
    return {
        freshHashes: evaluation.freshHashes,
        nextSnapshot: {
            cacheKey,
            topHash: effectiveTopHash,
            known: buildNextKnownSet(prev.known, keyChanged, staleCarryOver, gitLogs),
            headRef: effectiveHeadRef,
            logsRef: gitLogs,
            ignoredLogsRef: nextIgnoredLogsRef,
            pendingTopHash: nextPending ? effectiveTopHash : null,
            pendingBaseline: nextPending,
        },
    };
};

const hasSnapshotChanged = (
    prev: GraphHeadSnapshot,
    keyChanged: boolean,
    gitLogs: GitLogEntry[],
    nextIgnoredLogsRef: GitLogEntry[] | null,
): boolean =>
    keyChanged || prev.logsRef !== gitLogs || prev.ignoredLogsRef !== nextIgnoredLogsRef;

const hasArrivalContextShifted = (prev: GraphHeadSnapshot, next: GraphHeadSnapshot): boolean =>
    prev.cacheKey !== next.cacheKey ||
    prev.headRef !== next.headRef ||
    prev.topHash !== next.topHash;

const setsHaveSameMembers = (
    first: ReadonlySet<string>,
    second: ReadonlySet<string>,
): boolean => {
    if (first.size !== second.size) return false;
    for (const item of first) {
        if (!second.has(item)) return false;
    }
    return true;
};

const resolveNextArrivingState = (
    current: ReadonlySet<string>,
    freshHashes: ReadonlySet<string>,
    prev: GraphHeadSnapshot,
    next: GraphHeadSnapshot,
): ReadonlySet<string> => {
    if (freshHashes.size > 0) {
        return setsHaveSameMembers(current, freshHashes) ? current : freshHashes;
    }
    if (current.size > 0 && hasArrivalContextShifted(prev, next)) return EMPTY_ARRIVAL_SET;
    return current;
};

const clearExpiredPendingBaseline = (snapshot: GraphHeadSnapshot): GraphHeadSnapshot =>
    snapshot.pendingBaseline
        ? { ...snapshot, pendingTopHash: null, pendingBaseline: null }
        : snapshot;

/**
 * Tracks newly arrived head commits in an already-loaded graph view across streamed batches
 * while keeping cache switches, branch checkouts, and scroll recycling static.
 */
export const useArrivingCommitHashes = (
    cacheKey: string | null,
    gitLogs: GitLogEntry[],
): ReadonlySet<string> => {
    const [prev, setPrev] = useState<GraphHeadSnapshot>({
        cacheKey: null,
        topHash: null,
        known: new Set(),
        headRef: null,
        logsRef: null,
        ignoredLogsRef: null,
        pendingTopHash: null,
        pendingBaseline: null,
    });
    const [arrivingHashes, setArrivingHashes] = useState<ReadonlySet<string>>(EMPTY_ARRIVAL_SET);

    const keyChanged = prev.cacheKey !== cacheKey;
    const nextIgnoredLogsRef = resolveIgnoredLogsRef(prev, keyChanged, gitLogs);
    if (hasSnapshotChanged(prev, keyChanged, gitLogs, nextIgnoredLogsRef)) {
        const { nextSnapshot, freshHashes } = computeNextSnapshot(
            prev,
            cacheKey,
            gitLogs,
            nextIgnoredLogsRef,
        );
        setPrev(nextSnapshot);
        const nextArriving = resolveNextArrivingState(
            arrivingHashes,
            freshHashes,
            prev,
            nextSnapshot,
        );
        if (nextArriving !== arrivingHashes) setArrivingHashes(nextArriving);
    }

    useEffect(() => {
        if (arrivingHashes.size === 0) return undefined;
        const timer = window.setTimeout(() => {
            setArrivingHashes(EMPTY_ARRIVAL_SET);
            setPrev(clearExpiredPendingBaseline);
        }, 520);
        return () => window.clearTimeout(timer);
    }, [arrivingHashes]);

    return arrivingHashes;
};

/** Returns the newest arriving head commit hash, or `null` when idle. */
export const useArrivingCommitHash = (
    cacheKey: string | null,
    gitLogs: GitLogEntry[],
): string | null => {
    const arrivingHashes = useArrivingCommitHashes(cacheKey, gitLogs);
    const first = arrivingHashes.values().next();
    return first.done ? null : first.value;
};

/** Renders the repository commit graph with streamed log pagination, arrival strokes, and diffs. */
export default function Graph({
    className,
    surface = "panel",
    rich = false,
    active = true,
    hideHeader = false,
}: {
    className?: string;
    surface?: "panel" | "editor";
    /** Manager-only chrome: author/branch filters and richer titlebar. */
    rich?: boolean;
    /** When false (keep-alive pane hidden), unmount Monaco so it cannot overlay other pages. */
    active?: boolean;
    /** Skip the in-panel header (agent workspace tab already has chrome). */
    hideHeader?: boolean;
}) {
    const { project_path } = useProjectState();
    const { scmRepoPath } = useGitRepos(project_path);
    const gitRepo = scmRepoPath;
    const commitSearch = useOptionalFilter()?.query ?? "";
    const settings = useSettings();
    const showAllBranches = settings.git.graphShowAllBranches;
    const showGraphAvatars = settings.git.graphAvatars;
    const [authorFilter, setAuthorFilter] = useState<string>("all");
    const [branchFilter, setBranchFilter] = useState<string>("all");
    const [kindFilter, setKindFilter] = useState<"all" | "merges" | "non-merges">("all");
    const [refKindFilter, setRefKindFilter] = useState<"all" | "branches" | "remotes" | "tags">("all");
    const [dateFilter, setDateFilter] = useState<"all" | "7d" | "30d" | "90d">("all");
    const [localSearch, setLocalSearch] = useState("");
    const deferredLocalSearch = useDeferredValue(localSearch);
    const deferredCommitSearch = useDeferredValue(commitSearch);
    const [selectedHash, setSelectedHash] = useState<string | null>(null);
    const [detail, setDetail] = useState<GraphDetailSelection | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);

    const cacheKey = scmRepoPath
        ? `${scmRepoPath}::${showAllBranches ? "all" : "head"}`
        : project_path
          ? `${project_path}::${showAllBranches ? "all" : "head"}`
          : null;
    const cached = cacheKey ? graphCache[cacheKey] : null;

    const [gitLogs, setGitLogs] = useState<GitLogEntry[]>(cached?.logs || []);
    const [expandedCommits, setExpandedCommits] = useState<Set<string>>(cached?.expanded || new Set());
    const [commitFilesCache, setCommitFilesCache] = useState<Record<string, GitFileParams[]>>(cached?.filesCache || {});
    const [commitFilesLoaded, setCommitFilesLoaded] = useState<Record<string, boolean>>({});

    const scrollContainerRef = useRef<HTMLDivElement | null>(null);
    const [isLoadingNext, setIsLoadingNext] = useState(false);
    const isInitialLoading = !cached;

    // Virtual scroll state
    const [scrollTop, setScrollTop] = useState(cached?.scrollTop || 0);
    const [containerHeight, setContainerHeight] = useState(600);
    const scrollRafRef = useRef<number | null>(null);
    const scrollTopRef = useRef(cached?.scrollTop || 0);
    const windowRef = useRef({ start: -1, end: -1 });
    const hasRestoredScroll = useRef(false);

    const { startLoading, stopLoading } = useLoading();

    useEffect(() => {
        if (!cacheKey) return;
        if (gitLogs.length > 0) {
            const logs =
                gitLogs.length > GRAPH_LOG_SOFT_CAP
                    ? gitLogs.slice(0, GRAPH_LOG_SOFT_CAP)
                    : gitLogs;
            graphCache[cacheKey] = {
                logs,
                expanded: expandedCommits,
                filesCache: commitFilesCache,
                scrollTop: scrollTopRef.current,
            };
        }
    }, [cacheKey, gitLogs, expandedCommits, commitFilesCache]);



    const toggleCommitExpansion = useCallback((hash: string) => {
        setExpandedCommits(prev => {
            const next = new Set(prev);
            if (next.has(hash)) next.delete(hash);
            else next.add(hash);
            return next;
        });
    }, []);

    const handleFilesLoaded = useCallback((hash: string, files: GitFileParams[]) => {
        setCommitFilesCache(prev => ({ ...prev, [hash]: files }));
        setCommitFilesLoaded(prev => ({ ...prev, [hash]: true }));
    }, []);

    const streamGenRef = useRef(0);
    const streamActiveRef = useRef(false);

    const drainStream = useCallback(async (count: number, gen: number) => {
        // Cap catch-up so remounting a large cache doesn't freeze the UI.
        let remaining = Math.min(count, GRAPH_LOG_SOFT_CAP);
        while (remaining > 0 && gen === streamGenRef.current) {
            const batch = await commands.gitLogStreamNext("graph", Math.min(remaining, 400));
            if (batch.length === 0) break;
            remaining -= batch.length;
            await new Promise<void>((r) => requestAnimationFrame(() => r()));
        }
    }, []);

    const appendLogs = useCallback((more: GitLogEntry[]) => {
        if (more.length === 0) return;
        setGitLogs((prev) => {
            if (prev.length >= GRAPH_LOG_SOFT_CAP) return prev;
            const room = GRAPH_LOG_SOFT_CAP - prev.length;
            if (more.length <= room) return [...prev, ...more];
            return [...prev, ...more.slice(0, room)];
        });
    }, []);

    const refresh = useCallback((opts?: { track?: boolean }) => {
        if (!gitRepo) return;
        const track = opts?.track !== false;
        const gen = ++streamGenRef.current;
        streamActiveRef.current = false;
        if (track) startLoading();
        return commands.gitLogStreamStart(gitRepo, "graph", showAllBranches).then(async () => {
            if (gen !== streamGenRef.current) return;
            streamActiveRef.current = true;
            const initialLogs = await commands.gitLogStreamNext("graph", 100);
            if (gen !== streamGenRef.current) return;
            setGitLogs(initialLogs);

            void commands.gitLogStreamNext("graph", 200).then((more) => {
                if (gen !== streamGenRef.current || !streamActiveRef.current) return;
                appendLogs(more);
            });
        }).catch(() => {
            if (gen === streamGenRef.current) setGitLogs([]);
        }).finally(() => {
            // Always pair start/stop — skipping on gen mismatch left the bar stuck forever.
            if (track) stopLoading();
        });
    }, [gitRepo, showAllBranches, startLoading, stopLoading, appendLogs]);

    const [cacheRestore, setCacheRestore] = useState<{ key: string | null; scrollTop: number } | null>(null);
    if (cacheRestore === null || cacheRestore.key !== cacheKey) {
        const entry = cacheKey ? graphCache[cacheKey] : undefined;
        setCacheRestore({ key: cacheKey, scrollTop: entry?.scrollTop ?? 0 });
        setGitLogs(entry?.logs.slice(0, GRAPH_LOG_SOFT_CAP) ?? []);
        setExpandedCommits(entry?.expanded ?? new Set());
        setCommitFilesCache(entry?.filesCache ?? {});
        setCommitFilesLoaded({});
        setScrollTop(entry?.scrollTop ?? 0);
    }
    const activeLogs =
        cacheRestore !== null && cacheRestore.key === cacheKey
            ? gitLogs
            : (cached?.logs ?? []);
    const arrivingHashes = useArrivingCommitHashes(cacheKey, activeLogs);

    useLayoutEffect(() => {
        scrollTopRef.current = cacheRestore?.scrollTop ?? 0;
        hasRestoredScroll.current = false;
    }, [cacheRestore]);

    useEffect(() => {
        if (scrollContainerRef.current && gitLogs.length > 0 && !hasRestoredScroll.current) {
            scrollContainerRef.current.scrollTop = scrollTopRef.current;
            hasRestoredScroll.current = true;
        }
    }, [cacheRestore, gitLogs.length]);

    useEffect(() => {
        if (!cacheKey || !gitRepo) return;
        const entry = graphCache[cacheKey];
        if (entry?.logs.length) {
            const gen = ++streamGenRef.current;
            streamActiveRef.current = false;
            void commands.gitLogStreamStart(gitRepo, "graph", showAllBranches).then(async () => {
                if (gen !== streamGenRef.current) return;
                await drainStream(entry.logs.length, gen);
                if (gen === streamGenRef.current) streamActiveRef.current = true;
            }).catch(() => { /* a subsequent refresh can retry the stream */ });
        } else {
            void refresh({ track: false });
        }
        return () => {
            streamGenRef.current += 1;
            streamActiveRef.current = false;
            void commands.gitLogStreamStop("graph");
        };
    }, [cacheKey, refresh, gitRepo, drainStream, showAllBranches]);

    const handleShowCommitDiff = useCallback(async (hash: string, path: string) => {
        if (!gitRepo) return;
        if (rich) {
            const log = gitLogs.find((l) => l.hash === hash);
            const files = commitFilesCache[hash] ?? [];
            const file = files.find((f) => f.path === path) ?? ({ path, status: "M" } as GitFileParams);
            if (log) {
                setSelectedHash(hash);
                setDetail({ kind: "file", log, file });
            }
            return;
        }
        const name = path.split(/[\\\/]/).pop() || path;
        try {
            await commands.gitOpenCommitDiff(path, name, hash);
        } catch (e) { notify.error("Git Error", `Failed to open diff: ${e}`); }
    }, [gitRepo, rich, gitLogs, commitFilesCache]);

    const handleSelectCommit = useCallback((hash: string) => {
        setSelectedHash(hash);
        if (!rich) return;
        const log = gitLogs.find((l) => l.hash === hash);
        if (!log) return;
        setDetail((prev) => {
            if (prev?.kind === "file" && prev.log.hash === hash) return prev;
            return { kind: "commit", log };
        });
    }, [rich, gitLogs]);

    const handleRefActivate = useCallback((ref: RefInfo) => {
        if (!rich) return;
        const label = ref.label.replace(/^tag:\s*/i, "").trim();
        if (!label || label.toLowerCase() === "head") return;
        setBranchFilter((prev) => (prev === label ? "all" : label));
    }, [rich]);

    const handleOpenFile = useCallback(async (path: string) => {
        if (!gitRepo) return;
        const name = path.split(/[\\\/]/).pop() || path;
        const sep = gitRepo.endsWith('/') || gitRepo.endsWith('\\') ? '' : '/';
        try {
            await commands.openFile(gitRepo + sep + path, name);
        } catch (e) { notify.error("Git Error", `Failed to open file: ${e}`); }
    }, [gitRepo]);

    // ── VIRTUAL SCROLLING ──
    // Pre-compute cumulative top offsets once. Only changes when expand state or file count changes.
    const authors = useMemo(() => {
        const set = new Set<string>();
        // Cap scan + options, author dropdown doesn't need every unique name from 8k commits.
        const limit = Math.min(gitLogs.length, 2_000);
        for (let i = 0; i < limit; i++) {
            const a = gitLogs[i].author?.trim();
            if (a) set.add(a);
            if (set.size >= 80) break;
        }
        return Array.from(set).sort((a, b) => a.localeCompare(b));
    }, [gitLogs]);


    /** Match predicate, used to mute rows, not drop them (preserves lane topology). */
    const commitMatchesFilter = useCallback((log: GitLogEntry) => {
        const q = (rich ? (deferredLocalSearch || deferredCommitSearch) : deferredCommitSearch).trim().toLowerCase();
        if (authorFilter !== "all" && log.author.trim() !== authorFilter) return false;
        if (branchFilter !== "all") {
            const refs = (log.refs ?? []).map((r) =>
                r.replace(/HEAD -> /g, "").replace(/^tag: /, "").trim(),
            );
            if (!refs.some((r) => r === branchFilter || r.endsWith(`/${branchFilter}`))) {
                return false;
            }
        }
        if (kindFilter === "merges" && log.parent_count <= 1) return false;
        if (kindFilter === "non-merges" && log.parent_count > 1) return false;
        if (refKindFilter !== "all") {
            const refs = log.refs ?? [];
            if (refs.length === 0) return false;
            const has = refs.some((r) => {
                const cleaned = r.replace(/HEAD -> /g, "").trim();
                if (refKindFilter === "tags") return cleaned.startsWith("tag: ");
                if (refKindFilter === "remotes") {
                    return cleaned.startsWith("origin/") || cleaned.startsWith("upstream/");
                }
                // local branches
                return (
                    !cleaned.startsWith("tag: ")
                    && !cleaned.startsWith("origin/")
                    && !cleaned.startsWith("upstream/")
                    && cleaned.toLowerCase() !== "head"
                );
            });
            if (!has) return false;
        }
        if (dateFilter !== "all") {
            const ts = Number.parseInt(log.date, 10);
            if (Number.isFinite(ts)) {
                const days = dateFilter === "7d" ? 7 : dateFilter === "30d" ? 30 : 90;
                const cutoff = Date.now() / 1000 - days * 86400;
                if (ts < cutoff) return false;
            }
        }
        if (!q) return true;
        return (
            log.message.toLowerCase().includes(q)
            || log.author.toLowerCase().includes(q)
            || log.hash.toLowerCase().includes(q)
            || (log.refs ?? []).some((r) => r.toLowerCase().includes(q))
        );
    }, [rich, deferredLocalSearch, deferredCommitSearch, authorFilter, branchFilter, kindFilter, refKindFilter, dateFilter]);

    const hasActiveFilter = useMemo(() => {
        const q = (rich ? (deferredLocalSearch || deferredCommitSearch) : deferredCommitSearch).trim();
        return (
            authorFilter !== "all"
            || branchFilter !== "all"
            || kindFilter !== "all"
            || refKindFilter !== "all"
            || dateFilter !== "all"
            || q.length > 0
        );
    }, [rich, deferredLocalSearch, deferredCommitSearch, authorFilter, branchFilter, kindFilter, refKindFilter, dateFilter]);

    const mutedHashes = useMemo(() => {
        if (!hasActiveFilter) return null as Set<string> | null;
        const muted = new Set<string>();
        for (const log of gitLogs) {
            if (!commitMatchesFilter(log)) muted.add(log.hash);
        }
        return muted;
    }, [gitLogs, hasActiveFilter, commitMatchesFilter]);

    const matchCount = useMemo(() => {
        if (!mutedHashes) return gitLogs.length;
        return gitLogs.length - mutedHashes.size;
    }, [gitLogs.length, mutedHashes]);

    const headIndex = useMemo(() => {
        const idx = gitLogs.findIndex((log) => commitIsHead(log.refs));
        return idx >= 0 ? idx : 0;
    }, [gitLogs]);

    const rowLayout = useMemo(() => {
        const fileCounts: Record<string, number> = {};
        if (expandedCommits.size > 0) {
            for (const hash of expandedCommits) {
                fileCounts[hash] = commitFilesCache[hash]?.length ?? 1;
            }
        }
        return computeGraphRowLayout(
            gitLogs.length,
            expandedCommits,
            fileCounts,
            (index) => gitLogs[index]?.hash ?? "",
        );
    }, [gitLogs, expandedCommits, commitFilesCache]);

    const scrollToIndex = useCallback((idx: number, opts?: { select?: boolean; flash?: boolean }) => {
        const log = gitLogs[idx];
        if (!log || !scrollContainerRef.current) return;
        scrollContainerRef.current.scrollTop = Math.max(0, rowTop(rowLayout, idx) - 40);
        if (opts?.select !== false) setSelectedHash(log.hash);
        if (opts?.flash) {
            requestAnimationFrame(() => {
                const el = scrollContainerRef.current?.querySelector(`[data-hash="${log.hash}"]`);
                el?.classList.add("graph-commit-flash");
                window.setTimeout(() => el?.classList.remove("graph-commit-flash"), 800);
            });
        }
    }, [rowLayout, gitLogs]);

    const jumpToHead = useCallback(() => {
        const headLog = gitLogs[headIndex];
        if (headLog && mutedHashes?.has(headLog.hash)) {
            // Prefer the nearest matching commit around HEAD when filters are active.
            for (let step = 0; step < gitLogs.length; step++) {
                for (const dir of [1, -1] as const) {
                    const idx = headIndex + dir * step;
                    if (idx < 0 || idx >= gitLogs.length) continue;
                    if (mutedHashes.has(gitLogs[idx].hash)) continue;
                    scrollToIndex(idx, { select: true, flash: true });
                    return;
                }
            }
            return;
        }
        scrollToIndex(headIndex, { select: true, flash: true });
    }, [scrollToIndex, headIndex, gitLogs, mutedHashes]);

    const jumpToNextMatch = useCallback((dir: 1 | -1) => {
        if (!gitLogs.length) return;
        const start = selectedHash
            ? gitLogs.findIndex((l) => l.hash === selectedHash)
            : headIndex;
        const from = start >= 0 ? start : 0;
        for (let step = 1; step <= gitLogs.length; step++) {
            const idx = (from + dir * step + gitLogs.length * 10) % gitLogs.length;
            const log = gitLogs[idx];
            if (mutedHashes?.has(log.hash)) continue;
            scrollToIndex(idx, { select: true, flash: true });
            return;
        }
    }, [gitLogs, selectedHash, headIndex, mutedHashes, scrollToIndex]);

    const totalHeight = rowLayout.totalHeight;
    const rowLayoutRef = useRef(rowLayout);
    const heightRef = useRef(containerHeight);
    useLayoutEffect(() => {
        rowLayoutRef.current = rowLayout;
        heightRef.current = containerHeight;
    }, [rowLayout, containerHeight]);

    const { startIdx, endIdx } = useMemo(
        () => computeVisibleRange(rowLayout, scrollTop, containerHeight, OVERSCAN_PX),
        [rowLayout, scrollTop, containerHeight],
    );

    // Avatars on branch/tag tips (commits with refs) and HEAD. Unique SVG clip ids
    // per hash avoid collisions; tips stay stable under filters.
    const laneAvatarByHash = useMemo(() => {
        const map = new Map<string, string>();
        if (!showGraphAvatars) return map;

        const assign = (log: GitLogEntry) => {
            if (map.has(log.hash)) return;
            const url = resolveGithubAvatarUrl(log.author_email, log.author, 32);
            if (url) map.set(log.hash, url);
        };

        // Always try HEAD / newest commit.
        if (gitLogs[0]) assign(gitLogs[0]);

        // One tip avatar per lane from ref-bearing commits (branch/tag heads).
        const laneSeen = new Set<number>();
        const scanLimit = Math.min(gitLogs.length, 2_500);
        for (let i = 0; i < scanLimit; i++) {
            const log = gitLogs[i];
            if (!log.refs?.length) continue;
            const lane = log.graphNode?.lane;
            if (lane == null || laneSeen.has(lane)) continue;
            laneSeen.add(lane);
            assign(log);
        }

        // Fallback: if a lane never had a ref tip, still mark its first commit.
        for (let i = 0; i < scanLimit; i++) {
            const log = gitLogs[i];
            const lane = log.graphNode?.lane;
            if (lane == null || laneSeen.has(lane)) continue;
            laneSeen.add(lane);
            assign(log);
        }

        return map;
    }, [gitLogs, showGraphAvatars]);

    // Throttle scroll updates to one RAF per frame (not per event)
    const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        const { scrollTop: st, scrollHeight, clientHeight } = e.currentTarget;
        scrollTopRef.current = st;
        if (scrollRafRef.current === null) {
            scrollRafRef.current = requestAnimationFrame(() => {
                scrollRafRef.current = null;
                const range = computeVisibleRange(
                    rowLayoutRef.current,
                    scrollTopRef.current,
                    heightRef.current,
                    OVERSCAN_PX,
                );
                const prev = windowRef.current;
                if (range.startIdx === prev.start && range.endIdx === prev.end) return;
                windowRef.current = { start: range.startIdx, end: range.endIdx };
                const cachedEntry = cacheKey ? graphCache[cacheKey] : undefined;
                if (cachedEntry) cachedEntry.scrollTop = scrollTopRef.current;
                setScrollTop(scrollTopRef.current);
            });
        }

        if (
            st + clientHeight > scrollHeight - 1500
            && !isLoadingNext
            && streamActiveRef.current
        ) {
            const gen = streamGenRef.current;
            setIsLoadingNext(true);
            void commands.gitLogStreamNext("graph", 300).then((moreLogs) => {
                if (gen !== streamGenRef.current || !streamActiveRef.current) return;
                appendLogs(moreLogs);
            }).finally(() => {
                if (gen === streamGenRef.current) setIsLoadingNext(false);
            });
        }
    }, [isLoadingNext, appendLogs, cacheKey]);

    const hasGitLogs = gitLogs.length > 0;
    // Keep viewport height accurate on resize (sidebar drag, manager split).
    useEffect(() => {
        const node = scrollContainerRef.current;
        if (!node || typeof ResizeObserver === "undefined") return;
        const ro = new ResizeObserver((entries) => {
            const h = entries[0]?.contentRect.height;
            if (typeof h === "number" && h > 0) setContainerHeight(h);
        });
        ro.observe(node);
        setContainerHeight(node.clientHeight);
        return () => ro.disconnect();
    }, [hasGitLogs]);

    // When filters change and the current selection is muted, snap to the next match.
    const filterKey = `${authorFilter}\0${branchFilter}\0${kindFilter}\0${refKindFilter}\0${dateFilter}\0${rich ? (deferredLocalSearch || deferredCommitSearch) : deferredCommitSearch}`;
    const [appliedFilter, setAppliedFilter] = useState<string | null>(null);
    const [filterJump, setFilterJump] = useState<{ top: number; hash: string } | null>(null);
    if (appliedFilter !== filterKey) {
        setAppliedFilter(filterKey);
        if (selectedHash && mutedHashes?.has(selectedHash) && matchCount > 0) {
            const from = Math.max(0, gitLogs.findIndex(log => log.hash === selectedHash));
            for (let step = 1; step <= gitLogs.length; step++) {
                const index = (from + step) % gitLogs.length;
                const log = gitLogs[index];
                if (mutedHashes.has(log.hash)) continue;
                setSelectedHash(log.hash);
                setFilterJump({ top: Math.max(0, rowTop(rowLayout, index) - 40), hash: log.hash });
                break;
            }
        }
    }
    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!filterJump || !container) return;
        container.scrollTop = filterJump.top;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let row: Element | null = null;
        const frame = requestAnimationFrame(() => {
            row = container.querySelector(`[data-hash="${filterJump.hash}"]`);
            row?.classList.add("graph-commit-flash");
            timer = setTimeout(() => row?.classList.remove("graph-commit-flash"), 800);
        });
        return () => { cancelAnimationFrame(frame); clearTimeout(timer); row?.classList.remove("graph-commit-flash"); };
    }, [filterJump]);

    // Keep manager detail panel in sync with selected commit (unless viewing a file of that commit).
    const [detailInputs, setDetailInputs] = useState<readonly unknown[] | null>(null);
    if (detailInputs === null || !Object.is(detailInputs[0], rich) || !Object.is(detailInputs[1], selectedHash) || !Object.is(detailInputs[2], gitLogs)) {
        setDetailInputs([rich, selectedHash, gitLogs]);
        const log = rich && selectedHash ? gitLogs.find(entry => entry.hash === selectedHash) : undefined;
        if (log) {
        setDetail((prev) => {
            if (prev?.kind === "file" && prev.log.hash === selectedHash) {
                return { ...prev, log };
            }
            if (prev?.kind === "commit" && prev.log.hash === selectedHash) {
                return { kind: "commit", log };
            }
            if (!prev) return { kind: "commit", log };
            if (prev.log.hash !== selectedHash) return { kind: "commit", log };
            return prev;
        });
        }
    }

    // Keyboard: j/k or arrows move selection among matches; Enter expands; n/N; H → HEAD.
    // Keep Tab native so keyboard users can reach graph controls in the normal tab order.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            if (!target) return;

            const inGraphSearch = !!target.closest("[data-graph-search]");
            const inTitlebarSearch = !!target.closest("[data-git-titlebar-search]");
            const inThisGraph = !!(rootRef.current && rootRef.current.contains(target));
            const isInteractiveControl = !!target.closest(
                'button, a[href], select, summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]',
            );
            const inField = !!target.closest("input, textarea, [contenteditable=true]");

            if (!inThisGraph && !inTitlebarSearch) return;
            // Interactive controls own their keyboard activation and selection keys.
            if (isInteractiveControl) return;
            if (inField && !inGraphSearch && !inTitlebarSearch) return;
            // Titlebar search is shared, only steal keys while Git Graph is the active manager surface.
            if (inTitlebarSearch && !rich) return;

            const isNav =
                e.key === "ArrowDown" || e.key === "ArrowUp"
                || e.key.toLowerCase() === "j" || e.key.toLowerCase() === "k"
                || (e.key.toLowerCase() === "n" && !e.ctrlKey && !e.metaKey)
                || e.key === "Enter"
                || (e.key.toLowerCase() === "h" && !e.ctrlKey && !e.metaKey && !e.altKey);

            if ((inGraphSearch || inTitlebarSearch) && !isNav) return;
            if ((inGraphSearch || inTitlebarSearch) && (e.key.toLowerCase() === "j" || e.key.toLowerCase() === "k")) return;

            const key = e.key.toLowerCase();
            if (key === "j" || e.key === "ArrowDown") {
                e.preventDefault();
                jumpToNextMatch(1);
            } else if (key === "k" || e.key === "ArrowUp") {
                e.preventDefault();
                jumpToNextMatch(-1);
            } else if (key === "n" && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                jumpToNextMatch(e.shiftKey ? -1 : 1);
            } else if (e.key === "Enter" && selectedHash) {
                e.preventDefault();
                toggleCommitExpansion(selectedHash);
            } else if (key === "h" && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                jumpToHead();
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [jumpToNextMatch, jumpToHead, selectedHash, toggleCommitExpansion, rich]);

    const graphList = (
        <div
            role="listbox"
            aria-label="Commit graph"
            className="graph-scroll min-h-0 flex-1 overflow-y-scroll overflow-x-hidden relative outline-none"
            tabIndex={0}
            onScroll={handleScroll}
            onMouseDown={() => {
                scrollContainerRef.current?.focus({ preventScroll: true });
            }}
            ref={(node) => {
                if (node) {
                    scrollContainerRef.current = node;
                    if (containerHeight !== node.clientHeight) setContainerHeight(node.clientHeight);
                }
            }}
        >
            {gitLogs.length > 0 ? (
                <div style={{ height: totalHeight, position: "relative" }} role="list" aria-label="Commit graph">
                    {gitLogs.slice(startIdx, endIdx + 1).map((log, relIdx) => {
                        const idx = startIdx + relIdx;
                        const top = rowTop(rowLayout, idx);
                        const node = log.graphNode || EMPTY_NODE;
                        const isMuted = mutedHashes?.has(log.hash) ?? false;
                        const prevMuted = idx > 0 ? (mutedHashes?.has(gitLogs[idx - 1].hash) ?? false) : true;
                        const nextMuted = idx < gitLogs.length - 1 ? (mutedHashes?.has(gitLogs[idx + 1].hash) ?? false) : true;
                        return (
                            <div
                                key={log.hash}
                                role="listitem"
                                aria-posinset={idx + 1}
                                aria-setsize={gitLogs.length}
                                aria-current={selectedHash === log.hash ? "true" : undefined}
                                style={{ position: "absolute", top, left: 0, right: 0 }}
                            >
                                <GraphCommitRow
                                    log={log}
                                    node={node}
                                    repoPath={gitRepo}
                                    index={idx}
                                    total={gitLogs.length}
                                    isExpanded={expandedCommits.has(log.hash)}
                                    onToggleExpand={toggleCommitExpansion}
                                    onShowCommitDiff={handleShowCommitDiff}
                                    onOpenFile={handleOpenFile}
                                    onRefresh={refresh}
                                    files={commitFilesCache[log.hash] || EMPTY_ARRAY}
                                    filesLoaded={commitFilesLoaded[log.hash] || false}
                                    onFilesLoaded={handleFilesLoaded}
                                    laneAvatarUrl={laneAvatarByHash.get(log.hash) ?? null}
                                    surface={surface}
                                    muted={isMuted}
                                    matchHighlight={hasActiveFilter && !isMuted}
                                    blendTop={isMuted && !prevMuted}
                                    blendBottom={isMuted && !nextMuted}
                                    selected={selectedHash === log.hash}
                                    onSelect={handleSelectCommit}
                                    onRefActivate={rich ? handleRefActivate : undefined}
                                    compact={hideHeader}
                                    arriving={arrivingHashes.has(log.hash)}
                                />
                            </div>
                        );
                    })}
                </div>
            ) : isInitialLoading ? (
                <GraphLoadingStatus />
            ) : (
                <div className="flex h-full flex-1 items-center justify-center text-xs text-text-muted">
                    No commits found
                </div>
            )}
        </div>
    );

    const graphChrome = (
        <>
            {rich ? (
                active ? (
                <GitChromeActions>
                    <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                aria-label="Filter commits"
                            >
                                <Icon icon={Filter20Regular} />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-auto p-2">
                            <div className="flex flex-col gap-1.5">
                                <FilterMenu
                                    label="All authors"
                                    value={authorFilter}
                                    onChange={setAuthorFilter}
                                    options={[
                                        { value: "all", label: "All authors" },
                                        ...authors.map((a) => ({ value: a, label: a })),
                                    ]}
                                />
                                <FilterMenu
                                    label="All commits"
                                    value={kindFilter}
                                    onChange={(v) => setKindFilter(v as typeof kindFilter)}
                                    options={[
                                        { value: "all", label: "All commits" },
                                        { value: "merges", label: "Merges only" },
                                        { value: "non-merges", label: "No merges" },
                                    ]}
                                />
                                <FilterMenu
                                    label="Any time"
                                    value={dateFilter}
                                    onChange={(v) => setDateFilter(v as typeof dateFilter)}
                                    options={[
                                        { value: "all", label: "Any time" },
                                        { value: "7d", label: "Last 7 days" },
                                        { value: "30d", label: "Last 30 days" },
                                        { value: "90d", label: "Last 90 days" },
                                    ]}
                                />
                                {hasActiveFilter ? (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-8"
                                        onClick={() => {
                                            setAuthorFilter("all");
                                            setBranchFilter("all");
                                            setKindFilter("all");
                                            setRefKindFilter("all");
                                            setDateFilter("all");
                                            setLocalSearch("");
                                        }}
                                    >
                                        Clear filters
                                    </Button>
                                ) : null}
                            </div>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <Tooltip content="Go to HEAD">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={jumpToHead} aria-label="Go to HEAD">
                            <Icon icon={Target20Regular} />
                        </Button>
                    </Tooltip>
                    <Tooltip content="Fetch">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={async () => {
                                if (!gitRepo) return;
                                startLoading();
                                try {
                                    await commands.gitFetch(gitRepo);
                                    notify.info("Git", "Fetched from all remotes.");
                                    await refresh({ track: false });
                                } catch (e) {
                                    notify.error("Git Error", String(e));
                                } finally {
                                    stopLoading();
                                }
                            }}
                            aria-label="Fetch"
                        >
                            <Icon icon={ArrowSync20Regular} />
                        </Button>
                    </Tooltip>
                    <Tooltip content="Pull">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={async () => {
                                if (!gitRepo) return;
                                startLoading();
                                try {
                                    await commands.gitPull(gitRepo);
                                    notify.info("Git", "Pulled successfully.");
                                    await refresh({ track: false });
                                } catch (e) {
                                    notify.error("Git Error", String(e));
                                } finally {
                                    stopLoading();
                                }
                            }}
                            aria-label="Pull"
                        >
                            <Icon icon={CloudOff20Regular} />
                        </Button>
                    </Tooltip>
                    <Tooltip content="Push">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={async () => {
                                if (!gitRepo) return;
                                startLoading();
                                try {
                                    await commands.gitPush(gitRepo);
                                    notify.info("Git", "Pushed successfully.");
                                    await refresh({ track: false });
                                } catch (e) {
                                    notify.error("Git Error", String(e));
                                } finally {
                                    stopLoading();
                                }
                            }}
                            aria-label="Push"
                        >
                            <Icon icon={ArrowUpload20Regular} />
                        </Button>
                    </Tooltip>
                    {expandedCommits.size > 0 ? (
                        <Tooltip content="Collapse all">
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => setExpandedCommits(new Set())}
                                aria-label="Collapse all"
                            >
                                <Icon icon={ArrowMinimize20Regular} />
                            </Button>
                        </Tooltip>
                    ) : null}
                </GitChromeActions>
            ) : null
            ) : hideHeader ? null : (
            <SidebarPanelHeaderFrame
                title="Git Graph"
                className={rich ? "bg-editor" : undefined}
                titleExtra={
                    hasActiveFilter ? (
                        <span className="shrink-0 text-xs tabular-nums text-text-muted">
                            {matchCount}/{gitLogs.length}
                        </span>
                    ) : null
                }
                actions={
                    <>
                    <Tooltip content="Go to HEAD (H)">
                        <Button variant="ghost" size="icon" className="text-text-primary hover:bg-[var(--btn-hover)]" onClick={jumpToHead}>
                            <Icon icon={Target20Regular} />
                        </Button>
                    </Tooltip>
                    <Tooltip content="Fetch From All Remotes">
                        <Button variant="ghost" size="icon" className="text-text-primary hover:bg-[var(--btn-hover)]" onClick={async () => {
                            if (!gitRepo) return;
                            startLoading();
                            try {
                                await commands.gitFetch(gitRepo);
                                notify.info("Git", "Fetched from all remotes.");
                                await refresh({ track: false });
                            } catch (e) { notify.error("Git Error", String(e)); }
                            finally { stopLoading(); }
                        }}>
                            <Icon icon={ArrowSync20Regular} />
                        </Button>
                    </Tooltip>
                    <Tooltip content="Pull">
                        <Button variant="ghost" size="icon" className="text-text-primary hover:bg-[var(--btn-hover)]" onClick={async () => {
                            if (!gitRepo) return;
                            startLoading();
                            try {
                                await commands.gitPull(gitRepo);
                                notify.info("Git", "Pulled successfully.");
                                await refresh({ track: false });
                            } catch (e) { notify.error("Git Error", String(e)); }
                            finally { stopLoading(); }
                        }}>
                            <Icon icon={CloudOff20Regular} />
                        </Button>
                    </Tooltip>
                    <Tooltip content="Push">
                        <Button variant="ghost" size="icon" className="text-text-primary hover:bg-[var(--btn-hover)]" onClick={async () => {
                            if (!gitRepo) return;
                            startLoading();
                            try {
                                await commands.gitPush(gitRepo);
                                notify.info("Git", "Pushed successfully.");
                                await refresh({ track: false });
                            } catch (e) { notify.error("Git Error", String(e)); }
                            finally { stopLoading(); }
                        }}>
                            <Icon icon={ArrowUpload20Regular} />
                        </Button>
                    </Tooltip>
                    <Tooltip content="Refresh Graph">
                        <Button variant="ghost" size="icon" className="text-text-primary hover:bg-[var(--btn-hover)]" onClick={async () => { await refresh(); }}>
                            <Icon icon={ArrowSync20Regular} />
                        </Button>
                    </Tooltip>
                    {!rich && project_path ? <GitManagerTrigger /> : null}
                    </>
                }
            />
            )}

            {hideHeader ? (
                <div className="shrink-0 px-2 pb-1 pt-2">
                    <input
                        value={localSearch}
                        onChange={(event) => setLocalSearch(event.target.value)}
                        placeholder="Search commits"
                        aria-label="Search commits"
                        className="h-8 w-full rounded-lg bg-panel-hover px-2.5 text-sm text-text-primary outline-none placeholder:text-text-muted"
                    />
                </div>
            ) : null}

            <div
                className="shrink-0 pointer-events-none relative z-10 transition-opacity duration-[var(--transition-fast)] ease-[var(--ease-out)]"
                style={{
                    height: 30,
                    marginBottom: -30,
                    opacity: scrollTop > 0 ? 1 : 0,
                    background: "linear-gradient(to bottom, var(--graph-surface, var(--color-panel)) 0%, transparent 100%)",
                }}
            />
            {graphList}
        </>
    );

    return (
        <div
            ref={rootRef}
            className={cn(
                "flex h-full w-full relative flex-col select-none",
                surface === "editor" ? "bg-editor" : hideHeader ? "bg-transparent" : "bg-panel",
                className,
            )}
            style={{
                ["--graph-surface" as string]:
                    surface === "editor" ? "var(--color-editor)" : hideHeader ? "var(--color-sidebar)" : "var(--color-panel)",
            }}
        >
            {rich ? (
                <Panel
                    className="min-h-0 flex-1"
                    direction="horizontal"
                    storageKey="git-manager-graph-detail"
                    hideSeparator
                    paneGap="var(--workbench-gap)"
                    panes={[
                        {
                            id: "graph-main",
                            flexible: true,
                            minSize: 360,
                            preferredSize: 640,
                            // Main graph canvas, flush like Actions content, not a workbench card.
                            children: (
                                <div className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
                                    {graphChrome}
                                </div>
                            ),
                        },
                        {
                            id: "graph-detail",
                            preferredSize: 360,
                            minSize: 260,
                            maxSize: 560,
                            snap: true,
                            visible: Boolean(detail),
                            children: (
                                <GraphDetailPanel
                                    selection={
                                        detail
                                            ? { kind: "commit", log: detail.log }
                                            : null
                                    }
                                    repoPath={gitRepo}
                                    active={active}
                                    forceCommit
                                    onClose={() => {
                                        setDetail(null);
                                        setSelectedHash(null);
                                    }}
                                    onOpenFile={(file) => {
                                        if (detail?.log) setDetail({ kind: "file", log: detail.log, file });
                                    }}
                                />
                            ),
                        },
                        {
                            id: "graph-diff",
                            preferredSize: 480,
                            minSize: 280,
                            maxSize: 900,
                            snap: true,
                            visible: detail?.kind === "file",
                            children: (
                                <GraphDetailPanel
                                    selection={detail?.kind === "file" ? detail : null}
                                    repoPath={gitRepo}
                                    active={active && detail?.kind === "file"}
                                    onClose={() => {
                                        if (detail?.log) setDetail({ kind: "commit", log: detail.log });
                                    }}
                                    onClearFile={() => {
                                        if (detail?.log) setDetail({ kind: "commit", log: detail.log });
                                    }}
                                />
                            ),
                        },
                    ]}
                />
            ) : (
                graphChrome
            )}
        </div>
    );
}
