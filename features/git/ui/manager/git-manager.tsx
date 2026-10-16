"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useIsMounted } from "@/lib/ui/use-mounted";
import { listen } from "@tauri-apps/api/event";
import { BetterShapeLogo } from "@/components/ui/bettershape-logo";
import { SearchInput } from "@/components/ui/search";
import { cn } from "@/lib/utils";
import { commands, useProjectState } from "@/lib/backend";
import type { GitSectionId } from "@/features/git/types";
import Source from "@/features/git/ui/source/source";
import { BranchWindow } from "@/features/git/ui/branches/panel";
import Graph from "@/features/git/ui/graph/graph";
import { GitHubSection } from "@/features/git/ui/github/section";
import { ReleasesPage } from "@/features/git/ui/github/releases-page";
import { ActionsConsole } from "@/features/git/ui/actions/console";
import { LocalTags } from "@/features/git/ui/tags/panel";
import { StashPanel } from "@/features/git/ui/stash/panel";
import { useFilter, coerceGitSection, persistGitSection } from "./filter-context";
import { GitPageChrome } from "./chrome";
import { useGitRepos } from "@/lib/git/repos";
import { LoadingBar } from "@/components/ui/loading";
import { useLoading } from "@/features/loading/context";
import { CollapsibleNavGroup, NavLeafButton } from "@/components/ui/collapsible-nav";
import {
    GitListSkeleton,
    GitManagerShellSkeleton,
    Skeleton,
} from "@/features/git/ui/shared/skeletons";
import { HostedSidebarBack } from "@/features/agent/sidebar/hosted-nav";

export type { GitSectionId } from "@/features/git/types";

const GitEmbedCtx = createContext<{
    navPortalTarget?: HTMLElement | null;
    sidebarExpanded?: boolean;
    onClose?: () => void;
}>({});

type NavLeaf = { id: GitSectionId; label: string; keywords?: string[] };
type NavGroup = { id: string; label: string; children: NavLeaf[] };

const NAV: NavGroup[] = [
    {
        id: "local",
        label: "Local",
        children: [
            { id: "source", label: "Source Control", keywords: ["scm", "changes", "commit"] },
            { id: "graph", label: "Git Graph", keywords: ["history", "commits"] },
            { id: "branches", label: "Branches" },
            { id: "tags", label: "Tags" },
            { id: "stash", label: "Stash" },
        ],
    },
    {
        id: "github",
        label: "GitHub",
        children: [
            { id: "pull-requests", label: "Pull requests", keywords: ["pr"] },
            { id: "issues", label: "Issues" },
            { id: "releases", label: "Releases" },
        ],
    },
    {
        id: "actions",
        label: "Actions",
        children: [
            { id: "workflow-runs", label: "Workflow runs", keywords: ["ci", "checks"] },
            { id: "jobs", label: "Jobs" },
        ],
    },
];

const ALL_SECTION_IDS = NAV.flatMap((g) => g.children.map((c) => c.id));


type GitEmptyReason = "no-project" | "no-repo" | "no-commits";

const INTRO_SEEN_KEY = "bettershape-git-manager-intro-seen";

function GitManagerIntro({ children }: { children: React.ReactNode }) {
    // Always start false so SSR + first paint match; skip splash after mount if already seen.
    const [ready, setReady] = useState(false);
    const [visible, setVisible] = useState(false);

    const hydrated = useIsMounted();
    const [seen, setSeen] = useState<boolean | null>(null);
    if (hydrated && seen === null) {
        let stored = false;
        try { stored = sessionStorage.getItem(INTRO_SEEN_KEY) === "1"; } catch { /* use the intro */ }
        setSeen(stored);
        if (stored) setReady(true);
    }

    useEffect(() => {
        if (seen !== false) return;
        let cancelled = false;
        let t2: number | undefined;

        const fadeIn = requestAnimationFrame(() => {
            if (!cancelled) setVisible(true);
        });

        const t1 = window.setTimeout(() => {
            if (cancelled) return;
            setVisible(false);
            t2 = window.setTimeout(() => {
                if (cancelled) return;
                try {
                    sessionStorage.setItem(INTRO_SEEN_KEY, "1");
                } catch {
                    /* ignore */
                }
                setReady(true);
            }, 450);
        }, 1200);

        return () => {
            cancelled = true;
            cancelAnimationFrame(fadeIn);
            if (t1 !== undefined) window.clearTimeout(t1);
            if (t2 !== undefined) window.clearTimeout(t2);
        };
    }, [seen]);

    if (!ready) {
        return (
            <div className="flex h-full items-center justify-center bg-background">
                <Image
src="/logos/logo.png"
                    alt="BetterShape"
                    width={46}
                    height={46}
                    priority
                    style={{ width: 46, height: 46 }}
                    className={cn(
                        "logo-invert transition-opacity duration-500 ease-out",
                        visible ? "opacity-100" : "opacity-0",
                    )}
                />
            </div>
        );
    }

    return children;
}

function GitManagerEmpty({ reason }: { reason: GitEmptyReason }) {
    const detail =
        reason === "no-project"
            ? "Open a project in BetterShape to use Git Manager."
            : reason === "no-repo"
              ? "This folder is not a Git repository yet."
              : "This repository has no commits yet.";

    return (
        <div className="flex h-full flex-col items-center justify-center gap-3 bg-panel px-6 text-center">
            <BetterShapeLogo size={32} />
            <div>
                <p className="text-base font-medium text-text-primary">Project is empty</p>
                <p className="mt-1 text-sm text-text-muted">{detail}</p>
            </div>
        </div>
    );
}

/** Content-only skeleton, nav lives in the agent sidebar when embedded. */
function GitContentSkeleton() {
    return (
        <div
            className="h-full min-h-0 w-full overflow-hidden bg-panel p-3"
            aria-busy
            aria-label="Loading Git Manager"
        >
            <Skeleton className="mb-3 h-9 w-48" />
            <GitListSkeleton rows={10} variant="dense" />
        </div>
    );
}

/** Minimal Back control while Git is loading / empty, still uses the agent sidebar slot. */
function GitEmbedNavChrome() {
    const { navPortalTarget, sidebarExpanded = true, onClose } = useContext(GitEmbedCtx);
    if (!navPortalTarget || !onClose) return null;
    const collapsed = !sidebarExpanded;
    return createPortal(
        <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
            <HostedSidebarBack
                label="Back to app"
                onBack={onClose}
                collapsed={collapsed}
            />
        </div>,
        navPortalTarget,
    );
}

function GitManagerGate() {
    const { project_path } = useProjectState();
    const { repos, activeRepoPath, loading } = useGitRepos(project_path);
    const { navPortalTarget } = useContext(GitEmbedCtx);
    const [emptyReason, setEmptyReason] = useState<GitEmptyReason | null>(null);
    const [checking, setChecking] = useState(true);
    const [refreshToken, setRefreshToken] = useState(0);

    const repoPath = activeRepoPath ?? repos[0]?.path ?? null;
    const embedded = Boolean(navPortalTarget);

    useEffect(() => {
        const onRefresh = () => setRefreshToken((n) => n + 1);
        window.addEventListener("bettershape-git-refresh", onRefresh);
        return () => window.removeEventListener("bettershape-git-refresh", onRefresh);
    }, []);

    useEffect(() => {
        let cancelled = false;

        async function check() {
            if (!project_path) {
                if (!cancelled) {
                    setEmptyReason("no-project");
                    setChecking(false);
                }
                return;
            }
            if (loading) {
                if (!cancelled) {
                    setChecking(true);
                    setEmptyReason(null);
                }
                return;
            }
            if (!repoPath) {
                if (!cancelled) {
                    setEmptyReason("no-repo");
                    setChecking(false);
                }
                return;
            }

            // Show the shell immediately once we have a repo, don't wait on log I/O.
            if (!cancelled) {
                setEmptyReason(null);
                setChecking(false);
            }

            try {
                // One cheap `git log -1`, avoid starting a full unbounded stream just to probe.
                const logs = await commands.gitLog(repoPath, 1);
                if (!cancelled && logs.length === 0) {
                    setEmptyReason("no-commits");
                }
            } catch {
                if (!cancelled) setEmptyReason("no-repo");
            }
        }

        void check();
        return () => {
            cancelled = true;
        };
    }, [project_path, loading, repoPath, refreshToken]);

    if (emptyReason) {
        return (
            <>
                {embedded ? <GitEmbedNavChrome /> : null}
                <GitManagerEmpty reason={emptyReason} />
            </>
        );
    }

    if (checking || loading || !project_path) {
        return (
            <>
                {embedded ? <GitEmbedNavChrome /> : null}
                {embedded ? <GitContentSkeleton /> : <GitManagerShellSkeleton />}
            </>
        );
    }

    return <ManagerShell key={project_path} />;
}

function ManagerShell() {
    const { section, setSection } = useFilter();
    const { resetLoading } = useLoading();
    const { navPortalTarget, sidebarExpanded = true, onClose } = useContext(GitEmbedCtx);
    const [query, setQuery] = useState("");
    const [activeLeafId, setActiveLeafId] = useState<string>(() => section);
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
        () => new Set(NAV.map((g) => g.id)),
    );
    // Mount each heavy local pane once, then keep it alive while switching.
    const [visited, setVisited] = useState<Set<string>>(() => new Set([section]));

    if (!visited.has(section)) setVisited(previous => new Set([...previous, section]));

    // Clear any leaked global loading starts when leaving Git Manager.
    useEffect(() => () => resetLoading(), [resetLoading]);

    const hydrated = useIsMounted();
    useEffect(() => {
        if (hydrated) persistGitSection(section);
    }, [hydrated, section]);

    const [sectionInputs, setSectionInputs] = useState<readonly unknown[] | null>(null);
    if (sectionInputs === null || !Object.is(sectionInputs[0], section)) {
        setSectionInputs([section]);
        setActiveLeafId(section);
    }

    useEffect(() => {
        let unlisten: (() => void) | undefined;
        void listen<{ section?: string }>("bettershape-git-section", (event) => {
            const next = coerceGitSection(event.payload?.section);
            if (next && ALL_SECTION_IDS.includes(next)) {
                setSection(next);
                setActiveLeafId(next);
            }
        }).then((fn) => {
            unlisten = fn;
        });
        const onWindow = (e: Event) => {
            const next = coerceGitSection(
                (e as CustomEvent<{ section?: string }>).detail?.section,
            );
            if (next && ALL_SECTION_IDS.includes(next)) {
                setSection(next);
                setActiveLeafId(next);
            }
        };
        window.addEventListener("bettershape-git-section", onWindow as EventListener);
        return () => {
            unlisten?.();
            window.removeEventListener("bettershape-git-section", onWindow as EventListener);
        };
    }, [setSection]);

    const filteredNav = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return NAV;
        return NAV.map((group) => ({
            ...group,
            children: group.children.filter(
                (leaf) =>
                    leaf.label.toLowerCase().includes(q) ||
                    group.label.toLowerCase().includes(q) ||
                    leaf.keywords?.some((k) => k.includes(q)),
            ),
        })).filter((group) => group.children.length > 0);
    }, [query]);

    const [filterInputs, setFilterInputs] = useState<readonly unknown[] | null>(null);
    if (filterInputs === null || !Object.is(filterInputs[0], query) || !Object.is(filterInputs[1], filteredNav)) {
        setFilterInputs([query, filteredNav]);
        if (query.trim()) setExpandedGroups(new Set(filteredNav.map(group => group.id)));
    }

    const toggleGroup = (id: string) => {
        setExpandedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const select = useCallback(
        (id: GitSectionId) => {
            setActiveLeafId(id);
            setSection(id);
        },
        [setSection],
    );

    const collapsed = Boolean(navPortalTarget) && !sidebarExpanded;

    const pane = (id: GitSectionId, node: React.ReactNode) =>
        visited.has(id) ? (
            <div
                key={id}
                className={cn(
                    "absolute inset-0 min-h-0 min-w-0",
                    section === id ? "z-10" : "hidden",
                )}
                aria-hidden={section !== id}
            >
                {node}
            </div>
        ) : null;

    return (
        <div
            className={cn(
                "relative flex h-full w-full min-w-0 flex-col overflow-hidden select-none text-text-primary",
                navPortalTarget ? "bg-panel" : "bg-background",
            )}
        >
            <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                {(() => {
                    const nav = (
                        <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
                            {onClose ? (
                                <HostedSidebarBack
                                    label="Back to app"
                                    onBack={onClose}
                                    collapsed={collapsed}
                                />
                            ) : null}
                            {collapsed ? null : (
                                <>
                                    <div className="shrink-0 px-2 pb-2">
                                        <SearchInput
                                            placeholder="Search git"
                                            value={query}
                                            onChange={(e) => setQuery(e.target.value)}
                                            className="w-full"
                                        />
                                    </div>
                                    <nav className="no-scrollbar flex-1 space-y-1 overflow-y-auto px-2 pb-2">
                                        {filteredNav.map((group) => {
                                            const open = expandedGroups.has(group.id) || !!query.trim();
                                            return (
                                                <CollapsibleNavGroup
                                                    key={group.id}
                                                    label={group.label}
                                                    open={open}
                                                    onToggle={() => toggleGroup(group.id)}
                                                >
                                                    {group.children.map((leaf) => (
                                                        <NavLeafButton
                                                            key={leaf.id}
                                                            active={activeLeafId === leaf.id || section === leaf.id}
                                                            onClick={() => select(leaf.id)}
                                                        >
                                                            <span className="truncate text-sm font-regular">
                                                                {leaf.label}
                                                            </span>
                                                        </NavLeafButton>
                                                    ))}
                                                </CollapsibleNavGroup>
                                            );
                                        })}
                                    </nav>
                                </>
                            )}
                        </div>
                    );
                    if (navPortalTarget) return createPortal(nav, navPortalTarget);
                    return (
                        <aside className="flex w-64 shrink-0 flex-col overflow-hidden bg-background">
                            {nav}
                        </aside>
                    );
                })()}

                <section className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-panel">
                    <GitPageChrome />
                    {pane("source", <Source embedded active={section === "source"} />)}
                    {pane(
                        "graph",
                        <Graph
                            rich
                            surface="editor"
                            active={section === "graph"}
                        />,
                    )}
                    {pane("branches", <BranchWindow active={section === "branches"} />)}
                    {pane("tags", <LocalTags />)}
                    {pane("stash", <StashPanel />)}
                    {pane(
                        "pull-requests",
                        <GitHubSection section="pull-requests" />,
                    )}
                    {pane("issues", <GitHubSection section="issues" />)}
                    {pane("releases", <ReleasesPage />)}
                    {pane(
                        "workflow-runs",
                        <ActionsConsole focus="workflow-runs" />,
                    )}
                    {pane("jobs", <ActionsConsole focus="jobs" />)}
                </section>
            </div>
            <LoadingBar className="absolute inset-x-0 bottom-0 z-50 pointer-events-none" />
        </div>
    );
}

export function GitManager({
    embedded = false,
    navPortalTarget,
    sidebarExpanded = true,
    onClose,
}: {
    embedded?: boolean;
    navPortalTarget?: HTMLElement | null;
    sidebarExpanded?: boolean;
    onClose?: () => void;
}) {
    const body = embedded ? (
        <GitManagerGate />
    ) : (
        <GitManagerIntro>
            <GitManagerGate />
        </GitManagerIntro>
    );
    return (
        <GitEmbedCtx.Provider value={{ navPortalTarget, sidebarExpanded, onClose }}>
            {body}
        </GitEmbedCtx.Provider>
    );
}

export { GitManagerTrigger } from "./git-manager-trigger";
