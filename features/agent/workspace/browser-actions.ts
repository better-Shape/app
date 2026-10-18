"use client";

import type { Dispatch, RefObject, SetStateAction } from "react";

import { commands } from "@/lib/backend";
import { notificationStore } from "@/features/notifications";
import { hostnameOf } from "@/lib/ui/favicon";
import type { BrowseFrame } from "@/features/agent/browser/session";
import type { ColorScheme, PageTab } from "./browser-storage";
import type { BrowserActions } from "./browser-chrome";
import { frameOrigin, steerFrame } from "./browser-frame";
import type { ToolsState } from "./browser-hooks";
import { newTabAtUrl, tabAtHistoryStep, tabAtUrl } from "./browser-tabs";
import { resolveBrowserInput } from "@/features/agent/browser/store";

/** How long after a back or forward press the frame's own reports count as travel. */
const TRAVEL_WINDOW_MS = 800;

/**
 * Asks the frame to move in its history, on both routes.
 *
 * The host script handles the move inside the page where the platform can inject into it, and
 * the frame is pointed at the URL where it cannot, so both are sent rather than one.
 */
const postHistory = (frame: HTMLIFrameElement | null, delta: number, url: string) => {
    frame?.contentWindow?.postMessage(
        { type: "bettershape-browser-host", history: delta < 0 ? "back" : "forward", goto: url },
        frameOrigin(frame),
    );
    steerFrame(frame, "goto", url);
};

/** Tells the frame to reload from here, which is the half the host script cannot do itself. */
const postReload = (frame: HTMLIFrameElement | null) => {
    frame?.contentWindow?.postMessage(
        { type: "bettershape-browser-host", reload: true },
        frameOrigin(frame),
    );
    steerFrame(frame, "reload");
};

/** The title the star saves with the page, falling back to the host when the page has none. */
const bookmarkTitleOf = (agentFrame: BrowseFrame | null, active: PageTab | null, url: string) =>
    (agentFrame?.title ?? active?.title) || hostnameOf(url);

/** The reason the developer tools did not open, in the words the panel shows. */
const toolsRefusal = (error: unknown) => {
    const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
    return message || "This page doesn't have developer tools yet.";
};

/**
 * The message a failed capture shows.
 *
 * The backend rejects with a bare string, an `Error`, or a payload carrying neither, so a
 * capture that fails must never surface as an empty failure message.
 */
export const screenshotFailureMessage = (error: unknown): string => {
    const message =
        typeof error === "string" ? error : error instanceof Error ? error.message : "";
    return message || "The page could not be captured.";
};

/** Everything the browser's actions read or write, taken at the moment they are called. */
export type BrowserActionDeps = {
    active: PageTab | null;
    showAgent: boolean;
    currentUrl: string;
    agentFrame: BrowseFrame | null;
    frameRef: RefObject<HTMLIFrameElement | null>;
    frameTabRef: RefObject<string | null>;
    travelUntilRef: RefObject<number>;
    setTabs: Dispatch<SetStateAction<PageTab[]>>;
    setActiveId: (id: string | null) => void;
    clearDraft: () => void;
    closePageMenu: () => void;
    leaveAgentTab: () => void;
    setFrameSrc: (src: string) => void;
    setPicking: Dispatch<SetStateAction<boolean>>;
    setTools: Dispatch<SetStateAction<ToolsState | null>>;
    savingShot: boolean;
    setSavingShot: Dispatch<SetStateAction<boolean>>;
    saveBookmark: (url: string, title: string) => void;
    chooseScheme: (scheme: ColorScheme) => void;
    showBookmarkBar: (show: boolean) => void;
};

/**
 * The browser's actions, as the toolbar and the page menu call them.
 *
 * The actions read the deps object at call time rather than closing over it, so a handler
 * built on one render still acts on the tab that is on screen when it is pressed.
 */
export const createBrowserActions = (deps: BrowserActionDeps): BrowserActions => {
    /** Asks the frame to go back or forward one step of its own history. */
    const goHistory = (delta: number) => {
        const { active, showAgent } = deps;
        if (!active || active.pending || showAgent) return;
        const index = active.index + delta;
        const url = active.entries[index];
        if (!url) return;
        deps.travelUntilRef.current = Date.now() + TRAVEL_WINDOW_MS;
        deps.setTabs((previous) =>
            previous.map((tab) => (tab.id === active.id ? tabAtHistoryStep(tab, index) : tab)),
        );
        postHistory(deps.frameRef.current, delta, url);
    };

    /** Reloads the page, through the host script first and the frame itself as the fallback. */
    const reload = () => {
        const { active, showAgent } = deps;
        if (!active?.url || showAgent) return;
        deps.setTabs((previous) =>
            previous.map((tab) => (tab.id === active.id ? { ...tab, error: null } : tab)),
        );
        postReload(deps.frameRef.current);
    };

    /** Points the tab that is already on screen at a URL, which is what typing into it means. */
    const navigateExistingTab = (resolved: string) => {
        const active = deps.active;
        if (!active) return;
        deps.setTabs((previous) =>
            previous.map((tab) => (tab.id === active.id ? tabAtUrl(tab, resolved) : tab)),
        );
        deps.setFrameSrc(resolved);
        deps.frameTabRef.current = active.id;
        if (deps.frameRef.current) deps.frameRef.current.src = resolved;
    };

    /** Opens a URL in a tab of its own, which is what happens with no tab to navigate. */
    const openInNewTab = (resolved: string) => {
        const id = `tab-${Date.now()}`;
        deps.setTabs((previous) => [...previous, newTabAtUrl(id, resolved)]);
        deps.setActiveId(id);
        deps.setFrameSrc(resolved);
    };

    /**
     * Leaves the agent's view, cuts the history at the current step, and goes to the URL.
     *
     * A typed URL navigates the tab that is already on screen, and with no tab to put it in it
     * becomes a new one. Both routes set the frame's source directly as well as the tab's,
     * because the effect that points the frame runs when the active tab's id changes.
     */
    const submitUrl = (raw: string) => {
        deps.clearDraft();
        deps.closePageMenu();
        const resolved = resolveBrowserInput(raw);
        if (!resolved) return;
        deps.leaveAgentTab();
        if (deps.active && !deps.showAgent) {
            navigateExistingTab(resolved);
            return;
        }
        openInNewTab(resolved);
    };

    /** Adds the current page to the bookmarks, or takes it out again. */
    const toggleBookmark = () =>
        deps.saveBookmark(deps.currentUrl, bookmarkTitleOf(deps.agentFrame, deps.active, deps.currentUrl));

    /** Reads the page's devtools URL, which only exists where the surface can host them. */
    const openTools = () => {
        const pageUrl = deps.active?.url;
        if (!pageUrl) return;
        commands.browserSurfaceDevtools(pageUrl)
            .then((next) => {
                if (!next) return;
                deps.setTools({ url: pageUrl, src: next, error: null });
            })
            .catch((error: unknown) => {
                deps.setTools({ url: pageUrl, src: null, error: toolsRefusal(error) });
            });
    };

    /**
     * Captures the page on screen and reports where the file landed.
     *
     * The guard drops a second press while the first capture is still running, so a
     * double-click cannot race two captures into the downloads folder.
     */
    const takeScreenshot = () => {
        const { active, savingShot } = deps;
        if (!active || savingShot) return;
        deps.setSavingShot(true);
        commands
            .browserScreenshot(active.id)
            .then((savedTo) => {
                notificationStore.add(
                    "Screenshot saved",
                    "success",
                    savedTo ? `Saved to ${savedTo}` : undefined,
                );
            })
            .catch((error: unknown) => {
                notificationStore.add(
                    "Screenshot failed",
                    "error",
                    screenshotFailureMessage(error),
                );
            })
            .finally(() => deps.setSavingShot(false));
    };

    return {
        back: () => goHistory(-1),
        forward: () => goHistory(1),
        reload,
        toggleBookmark,
        submitUrl,
        togglePicking: () => deps.setPicking((on) => !on),
        openTools,
        takeScreenshot,
        closeTools: () => deps.setTools(null),
        chooseScheme: deps.chooseScheme,
        showBookmarkBar: deps.showBookmarkBar,
        openExternally: () => {
            if (deps.currentUrl) commands.openUrlExternal(deps.currentUrl).catch(() => undefined);
        },
        copyUrl: () => {
            if (deps.currentUrl) navigator.clipboard.writeText(deps.currentUrl).catch(() => undefined);
        },
        clear: (what) => {
            commands.browserClear(what).catch(() => undefined);
        },
    };
};

