"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useProjectState } from "@/lib/backend";
import { EditorViewProvider, EditorSplitProvider } from "@/core/providers/editor";
import { FileTree } from "./tree";
import type { FileDiffTabInfo } from "./file-diff";
import Graph from "@/features/git/ui/graph/graph";
import { ProblemsTab } from "./problems-tab";
import { BlameTab } from "./blame-tab";
import { PackagesTab } from "./packages-tab";
import { SubagentCards } from "@/features/agent/subagents/cards";
import { AllChangesTab } from "./multi-diff";

/** The design studio is a large surface; it loads when its tab opens, never before. */
const DesignStudioSurface = dynamic(
    () => import("@/features/preview/design/shell").then((module) => module.DesignStudio),
    { ssr: false, loading: () => <div className="h-full w-full" aria-hidden /> },
);
import { SearchTab } from "./search-tab";
import { subscribePrUi, getPrUi } from "@/features/chat/ui/prs/store";
import { isBrowserTab } from "@/lib/window/browser-tab";
import { takeRequestedWorkspaceTab } from "@/lib/window/workspace-intent";
import { WorkspaceTabs } from "./tabs";
import { FileBar } from "./file-bar";
import type { CSSProperties } from "react";
import workspaceLayout from "./workspace-layout.module.css";

/**
 * Panels behind a tab the user has to open are split out of the first-load
 * bundle — CodeMirror alone is ~330 KB and the diff view pulls its own editor.
 * The Graph is the default tab and stays eager so the workspace paints on the
 * first frame; these placeholders only cover the tick before the chunk lands
 * (it is served from local disk, not the network).
 */
const PanelFallback = () => <div className="h-full w-full" aria-hidden />;

const FileEditor = dynamic(() => import("./editor").then((m) => m.FileEditor), {
    ssr: false,
    loading: PanelFallback,
});
const SingleFileDiffEditor = dynamic(
    () => import("./file-diff").then((m) => m.SingleFileDiffEditor),
    { ssr: false, loading: PanelFallback },
);
const PlanTabView = dynamic(() => import("./plan-tab").then((m) => m.PlanTabView), {
    ssr: false,
    loading: PanelFallback,
});
const PullRequestsPanel = dynamic(
    () => import("@/features/chat/ui/prs/view").then((m) => m.PullRequestsPanel),
    { ssr: false, loading: PanelFallback },
);

const SIDEBAR_SURFACE = {
    "--panel": "var(--sidebar)",
    "--color-panel": "var(--sidebar)",
    "--editor": "var(--sidebar)",
    "--color-editor": "var(--sidebar)",
} as CSSProperties;
import {
    DEFAULT_TABS,
    uid,
    type TabKind,
    type WorkspaceTab,
} from "./model";

const ADDABLE_TAB_TITLES: Partial<Record<TabKind, string>> = {
    files: "Files",
    "all-changes": "All changes",
    design: "Design",
    agents: "Agents",
    graph: "Graph",
    prs: "Pull requests",
    browser: "New tab",
    problems: "Problems",
    search: "Search",
    packages: "packages",
    blame: "blame",
};

const WORKSPACE_TAB_ALIASES: Partial<Record<string, TabKind>> = {
    preview: "files",
    browser: "files",
    files: "files",
    explorer: "files",
    graph: "graph",
    git: "graph",
    prs: "prs",
    pulls: "prs",
    "pull-requests": "prs",
    problems: "problems",
    errors: "problems",
    search: "search",
    find: "search",
    "all-changes": "all-changes",
    changes: "all-changes",
    design: "design",
    agents: "agents",
    packages: "packages",
    dependencies: "packages",
    blame: "blame",
    annotations: "blame",
};

const NON_SINGLETON_TAB_KINDS = new Set<TabKind>(["plan", "file", "diff"]);

/** Resolves the display basename for a workspace file or diff path. */
const tabTitleFromPath = (path: string): string => path.split(/[\\/]/).pop() || path;

/** Renders the split code editor and sibling file tree body inside `WorkspaceFileSurface`. */
const WorkspaceFileSplitBody = ({
    projectPath,
    path,
    onOpenFile,
}: {
    projectPath: string;
    path: string;
    onOpenFile: (path: string) => void;
}) => (
    <div className="flex h-full min-h-0 flex-col">
        <FileBar path={path} />
        <div className="flex min-h-0 flex-1">
            <div className="min-h-0 min-w-0 flex-1 bg-sidebar" style={SIDEBAR_SURFACE}>
                <FileEditor path={path} />
            </div>
            <div
                role="region"
                aria-label="File explorer"
                className={`border-l border-border-subtle ${workspaceLayout.fileExplorer}`}
            >
                <FileTree projectPath={projectPath} activePath={path} onOpenFile={onOpenFile} />
            </div>
        </div>
    </div>
);

/** Renders the split code editor and sibling file tree for an open workspace file tab. */
const WorkspaceFileSurface = ({
    projectPath,
    path,
    onOpenFile,
}: {
    projectPath: string;
    path: string;
    onOpenFile: (path: string) => void;
}) => (
    <EditorViewProvider>
        <EditorSplitProvider>
            <WorkspaceFileSplitBody
                projectPath={projectPath}
                path={path}
                onOpenFile={onOpenFile}
            />
        </EditorSplitProvider>
    </EditorViewProvider>
);

type SingletonTabContext = {
    projectPath: string;
    activeFile: string | null;
    onOpenFile: (path: string) => void;
    closeActiveTab: () => void;
};

const SINGLETON_TAB_RENDERERS: Partial<Record<TabKind, (ctx: SingletonTabContext) => React.ReactNode>> = {
    graph: () => <Graph hideHeader surface="panel" active />,
    files: ({ projectPath, activeFile, onOpenFile }) => (
        <FileTree projectPath={projectPath} activePath={activeFile} onOpenFile={onOpenFile} />
    ),
    prs: () => (
        <div className="h-full min-h-0 bg-sidebar" style={SIDEBAR_SURFACE}>
            <PullRequestsPanel pane="full" />
        </div>
    ),
    search: () => <SearchTab />,
    "all-changes": ({ projectPath }) => <AllChangesTab projectPath={projectPath} />,
    agents: () => <SubagentCards className="h-full" />,
    design: ({ projectPath, closeActiveTab }) => (
        <DesignStudioSurface projectPath={projectPath} onClose={closeActiveTab} />
    ),
    problems: () => <ProblemsTab />,
    packages: () => <PackagesTab />,
    blame: () => <BlameTab />,
};

/** Checks whether a `WorkspaceTab` represents a renderable plan document. */
const isRenderablePlanTab = (tab: WorkspaceTab): boolean =>
    tab.kind === "plan" && Boolean(tab.path || tab.markdown);

/** Checks whether a keyboard event uses bare Ctrl/Cmd without Alt or Shift modifiers. */
const hasBarePrimaryMod = (event: KeyboardEvent): boolean =>
    (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;

/** Checks whether a keyboard event matches bare `Mod+G` outside editable inputs. */
const isOpenFilesShortcut = (event: KeyboardEvent): boolean => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("textarea, input, [contenteditable='true']")) return false;
    return hasBarePrimaryMod(event) && event.key.toLowerCase() === "g";
};

/** Renders a `file` or `diff` document tab when matched. */
const renderFileOrDiffTab = (
    active: WorkspaceTab,
    projectPath: string,
    onOpenFile: (path: string) => void,
): React.ReactNode | undefined => {
    if (active.kind === "file" && active.path) {
        return <WorkspaceFileSurface projectPath={projectPath} path={active.path} onOpenFile={onOpenFile} />;
    }
    if (active.kind === "diff" && active.diff) {
        return (
            <div className="h-full min-h-0 bg-sidebar" style={SIDEBAR_SURFACE}>
                <SingleFileDiffEditor tab={active.diff} />
            </div>
        );
    }
    return undefined;
};

/** Renders multi-instance document tabs (`file`, `diff`, `plan`) when matched. */
const renderDocumentWorkspaceTab = (
    active: WorkspaceTab,
    projectPath: string,
    onOpenFile: (path: string) => void,
): React.ReactNode | undefined => {
    const fileOrDiff = renderFileOrDiffTab(active, projectPath, onOpenFile);
    if (fileOrDiff !== undefined) return fileOrDiff;
    if (!isRenderablePlanTab(active)) return undefined;
    return (
        <div className="h-full min-h-0 bg-sidebar" style={SIDEBAR_SURFACE}>
            <PlanTabView path={active.path || ""} markdown={active.markdown} />
        </div>
    );
};

/** Renders the active workspace tab body based on its discriminated `kind`. */
const WorkspaceTabBody = ({
    active,
    projectPath,
    activeFile,
    onOpenFile,
    closeActiveTab,
}: {
    active: WorkspaceTab | undefined;
    projectPath: string;
    activeFile: string | null;
    onOpenFile: (path: string) => void;
    closeActiveTab: () => void;
}) => {
    if (!active) return null;
    const docNode = renderDocumentWorkspaceTab(active, projectPath, onOpenFile);
    if (docNode !== undefined) return docNode;
    const renderSingleton = SINGLETON_TAB_RENDERERS[active.kind];
    return renderSingleton ? renderSingleton({ projectPath, activeFile, onOpenFile, closeActiveTab }) : null;
};

/** Subscribes window and Tauri event channels that open or switch workspace tabs. */
const useWorkspaceEventChannels = ({
    addTab,
    openDiff,
    openFile,
    openPlan,
}: {
    addTab: (kind: TabKind, opts?: { expand?: boolean }) => void;
    openDiff: (info: FileDiffTabInfo) => void;
    openFile: (path: string) => void;
    openPlan: (path: string, title: string, markdown?: string) => void;
}) => {
    useEffect(() => {
        /** Maps named tab aliases to singleton workspace tabs. */
        const onTab = (e: Event) => {
            // The event reached a mounted workspace, so nothing is pending.
            takeRequestedWorkspaceTab();
            const tabId = (e as CustomEvent<string | null>).detail?.toLowerCase();
            const mapped = tabId ? WORKSPACE_TAB_ALIASES[tabId] : undefined;
            if (mapped) addTab(mapped, { expand: true });
        };
        /** Resolves plan title fallback for `bettershape-open-workspace-plan`. */
        const resolvePlanTitle = (path: string, title?: string) => title || tabTitleFromPath(path) || "Plan";
        /** Opens or updates a plan tab from custom workspace plan events. */
        const onOpenPlan = (e: Event) => {
            const detail = (e as CustomEvent<{ path?: string; title?: string; markdown?: string } | null>).detail;
            if (!detail || (!detail.path && !detail.markdown)) return;
            const resolvedPath = detail.path || "plan.md";
            openPlan(resolvedPath, resolvePlanTitle(resolvedPath, detail.title), detail.markdown);
        };
        /** Opens a workspace file tab or routes browser URLs to the files view. */
        const onOpenFile = (e: Event) => {
            const path = (e as CustomEvent<{ path?: string } | null>).detail?.path;
            if (!path) return;
            if (isBrowserTab(path)) addTab("files", { expand: true });
            else openFile(path);
        };
        /** Opens a single-file diff tab when both `id` and `path` are supplied. */
        const onOpenDiff = (e: Event) => {
            const tab = (e as CustomEvent<FileDiffTabInfo | null>).detail;
            if (tab?.id && tab.path) openDiff(tab);
        };
        // A command may have asked for a tab while this panel was closed.
        const pendingTab = takeRequestedWorkspaceTab();
        const pendingKind = pendingTab ? WORKSPACE_TAB_ALIASES[pendingTab.toLowerCase()] : undefined;
        if (pendingKind) addTab(pendingKind, { expand: true });
        window.addEventListener("bettershape-set-active-tab", onTab as EventListener);
        window.addEventListener("bettershape-set-panel-tab", onTab as EventListener);
        window.addEventListener("bettershape-open-workspace-plan", onOpenPlan as EventListener);
        window.addEventListener("bettershape-open-workspace-file", onOpenFile as EventListener);
        window.addEventListener("bettershape-open-file-diff", onOpenDiff as EventListener);
        let disposed = false;
        let stopRustTab: (() => void) | undefined;
        import("@tauri-apps/api/event")
            .then(({ listen }) =>
                listen<string>("bettershape-set-active-tab", (event) => {
                    window.dispatchEvent(new CustomEvent("bettershape-set-active-tab", { detail: event.payload }));
                }),
            )
            .then((stop) => {
                if (disposed) stop();
                else stopRustTab = stop;
            })
            .catch(() => {
                /* Non-Tauri browser preview runtime */
            });
        return () => {
            disposed = true;
            stopRustTab?.();
            window.removeEventListener("bettershape-set-active-tab", onTab as EventListener);
            window.removeEventListener("bettershape-set-panel-tab", onTab as EventListener);
            window.removeEventListener("bettershape-open-workspace-plan", onOpenPlan as EventListener);
            window.removeEventListener("bettershape-open-workspace-file", onOpenFile as EventListener);
            window.removeEventListener("bettershape-open-file-diff", onOpenDiff as EventListener);
        };
    }, [addTab, openDiff, openFile, openPlan]);
};

/** Syncs active backend file selection, PR selection, and Ctrl/Cmd+G shortcut to workspace tabs. */
const useWorkspaceSecondarySync = (
    activeFile: string | null,
    addTab: (kind: TabKind, opts?: { expand?: boolean }) => void,
    openFile: (path: string) => void,
) => {
    useEffect(() => {
        if (!activeFile || activeFile.startsWith("bettershape://")) return;
        if (isBrowserTab(activeFile)) addTab("files", { expand: true });
        else openFile(activeFile);
    }, [activeFile, addTab, openFile]);

    useEffect(() => {
        /** Opens the Pull Requests workspace tab whenever a PR item is selected. */
        const openDetail = () => {
            if (getPrUi().selectedId) addTab("prs", { expand: true });
        };
        openDetail();
        return subscribePrUi(openDetail);
    }, [addTab]);

    useEffect(() => {
        /** Focuses the Files workspace tab on Ctrl/Cmd+G outside text inputs. */
        const onKey = (e: KeyboardEvent) => {
            if (!isOpenFilesShortcut(e)) return;
            e.preventDefault();
            addTab("files", { expand: true });
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [addTab]);
};

/** Renders the AgentWorkspace UI component. */
export const AgentWorkspace = ({
    projectPath,
    expanded,
    onExpand,
}: {
    projectPath: string;
    expanded: boolean;
    onExpand: () => void;
}) => {
    const { active_file } = useProjectState();
    const [tabs, setTabs] = useState<WorkspaceTab[]>(DEFAULT_TABS);
    const [activeId, setActiveId] = useState("graph");

    // Tab mutations read the latest list synchronously so a new tab and its
    // active id always agree (state updaters run twice in dev and must be pure).
    const tabsRef = useRef(tabs);
    const activeIdRef = useRef(activeId);
    const onExpandRef = useRef(onExpand);
    useEffect(() => {
        onExpandRef.current = onExpand;
    }, [onExpand]);

    const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

    const commitTabs = useCallback((next: WorkspaceTab[], activate: string) => {
        tabsRef.current = next;
        activeIdRef.current = activate;
        setTabs(next);
        setActiveId(activate);
    }, []);

    const addTab = useCallback((kind: TabKind, opts?: { expand?: boolean }) => {
        if (NON_SINGLETON_TAB_KINDS.has(kind)) return;
        const title = ADDABLE_TAB_TITLES[kind] ?? kind;
        const prev = tabsRef.current;
        const existing = prev.find((t) => t.kind === kind);
        if (existing) commitTabs(prev, existing.id);
        else commitTabs([...prev, { id: kind, kind, title }], kind);
        if (opts?.expand) onExpandRef.current();
    }, [commitTabs]);

    const closeTab = useCallback((id: string) => {
        const prev = tabsRef.current;
        if (prev.length <= 1) return;
        const next = prev.filter((tab) => tab.id !== id);
        const activate = activeIdRef.current === id ? next[next.length - 1].id : activeIdRef.current;
        commitTabs(next, activate);
    }, [commitTabs]);

    const openFile = useCallback(
        (path: string) => {
            onExpandRef.current();
            const prev = tabsRef.current;
            const existing = prev.find((t) => t.kind === "file" && t.path === path);
            if (existing) {
                commitTabs(prev, existing.id);
                return;
            }
            const tab: WorkspaceTab = { id: uid("file"), kind: "file", title: tabTitleFromPath(path), path };
            commitTabs([...prev, tab], tab.id);
        },
        [commitTabs],
    );

    const openDiff = useCallback(
        (info: FileDiffTabInfo) => {
            onExpandRef.current();
            const prev = tabsRef.current;
            const existing = prev.find((t) => t.kind === "diff" && t.id === info.id);
            if (existing) {
                commitTabs(prev.map((t) => (t.id === existing.id ? { ...t, diff: info } : t)), existing.id);
                return;
            }
            const tab: WorkspaceTab = {
                id: info.id,
                kind: "diff",
                title: tabTitleFromPath(info.path),
                path: info.path,
                diff: info,
            };
            commitTabs([...prev, tab], tab.id);
        },
        [commitTabs],
    );

    const openPlan = useCallback(
        (path: string, title: string, markdown?: string) => {
            onExpandRef.current();
            const prev = tabsRef.current;
            const existing = prev.find((t) => t.kind === "plan" && t.path === path);
            if (existing) {
                commitTabs(
                    prev.map((t) => (t.id === existing.id ? { ...t, markdown: markdown ?? t.markdown } : t)),
                    existing.id,
                );
                return;
            }
            const tab: WorkspaceTab = { id: uid("plan"), kind: "plan", title: title || "Plan", path, markdown };
            commitTabs([...prev, tab], tab.id);
        },
        [commitTabs],
    );

    useWorkspaceEventChannels({ addTab, openDiff, openFile, openPlan });
    useWorkspaceSecondarySync(active_file, addTab, openFile);

    if (!expanded) return null;

    return (
        <aside className={`flex h-full w-full min-w-0 flex-col overflow-hidden bg-sidebar ${workspaceLayout.workspaceViewport}`}>
            <div className="flex h-titlebar shrink-0 items-stretch">
                <WorkspaceTabs
                    className="min-w-0 flex-1 bg-transparent"
                    tabs={tabs}
                    activeId={active.id}
                    onSelect={(id) => {
                        activeIdRef.current = id;
                        setActiveId(id);
                    }}
                    onClose={closeTab}
                    onNew={(kind) => addTab(kind, { expand: true })}
                    onReorder={(next) => commitTabs(next, activeIdRef.current)}
                />
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <div className="relative min-h-0 flex-1 overflow-hidden">
                    <WorkspaceTabBody
                        active={active}
                        projectPath={projectPath}
                        activeFile={active_file}
                        onOpenFile={openFile}
                        closeActiveTab={() => closeTab(active.id)}
                    />
                </div>
            </div>
        </aside>
    );
};
