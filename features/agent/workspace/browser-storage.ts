"use client";

/** Where the browser keeps its bookmarks, its bookmark bar flag and its colour scheme. */
export const BOOKMARKS_KEY = "bettershape-browser-bookmarks";
export const BOOKMARK_BAR_KEY = "bettershape-browser-bookmark-bar";
export const SCHEME_KEY = "bettershape-browser-scheme";

/** The id the agent's own tab carries, so a tab list can tell it from the user's. */
export const AGENT_TAB = "agent";

/** A saved page: what the user starred, and what the bar shows for it. */
export type Bookmark = { url: string; title: string };

/** The scheme the framed page is asked to render in, and the frame's own preference. */
export type ColorScheme = "system" | "light" | "dark";

/** One tab of the browser: its history, where it is in that history, and what it is showing. */
export type PageTab = {
    id: string;
    pending: boolean;
    url: string;
    title: string;
    favicon: string;
    entries: string[];
    index: number;
    error: string | null;
};

/** A tab that has an id and nothing else yet, which is what a new tab starts as. */
export const blankTab = (id: string): PageTab => ({
    id,
    pending: true,
    url: "",
    title: "",
    favicon: "",
    entries: [],
    index: 0,
    error: null,
});

/**
 * Reads a JSON value out of local storage.
 *
 * Storage fails in three ways that all have the same answer: it can be unavailable (a
 * partitioned or private context throws on access), the value can be absent, and the value can
 * be corrupt. A browser that cannot read its bookmarks should start with none rather than fail
 * to start, so every one of them returns the fallback.
 */
export const loadJson = <T,>(key: string, fallback: T): T => {
    try {
        const raw = window.localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
        return fallback;
    }
};

/**
 * Writes a JSON value to local storage.
 *
 * A failed write is dropped on purpose: a quota-exceeded bookmark is a browser that forgets
 * it, and the alternative is an error surface for something the user cannot act on.
 */
export const saveJson = (key: string, value: unknown) => {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* ignore */
    }
};
