import { commands } from "@/lib/backend";
import { parseJson } from "./mapping";

export const PR_PAGE_SIZE = 100;

export type GitHubPage = { rows: Record<string, unknown>[]; hasMore: boolean };

/** The IPC returns only the body, not Link headers. A full page may have a successor. */
export async function getGitHubPage(path: string, page: number): Promise<GitHubPage> {
    const separator = path.includes("?") ? "&" : "?";
    const payload = parseJson(await commands.githubApiGet(`${path}${separator}per_page=${PR_PAGE_SIZE}&page=${page}`));
    if (!Array.isArray(payload) || payload.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
        throw new Error("GitHub returned an invalid list response.");
    }
    return { rows: payload, hasMore: payload.length === PR_PAGE_SIZE };
}

/** Page boundaries can move while GitHub is serving a changing collection. */
export function appendUnique<T>(previous: T[], next: T[], key: (row: T) => string): T[] {
    const rows = new Map(previous.map((row) => [key(row), row]));
    for (const row of next) rows.set(key(row), row);
    return [...rows.values()];
}
