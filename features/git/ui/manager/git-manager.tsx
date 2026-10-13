"use client";

import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
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
import { useFilter, coerceGitSection, persistGitSection, readStoredGitSection } from "./filter-context";
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

function initialSection(pathname: string | null, query: string | null): GitSectionId {
    const fromQuery = coerceGitSection(query);
    if (fromQuery && ALL_SECTION_IDS.includes(fromQuery)) return fromQuery;
    const stored = readStoredGitSection();
    if (stored && ALL_SECTION_IDS.includes(stored)) return stored;
    if (pathname?.startsWith("/branch")) return "branches";
    return "source";
}

type GitEmptyReason = "no-project" | "no-repo" | "no-commits";

function gitProbeKey(projectPath: string | null, repoPath: string | null, token: number): string {
    return `${projectPath ?? ""}\u0000${repoPath ?? ""}\u0000${token}`;
}

const INTRO_SEEN_KEY = "bettershape-git-manager-intro-seen";

const subscribeNone = () => () => {};

function readIntroSeen(): boolean {
    try {
        return sessionStorage.getItem(INTRO_SEEN_KEY) === "1";
    } catch {
        return false;
    }
}

function GitManagerIntro({ children }: { children: React.ReactNode }) {
    // The server snapshot is `false`, so SSR and the first client render match.
    // A previously seen intro is read from sessionStorage after hydration.
    const seenBefore = useSyncExternalStore(subscribeNone, readIntroSeen, () => false);
    const [introDone, setIntroDone] = useState(false);
    const [visible, setVisible] = useState(false);
    const ready = seenBefore || introDone;

    useEffect(() => {
        if (seenBefore) return;
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
                setIntroDone(true);
            }, 450);
        }, 1200);

        return () => {
            cancelled = true;
            cancelAnimationFrame(fadeIn);
            window.clearTimeout(t1);
            if (t2 !== undefined) window.clearTimeout(t2);
        };
    }, [seenBefore]);

    if (!ready) {
        return (
            <div className="flex h-full items-center justify-center bg-background">
                <Image
                    src="/logos/logo.svg"
                    alt="BetterShape"
                    width={46}
                    height={56}
                    priority
                    style={{ width: 46, height: "auto" }}
                    className={cn(
                        "logo-invert transition-opacity duration-500 ease-out",
                        visible ? "opacity-100" : "opacity-0",
                    )}
                />
            </div>
        );
    }

    return <>{children}</>;
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

/** Content-only skeleton — nav lives in the agent sidebar when embedded. */
function GitContentSkeleton() {
    return (
        <div
            className="h-full min-h-0 w-full overflow-hidden bg-panel p-3"
            aria-busy
            aria-label="Loading Git Manager"
        >
            <Skeleton className="mb-3 h-9 w-48" />
            <GitListSkeleton rows={10} />
        </div>
    );
}

/** Minimal Back control while Git is loading / empty — still uses the agent sidebar slot. */
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

/**
 * Keyed by project: a project switch remounts the gate, so its probe state,
 * refresh token and repo state never carry over from the previous project.
 */
function GitManagerGate() {
    const { project_path } = useProjectState();
    return <GitManagerGateInner key={project_path ?? ""} />;
}

function GitManagerGateInner() {
    const { project_path } = useProjectState();
    const { repos, activeRepoPath, loading } = useGitRepos(project_path);
    const { navPortalTarget } = useContext(GitEmbedCtx);
    const [refreshToken, setRefreshToken] = useState(0);
    // The `git log` probe result is tagged with the inputs it was run for. A project switch
    // (or any input change) makes the tag stale, so the old result is never shown.
    const [probe, setProbe] = useState<{ key: string; reason: GitEmptyReason | null }>({
        key: "",
        reason: null,
    });

    const repoPath = activeRepoPath ?? repos[0]?.path ?? null;
    const embedded = Boolean(navPortalTarget);
    const probeKey = gitProbeKey(project_path, repoPath, refreshToken);
    const probeReason = probe.key === probeKey ? probe.reason : null;
    const emptyReason: GitEmptyReason | null = !project_path
        ? "no-project"
        : loading
          ? null
          : !repoPath
            ? "no-repo"
            : probeReason;

    useEffect(() => {
        const onRefresh = () => setRefreshToken((n) => n + 1);
        window.addEventListener("bettershape-git-refresh", onRefresh);
        return () => window.removeEventListener("bettershape-git-refresh", onRefresh);
    }, []);

    useEffect(() => {
        // Only the commit probe is async. The shell shows as soon as a repo is known.
        if (!project_path || loading || !repoPath) return;
        let cancelled = false;
        const key = gitProbeKey(project_path, repoPath, refreshToken);
        // One cheap `git log -1` — avoid starting a full unbounded stream just to probe.
        commands
            .gitLog(repoPath, 1)
            .then((logs) => {
                if (!cancelled) setProbe({ key, reason: logs.length === 0 ? "no-commits" : null });
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                // Only a real "not a repository" answer means no repo. Permission or backend
                // errors are unknown, so they must not show the no-repo empty state.
                const message = err instanceof Error ? err.message : String(err);
                setProbe({ key, reason: /not a git repository/i.test(message) ? "no-repo" : null });
            });
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

    if (loading || !project_path) {
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
    const search = useSearchParams();
    const pathname = usePathname();
    useProjectState();
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

    useEffect(() => {
        setVisited((prev) => {
            if (prev.has(section)) return prev;
            const next = new Set(prev);
            next.add(section);
            return next;
        });
    }, [section]);

    // Clear any leaked global loading starts when leaving Git Manager.
    useEffect(() => () => resetLoading(), [resetLoading]);

    // Sync once from URL / storage on mount; avoid resetting to Source on reload.
    useEffect(() => {
        const next = initialSection(pathname, search.get("section"));
        setSection(next);
        setActiveLeafId(next);
        persistGitSection(next);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
    }, []);

    useEffect(() => {
        setActiveLeafId(section);
    }, [section]);

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

    useEffect(() => {
        if (!query.trim()) return;
        setExpandedGroups(new Set(filteredNav.map((g) => g.id)));
    }, [query, filteredNav]);

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
