"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";

import { BetterShapeLogo } from "@/components/ui/bettershape-logo";
import { GIT_WINDOW_TITLE_SLOT } from "@/features/git/ui/manager/chrome";
import { useProjectState } from "@/lib/backend";
import { useKeyboardShortcuts } from "@/lib/ui/shortcuts";
import type { RepoHistoryEntry } from "@/lib/workspace/repo-history";
import { useEditorBuffer } from "../hooks/use-editor-buffer";
import { useRepoHistory } from "../hooks/use-repo-history";
import { useWindowControls } from "../hooks/use-window-controls";
import { createMenuActionHandler } from "../menu-actions";
import type { TitlebarProps } from "../types";
import { TitlebarMenubar } from "./app-menu";
import { TitlebarUpdateButton } from "./update-button";
import { WindowControls } from "./window-controls";

/**
 * The width the first paint assumes.
 *
 * The bar is rendered before any window can be measured, and the menubar collapses on width,
 * so the snapshot has to name one rather than read one.
 */
const serverWindowWidth = () => 1200;

/** The live window width, which decides how much of the menubar fits. */
const getWindowWidth = () => window.innerWidth;

/** Width changes: the menubar re-decides once per resize, not once per frame. */
const subscribeWindowResize = (onChange: () => void) => {
    window.addEventListener("resize", onChange);
    return () => window.removeEventListener("resize", onChange);
};

/** The brand mark, with the menubar beside it unless the window is in focus mode. */
const TitlebarBrand = ({
    showMenu,
    windowWidth,
    onMenuAction,
    repoHistory,
    onClearHistory,
}: {
    showMenu: boolean;
    windowWidth: number;
    onMenuAction: (label: string) => void;
    repoHistory: RepoHistoryEntry[];
    onClearHistory: () => void;
}) => (
    <>
        <div className="flex shrink-0 items-center">
            <div className="window-appicon flex h-full w-5 ml-3 shrink-0 items-center justify-center">
                <BetterShapeLogo size={16} className="rounded-sm" />
            </div>
        </div>
        {showMenu ? (
            <TitlebarMenubar
                windowWidth={windowWidth}
                onAction={onMenuAction}
                repoHistory={repoHistory}
                onClearHistory={onClearHistory}
            />
        ) : null}
    </>
);

/**
 * The compact cluster: the brand mark, then whatever the window calls itself.
 *
 * The Git window has no title of its own; it publishes a slot in the bar instead, so the
 * repository's own titlebar can render there with the repo name, branch and sync state.
 */
const TitlebarCompactTitle = ({ title }: { title?: string }) => (
    <div className="relative z-20 flex h-full shrink-0 items-center">
        <div className="window-appicon flex h-full w-11 shrink-0 items-center justify-center">
            <BetterShapeLogo size={16} className="rounded-sm" />
        </div>
        {title === "Git" ? (
            <div id={GIT_WINDOW_TITLE_SLOT} className="flex min-w-0 items-center pr-2" />
        ) : title ? (
            <span className="pr-2 text-sm font-normal text-text-primary">{title}</span>
        ) : null}
    </div>
);

/**
 * The left half of the bar, in one of the two shapes a window can be in.
 *
 * Compact is a settings or onboarding window, which is named and has no menus; everything
 * else is the workbench, which has the menus and no name.
 */
const TitlebarLeft = ({
    compact,
    showMenu,
    title,
    windowWidth,
    onMenuAction,
    repoHistory,
    onClearHistory,
}: {
    compact: boolean;
    showMenu: boolean;
    title?: string;
    windowWidth: number;
    onMenuAction: (label: string) => void;
    repoHistory: RepoHistoryEntry[];
    onClearHistory: () => void;
}) => {
    if (compact) return <TitlebarCompactTitle title={title} />;

    return (
        <TitlebarBrand
            showMenu={showMenu}
            windowWidth={windowWidth}
            onMenuAction={onMenuAction}
            repoHistory={repoHistory}
            onClearHistory={onClearHistory}
        />
    );
};

/**
 * The window's titlebar: brand, menus, the update button and the window controls.
 *
 * The menu handler answers its own rejections rather than letting them out into an event
 * handler, because a command that fails reports the failure in the surface it touches; the
 * wrapper is memoised with the handler, so the menubar and the save-all listener keep one
 * identity across renders.
 */
const Titlebar = ({ onboarding, settings, focus, title }: TitlebarProps) => {
    useKeyboardShortcuts();

    const { active_file, project_path, open_files } = useProjectState();
    const compact = Boolean(onboarding || settings);
    const windowWidth = useSyncExternalStore(
        subscribeWindowResize,
        getWindowWidth,
        serverWindowWidth,
    );

    const { isMaximized, minimize, toggleMaximize, close, closeWindow } = useWindowControls();
    const { repoHistory, clearHistory } = useRepoHistory(project_path);
    const { readLatestContent } = useEditorBuffer();

    const handleMenuClick = useMemo(() => {
        const run = createMenuActionHandler({
            projectPath: project_path,
            activeFile: active_file,
            openFiles: open_files,
            readLatestContent,
            closeWindow,
        });
        return (label: string) => {
            run(label).catch(() => undefined);
        };
    }, [project_path, active_file, open_files, readLatestContent, closeWindow]);

    useEffect(() => {
        /**
         * Save All arrives as a window event from the shortcut layer.
         *
         * Block-bodied on purpose: a concise arrow here would hand React the promise as a
         * cleanup function, which it would then call on unmount.
         */
        const onSaveAll = () => {
            handleMenuClick("Save All");
        };
        window.addEventListener("save-all-request", onSaveAll);
        return () => window.removeEventListener("save-all-request", onSaveAll);
    }, [handleMenuClick]);

    return (
        <div
            className="titlebar-container relative flex h-titlebar w-full shrink-0 select-none items-center bg-background text-sm font-normal leading-none text-text-primary transition-[background-color] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
            data-tauri-drag-region
        >
            <div className="titlebar-left relative z-20 flex shrink-0 items-center" data-no-drag>
                <TitlebarLeft
                    compact={compact}
                    showMenu={!focus}
                    title={title}
                    windowWidth={windowWidth}
                    onMenuAction={handleMenuClick}
                    repoHistory={repoHistory}
                    onClearHistory={clearHistory}
                />
            </div>

            <div className="pointer-events-none min-w-0 flex-1" aria-hidden />

            <div
                className="titlebar-right relative z-20 flex h-full shrink-0 items-center gap-0.5 px-1"
                data-no-drag
            >
                {focus ? null : <TitlebarUpdateButton />}
                <WindowControls
                    isMaximized={isMaximized}
                    onMinimize={minimize}
                    onToggleMaximize={toggleMaximize}
                    onClose={close}
                />
            </div>
        </div>
    );
};

export default Titlebar;
