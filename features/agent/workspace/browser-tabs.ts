"use client";

import { blankTab, type PageTab } from "./browser-storage";

/** A navigation the framed page reported, in the shape the tab list applies it in. */
export type PageNavigation = {
    url: string;
    title?: string;
    favicon?: string;
    error: string | null;
    travel: boolean;
};

/** The fields of a navigation once the tab's own state has been folded into them. */
type ResolvedNavigation = {
    url: string;
    title: string;
    favicon: string;
    error: string | null;
};

/**
 * Whether there is a page here worth noting.
 *
 * A frame reports an empty URL while it is being pointed somewhere, and `about:blank` as its
 * own empty state. Neither is a page the user navigated to, so neither moves the tab.
 */
export const isNavigable = (url: string) => Boolean(url) && url !== "about:blank";

/**
 * The title to show for a page, which is the tab's current title when there is nothing better.
 *
 * A page with no `<title>` reports its own URL, and a URL in the title slot reads as a
 * mis-rendered heading rather than as the name of the page, so it keeps the previous title.
 */
const cleanTitle = (title: string | undefined, fallback: string) => {
    const trimmed = title?.trim();
    if (!trimmed) return fallback;
    return /^https?:\/\//i.test(trimmed) ? fallback : trimmed;
};

/** A tab moved to a URL already in its history, which is what going back and forward is. */
const revisitTab = (tab: PageTab, at: ResolvedNavigation): PageTab => {
    const found = tab.entries.lastIndexOf(at.url);
    const index = found >= 0 ? found : tab.index;
    return { ...tab, ...at, index };
};

/** A tab moved to a new URL, appended in front of whatever was ahead of it in history. */
const pushTab = (tab: PageTab, at: ResolvedNavigation): PageTab => {
    if (tab.entries[tab.index] === at.url) return { ...tab, ...at };
    const entries = [...tab.entries.slice(0, tab.index + 1), at.url];
    return { ...tab, ...at, entries, index: entries.length - 1 };
};

/**
 * Applies one navigation to the tab that reported it.
 *
 * A pending tab has not loaded a first page yet, so a report from it is either the page it was
 * pointed at or noise from the frame being torn down; the load that makes it current arrives
 * separately and is what takes it out of pending.
 */
export const navigateTab = (tab: PageTab, nav: PageNavigation): PageTab => {
    if (tab.pending) return tab;
    const at: ResolvedNavigation = {
        url: nav.url,
        title: cleanTitle(nav.title, tab.title),
        favicon: nav.favicon || tab.favicon,
        error: nav.error,
    };
    return nav.travel ? revisitTab(tab, at) : pushTab(tab, at);
};

/** Applies a navigation to the one tab it belongs to, leaving the others as they were. */
export const navigateTabs = (
    tabs: readonly PageTab[],
    id: string | null,
    nav: PageNavigation,
): PageTab[] => tabs.map((tab) => (tab.id === id ? navigateTab(tab, nav) : tab));

/** A tab pointed at a URL the user typed, with history cut in front of where it is now. */
export const tabAtUrl = (tab: PageTab, url: string): PageTab => {
    const entries = tab.entries.slice(0, tab.index + 1);
    if (entries[entries.length - 1] !== url) entries.push(url);
    return {
        ...tab,
        pending: false,
        url,
        title: "",
        favicon: "",
        error: null,
        entries,
        index: entries.length - 1,
    };
};

/** A tab for a URL the user typed with no tab to put it in. */
export const newTabAtUrl = (id: string, url: string): PageTab => ({
    id,
    pending: false,
    url,
    title: "",
    favicon: "",
    entries: [url],
    index: 0,
    error: null,
});

/** The tab after a history move, with the URL its history holds at that step. */
export const tabAtHistoryStep = (tab: PageTab, index: number): PageTab => {
    const url = tab.entries[index];
    if (!url) return tab;
    return { ...tab, index, url, error: null };
};

/** Whether a tab list already matches the ids it was given, so nothing needs replacing. */
export const tabsMatch = (tabs: readonly PageTab[], ids: readonly string[]) =>
    tabs.length === ids.length && tabs.every((tab, index) => tab.id === ids[index]);

/** The tab list a controlled view shows, keeping the state of every tab that survives. */
export const syncTabs = (tabs: readonly PageTab[], ids: readonly string[]): PageTab[] =>
    ids.map((id) => tabs.find((tab) => tab.id === id) ?? blankTab(id));
