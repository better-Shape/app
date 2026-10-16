"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { BrowserPickedElement } from "@/lib/backend/types";
import { AgentControlBar } from "@/features/chat/ui/blocks/browse-frame";
import { useBrowseFrame, type BrowseFrame } from "@/features/agent/browser/session";
import { getLastDevUrl } from "@/features/preview/store";
import { createBrowserActions } from "./browser-actions";
import { BrowserToolbar, BookmarkBar, PageContextMenu, type BrowserState } from "./browser-chrome";
import {
    useBookmarks,
    useBrowserFrameEvents,
    useColorScheme,
    useFrameMessages,
    useFrameSrcSync,
    usePickingBroadcast,
    useSchemeBroadcast,
    type HoverTarget,
    type MenuPoint,
    type ToolsState,
} from "./browser-hooks";
import { PageArea } from "./browser-page";
import { steerFrame } from "./browser-frame";
import { AGENT_TAB, blankTab, type PageTab } from "./browser-storage";
import { displayUrl } from "./browser-suggest";
import { isNavigable, navigateTabs, syncTabs, tabsMatch } from "./browser-tabs";

/** The tab list a controlled window shows, keeping the state of every tab that survives. */
const tabsFromIds = (tabs: readonly PageTab[], ids: readonly string[]) => syncTabs(tabs, ids);

/** The tab fields the window reports upwards, read as one value so the report has one dep. */
const activeMeta = (active: PageTab | null) => ({
    id: active?.id,
    title: active?.title,
    url: active?.url,
    favicon: active?.favicon,
});

/** The URL the agent's own browser is on, which is where the frame cannot be read instead. */
const agentAddress = (frame: BrowseFrame | null) => frame?.url ?? "";

/** The URL the active tab is on, before the address field's hollow state is applied to it. */
const pageAddress = (active: PageTab | null) => active?.url || "";

/** The URL the address field falls back to when the user has not typed anything. */
const addressOf = ({ showAgent, agentFrame, active }: { showAgent: boolean; agentFrame: BrowseFrame | null; active: PageTab | null }) =>
    showAgent ? agentAddress(agentFrame) : displayUrl(pageAddress(active));

/** Whether the frame has a page on screen, which is what every page-level control reads. */
const isPageVisible = (active: PageTab | null, showAgent: boolean) =>
    !showAgent && !!active && !active.pending && !!active.url;

/** The developer tools for the page that is on screen, if they were opened for that page. */
const toolsForPage = (tools: ToolsState | null, active: PageTab | null) =>
    tools && tools.url === active?.url ? tools : null;

/** Whether the agent has a browser of its own on screen. */
const agentIsDriving = (frame: BrowseFrame | null) => !!frame && frame.status !== "stopped";

/** The URL the window is on, before the address field's own draft is taken into account. */
const rawUrlOf = (showAgent: boolean, agentFrame: BrowseFrame | null, active: PageTab | null) =>
    showAgent ? agentAddress(agentFrame) : pageAddress(active);

/** The view the address field belongs to, which is what a typed draft is keyed by. */
const viewKey = (showAgent: boolean, activeId: string | null) =>
    showAgent ? AGENT_TAB : (activeId ?? "");

/** Whether the tab's history has a step behind it, which is what enables Back. */
const canGoBack = (active: PageTab | null, showAgent: boolean) =>
    !showAgent && !!active && active.index > 0;

/** Whether the tab's history has a step ahead of it, which is what enables Forward. */
const canGoForward = (active: PageTab | null, showAgent: boolean) =>
    !showAgent && !!active && active.index < active.entries.length - 1;

/** The address the field shows: what the user typed, or where the view actually is. */
const shownAddress = (draft: { key: string; value: string } | null, key: string, address: string) =>
    draft?.key === key ? draft.value : address;

/** What the toolbar and the page menu read to render their own state. */
type ChromeInput = {
    draft: { key: string; value: string } | null;
    tabKey: string;
    showAgent: boolean;
    address: string;
    active: PageTab | null;
    currentUrl: string;
    bookmarks: readonly { url: string }[];
    picking: boolean;
    pageTools: ToolsState | null;
    scheme: ReturnType<typeof useColorScheme>["scheme"];
    bookmarkBar: boolean;
};

/**
 * The toolbar's view of the window.
 *
 * Derived in one place so a control cannot disagree with its neighbour about whether there is
 * a page on screen: the star, the reload and the picker all read the same three fields.
 */
const chromeState = (input: ChromeInput): BrowserState => ({
    url: shownAddress(input.draft, input.tabKey, input.address),
    canBack: canGoBack(input.active, input.showAgent),
    canForward: canGoForward(input.active, input.showAgent),
    reloadable: isPageVisible(input.active, input.showAgent),
    bookmarkable: Boolean(input.currentUrl),
    bookmarked: input.bookmarks.some((saved) => saved.url === input.currentUrl),
    picking: input.picking,
    agentDriving: input.showAgent,
    toolsOpen: Boolean(input.pageTools?.src),
    toolsError: Boolean(input.pageTools?.error),
    scheme: input.scheme,
    bookmarkBar: input.bookmarkBar,
});

/**
 * The browser: tabs of pages in a frame, with an address field, bookmarks and developer tools.
 *
 * The window can be uncontrolled, where it owns its tab list, or controlled, where the caller
 * passes the tab ids and the window only keeps what it knows about each of them. The controlled
 * shape is what lets the workbench's tab strip own the list while the frame stays mounted.
 */
export const BrowserView = ({
    tabId = null,
    tabIds,
    onMeta,
    onUseTool,
}: {
    tabId?: string | null;
    tabIds?: string[];
    onMeta?: (id: string, title: string, url: string, favicon?: string) => void;
    onUseTool?: (kind: "files" | "graph" | "prs") => void;
} = {}) => {
    const controlled = Array.isArray(tabIds);
    const agentFrame = useBrowseFrame();
    const agentActive = agentIsDriving(agentFrame);

    const [tabs, setTabs] = useState<PageTab[]>(() => (controlled ? [] : [blankTab("new-1")]));
    const [activeId, setActiveId] = useState<string | null>(() => (controlled ? null : "new-1"));
    const [localActive, setLocalActive] = useState<string | null>(null);
    const [draft, setDraft] = useState<{ key: string; value: string } | null>(() => {
        if (controlled) return null;
        const last = getLastDevUrl();
        return last ? { key: "new-1", value: last } : null;
    });
    const [picking, setPicking] = useState(false);
    const [hover, setHover] = useState<HoverTarget | null>(null);
    const [tools, setTools] = useState<ToolsState | null>(null);
    const [frameSrc, setFrameSrc] = useState("about:blank");
    const [pageMenu, setPageMenu] = useState<MenuPoint | null>(null);

    const frameRef = useRef<HTMLIFrameElement>(null);
    const frameTab = useRef<string | null>(null);
    const activeIdRef = useRef<string | null>(null);
    const currentUrlRef = useRef("");
    const travelUntil = useRef(0);
    const seenScheme = useRef<ReturnType<typeof useColorScheme>["scheme"] | null>(null);

    const { bookmarks, bar: bookmarkBar, showBar, toggle: toggleSaved } = useBookmarks();
    const { scheme, choose: chooseScheme } = useColorScheme();

    const showAgent = localActive === AGENT_TAB && agentActive;
    const active = useMemo(() => tabs.find((tab) => tab.id === activeId) ?? null, [tabs, activeId]);
    const currentUrl = rawUrlOf(showAgent, agentFrame, active);
    const showPage = isPageVisible(active, showAgent);
    const meta = useMemo(() => activeMeta(active), [active]);
    const pageTools = toolsForPage(tools, active);
    /**
     * Which view the address field is showing.
     *
     * A draft is what the user has typed and not yet submitted, and it belongs to the view it
     * was typed in: switching tabs drops it rather than carrying the text across, which is what
     * makes the field show the page it is actually on again.
     */
    const tabKey = viewKey(showAgent, activeId);

    /** Records a navigation for the tab it belongs to, once the report is worth keeping. */
    const noteNavigation = useCallback(
        (url: string, title: string | undefined, error: string | null, travel: boolean, favicon?: string) => {
            if (!isNavigable(url)) return;
            const id = activeIdRef.current;
            if (!id) return;
            const traveling = travel || Date.now() < travelUntil.current;
            setTabs((previous) => navigateTabs(previous, id, { url, title, error, travel: traveling, favicon }));
        },
        [],
    );

    /** Hands the picked element to the chat, which the mention flow already understands. */
    const onPick = useCallback((element: BrowserPickedElement) => {
        setPicking(false);
        window.dispatchEvent(new CustomEvent("bettershape-chat-attach-element", { detail: element }));
        window.dispatchEvent(new Event("bettershape-chat-focus-input"));
    }, []);

    useFrameMessages({
        frameRef,
        urlRef: currentUrlRef,
        onNavigation: noteNavigation,
        onHover: setHover,
        onMenu: setPageMenu,
        onPick,
    });
    useBrowserFrameEvents({ travelUntil, onNavigation: noteNavigation });
    useSchemeBroadcast({ frameRef, scheme, seenSchemeRef: seenScheme });
    useFrameSrcSync({ frameRef, frameTabRef: frameTab, active });
    usePickingBroadcast({ frameRef, picking, frameSrc, showPage });

    // Jump to the agent's tab when it starts driving, and leave it when it stops.
    const wasAgentActive = useRef(false);
    useEffect(() => {
        if (agentActive && !wasAgentActive.current) setLocalActive(AGENT_TAB);
        if (!agentActive) setLocalActive((current) => (current === AGENT_TAB ? null : current));
        wasAgentActive.current = agentActive;
    }, [agentActive]);

    useEffect(() => {
        if (!controlled || !tabIds) return;
        setTabs((previous) => (tabsMatch(previous, tabIds) ? previous : tabsFromIds(previous, tabIds)));
        if (tabId) setActiveId(tabId);
        // A draft belongs to the view it was typed in, so a change of active tab drops it
        // rather than leaving the previous page's half-typed address over the new one.
        setDraft(null);
    }, [controlled, tabIds, tabId]);

    /**
     * A new tab clears what belonged to the old one.
     *
     * The picker and the outline are about the page that was on screen, so both drop when the
     * user moves to another tab rather than following them there.
     */
    useEffect(() => {
        setPicking(false);
        setHover(null);
    }, [activeId, showAgent]);

    activeIdRef.current = activeId;
    currentUrlRef.current = currentUrl;

    useEffect(() => {
        if (!meta.id || !meta.url || !onMeta) return;
        onMeta(meta.id, meta.title ?? "", meta.url, meta.favicon);
    }, [meta, onMeta]);

    const actions = createBrowserActions({
        active,
        showAgent,
        currentUrl,
        agentFrame,
        frameRef,
        frameTabRef: frameTab,
        travelUntilRef: travelUntil,
        setTabs,
        setActiveId,
        clearDraft: () => setDraft(null),
        closePageMenu: () => setPageMenu(null),
        leaveAgentTab: () => setLocalActive(null),
        setFrameSrc,
        setPicking,
        setTools,
        saveBookmark: toggleSaved,
        chooseScheme,
        showBookmarkBar: showBar,
    });

    const state = chromeState({
        draft,
        tabKey,
        showAgent,
        address: addressOf({ showAgent, agentFrame, active }),
        active,
        currentUrl,
        bookmarks,
        picking,
        pageTools,
        scheme,
        bookmarkBar,
    });

    return (
        <div className="flex h-full min-h-0 flex-col">
            <AgentControlBar />
            <BrowserToolbar
                state={state}
                actions={actions}
                onUrlDraft={(value) => setDraft({ key: tabKey, value })}
            />
            <BookmarkBar show={bookmarkBar} bookmarks={bookmarks} onOpen={actions.submitUrl} />
            <PageArea
                frameRef={frameRef}
                showPage={showPage}
                showAgent={showAgent}
                agentFrame={agentFrame}
                active={active}
                picking={picking}
                hover={hover}
                tools={pageTools}
                onReload={actions.reload}
                onOpenExternally={actions.openExternally}
                onOpen={actions.submitUrl}
                onUseTool={onUseTool}
            />
            <PageContextMenu
                point={pageMenu}
                state={state}
                actions={actions}
                onClose={() => setPageMenu(null)}
            />
        </div>
    );
};

/** The frame driver is used by tests directly, so it stays on this module's surface. */
export { steerFrame };
