"use client";

import { parseGitHubRemote } from "@/lib/github/remote";
import { ArrowSync20Regular } from "@fluentui/react-icons/headless/svg/arrow-sync";
import { BranchRequest20Regular } from "@fluentui/react-icons/headless/svg/branch-request";
import { ChevronDown20Regular } from "@fluentui/react-icons/headless/svg/chevron-down";
import { Open20Regular } from "@fluentui/react-icons/headless/svg/open";


import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/icon";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import { useProjectState, commands } from "@/lib/backend";
import { loginGitHub, useGitHubAuth } from "@/lib/github/store";
import { cn } from "@/lib/utils";
import { useFilter } from "@/features/git/ui/manager/filter-context";
import { statusIcon } from "@/features/git/ui/actions/utils";
import { formatCommandError } from "@/lib/errors/format";
import { notify } from "@/features/notifications";
import { Tooltip } from "@/components/ui/tooltip";
import { GitHubDetailPane } from "./detail";
import { GitListSkeleton } from "@/features/git/ui/shared/skeletons";
import { GIT_ROW_TEXT } from "@/features/git/ui/shared/row-shell";
import { GitChromeActions } from "@/features/git/ui/manager/chrome";
import { CreatePullRequestDialog } from "./create-pr-dialog";
import { Panel } from "@/features/panels";

type IssueStateFilter = "open" | "closed" | "all";

type GhItem = {
    id: string | number;
    title: string;
    subtitle?: string;
    url?: string;
    status?: string;
    meta?: string;
    number?: number;
    author?: string;
    body?: string;
};

export type GitHubListSection = "issues" | "pull-requests";

const SECTION_META: Record<
    GitHubListSection,
    {
        title: string;
        empty: (state?: IssueStateFilter) => string;
        endpoint: (owner: string, repo: string, state?: IssueStateFilter) => string;
    }
> = {
    issues: {
        title: "Issues",
        empty: (state) =>
            state === "closed"
                ? "No closed issues"
                : state === "all"
                  ? "No issues"
                  : "No open issues",
        endpoint: (o, r, state = "open") =>
            `/repos/${o}/${r}/issues?state=${state}&per_page=50`,
    },
    "pull-requests": {
        title: "Pull requests",
        empty: (state) =>
            state === "closed"
                ? "No closed pull requests"
                : state === "all"
                  ? "No pull requests"
                  : "No open pull requests",
        endpoint: (o, r, state = "open") =>
            `/repos/${o}/${r}/pulls?state=${state}&per_page=50`,
    },
};

function asArr(v: unknown): unknown[] {
    return Array.isArray(v) ? v : v && typeof v === "object" ? [v] : [];
}

function formatRelative(iso: unknown): string {
    if (typeof iso !== "string" || !iso) return "";
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return "";
    const mins = Math.round((Date.now() - t) / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 48) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
}

function statusTone(status?: string): string {
    const s = (status || "").toLowerCase();
    if (["success", "completed", "passed", "open"].includes(s)) return "text-success";
    if (["failure", "failed", "error", "cancelled", "closed"].includes(s)) return "text-error";
    if (["in_progress", "queued", "pending", "waiting"].includes(s)) return "text-warning";
    return "text-text-muted";
}

function ItemStatusIcon({ status }: { status?: string }) {
    if (!status) return null;
    const icon = statusIcon(status, status);
    return (
        <Icon
            icon={icon.icon}
            className={cn("shrink-0", statusTone(status), icon.spin && "animate-spin")}
        />
    );
}

function supportsStateFilter(section: GitHubListSection): boolean {
    return section === "issues" || section === "pull-requests";
}

function normalize(section: GitHubListSection, data: unknown): GhItem[] {
    return asArr(data)
        .filter((raw) => {
            const i = raw as Record<string, unknown>;
            if (section === "issues" && i.pull_request) return false;
            return true;
        })
        .map((raw, index) => {
            const i = raw as Record<string, unknown>;
            const user =
                i.user && typeof i.user === "object"
                    ? (i.user as { login?: string }).login
                    : undefined;
            const labels = Array.isArray(i.labels)
                ? i.labels
                      .map((l) =>
                          typeof l === "object" && l && "name" in l
                              ? String((l as { name?: string }).name)
                              : null,
                      )
                      .filter(Boolean)
                      .slice(0, 3)
                      .join(", ")
                : "";
            const number = typeof i.number === "number" ? i.number : Number(i.number);
            return {
                id: String(i.id ?? i.number ?? `${section}-${index}`),
                title: String(i.title ?? `#${i.number}`),
                subtitle: [`#${i.number}`, user, labels].filter(Boolean).join(" · "),
                url: typeof i.html_url === "string" ? i.html_url : undefined,
                status: String(i.state ?? ""),
                meta: formatRelative(i.updated_at ?? i.created_at),
                number: Number.isFinite(number) ? number : undefined,
                author: user,
                body: typeof i.body === "string" ? i.body : undefined,
            };
        });
}

async function resolveOwnerRepo(
    projectPath: string | null,
): Promise<{ owner: string; repo: string } | null> {
    if (!projectPath) return null;
    try {
        return parseGitHubRemote(await commands.gitRemoteUrl(projectPath));
    } catch {
        return null;
    }
}

async function parseApi(path: string): Promise<unknown> {
    const raw = await commands.githubApiGet(path);
    return typeof raw === "string" ? JSON.parse(raw) : raw;
}

export function GitHubSection({ section }: { section: GitHubListSection }) {
    const meta = SECTION_META[section];
    const { project_path } = useProjectState();
    const auth = useGitHubAuth();
    const { query } = useFilter();
    const [items, setItems] = useState<GhItem[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [repo, setRepo] = useState<{ owner: string; repo: string } | null>(null);
    const [issueState, setIssueState] = useState<IssueStateFilter>("open");
    const [selectedId, setSelectedId] = useState<string | number | null>(null);
    const [createPrOpen, setCreatePrOpen] = useState(false);

    const fetchList = useCallback(() => resolveOwnerRepo(project_path).then(async resolved => {
            setRepo(resolved);
            if (!resolved) {
                setItems([]);
                setError("Connect a GitHub remote to load this view.");
                return;
            }
            if (!auth.loggedIn) {
                setItems([]);
                setError("Sign in with GitHub to load this data.");
                return;
            }

            const state = supportsStateFilter(section) ? issueState : undefined;
            setItems(
                normalize(
                    section,
                    await parseApi(meta.endpoint(resolved.owner, resolved.repo, state)),
                ),
            );
    }).catch(e => {
            setItems([]);
            const formatted = formatCommandError(e, "GitHub");
            const text = formatted.hint
                ? `${formatted.message}\n${formatted.hint}`
                : formatted.message || formatted.title;
            notify.error(formatted.title, text);
    }).finally(() => {
            setLoading(false);
    }), [auth.loggedIn, issueState, meta, project_path, section]);

    const load = useCallback(() => {
        setLoading(true);
        setError(null);
        return fetchList();
    }, [fetchList]);

    const [requestInputs, setRequestInputs] = useState<readonly unknown[] | null>(null);
    if (requestInputs === null || !Object.is(requestInputs[0], fetchList)) {
        setRequestInputs([fetchList]);
        setLoading(true);
        setError(null);
    }

    useEffect(() => {
        void fetchList();
    }, [fetchList]);

    const [listScope, setListScope] = useState<readonly [typeof section, typeof issueState] | null>(null);
    if (listScope === null || !Object.is(listScope[0], section) || !Object.is(listScope[1], issueState)) {
        setListScope([section, issueState]);
        setSelectedId(null);
        setItems([]);
        setError(null);

    }

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return items;
        return items.filter(
            (item) =>
                item.title.toLowerCase().includes(q) ||
                item.subtitle?.toLowerCase().includes(q) ||
                item.status?.toLowerCase().includes(q) ||
                item.author?.toLowerCase().includes(q),
        );
    }, [items, query]);

    const selectedItem = useMemo(
        () => filtered.find((item) => item.id === selectedId) ?? null,
        [filtered, selectedId],
    );

    const emptyLabel = supportsStateFilter(section)
        ? meta.empty(issueState)
        : meta.empty();

    const closeDetail = useCallback(() => setSelectedId(null), []);

    useEffect(() => {
        if (!selectedItem) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                closeDetail();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [selectedItem, closeDetail]);


    const listPane = (
        <div className="workbench-panel flex h-full min-h-0 flex-col overflow-hidden border border-border-subtle bg-panel">
            <ScrollArea className="h-full min-h-0 p-2" fadeFrom="from-panel">
                {loading && items.length === 0 ? (
                    <GitListSkeleton rows={10} variant="dense" />
                ) : error && items.length === 0 ? (
                    <div className="flex flex-col gap-2 px-2 py-3">
                        <p className="text-sm text-text-muted">{error}</p>
                        {!auth.loggedIn ? (
                            <Button
                                variant="secondary"
                                size="sm"
                                className="w-fit"
                                onClick={() => void loginGitHub()}
                            >
                                Sign in with GitHub
                            </Button>
                        ) : null}
                    </div>
                ) : filtered.length === 0 ? (
                    <p className="px-2 py-3 text-sm text-text-muted">{emptyLabel}</p>
                ) : (
                    <ul className="flex flex-col gap-0.5">
                        {filtered.map((item) => (
                            <li key={item.id}>
                                <button
                                    type="button"
                                    onClick={() => setSelectedId(item.id)}
                                    className={cn(
                                        "flex w-full flex-col gap-0.5 rounded-lg px-2 py-2 text-left hover:bg-[var(--row-hover)]",
                                        selectedId === item.id && "bg-[var(--row-selected)] hover:bg-[var(--row-selected-hover)]",
                                    )}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <span className="flex min-w-0 items-start gap-2 text-sm leading-snug text-text-primary">
                                            <ItemStatusIcon status={item.status} />
                                            <span className={cn("line-clamp-2", GIT_ROW_TEXT.run.titleReserve)}>
                                                {item.title}
                                            </span>
                                        </span>
                                        {item.meta ? (
                                            <span className="shrink-0 text-2xs text-text-muted">
                                                {item.meta}
                                            </span>
                                        ) : null}
                                    </div>
                                    {item.subtitle ? (
                                        <div className="flex items-center gap-2 pl-6">
                                            <span className="truncate text-xs text-text-muted">
                                                {item.subtitle}
                                            </span>
                                            {item.url ? (
                                                <Icon
                                                    icon={Open20Regular}
                                                    className="shrink-0 text-text-muted"
                                                />
                                            ) : null}
                                        </div>
                                    ) : null}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </ScrollArea>
        </div>
    );

    const detailPane = selectedItem && repo ? (
        <div className="workbench-panel flex h-full min-h-0 flex-col overflow-hidden border border-border-subtle bg-panel">
            <GitHubDetailPane
                section={section}
                item={selectedItem}
                owner={repo.owner}
                repo={repo.repo}
                onBack={closeDetail}
            />
        </div>
    ) : (
        <div className="workbench-panel flex h-full items-center justify-center border border-border-subtle bg-panel px-4 text-sm text-text-muted">
            Select an item to open it in this panel.
        </div>
    );

    return (
        <div className="flex h-full min-h-0 flex-col">
            <GitChromeActions>
                {supportsStateFilter(section) ? (
                    <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1 px-2 capitalize"
                            >
                                {issueState}
                                <Icon icon={ChevronDown20Regular} />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuRadioGroup
                                value={issueState}
                                onValueChange={(v) =>
                                    setIssueState(v as IssueStateFilter)
                                }
                            >
                                <DropdownMenuRadioItem value="open">Open</DropdownMenuRadioItem>
                                <DropdownMenuRadioItem value="closed">
                                    Closed
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem value="all">All</DropdownMenuRadioItem>
                            </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : null}
                {section === "pull-requests" ? (
                    <Tooltip content="Create pull request">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setCreatePrOpen(true)}
                            aria-label="Create pull request"
                        >
                            <Icon icon={BranchRequest20Regular} />
                        </Button>
                    </Tooltip>
                ) : null}
                {!auth.loggedIn ? (
                    <Button
                        variant="secondary"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => void loginGitHub()}
                    >
                        Sign in
                    </Button>
                ) : null}
                <Tooltip content="Refresh">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => void load()}
                        aria-label="Refresh"
                    >
                        <Icon icon={ArrowSync20Regular} />
                    </Button>
                </Tooltip>
            </GitChromeActions>
            <CreatePullRequestDialog
                open={createPrOpen}
                onOpenChange={setCreatePrOpen}
                owner={repo?.owner ?? null}
                repo={repo?.repo ?? null}
                onCreated={() => void load()}
            />

            <Panel
                direction="horizontal"
                paneGap="var(--workbench-gap)"
                storageKey={`git-github-${section}-split`}
                hideSeparator
                className="h-full min-h-0 flex-1"
                panes={[
                    {
                        id: "github-list",
                        preferredSize: 320,
                        minSize: 220,
                        maxSize: 480,
                        snap: true,
                        children: listPane,
                    },
                    {
                        id: "github-detail",
                        flexible: true,
                        minSize: 360,
                        visible: Boolean(selectedItem),
                        children: detailPane,
                    },
                ]}
            />
        </div>
    );
}
