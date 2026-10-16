"use client";

import { resolveBrowserInput } from "@/features/agent/browser/store";
import { MAJOR_SITES } from "@/features/agent/browser/sites";
import type { BrowserHistoryEntry } from "@/lib/backend/types";
import { hostnameOf } from "@/lib/ui/favicon";

/** One row of the URL bar's suggestion list, which is also what the list keys on. */
export type Suggestion =
    | { kind: "history"; url: string; title: string }
    | { kind: "search"; query: string; url: string }
    | { kind: "go"; url: string };

/** How many suggestions the bar offers, and how many of them may come from history. */
const SUGGESTION_LIMIT = 8;
const HISTORY_LIMIT = 6;

/** How many history entries one read of the bar pulls in to choose those from. */
export const HISTORY_READ_LIMIT = 40;

/** Whether the field's text is something to open rather than something to search for. */
export const looksLikeUrl = (raw: string) => {
    const trimmed = raw.trim();
    const hasScheme = /^(https?:\/\/|localhost|127\.0\.0\.1)/i.test(trimmed);
    const looksLikeHost = /^[\w-]+(\.[\w-]+)+/i.test(trimmed) && !/\s/.test(trimmed);
    return hasScheme || looksLikeHost;
};

/** The URL the bar shows. `about:blank` is the frame's empty state and reads as nothing. */
export const displayUrl = (url: string) => {
    if (!url || url === "about:blank") return "";
    return url;
};

/** Whether the site's name, or its first label, starts with the needle. */
const nameMatches = (needle: string, host: string) => {
    const name = host.toLowerCase().replace(/^www\./, "");
    const label = name.split(".")[0] ?? "";
    return name.startsWith(needle) || label.startsWith(needle);
};

/** Whether the page's title, or a word inside it, starts with the needle. */
const titleMatches = (needle: string, title: string) => {
    const heading = title.toLowerCase();
    if (heading.startsWith(needle)) return true;
    // A prefix of a word inside a title is only specific enough from three characters.
    if (needle.length < 3) return false;
    return heading.split(/[^a-z0-9]+/).some((word) => word.startsWith(needle));
};

/**
 * Whether a known site answers to what is being typed.
 *
 * Prefix matching is deliberate rather than substring matching: typing `git` should reach
 * GitHub, and it should not reach every site with those three letters anywhere in its name.
 */
export const siteMatches = (query: string, host: string, title: string) => {
    const needle = query.toLowerCase();
    if (!needle) return false;
    return nameMatches(needle, host) || titleMatches(needle, title);
};

/** Adds a site to the list once, and only when it answers to the query. */
const addSite = (out: Suggestion[], seen: Set<string>, query: string, url: string, title: string) => {
    const host = hostnameOf(url);
    if (!host || seen.has(host)) return;
    if (query && !siteMatches(query, host, title)) return;
    seen.add(host);
    out.push({ kind: "history", url, title });
};

/** How many site rows the list currently holds, which is what the cap counts. */
const siteRowCount = (rows: readonly Suggestion[]) =>
    rows.filter((row) => row.kind === "history").length;

/** The row that opens the field's own text, when the text is something to open. */
const goRow = (trimmed: string): Suggestion[] =>
    trimmed && looksLikeUrl(trimmed)
        ? [{ kind: "go", url: resolveBrowserInput(trimmed) }]
        : [];

/** The row that searches for the field's own text, when it is not something to open. */
const searchRow = (trimmed: string): Suggestion[] =>
    trimmed && !looksLikeUrl(trimmed)
        ? [{ kind: "search", query: trimmed, url: resolveBrowserInput(trimmed) }]
        : [];

/** Fills the list with known sites whose names answer to the query, up to the cap. */
const addSiteRows = (out: Suggestion[], seen: Set<string>, query: string) => {
    for (const host of MAJOR_SITES) {
        if (siteRowCount(out) >= HISTORY_LIMIT) break;
        addSite(out, seen, query, `https://${host}`, host.split(".")[0] ?? host);
    }
};

/**
 * The suggestion list for what has been typed.
 *
 * An empty field offers sites only, capped at the number of rows the list shows, because
 * there is nothing to search for yet. A non-empty one offers the live URL first, then every
 * history row that answers to it, then known sites filling the list up to the cap, then the
 * search row last, so that the row a stray Enter hits is the one that navigates rather than
 * the one that searches.
 *
 * One `seen` set spans both the history and the site rows: a site already offered from history
 * is not offered again from the major-site list, which is what keeps a fresh profile's list
 * from repeating its first six rows.
 */
export const buildSuggestions = (
    raw: string,
    history: readonly BrowserHistoryEntry[],
): Suggestion[] => {
    const trimmed = raw.trim();
    const query = trimmed.toLowerCase();
    const out: Suggestion[] = [...goRow(trimmed)];
    const seen = new Set<string>();
    for (const entry of history) {
        addSite(out, seen, query, entry.url, entry.title);
        if (siteRowCount(out) >= HISTORY_LIMIT) break;
    }
    if (query) addSiteRows(out, seen, query);
    out.push(...searchRow(trimmed));
    return out.slice(0, SUGGESTION_LIMIT);
};
