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
import { FileIcon } from "@/components/ui/file-icon";
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
    mergeableFrom,
    parseJson,
    type PrCi,
    type PrItem,
} from "./mapping";
import { settlePrOverrides } from "./overrides";
import { apiSortParam, type PrSortMode } from "./ranking";
import { selectPr, usePrUi } from "./store";

type PrFile = {
    filename: string;
    status: string;
    additions: number;
    deletions: number;
};

type PrReviewer = { login: string; avatar?: string };

async function resolveOwnerRepo(projectPath: string | null) {
    if (!projectPath) return null;
    try {
        return parseGitHubRemote(await commands.gitRemoteUrl(projectPath));
    } catch {
        return null;
    }
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
    const [files, setFiles] = useState<PrFile[]>([]);
    const [filesLoading, setFilesLoading] = useState(false);
    const [reviewers, setReviewers] = useState<PrReviewer[]>([]);
    const [commentCount, setCommentCount] = useState(0);
    const [checkingOut, setCheckingOut] = useState(false);

    const loadVersion = useRef(0);
    const loadBusy = useRef(false);
    const [detailRevision, setDetailRevision] = useState(0);
    const load = useCallback(async (background = false) => {
        if (background && loadBusy.current) return;
        const version = ++loadVersion.current;
        loadBusy.current = true;
        if (!background) {
            setItems([]);
            setRepo(null);
        }
        setLoading(true);
        setError(null);
        try {
            const resolved = await resolveOwnerRepo(project_path);
            if (version !== loadVersion.current) return;
            setRepo(resolved);
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
            const raw = await commands.githubApiGet(
                `/repos/${resolved.owner}/${resolved.repo}/pulls?state=${state}&sort=${apiSortParam(sort)}&direction=desc&per_page=50`,
            );
            if (version !== loadVersion.current) return;
            const mapped = mapPullRows(parseJson(raw), `${resolved.owner}/${resolved.repo}`);
            settlePrOverrides(mapped);
            setItems(mapped);
            setDetailRevision((revision) => revision + 1);
        } catch (e) {
            if (version !== loadVersion.current) return;
            if (!background) setItems([]);
            setError(e instanceof Error ? e.message : "Could not load pull requests.");
        } finally {
            if (version === loadVersion.current) {
                loadBusy.current = false;
                setLoading(false);
            }
        }
    }, [auth.loggedIn, project_path, sort, state]);

    useEffect(() => {
        void load();
        const refreshVisible = () => { if (!document.hidden) void load(true); };
        const timer = window.setInterval(refreshVisible, 30_000);
        return () => {
            loadVersion.current += 1;
            loadBusy.current = false;
            window.clearInterval(timer);
        };
    }, [load]);

    const onCiResolved = useCallback((id: string, ci: PrCi) => {
        setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ci } : item)));
    }, []);

    const selected = useMemo(
        () => items.find((item) => item.id === selectedId) ?? null,
        [items, selectedId],
    );

    // Detail enrichment must not depend on the object it updates in setItems.
    const detailId = selected?.id;
    const detailNumber = selected?.number;
    const detailOwner = repo?.owner;
    const detailRepo = repo?.repo;
    useEffect(() => {
        setFiles([]);
        setReviewers([]);
        setCommentCount(0);
        if (!detailId || !detailNumber || !detailOwner || !detailRepo) {
            setFilesLoading(false);
            return;
        }
        let cancelled = false;
        setFilesLoading(true);
        void Promise.all([
            commands.githubApiGet(`/repos/${detailOwner}/${detailRepo}/pulls/${detailNumber}`),
            commands.githubApiGet(`/repos/${detailOwner}/${detailRepo}/pulls/${detailNumber}/files?per_page=100`),
            commands.githubApiGet(`/repos/${detailOwner}/${detailRepo}/pulls/${detailNumber}/reviews?per_page=50`),
        ])
            .then(([detailRaw, filesRaw, reviewsRaw]) => {
                if (cancelled) return;
                const detail = parseJson(detailRaw) as Record<string, unknown>;
                const fileList = Array.isArray(parseJson(filesRaw)) ? (parseJson(filesRaw) as Record<string, unknown>[]) : [];
                const reviewList = Array.isArray(parseJson(reviewsRaw))
                    ? (parseJson(reviewsRaw) as Record<string, unknown>[])
                    : [];
                setFiles(
                    fileList.map((row) => ({
                        filename: String(row.filename ?? ""),
                        status: String(row.status ?? ""),
                        additions: Number(row.additions ?? 0),
                        deletions: Number(row.deletions ?? 0),
                    })),
                );
                const requested = Array.isArray(detail.requested_reviewers)
                    ? (detail.requested_reviewers as { login?: string; avatar_url?: string }[])
                    : [];
                const fromReviews: PrReviewer[] = [];
                for (const row of reviewList) {
                    const user = row.user as { login?: string; avatar_url?: string } | undefined;
                    if (user?.login) fromReviews.push({ login: user.login, avatar: user.avatar_url });
                }
                const merged = [...requested.map((u) => ({ login: u.login || "", avatar: u.avatar_url })), ...fromReviews]
                    .filter((p) => p.login)
                    .filter((p, i, all) => all.findIndex((x) => x.login === p.login) === i);
                setReviewers(merged);
                setCommentCount(Number(detail.comments ?? 0));
                const head = detail.head as { ref?: string; sha?: string } | undefined;
                const base = detail.base as { ref?: string } | undefined;
                setItems((prev) =>
                    prev.map((item) =>
                        item.id === detailId
                            ? {
                                  ...item,
                                  additions: Number(detail.additions ?? item.additions ?? 0),
                                  deletions: Number(detail.deletions ?? item.deletions ?? 0),
                                  comments: Number(detail.comments ?? item.comments ?? 0),
                                  body: typeof detail.body === "string" ? detail.body : item.body,
                                  headRef: head?.ref ?? item.headRef,
                                  baseRef: base?.ref ?? item.baseRef,
                                  headSha: head?.sha ?? item.headSha,
                                  mergeable: mergeableFrom(detail),
                              }
                            : item,
                    ),
                );
            })
            .catch(() => {
                if (!cancelled) {
                    setFiles([]);
                    setReviewers([]);
                }
            })
            .finally(() => {
                if (!cancelled) setFilesLoading(false);
            });
        return () => {
            cancelled = true;
        };
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
                        className="mt-0.5 flex size-7 items-center justify-center rounded-md text-text-muted hover:bg-panel-hover hover:text-text-primary"
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
                                    className="flex size-7 items-center justify-center rounded-md text-text-muted hover:bg-panel-hover hover:text-text-primary"
                                >
                                    <Icon icon={MoreHorizontal20Regular} />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-52">
                                <DropdownMenuItem onClick={() => void load()}>
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
                                {selected.url ? (
                                    <DropdownMenuItem
                                        onClick={() => void commands.openUrlExternal(selected.url!)}
                                    >
                                        <Icon icon={Open20Regular} />
                                        Open on GitHub
                                    </DropdownMenuItem>
                                ) : null}
                                {selected.url ? (
                                    <DropdownMenuItem
                                        onClick={() => {
                                            void navigator.clipboard.writeText(selected.url!);
                                            notify.success("Link copied");
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

                <Tabs defaultValue="summary" className="flex min-h-0 flex-1 flex-col">
                    <div className="px-3">
                        <TabsList>
                            <TabsTrigger value="summary">Summary</TabsTrigger>
                            <TabsTrigger value="files">
                                Files{files.length ? ` ${files.length}` : ""}
                            </TabsTrigger>
                            <TabsTrigger value="timeline">Timeline</TabsTrigger>
                        </TabsList>
                    </div>
                    <TabsContent value="summary" className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 pt-3">
                        <div className="mb-4 grid gap-2 text-sm">
                            <div className="flex gap-2">
                                <span className="w-20 shrink-0 text-text-muted">Reviewers</span>
                                <span className="text-text-secondary">
                                    {reviewers.length
                                        ? reviewers.map((r) => r.login).join(", ")
                                        : "None"}
                                </span>
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
                                <span className="text-text-secondary">{commentCount} comments</span>
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
                        {filesLoading ? (
                            <p className="text-sm text-text-muted">Loading files…</p>
                        ) : files.length === 0 ? (
                            <p className="text-sm text-text-muted">No files listed</p>
                        ) : (
                            <ul className="flex flex-col gap-0.5">
                                {files.map((file) => (
                                    <li
                                        key={file.filename}
                                        className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm"
                                    >
                                        <FileIcon name={file.filename} className="size-4 shrink-0" />
                                        <span className="min-w-0 flex-1 truncate text-text-primary">
                                            {file.filename}
                                        </span>
                                        <span className="shrink-0 text-xs text-success">+{file.additions}</span>
                                        <span className="shrink-0 text-xs text-error">−{file.deletions}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </TabsContent>
                    <TabsContent value="timeline" className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 pt-3">
                        <p className="text-sm text-text-muted">
                            {selected.author} opened this pull request
                            {selected.updated ? ` · ${selected.updated}` : ""}.
                        </p>
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
            onRefresh={() => void load()}
            onSignIn={() => void loginGitHub()}
            onCiResolved={onCiResolved}
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