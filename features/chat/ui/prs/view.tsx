"use client";

import { parseGitHubRemote } from "@/lib/github/remote";
import { ArrowLeft20Regular } from "@fluentui/react-icons/headless/svg/arrow-left";
import { ArrowSync20Regular } from "@fluentui/react-icons/headless/svg/arrow-sync";
import { Chat20Filled } from "@fluentui/react-icons/headless/svg/chat";
import { ChevronDown20Regular } from "@fluentui/react-icons/headless/svg/chevron-down";
import { MoreHorizontal20Regular } from "@fluentui/react-icons/headless/svg/more-horizontal";
import { Open20Regular } from "@fluentui/react-icons/headless/svg/open";



import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";


import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { commands, useProjectState } from "@/lib/backend";
import { loginGitHub, useGitHubAuth } from "@/lib/github/store";
import { GitMarkdown } from "@/features/git/ui/github/markdown";
import { notify } from "@/features/notifications";
import { PullRequestsList, type IssueStateFilter } from "./list";
import {
    mapPullRows,
    formatRelative,
    mergeableFrom,
    parseJson,
    type PrCi,
    type PrItem,
} from "./mapping";
import { applyPrOverrides, settlePrOverrides, usePrOverridesSnapshot } from "./overrides";
import { appendUnique, getGitHubPage, reconcilePageRows } from "./pagination";
import { PrFilesTab, PrTimelineTab, PrReviewers, type RequestedReviewerSnapshot } from "./detail-tabs";
import { apiSortParam, type PrSortMode } from "./ranking";
import { selectPr, updateSelectedPr, usePrUi } from "./store";

async function resolveOwnerRepo(projectPath: string | null) {
    if (!projectPath) return null;
    // A failed lookup is not evidence that the remote disappeared. Let load()
    // preserve the last successful snapshot on a transient background failure.
    return parseGitHubRemote(await commands.gitRemoteUrl(projectPath));
}

export function PullRequestsPanel({ pane = "full" }: { pane?: "list" | "detail" | "full" }) {
    const { project_path } = useProjectState();
    const auth = useGitHubAuth();
    const prUi = usePrUi();
    const [query, setQuery] = useState("");
    const [state, setState] = useState<IssueStateFilter>("open");
    const [sort, setSort] = useState<PrSortMode>("updated");
    const [items, setItems] = useState<PrItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [repo, setRepo] = useState<{ owner: string; repo: string } | null>(null);
    const selectedId = pane === "list" ? null : prUi.selectedId;
    const [detailError, setDetailError] = useState<string | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [requestedReviewers, setRequestedReviewers] = useState<(RequestedReviewerSnapshot & { key: string; revision: number }) | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const loadedPages = useRef(1);
    const pageIds = useRef<string[][]>([]);
    const nextPollPage = useRef(2);
    const overrides = usePrOverridesSnapshot();
    const [checkingOut, setCheckingOut] = useState(false);

    const repoKey = useRef<string | null>(null);
    const loadVersion = useRef(0);
    const loadBusy = useRef(false);
    const pendingRefresh = useRef(false);
    const [detailRevision, setDetailRevision] = useState(0);
    const [resourceRevision, setResourceRevision] = useState(0);
    /** Coalesce explicit refresh intent behind current list work; automatic polls remain skippable. */
    const fetchList = useCallback(async function loadList(mode: "initial" | "poll" | "refresh" = "initial") {
        const background = mode !== "initial";
        if (background && loadBusy.current) {
            if (mode === "refresh") pendingRefresh.current = true;
            return;
        }
        const version = ++loadVersion.current;
        loadBusy.current = true;
        if (!background) {
            repoKey.current = null;
            loadedPages.current = 1;
            pageIds.current = [];
            nextPollPage.current = 2;
        }
        return resolveOwnerRepo(project_path).then(async resolved => {
            if (version !== loadVersion.current) return;
            const nextRepoKey = resolved ? `${resolved.owner}/${resolved.repo}` : null;
            if (nextRepoKey !== repoKey.current) {
                // A snapshot belongs to one remote. Transient errors may retain
                // it only while that identity is unchanged.
                setItems([]);
                setHasMore(false);
                loadedPages.current = 1;
                pageIds.current = [];
                nextPollPage.current = 2;
                repoKey.current = nextRepoKey;
            }
            setRepo((previous) => previous?.owner === resolved?.owner && previous?.repo === resolved?.repo ? previous : resolved);
            if (!resolved) {
                setItems([]);
                setError("Connect a GitHub remote to load pull requests.");
                return;
            }
            if (!auth.loggedIn) {
                setItems([]);
                setError("Sign in with GitHub to load this data.");
                return;
            }
            // Automatic polling has a fixed request budget; explicit Refresh
            // still reconciles the complete loaded window in one transaction.
            const olderPage = Math.min(nextPollPage.current, loadedPages.current);
            const pages = mode === "poll"
                ? [1, ...(olderPage > 1 ? [olderPage] : [])]
                : Array.from({ length: loadedPages.current }, (_, index) => index + 1);
            const nextPageIds = pageIds.current.slice();
            let pageCount = loadedPages.current;
            let more: boolean | undefined;
            let mapped: PrItem[] = [];
            for (const page of pages) {
                const result = await getGitHubPage(
                    `/repos/${resolved.owner}/${resolved.repo}/pulls?state=${state}&sort=${apiSortParam(sort)}&direction=desc`, page,
                );
                if (version !== loadVersion.current) return;
                const fresh = mapPullRows(result.rows, `${resolved.owner}/${resolved.repo}`);
                mapped = appendUnique(mapped, fresh, (item) => item.id);
                nextPageIds[page - 1] = fresh.map(item => item.id);
                if (!result.hasMore) {
                    pageCount = page;
                    nextPageIds.length = page;
                    more = false;
                    break;
                }
                if (page === pageCount) more = result.hasMore;
            }
            loadedPages.current = pageCount;
            pageIds.current = nextPageIds;
            nextPollPage.current = mode === "poll" && olderPage < pageCount ? olderPage + 1 : 2;
            if (more !== undefined) setHasMore(more);
            settlePrOverrides(mapped);
            setItems(previous => reconcilePageRows(previous, mapped, nextPageIds, item => item.id));
            setDetailRevision((revision) => revision + 1);
        }).catch(e => {
            if (version !== loadVersion.current) return;
            if (!background) setItems([]);
            setError(e instanceof Error ? e.message : "Could not load pull requests.");
        }).finally(async () => {
            if (version === loadVersion.current) {
                loadBusy.current = false;
                if (pendingRefresh.current) {
                    pendingRefresh.current = false;
                    setError(null);
                    await loadList("refresh");
                } else {
                    setLoading(false);
                }
            }
        });
    }, [auth.loggedIn, project_path, sort, state]);

    const load = useCallback((mode: "initial" | "poll" | "refresh" = "initial") => {
        if (mode === "initial" || !loadBusy.current) {
            setLoading(true);
            setError(null);
        }
        return fetchList(mode);
    }, [fetchList]);

    const [listInputs, setListInputs] = useState<readonly unknown[] | null>(null);
    if (listInputs === null || !Object.is(listInputs[0], fetchList)) {
        setListInputs([fetchList]);
        setItems([]);
        setRepo(null);
        setHasMore(false);
        setLoading(true);
        setError(null);
    }

    useEffect(() => {
        void fetchList();
        const refreshVisible = () => { if (!document.hidden) void load("poll"); };
        const timer = window.setInterval(refreshVisible, 30_000);
        document.addEventListener("visibilitychange", refreshVisible);
        return () => {
            loadVersion.current += 1;
            loadBusy.current = false;
            pendingRefresh.current = false;
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", refreshVisible);
        };
    }, [load, fetchList]);

    const refresh = useCallback(() => {
        setResourceRevision((revision) => revision + 1);
        void load("refresh");
    }, [load]);

    const loadMore = async () => {
        if (!repo || !hasMore || loadBusy.current) return;
        const version = ++loadVersion.current;
        loadBusy.current = true;
        setLoading(true);
        setError(null);
        try {
            const result = await getGitHubPage(
                `/repos/${repo.owner}/${repo.repo}/pulls?state=${state}&sort=${apiSortParam(sort)}&direction=desc`, loadedPages.current + 1,
            );
            if (version !== loadVersion.current) return;
            const mapped = mapPullRows(result.rows, `${repo.owner}/${repo.repo}`);
            settlePrOverrides(mapped);
            setItems((previous) => appendUnique(previous, mapped, (item) => item.id));
            pageIds.current = [...pageIds.current, mapped.map(item => item.id)];
            loadedPages.current += 1;
            setHasMore(result.hasMore);
        } catch (cause) {
            if (version === loadVersion.current) setError(cause instanceof Error ? cause.message : "Could not load more pull requests.");
        } finally {
            if (version === loadVersion.current) {
                loadBusy.current = false;
                setLoading(false);
                if (pendingRefresh.current) {
                    pendingRefresh.current = false;
                    await load("refresh");
                }
            }
        }
    };

    const onCiResolved = useCallback((id: string, ci: PrCi) => {
        setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ci } : item)));
    }, []);

    const selected = useMemo(
        () => {
            const item = items.find((item) => item.id === selectedId && item.repo === `${repo?.owner}/${repo?.repo}`)
                ?? (prUi.selectedItem?.id === selectedId && prUi.selectedItem.repo === `${repo?.owner}/${repo?.repo}` ? prUi.selectedItem : undefined);
            return item ? applyPrOverrides([item], undefined, overrides)[0] : null;
        },
        [items, selectedId, prUi.selectedItem, repo, overrides],
    );
    const selectedUrl = selected?.url;

    // Detail enrichment must not depend on the object it updates in setItems.
    const selectedRef = useRef(selected);
    useEffect(() => { selectedRef.current = selected; }, [selected]);
    const detailId = selected?.id;
    const detailNumber = selected?.number;
    const detailOwner = repo?.owner;
    const detailRepo = repo?.repo;
    const [detailInputs, setDetailInputs] = useState<readonly unknown[] | null>(null);
    if (detailInputs === null
        || !Object.is(detailInputs[0], detailId)
        || !Object.is(detailInputs[1], detailNumber)
        || !Object.is(detailInputs[2], detailOwner)
        || !Object.is(detailInputs[3], detailRepo)
        || !Object.is(detailInputs[4], detailRevision)) {
        setDetailInputs([detailId, detailNumber, detailOwner, detailRepo, detailRevision]);
        setDetailError(null);
        setRequestedReviewers(null);
        setDetailLoading(Boolean(detailId && detailNumber && detailOwner && detailRepo));
    }

    useEffect(() => {
        if (!detailId || !detailNumber || !detailOwner || !detailRepo) {
            return;
        }
        let cancelled = false;
        void commands.githubApiGet(`/repos/${detailOwner}/${detailRepo}/pulls/${detailNumber}`)
            .then((raw) => {
                if (cancelled) return;
                const payload = parseJson(raw);
                if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("GitHub returned invalid pull request details.");
                const detail = payload as Record<string, unknown>;
                const requested = Array.isArray(detail.requested_reviewers) ? detail.requested_reviewers as { login?: string }[] : [];
                const teams = Array.isArray(detail.requested_teams) ? detail.requested_teams as { name?: string; slug?: string }[] : [];
                if (Array.isArray(detail.requested_reviewers) || Array.isArray(detail.requested_teams)) {
                    setRequestedReviewers({
                        key: `${detailOwner}/${detailRepo}#${detailNumber}`,
                        revision: detailRevision,
                        complete: Array.isArray(detail.requested_reviewers) && Array.isArray(detail.requested_teams),
                        names: [
                            ...requested.flatMap((user) => user?.login ? [user.login] : []),
                            ...teams.flatMap((team) => team?.name || team?.slug ? [`Team: ${team.name || team.slug}`] : []),
                        ],
                    });
                }
                const head = detail.head as { ref?: string; sha?: string } | undefined;
                const base = detail.base as { ref?: string } | undefined;
                const enrich = (item: PrItem): PrItem => ({
                    ...item,
                    title: typeof detail.title === "string" ? detail.title : item.title,
                    status: detail.merged === true || detail.merged_at ? "merged" : typeof detail.state === "string" ? detail.state : item.status,
                    draft: typeof detail.draft === "boolean" ? detail.draft : item.draft,
                    updatedAt: typeof detail.updated_at === "string" ? detail.updated_at : item.updatedAt,
                    updated: typeof detail.updated_at === "string" ? formatRelative(detail.updated_at) : item.updated,
                    additions: typeof detail.additions === "number" ? detail.additions : item.additions,
                    deletions: typeof detail.deletions === "number" ? detail.deletions : item.deletions,
                    comments: typeof detail.comments === "number" ? detail.comments : item.comments,
                    body: detail.body === null ? "" : typeof detail.body === "string" ? detail.body : item.body,
                    headRef: head?.ref ?? item.headRef,
                    baseRef: base?.ref ?? item.baseRef,
                    headSha: head?.sha ?? item.headSha,
                    ci: head?.sha && head.sha !== item.headSha ? undefined : item.ci,
                    mergeable: mergeableFrom(detail),
                });
                setItems((prev) => prev.map((item) => item.id === detailId ? enrich(item) : item));
                if (selectedRef.current?.id === detailId) updateSelectedPr(enrich(selectedRef.current));
            })
            .catch((cause: unknown) => {
                if (!cancelled) setDetailError(cause instanceof Error ? cause.message : "Could not load pull request details.");
            })
            .finally(() => { if (!cancelled) setDetailLoading(false); });
        return () => { cancelled = true; };
    }, [detailId, detailNumber, detailOwner, detailRepo, detailRevision]);

    const checkout = async () => {
        if (!project_path || !selected?.headRef) {
            notify.error("No branch to check out");
            return;
        }
        setCheckingOut(true);
        try {
            await commands.gitFetch(project_path);
            await commands.gitSwitchBranch(project_path, selected.headRef);
            window.dispatchEvent(new Event("bettershape-git-refresh"));
            notify.success(`Checked out ${selected.headRef}`);
        } catch (e) {
            notify.error(e instanceof Error ? e.message : "Could not check out branch");
        } finally {
            setCheckingOut(false);
        }
    };

    const sendPrompt = (prompt: string) => {
        window.dispatchEvent(
            new CustomEvent("bettershape-chat-insert-prompt", { detail: { prompt, send: false } }),
        );
    };

    if (pane === "detail" && !selected) {
        return (
            <div className="flex h-full min-h-0 items-center justify-center bg-panel px-6">
                <p className="text-center text-sm text-text-muted">
                    Select a pull request to see details
                </p>
            </div>
        );
    }

    if (selected && pane !== "list") {
        return (
            <div className="flex h-full min-h-0 flex-col bg-panel">
                <div className="flex shrink-0 items-start gap-2 px-3 pt-3 pb-2">
                    {pane === "full" ? (
                    <button
                        type="button"
                        aria-label="Back to list"
                        onClick={() => selectPr(null)}
                        className="mt-0.5 flex size-7 items-center justify-center rounded-md text-text-muted hover:bg-[var(--btn-hover)] hover:text-text-primary"
                    >
                        <Icon icon={ArrowLeft20Regular} />
                    </button>
                    ) : null}
                    <div className="min-w-0 flex-1">
                        <p className="text-xs text-text-muted">
                            {selected.repo} #{selected.number}
                        </p>
                        <h2 className="font-medium leading-snug text-text-primary">
                            {selected.title}
                        </h2>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="secondary" size="xs" className="gap-1" disabled={checkingOut}>
                                    Check out
                                    <Icon icon={ChevronDown20Regular} />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-44">
                                <DropdownMenuItem onClick={() => void checkout()}>
                                    Check out {selected.headRef || "branch"}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button
                                    type="button"
                                    aria-label="More"
                                    className="flex size-7 items-center justify-center rounded-md text-text-muted hover:bg-[var(--btn-hover)] hover:text-text-primary"
                                >
                                    <Icon icon={MoreHorizontal20Regular} />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-52">
                                <DropdownMenuItem onClick={refresh}>
                                    <Icon icon={ArrowSync20Regular} />
                                    Refresh
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onClick={() =>
                                        sendPrompt(
                                            `Ask a question about PR #${selected.number}: ${selected.title}. Opens a thread that knows which pull request you mean.`,
                                        )
                                    }
                                >
                                    <Icon icon={Chat20Filled} />
                                    Ask a question
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onClick={() =>
                                        sendPrompt(
                                            `Explain pull request #${selected.number} (${selected.title}). Walk through the diff and what to read closely.`,
                                        )
                                    }
                                >
                                    Explain this PR
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onClick={() =>
                                        sendPrompt(
                                            `Fix findings in a thread for PR #${selected.number}: ${selected.title}.`,
                                        )
                                    }
                                >
                                    Fix findings in a thread
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                {selectedUrl ? (
                                    <DropdownMenuItem
                                        onClick={() => void commands.openUrlExternal(selectedUrl)}
                                    >
                                        <Icon icon={Open20Regular} />
                                        Open on GitHub
                                    </DropdownMenuItem>
                                ) : null}
                                {selectedUrl ? (
                                    <DropdownMenuItem
                                        onClick={() => {
                                            void navigator.clipboard.writeText(selectedUrl).then(
                                                () => notify.success("Link copied"),
                                                () => notify.error("Could not copy link"),
                                            );
                                        }}
                                    >
                                        Copy link
                                    </DropdownMenuItem>
                                ) : null}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>

                <div className="flex shrink-0 items-center gap-2 px-3 pb-3 text-xs text-text-muted">
                    {selected.avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={selected.avatar} alt="" className="size-4 rounded-full" />
                    ) : null}
                    <span>{selected.author}</span>
                    {selected.updated ? <span>· updated {selected.updated}</span> : null}
                </div>

                {selected.baseRef || selected.headRef ? (
                    <div className="flex shrink-0 items-center gap-1.5 px-3 pb-3 text-xs">
                        <span className="rounded-md bg-panel-hover px-1.5 py-0.5 text-text-secondary">
                            {selected.baseRef || "main"}
                        </span>
                        <span className="text-text-muted">←</span>
                        <span className="rounded-md bg-panel-hover px-1.5 py-0.5 text-text-secondary">
                            {selected.headRef || "branch"}
                        </span>
                    </div>
                ) : null}

                {detailError ? <p role="status" className="px-3 pb-2 text-sm text-text-muted">Details refresh failed: {detailError}</p> : null}
                {error ? <p role="status" className="px-3 pb-2 text-sm text-text-muted">Refresh failed: {error}</p> : null}
                <Tabs key={selected.id} defaultValue="summary" className="flex min-h-0 flex-1 flex-col">
                    <div className="px-3">
                        <TabsList>
                            <TabsTrigger value="summary">Summary</TabsTrigger>
                            <TabsTrigger value="files">
                                Files
                            </TabsTrigger>
                            <TabsTrigger value="timeline">Timeline</TabsTrigger>
                        </TabsList>
                    </div>
                    <TabsContent value="summary" className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 pt-3">
                        <div className="mb-4 grid gap-2 text-sm">
                            <div className="flex gap-2">
                                <span className="w-20 shrink-0 text-text-muted">Reviewers</span>
                                <div className="min-w-0 text-text-secondary">
                                    <PrReviewers item={selected} requested={
                                        requestedReviewers?.key === `${selected.repo}#${selected.number}` && requestedReviewers.revision === detailRevision
                                            ? requestedReviewers : null
                                    } revision={resourceRevision} />
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <span className="w-20 shrink-0 text-text-muted">Labels</span>
                                <span className="flex flex-wrap gap-1">
                                    {selected.labels.length ? (
                                        selected.labels.map((label) => (
                                            <span
                                                key={label.name}
                                                className="rounded-full px-1.5 py-0.5 text-2xs"
                                                style={{
                                                    backgroundColor: `#${label.color}22`,
                                                    color: `#${label.color}`,
                                                }}
                                            >
                                                {label.name}
                                            </span>
                                        ))
                                    ) : (
                                        <span className="text-text-muted">None</span>
                                    )}
                                </span>
                            </div>
                            <div className="flex gap-2">
                                <span className="w-20 shrink-0 text-text-muted">Comments</span>
                                <span className="text-text-secondary">{detailLoading ? "Loading…" : selected.comments === undefined ? "Not loaded" : `${selected.comments} comments`}</span>
                            </div>
                        </div>
                        <p className="mb-2 text-sm font-medium text-text-primary">Description</p>
                        {selected.body?.trim() ? (
                            <div className="text-sm text-text-secondary">
                                <GitMarkdown content={selected.body} />
                            </div>
                        ) : (
                            <p className="text-sm text-text-muted">No description</p>
                        )}
                    </TabsContent>
                    <TabsContent value="files" className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 pt-3">
                        <PrFilesTab item={selected} revision={resourceRevision} />
                    </TabsContent>
                    <TabsContent value="timeline" className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 pt-3">
                        <PrTimelineTab item={selected} revision={resourceRevision} />
                    </TabsContent>
                </Tabs>
            </div>
        );
    }

    return (
        <PullRequestsList
            items={items}
            loading={loading}
            error={error}
            signedIn={auth.loggedIn}
            repo={repo}
            query={query}
            onQueryChange={setQuery}
            sort={sort}
            onSortChange={setSort}
            state={state}
            onStateChange={setState}
            onRefresh={refresh}
            onSignIn={() => void loginGitHub()}
            onCiResolved={onCiResolved}
            hasMore={hasMore}
            onLoadMore={() => void loadMore()}
        />
    );
}

export function ChatPullRequestsView({ onClose }: { onClose: () => void }) {
    return (
        <div className="flex h-full min-h-0 flex-col bg-panel">
            <div className="flex justify-end px-3 pt-2">
                <Button variant="ghost" size="xs" onClick={onClose}>
                    Back to chat
                </Button>
            </div>
            <PullRequestsPanel pane="list" />
        </div>
    );
}
