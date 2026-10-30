"use client";

import { useIsMounted } from "@/lib/ui/use-mounted";

import { useElementById } from "@/lib/ui/use-element-by-id";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import Chat from "@/features/chat/ui/chat";
import { useProjectState } from "@/lib/backend";
import { cn } from "@/lib/utils";
import { OverlayRootProvider } from "@/lib/ui/overlay-root";
import { AgentSidebar, AGENT_SIDEBAR_NAV_SLOT } from "./sidebar";
import { ChatList } from "./sidebar/chats";
import { AgentChrome } from "./chrome";
import { Status } from "./workbench/status";
import { AgentWorkspace } from "./workspace";
import { AgentOverlayView, type AgentOverlay } from "./overlay";
import { DevRunHost } from "@/features/terminal/dev-run-host";
import { TerminalDock } from "./terminal-dock";
import { ProjectQuickPickHost } from "@/features/chat/ui/shell/project-pick";
import { startAgentBackgroundExitToasts } from "@/features/chat/lib/agent-terminal-notify";
import { useWindowControls } from "@/features/agent/workbench/titlebar/hooks/use-window-controls";
import { WindowControls } from "@/features/agent/workbench/titlebar/ui/window-controls";
import { usePlatform } from "@/lib/platform";
import { useReducedMotion } from "@/lib/ui/use-reduced-motion";
import { normalizePath } from "@/lib/path/utils";
import { NewFilePromptHost } from "./workspace/new-file-prompt";
import { InterruptedTurns } from "./recovery/interrupted-turns";

const MIN_WORKSPACE = 360;
const MIN_WORKSPACE_SOFT = 280;
const MIN_CHAT = 380;
const SIDEBAR_EXPANDED = 304;
const MIN_SIDEBAR_WINDOW = SIDEBAR_EXPANDED + MIN_CHAT;
const WORKSPACE_GUTTER = 12;
const WINDOW_MIN_HEIGHT = 500;
const WINDOW_MIN_WIDTH = 1000;
const MAX_WORKSPACE_RATIO = 0.72;
const MAX_WORKSPACE_PX = 1200;
const SPLASH_KEY = "bettershape-agent-splash-seen";
const ZEN_KEY = "bettershape-zen-mode";

/** Keeps each open work area usable without shrinking the native window below its shell floor. */
function layoutMinWidth(sidebarOpen: boolean, workspaceOpen: boolean) {
    const sidebar = sidebarOpen ? SIDEBAR_EXPANDED : 0;
    const workspace = workspaceOpen ? MIN_WORKSPACE + WORKSPACE_GUTTER : 0;
    return Math.max(WINDOW_MIN_WIDTH, sidebar + MIN_CHAT + workspace);
}

function isFlyoutUiTarget(target: EventTarget | null) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest("[data-sidebar-peek], [data-sidebar-peek-toggle]"));
}

const WORKSPACE_TAB_TARGETS = new Set([
    "files",
    "explorer",
    "preview",
    "browser",
    "source",
    "graph",
    "git",
    "prs",
    "pulls",
    "agents",
]);

/** Reads initial layout preferences (`workspaceWidth`, `workspaceOpen`, `sidebarOpen`, `zenMode`, `splash`) from storage. */
const readStoredAgentLayoutPrefs = () => {
    try {
        const storedWidth = Number(localStorage.getItem("bettershape-agent-workspace-width"));
        return {
            workspaceWidth:
                storedWidth >= MIN_WORKSPACE && storedWidth <= MAX_WORKSPACE_PX
                    ? storedWidth
                    : undefined,
            workspaceOpen: localStorage.getItem("bettershape-agent-workspace") !== "false",
            sidebarOpen: localStorage.getItem("bettershape-agent-sidebar") !== "false",
            zenMode: localStorage.getItem(ZEN_KEY) === "1",
            splash: sessionStorage.getItem(SPLASH_KEY) !== "1",
        };
    } catch {
        return { workspaceOpen: true, sidebarOpen: true, zenMode: false, splash: false };
    }
};

/** Keeps the peek list mounted briefly after close so its spring exit can complete. */
const useSidebarPeekMount = (shown: boolean, reducedMotion: boolean) => {
    const [mounted, setMounted] = useState(shown);
    const shouldStayMounted = shown || (!reducedMotion && mounted);
    if (shouldStayMounted !== mounted) setMounted(shouldStayMounted);

    useEffect(() => {
        if (shown || !shouldStayMounted) return undefined;
        const timeoutId = window.setTimeout(() => setMounted(false), 160);
        return () => window.clearTimeout(timeoutId);
    }, [shown, shouldStayMounted]);

    return shouldStayMounted;
};

/** Renders the hover flyout sidebar rail peek when the primary sidebar is collapsed. */
const SidebarPeek = ({
    shown,
    onEnter,
    onLeave,
}: {
    shown: boolean;
    onEnter: () => void;
    onLeave: () => void;
}) => {
    const reducedMotion = useReducedMotion();
    const [host, setHost] = useState<HTMLElement>();
    const shouldRenderList = useSidebarPeekMount(shown, reducedMotion);
    const attachHost = useCallback((el: HTMLDivElement | null) => setHost(el ?? undefined), []);

    return (
        <div
            ref={attachHost}
            role="presentation"
            data-sidebar-peek=""
            aria-hidden={!shown}
            inert={!shown}
            className={cn(
                "fixed z-30 flex w-82 flex-col overflow-visible origin-left",
                "transition-[opacity,transform,translate] duration-[var(--spring-quick-dur)] ease-[var(--spring-quick)]",
                shown ? "opacity-100 translate-x-0" : "pointer-events-none opacity-0 -translate-x-1.5",
            )}
            style={{ top: 0, bottom: 8, left: 8 }}
            onMouseEnter={onEnter}
            onMouseLeave={(e) => {
                if (!isFlyoutUiTarget(e.relatedTarget)) onLeave();
            }}
        >
            <div className="h-titlebar w-10 shrink-0" aria-hidden />
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden squircle-2xl border border-border-subtle bg-sidebar shadow-md/40">
                {shouldRenderList && host ? (
                    <OverlayRootProvider value={host}>
                        <ChatList
                            onNewChat={() => {
                                window.dispatchEvent(new Event("bettershape-chat-new"));
                                window.dispatchEvent(new Event("bettershape-chat-focus-input"));
                            }}
                        />
                    </OverlayRootProvider>
                ) : null}
            </div>
        </div>
    );
};

/** Drives the one-time session splash fade-in and fade-out lifecycle. */
const useAgentSplashLifecycle = (
    splash: boolean,
    setSplash: React.Dispatch<React.SetStateAction<boolean>>,
    setSplashVisible: React.Dispatch<React.SetStateAction<boolean>>,
) => {
    useEffect(() => {
        if (!splash) return undefined;
        let t2: number | undefined;
        const raf = requestAnimationFrame(() => setSplashVisible(true));
        const t1 = window.setTimeout(() => {
            setSplashVisible(false);
            t2 = window.setTimeout(() => {
                try {
                    sessionStorage.setItem(SPLASH_KEY, "1");
                } catch {
                    /* ignore */
                }
                setSplash(false);
            }, 280);
        }, 700);
        return () => {
            cancelAnimationFrame(raf);
            window.clearTimeout(t1);
            if (t2 !== undefined) window.clearTimeout(t2);
        };
    }, [setSplash, setSplashVisible, splash]);
};

/** Syncs center-view, new-chat, active-file, and diff navigation events with layout overlay state. */
const useAgentOverlaySync = ({
    activeFile,
    overlay,
    setOverlay,
    persistWorkspace,
}: {
    activeFile: string | null;
    overlay: AgentOverlay;
    setOverlay: React.Dispatch<React.SetStateAction<AgentOverlay>>;
    persistWorkspace: (next: boolean) => void;
}) => {
    const prevActiveFile = useRef<string | null>(null);
    useEffect(() => {
        if (!activeFile || activeFile === prevActiveFile.current) {
            prevActiveFile.current = activeFile;
            return;
        }
        prevActiveFile.current = activeFile;
        setOverlay(null);
        persistWorkspace(true);
        window.dispatchEvent(
            new CustomEvent("bettershape-open-workspace-file", { detail: { path: activeFile } }),
        );
    }, [activeFile, persistWorkspace, setOverlay]);

    const overlayRef = useRef<AgentOverlay>(overlay);
    const pendingNewChatRef = useRef(false);
    useEffect(() => {
        overlayRef.current = overlay;
        if (overlay === null && pendingNewChatRef.current) {
            pendingNewChatRef.current = false;
            window.dispatchEvent(new Event("bettershape-chat-new"));
            window.dispatchEvent(new Event("bettershape-chat-focus-input"));
        }
    }, [overlay]);

    useEffect(() => {
        /** Dismisses any active overlay when switching center views (`editor` or `chat`). */
        const onView = (event: Event) => {
            const view = (event as CustomEvent<string>).detail;
            if (view === "editor" || view === "chat") {
                overlayRef.current = null;
                setOverlay(null);
                if (view === "editor") persistWorkspace(true);
            }
        };
        /** Closes any active overlay and schedules new-chat focus handoff once unmounted. */
        const onChatNew = () => {
            if (overlayRef.current === null) return;
            overlayRef.current = null;
            pendingNewChatRef.current = true;
            setOverlay(null);
        };
        /** Clears any active overlay and opens the workspace pane when viewing a file diff. */
        const onFileDiff = () => {
            overlayRef.current = null;
            setOverlay(null);
            persistWorkspace(true);
        };
        window.addEventListener("bettershape-center-view", onView as EventListener);
        window.addEventListener("bettershape-chat-new", onChatNew);
        window.addEventListener("bettershape-open-file-diff", onFileDiff as EventListener);
        return () => {
            window.removeEventListener("bettershape-center-view", onView as EventListener);
            window.removeEventListener("bettershape-chat-new", onChatNew);
            window.removeEventListener("bettershape-open-file-diff", onFileDiff as EventListener);
        };
    }, [persistWorkspace, setOverlay]);
};

const SIDEBAR_TOGGLE_IDS = new Set(["primary-sidebar", "agent-sidebar"]);
const WORKSPACE_TOGGLE_IDS = new Set(["secondary-sidebar", "agent-workspace"]);
const PANEL_OVERLAY_CLEAR_IDS = new Set(["panel", "terminal"]);
const EXPLORER_TOGGLE_IDS = new Set(["files-mode", "explorer"]);

/** Opens the explorer workspace tab and clears any center overlay. */
const openExplorerFromLayoutToggle = (
    persistWorkspace: (next: boolean) => void,
    setOverlay: React.Dispatch<React.SetStateAction<AgentOverlay>>,
) => {
    setOverlay(null);
    persistWorkspace(true);
    window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("bettershape-set-active-tab", { detail: "files" }));
    }, 80);
};

/** Applies an explicit boolean or toggle action to the secondary workspace pane. */
const applyWorkspaceToggleValue = (
    value: boolean | undefined,
    persistWorkspace: (next: boolean) => void,
    toggleWorkspace: () => void,
) => {
    if (typeof value === "boolean") persistWorkspace(value);
    else toggleWorkspace();
};

/** Dispatches layout toggle detail payloads to sidebar, workspace, terminal, or explorer actions. */
const dispatchAgentLayoutToggle = ({
    detail,
    toggleSidebar,
    toggleWorkspace,
    persistWorkspace,
    setOverlay,
}: {
    detail: { id?: string; value?: boolean } | null | undefined;
    toggleSidebar: () => void;
    toggleWorkspace: () => void;
    persistWorkspace: (next: boolean) => void;
    setOverlay: React.Dispatch<React.SetStateAction<AgentOverlay>>;
}) => {
    const id = detail ? detail.id || "" : "";
    const handlers: Array<[ReadonlySet<string>, () => void]> = [
        [SIDEBAR_TOGGLE_IDS, toggleSidebar],
        [WORKSPACE_TOGGLE_IDS, () => applyWorkspaceToggleValue(detail?.value, persistWorkspace, toggleWorkspace)],
        [PANEL_OVERLAY_CLEAR_IDS, () => setOverlay(null)],
        [EXPLORER_TOGGLE_IDS, () => openExplorerFromLayoutToggle(persistWorkspace, setOverlay)],
    ];
    const matched = handlers.find(([ids]) => ids.has(id));
    if (matched) matched[1]();
};
/** Handles layout-toggle, overlay, pull-request, terminal, zen-mode, and layout-reset window events. */
const useAgentLayoutWindowChannels = ({
    projectPath,
    persistWorkspace,
    toggleSidebar,
    toggleWorkspace,
    setOverlay,
    setSidebarOpen,
    setZenMode,
    setDesiredWorkspaceWidth,
    setWorkspaceWidth,
    setWorkspaceFits,
    widthRef,
}: {
    projectPath: string | null;
    persistWorkspace: (next: boolean) => void;
    toggleSidebar: () => void;
    toggleWorkspace: () => void;
    setOverlay: React.Dispatch<React.SetStateAction<AgentOverlay>>;
    setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setZenMode: React.Dispatch<React.SetStateAction<boolean>>;
    setDesiredWorkspaceWidth: React.Dispatch<React.SetStateAction<number>>;
    setWorkspaceWidth: React.Dispatch<React.SetStateAction<number>>;
    setWorkspaceFits: React.Dispatch<React.SetStateAction<boolean>>;
    widthRef: React.MutableRefObject<number>;
}) => {
    useEffect(() => {
        /** Opens the right workspace when a workspace-hosted tab id is requested. */
        const onTab = (e: Event) => {
            const tabId = (e as CustomEvent<string>).detail?.toLowerCase();
            if (tabId && projectPath && WORKSPACE_TAB_TARGETS.has(tabId)) {
                setOverlay(null);
                persistWorkspace(true);
            }
        };
        /** Dispatches sidebar, workspace, terminal, and explorer layout toggle commands. */
        const onToggle = (e: Event) => {
            dispatchAgentLayoutToggle({
                detail: (e as CustomEvent<{ id?: string; value?: boolean }>).detail,
                toggleSidebar,
                toggleWorkspace,
                persistWorkspace,
                setOverlay,
            });
        };
        /** Opens or clears center overlays (`settings`, `git` -> `graph`, etc.). */
        const onOverlay = (e: Event) => {
            const detail = (e as CustomEvent<AgentOverlay>).detail;
            if (!detail?.type) {
                setOverlay(null);
                return;
            }
            if (detail.type === "git") {
                setOverlay(null);
                persistWorkspace(true);
                window.setTimeout(() => {
                    window.dispatchEvent(new CustomEvent("bettershape-set-active-tab", { detail: "graph" }));
                }, 80);
                return;
            }
            setOverlay(detail);
            setSidebarOpen(true);
            try {
                localStorage.setItem("bettershape-agent-sidebar", "true");
            } catch {
                /* ignore */
            }
        };
        /** Opens the Pull Requests workspace tab and clears any overlay. */
        const onPrs = () => {
            setOverlay(null);
            persistWorkspace(true);
            window.dispatchEvent(new CustomEvent("bettershape-set-active-tab", { detail: "prs" }));
        };
        window.addEventListener("bettershape-set-active-tab", onTab as EventListener);
        window.addEventListener("bettershape-layout-toggle", onToggle as EventListener);
        window.addEventListener("bettershape-agent-overlay", onOverlay as EventListener);
        window.addEventListener("bettershape-open-pull-requests", onPrs);
        return () => {
            window.removeEventListener("bettershape-set-active-tab", onTab as EventListener);
            window.removeEventListener("bettershape-layout-toggle", onToggle as EventListener);
            window.removeEventListener("bettershape-agent-overlay", onOverlay as EventListener);
            window.removeEventListener("bettershape-open-pull-requests", onPrs);
        };
    }, [persistWorkspace, projectPath, setOverlay, setSidebarOpen, toggleSidebar, toggleWorkspace]);

    useEffect(() => {
        /** Opens the chat-column terminal dock and dismisses any center overlay. */
        const openWorkspaceTerminal = () => {
            setOverlay(null);
            window.dispatchEvent(
                new CustomEvent("bettershape-layout-toggle", { detail: { id: "terminal", value: true } }),
            );
        };
        /** Opens the terminal dock on global terminal shortcut events. */
        const onShortcut = (e: Event) => {
            const action = (e as CustomEvent<{ action?: string } | null>).detail?.action;
            if (!action || action === "open" || action === "toggle") openWorkspaceTerminal();
        };
        /** Restores default panes, widths, and zen mode on `bettershape-layout-reset`. */
        const onReset = () => {
            setZenMode(false);
            setDesiredWorkspaceWidth(560);
            setWorkspaceWidth(560);
            widthRef.current = 560;
            setWorkspaceFits(true);
            persistWorkspace(true);
            setSidebarOpen(true);
            try {
                localStorage.setItem(ZEN_KEY, "0");
                localStorage.setItem("bettershape-agent-sidebar", "true");
                localStorage.removeItem("bettershape-agent-workspace-width");
            } catch {
                /* ignore */
            }
        };
        /** Toggles zen mode without mutating saved sidebar/workspace preferences. */
        const onZen = () => {
            setZenMode((prev) => {
                const next = !prev;
                try {
                    localStorage.setItem(ZEN_KEY, next ? "1" : "0");
                } catch {
                    /* ignore */
                }
                return next;
            });
        };
        window.addEventListener("bettershape-open-workspace-terminal", openWorkspaceTerminal);
        window.addEventListener("bettershape-terminal-shortcut", onShortcut as EventListener);
        window.addEventListener("bettershape-layout-reset", onReset);
        window.addEventListener("bettershape-toggle-zen-mode", onZen);
        return () => {
            window.removeEventListener("bettershape-open-workspace-terminal", openWorkspaceTerminal);
            window.removeEventListener("bettershape-terminal-shortcut", onShortcut as EventListener);
            window.removeEventListener("bettershape-layout-reset", onReset);
            window.removeEventListener("bettershape-toggle-zen-mode", onZen);
        };
    }, [
        persistWorkspace,
        projectPath,
        setDesiredWorkspaceWidth,
        setOverlay,
        setSidebarOpen,
        setWorkspaceFits,
        setWorkspaceWidth,
        setZenMode,
        widthRef,
    ]);
};

/** Handles workspace separator drag resizing, viewport clamping, and Tauri native min-width enforcement. */
const useAgentWorkspaceGeometry = ({
    projectPath,
    sidebarOpen,
    workspaceOpen,
    clampWorkspace,
    draggingRef,
    widthRef,
    setIsResizing,
    setSidebarFits,
    setWorkspaceFits,
    setDesiredWorkspaceWidth,
    setWorkspaceWidth,
}: {
    projectPath: string | null;
    sidebarOpen: boolean;
    workspaceOpen: boolean;
    clampWorkspace: (x: number, winW?: number) => number;
    draggingRef: React.MutableRefObject<boolean>;
    widthRef: React.MutableRefObject<number>;
    setIsResizing: React.Dispatch<React.SetStateAction<boolean>>;
    setSidebarFits: React.Dispatch<React.SetStateAction<boolean>>;
    setWorkspaceFits: React.Dispatch<React.SetStateAction<boolean>>;
    setDesiredWorkspaceWidth: React.Dispatch<React.SetStateAction<number>>;
    setWorkspaceWidth: React.Dispatch<React.SetStateAction<number>>;
}) => {
    useEffect(() => {
        /** Updates workspace width during separator drag. */
        const onMove = (e: MouseEvent) => {
            if (!draggingRef.current) return;
            const next = clampWorkspace(window.innerWidth - e.clientX);
            if (next < MIN_WORKSPACE_SOFT) return;
            widthRef.current = next;
            setDesiredWorkspaceWidth(next);
            setWorkspaceWidth(next);
        };
        /** Commits workspace width on mouseup and clears drag cursor styles. */
        const onUp = () => {
            if (!draggingRef.current) return;
            draggingRef.current = false;
            setIsResizing(false);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            try {
                localStorage.setItem("bettershape-agent-workspace-width", String(widthRef.current));
            } catch {
                /* ignore */
            }
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
    }, [clampWorkspace, draggingRef, setDesiredWorkspaceWidth, setIsResizing, setWorkspaceWidth, widthRef]);

    useEffect(() => {
        /** Clamps workspace width and sidebar fit whenever the viewport or native window resizes. */
        const apply = () => {
            setSidebarFits(window.innerWidth >= MIN_SIDEBAR_WINDOW);
            const next = clampWorkspace(widthRef.current);
            setWorkspaceFits(next > 0);
            if (next > 0) setWorkspaceWidth((prev) => (prev === next ? prev : next));
        };
        apply();
        window.addEventListener("resize", apply);
        let unlisten: (() => void) | undefined;
        let cancelled = false;
        import("@tauri-apps/api/window")
            .then(async ({ getCurrentWindow }) => {
                const stop = await getCurrentWindow().listen("tauri://resize", apply);
                if (cancelled) stop();
                else unlisten = stop;
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
            window.removeEventListener("resize", apply);
            unlisten?.();
        };
    }, [clampWorkspace, setSidebarFits, setWorkspaceFits, setWorkspaceWidth, sidebarOpen, widthRef]);

    useEffect(() => {
        const minWidth = layoutMinWidth(sidebarOpen, workspaceOpen && Boolean(projectPath));
        let cancelled = false;
        import("@tauri-apps/api/window")
            .then(async ({ getCurrentWindow }) => {
                const { LogicalSize } = await import("@tauri-apps/api/dpi");
                const win = getCurrentWindow();
                await win.setMinSize(new LogicalSize(minWidth, WINDOW_MIN_HEIGHT));
                const maximized = cancelled || (await win.isMaximized().catch(() => false));
                if (maximized) return;
                const factor = await win.scaleFactor();
                const inner = await win.innerSize();
                if (inner.width / factor + 1 < minWidth) {
                    await win.setSize(new LogicalSize(minWidth, inner.height / factor));
                }
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [projectPath, sidebarOpen, workspaceOpen]);
};

/** Renders the one-time startup logo splash overlay when active. */
const AgentStartupSplash = ({ splash, splashVisible }: { splash: boolean; splashVisible: boolean }) => {
    if (!splash) return null;
    const opacityClass = splashVisible ? "opacity-100" : "opacity-0";
    return (
        <div
            className={cn(
                "pointer-events-none absolute inset-0 z-[100] flex items-center justify-center bg-transparent",
                "transition-opacity duration-300 ease-[var(--ease-out)]",
                opacityClass,
            )}
            aria-hidden
        >
            <Image
                src="/logos/logo.png"
                alt="BetterShape"
                width={52}
                height={52}
                priority
                style={{ width: 52, height: 52 }}
                className={cn("logo-invert transition-opacity duration-500 ease-[var(--ease-out)]", opacityClass)}
            />
        </div>
    );
};

/** Renders the primary center surface (`AgentOverlayView`, project `Chat`, or fallback `children`). */
const AgentCenterViewport = ({
    overlay,
    projectPath,
    navSlot,
    sidebarOpen,
    onCloseOverlay,
    children,
}: {
    overlay: AgentOverlay;
    projectPath: string | null;
    navSlot: HTMLElement | null;
    sidebarOpen: boolean;
    onCloseOverlay: () => void;
    children: React.ReactNode;
}) => {
    if (overlay) {
        return (
            <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
                <AgentOverlayView
                    overlay={overlay}
                    onClose={onCloseOverlay}
                    navPortalTarget={navSlot}
                    sidebarExpanded={sidebarOpen}
                />
            </div>
        );
    }
    if (projectPath) {
        return (
            <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
                <Chat key={normalizePath(projectPath).toLowerCase()} className="bg-transparent" />
            </div>
        );
    }
    return (
        <div className="h-full overflow-hidden bg-transparent" data-tauri-drag-region>
            {children}
        </div>
    );
};

/** Computes hairline highlight tone for the vertical workspace separator. */
const workspaceHairlineTone = (rightExpanded: boolean, isResizing: boolean): string => {
    if (isResizing) return "bg-accent/60";
    return rightExpanded ? "group-hover:bg-accent/40" : "";
};

/** Computes class names and inline width for the right-hand workspace dock. */
const deriveWorkspaceDockChrome = (rightExpanded: boolean, isResizing: boolean, workspaceWidth: number) => ({
    separatorClass: cn("group relative z-30 w-0 shrink-0", !rightExpanded && "pointer-events-none opacity-0"),
    hairlineClass: cn(
        "pointer-events-none absolute inset-y-3 left-0 w-px transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]",
        workspaceHairlineTone(rightExpanded, isResizing),
    ),
    outerWidth: rightExpanded ? workspaceWidth + 12 : 0,
    outerClass: cn(
        "h-full min-w-0 overflow-hidden",
        rightExpanded ? "py-2 pr-2" : "pointer-events-none p-0",
        !isResizing && "transition-[width] duration-[var(--spring-quick-dur)] ease-[var(--spring-quick)]",
    ),
});

/** Renders the resizable right-hand workspace pane and its vertical drag separator. */
const AgentWorkspaceDock = ({
    showWorkspace,
    projectPath,
    rightExpanded,
    isResizing,
    workspaceWidth,
    onStartResize,
    onExpand,
}: {
    showWorkspace: boolean;
    projectPath: string | null;
    rightExpanded: boolean;
    isResizing: boolean;
    workspaceWidth: number;
    onStartResize: (e: React.MouseEvent) => void;
    onExpand: () => void;
}) => {
    if (!showWorkspace || !projectPath) return null;
    const chrome = deriveWorkspaceDockChrome(rightExpanded, isResizing, workspaceWidth);
    return (
        <>
            <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize workspace"
                className={chrome.separatorClass}
                onMouseDown={onStartResize}
            >
                <div className="absolute inset-y-3 -left-1.5 w-3 cursor-col-resize" />
                <div aria-hidden className={chrome.hairlineClass} />
            </div>
            <div
                style={{ width: chrome.outerWidth, flex: "0 0 auto" }}
                className={chrome.outerClass}
                aria-hidden={!rightExpanded}
            >
                {rightExpanded ? (
                    <div
                        style={{ width: workspaceWidth }}
                        className="relative flex h-full overflow-hidden rounded-xl bg-sidebar border border-border-subtle"
                    >
                        <AgentWorkspace projectPath={projectPath} expanded onExpand={onExpand} />
                    </div>
                ) : null}
            </div>
        </>
    );
};

/** Applies a hydrated workspace width to both desired width and viewport-clamped active width. */
const applyHydratedWorkspaceWidth = ({
    storedWidth,
    clampWorkspace,
    setDesiredWorkspaceWidth,
    setWorkspaceWidth,
    setWorkspaceFits,
}: {
    storedWidth: number | undefined;
    clampWorkspace: (x: number, winW?: number) => number;
    setDesiredWorkspaceWidth: React.Dispatch<React.SetStateAction<number>>;
    setWorkspaceWidth: React.Dispatch<React.SetStateAction<number>>;
    setWorkspaceFits: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
    if (storedWidth === undefined) return;
    setDesiredWorkspaceWidth(storedWidth);
    const clamped = clampWorkspace(storedWidth);
    setWorkspaceFits(clamped > 0);
    if (clamped > 0) setWorkspaceWidth(clamped);
};

/** Hydrates saved layout preferences once on the client without hydration mismatch. */
const useHydratedAgentLayoutPrefs = ({
    clampWorkspace,
    setDesiredWorkspaceWidth,
    setWorkspaceWidth,
    setWorkspaceFits,
    setWorkspaceOpen,
    setSidebarOpen,
    setZenMode,
    setSplash,
}: {
    clampWorkspace: (x: number, winW?: number) => number;
    setDesiredWorkspaceWidth: React.Dispatch<React.SetStateAction<number>>;
    setWorkspaceWidth: React.Dispatch<React.SetStateAction<number>>;
    setWorkspaceFits: React.Dispatch<React.SetStateAction<boolean>>;
    setWorkspaceOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setZenMode: React.Dispatch<React.SetStateAction<boolean>>;
    setSplash: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
    const hydrated = useIsMounted();
    const [restoredPreferences, setRestoredPreferences] = useState(false);
    if (!hydrated || restoredPreferences) return;
    setRestoredPreferences(true);
    const prefs = readStoredAgentLayoutPrefs();
    applyHydratedWorkspaceWidth({
        storedWidth: prefs.workspaceWidth,
        clampWorkspace,
        setDesiredWorkspaceWidth,
        setWorkspaceWidth,
        setWorkspaceFits,
    });
    setWorkspaceOpen(prefs.workspaceOpen);
    setSidebarOpen(prefs.sidebarOpen);
    setZenMode(prefs.zenMode);
    if (prefs.splash) setSplash(true);
};

/** Checks whether the right-hand workspace pane fits and is unhidden by Zen mode. */
const isWorkspacePaneAvailable = (workspaceOpen: boolean, workspaceFits: boolean, zenMode: boolean): boolean => {
    if (zenMode || !workspaceOpen) return false;
    return workspaceFits;
};

/** Checks whether the left-hand sidebar fits and is unhidden by Zen mode. */
const isSidebarPaneAvailable = (sidebarOpen: boolean, sidebarFits: boolean, zenMode: boolean): boolean => {
    if (zenMode || !sidebarOpen) return false;
    return sidebarFits;
};

/** Computes boolean pane visibility flags for `AgentLayout`. */
const deriveAgentLayoutFlags = ({
    projectPath,
    overlay,
    workspaceOpen,
    workspaceFits,
    sidebarOpen,
    sidebarFits,
    zenMode,
}: {
    projectPath: string | null;
    overlay: AgentOverlay;
    workspaceOpen: boolean;
    workspaceFits: boolean;
    sidebarOpen: boolean;
    sidebarFits: boolean;
    zenMode: boolean;
}) => {
    const overlayOpen = overlay != null;
    const hasProject = Boolean(projectPath);
    const showWorkspace = hasProject && !overlayOpen;
    const available = isWorkspacePaneAvailable(workspaceOpen, workspaceFits, zenMode);
    return {
        overlayOpen,
        hasProject,
        showWorkspace,
        rightExpanded: showWorkspace && available,
        sidebarShown: isSidebarPaneAvailable(sidebarOpen, sidebarFits, zenMode),
    };
};

/** Encapsulates sidebar, flyout, and workspace toggle callbacks plus clamping math for `AgentLayout`. */
/** Clears any pending narrow-flyout close timer. */
const clearFlyoutTimer = (timerRef: React.MutableRefObject<number | null>) => {
    if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
    }
};

/** Toggles the narrow sidebar flyout while keeping the first click after hover open. */
const toggleNarrowSidebarFlyout = (
    timerRef: React.MutableRefObject<number | null>,
    hoverLatchedRef: React.MutableRefObject<boolean>,
    setSidebarFlyout: React.Dispatch<React.SetStateAction<boolean>>,
) => {
    clearFlyoutTimer(timerRef);
    if (hoverLatchedRef.current) {
        hoverLatchedRef.current = false;
        setSidebarFlyout(true);
        return;
    }
    setSidebarFlyout((prev) => !prev);
};

/** Dismisses the narrow sidebar flyout when Escape is pressed. */
const useNarrowFlyoutEscapeDismiss = (
    active: boolean,
    onDismiss: () => void,
) => {
    useEffect(() => {
        if (!active) return undefined;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") onDismiss();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [active, onDismiss]);
};

const useAgentLayoutPaneControllers = ({
    projectPath,
    sidebarOpen,
    sidebarFits,
    setSidebarOpen,
    setSidebarFlyout,
    setWorkspaceOpen,
}: {
    projectPath: string | null;
    sidebarOpen: boolean;
    sidebarFits: boolean;
    setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setSidebarFlyout: React.Dispatch<React.SetStateAction<boolean>>;
    setWorkspaceOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
    const flyoutTimerRef = useRef<number | null>(null);
    const flyoutHoverLatchedRef = useRef(false);
    const persistWorkspace = useCallback((next: boolean) => {
        setWorkspaceOpen(next);
        try {
            localStorage.setItem("bettershape-agent-workspace", String(next));
        } catch {
            /* ignore */
        }
    }, [setWorkspaceOpen]);

    const clampWorkspace = useCallback(
        (x: number, winW = typeof window === "undefined" ? 1280 : window.innerWidth) => {
            const sidebar = sidebarOpen && winW >= MIN_SIDEBAR_WINDOW ? SIDEBAR_EXPANDED : 0;
            const maxByChat = Math.max(0, winW - sidebar - MIN_CHAT - WORKSPACE_GUTTER);
            const maxByRatio = Math.min(MAX_WORKSPACE_PX, Math.floor(winW * MAX_WORKSPACE_RATIO));
            const max = Math.min(maxByChat, maxByRatio);
            return max < MIN_WORKSPACE_SOFT ? 0 : Math.min(max, Math.max(MIN_WORKSPACE_SOFT, x));
        },
        [sidebarOpen],
    );

    const toggleSidebar = useCallback(() => {
        if (!sidebarFits) {
            toggleNarrowSidebarFlyout(flyoutTimerRef, flyoutHoverLatchedRef, setSidebarFlyout);
            return;
        }
        flyoutHoverLatchedRef.current = false;
        setSidebarFlyout(false);
        setSidebarOpen((prev) => {
            const next = !prev;
            try {
                localStorage.setItem("bettershape-agent-sidebar", String(next));
            } catch {
                /* ignore */
            }
            return next;
        });
    }, [sidebarFits, setSidebarFlyout, setSidebarOpen]);

    const openSidebarFlyout = useCallback(() => {
        clearFlyoutTimer(flyoutTimerRef);
        setSidebarFlyout((prev) => {
            if (!prev) flyoutHoverLatchedRef.current = true;
            return true;
        });
    }, [setSidebarFlyout]);

    const closeSidebarFlyout = useCallback(() => {
        flyoutHoverLatchedRef.current = false;
        clearFlyoutTimer(flyoutTimerRef);
        flyoutTimerRef.current = window.setTimeout(() => setSidebarFlyout(false), 180);
    }, [setSidebarFlyout]);

    const dismissSidebarFlyout = useCallback(() => {
        flyoutHoverLatchedRef.current = false;
        clearFlyoutTimer(flyoutTimerRef);
        setSidebarFlyout(false);
    }, [setSidebarFlyout]);

    const toggleWorkspace = useCallback(() => {
        if (!projectPath) return;
        setWorkspaceOpen((prev) => {
            const next = !prev;
            try {
                localStorage.setItem("bettershape-agent-workspace", String(next));
            } catch {
                /* ignore */
            }
            return next;
        });
    }, [projectPath, setWorkspaceOpen]);

    return {
        persistWorkspace,
        clampWorkspace,
        toggleSidebar,
        openSidebarFlyout,
        closeSidebarFlyout,
        dismissSidebarFlyout,
        toggleWorkspace,
    };
};

/** Renders the main center + workspace shell column inside `AgentLayout`. */
const AgentMainShellColumn = ({
    flags,
    projectPath,
    overlay,
    navSlot,
    sidebarOpen,
    isResizing,
    workspaceWidth,
    onStartResize,
    setOverlay,
    controllers,
    windowControls,
    children,
}: {
    flags: ReturnType<typeof deriveAgentLayoutFlags>;
    projectPath: string | null;
    overlay: AgentOverlay;
    navSlot: HTMLElement | null;
    sidebarOpen: boolean;
    isResizing: boolean;
    workspaceWidth: number;
    onStartResize: (e: React.MouseEvent) => void;
    setOverlay: React.Dispatch<React.SetStateAction<AgentOverlay>>;
    controllers: ReturnType<typeof useAgentLayoutPaneControllers>;
    windowControls: {
        isMaximized: boolean;
        onMinimize: () => void;
        onToggleMaximize: () => void;
        onClose: () => void;
    };
    children: React.ReactNode;
}) => (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel rounded-xl border-l border-border">
        <AgentChrome
            rightOpen={flags.rightExpanded}
            onToggleRight={controllers.toggleWorkspace}
            canToggleRight={flags.showWorkspace}
            showRightToggle={!flags.overlayOpen}
            padWindowControls
            sidebarOpen={sidebarOpen}
            onToggleSidebar={controllers.toggleSidebar}
            onSidebarHoverStart={controllers.openSidebarFlyout}
            onSidebarHoverEnd={controllers.closeSidebarFlyout}
            windowControls={windowControls}
        />
        <InterruptedTurns />
        <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <AgentCenterViewport
                    overlay={overlay}
                    projectPath={projectPath}
                    navSlot={navSlot}
                    sidebarOpen={sidebarOpen}
                    onCloseOverlay={() => setOverlay(null)}
                >
                    {children}
                </AgentCenterViewport>
                {flags.hasProject ? <TerminalDock suppressed={flags.overlayOpen} /> : null}
            </div>
            <AgentWorkspaceDock
                showWorkspace={flags.showWorkspace}
                projectPath={projectPath}
                rightExpanded={flags.rightExpanded}
                isResizing={isResizing}
                workspaceWidth={workspaceWidth}
                onStartResize={onStartResize}
                onExpand={() => controllers.persistWorkspace(true)}
            />
        </div>
        {flags.hasProject ? <Status /> : null}
    </div>
);

/**
 * Agent View, left sidebar (agent / settings / git / files nav),
 * center chrome + content; expanded workspace is full-height; rail under chrome.
 */
export const AgentLayout = ({ children }: { children: React.ReactNode }) => {
    const { project_path, active_file } = useProjectState();
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [workspaceOpen, setWorkspaceOpen] = useState(true);
    const [zenMode, setZenMode] = useState(false);
    const [overlay, setOverlay] = useState<AgentOverlay>(null);
    const [desiredWorkspaceWidth, setDesiredWorkspaceWidth] = useState(560);
    const [workspaceWidth, setWorkspaceWidth] = useState(560);
    const [workspaceFits, setWorkspaceFits] = useState(true);
    const [sidebarFits, setSidebarFits] = useState(true);
    const [splash, setSplash] = useState(false);
    const [splashVisible, setSplashVisible] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const [sidebarFlyout, setSidebarFlyout] = useState(false);
    const draggingRef = useRef(false);
    const widthRef = useRef(560);
    useLayoutEffect(() => { widthRef.current = desiredWorkspaceWidth; }, [desiredWorkspaceWidth]);

    const controllers = useAgentLayoutPaneControllers({
        projectPath: project_path,
        sidebarOpen,
        sidebarFits,
        setSidebarOpen,
        setSidebarFlyout,
        setWorkspaceOpen,
    });

    useHydratedAgentLayoutPrefs({
        clampWorkspace: controllers.clampWorkspace,
        setDesiredWorkspaceWidth,
        setWorkspaceWidth,
        setWorkspaceFits,
        setWorkspaceOpen,
        setSidebarOpen,
        setZenMode,
        setSplash,
    });

    useEffect(() => {
        if (!project_path) return;
        import("@/features/preview/lib/project-warm")
            .then(({ warmProjectAnalysis }) => warmProjectAnalysis(project_path).catch(() => undefined))
            .catch(() => undefined);
    }, [project_path]);

    useEffect(() => startAgentBackgroundExitToasts(), []);
    useAgentSplashLifecycle(splash, setSplash, setSplashVisible);

    const navSlot = useElementById(AGENT_SIDEBAR_NAV_SLOT, Boolean(overlay));

    useAgentOverlaySync({
        activeFile: active_file,
        overlay,
        setOverlay,
        persistWorkspace: controllers.persistWorkspace,
    });
    useAgentLayoutWindowChannels({
        projectPath: project_path,
        persistWorkspace: controllers.persistWorkspace,
        toggleSidebar: controllers.toggleSidebar,
        toggleWorkspace: controllers.toggleWorkspace,
        setOverlay,
        setSidebarOpen,
        setZenMode,
        setDesiredWorkspaceWidth,
        setWorkspaceWidth,
        setWorkspaceFits,
        widthRef,
    });
    useAgentWorkspaceGeometry({
        projectPath: project_path,
        sidebarOpen,
        workspaceOpen,
        clampWorkspace: controllers.clampWorkspace,
        draggingRef,
        widthRef,
        setIsResizing,
        setSidebarFits,
        setWorkspaceFits,
        setDesiredWorkspaceWidth,
        setWorkspaceWidth,
    });

    const flags = deriveAgentLayoutFlags({
        projectPath: project_path,
        overlay,
        workspaceOpen,
        workspaceFits,
        sidebarOpen,
        sidebarFits,
        zenMode,
    });
    useNarrowFlyoutEscapeDismiss(!flags.sidebarShown && sidebarFlyout, controllers.dismissSidebarFlyout);
    const { isMaximized, minimize, toggleMaximize, close } = useWindowControls();
    const isMac = usePlatform() === "macos";
    const winControls = {
        isMaximized,
        onMinimize: minimize,
        onToggleMaximize: () => { toggleMaximize().catch(() => undefined); },
        onClose: close,
    };
    const startWorkspaceResize = useCallback(
        (e: React.MouseEvent) => {
            if (!flags.rightExpanded) return;
            e.preventDefault();
            draggingRef.current = true;
            setIsResizing(true);
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
        },
        [flags.rightExpanded],
    );

    return (
        <div className="relative flex h-full min-h-0 w-full overflow-hidden bg-sidebar">
            <DevRunHost />
            <ProjectQuickPickHost />
            <NewFilePromptHost />
            <AgentStartupSplash splash={splash} splashVisible={splashVisible} />

            <AgentSidebar
                expanded
                open={flags.sidebarShown}
                overlay={overlay}
                onToggleSidebar={controllers.toggleSidebar}
                onSearch={() => {
                    window.dispatchEvent(
                        new CustomEvent("bettershape-command-palette", { detail: { placeholder: "Search..." } }),
                    );
                }}
            />
            {flags.sidebarShown ? null : (
                <SidebarPeek
                    shown={sidebarFlyout}
                    onEnter={controllers.openSidebarFlyout}
                    onLeave={controllers.closeSidebarFlyout}
                />
            )}

            <AgentMainShellColumn
                flags={flags}
                projectPath={project_path}
                overlay={overlay}
                navSlot={navSlot}
                sidebarOpen={flags.sidebarShown}
                isResizing={isResizing}
                workspaceWidth={workspaceWidth}
                onStartResize={startWorkspaceResize}
                setOverlay={setOverlay}
                controllers={controllers}
                windowControls={winControls}
            >
                {children}
            </AgentMainShellColumn>
            {isMac ? null : (
                <WindowControls
                    isMaximized={isMaximized}
                    onMinimize={minimize}
                    onToggleMaximize={winControls.onToggleMaximize}
                    onClose={close}
                    surface="panel"
                    spacer={false}
                />
            )}
        </div>
    );
};
