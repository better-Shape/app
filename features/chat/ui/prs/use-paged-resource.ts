"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { appendUnique, getGitHubPage, PR_PAGE_SIZE } from "./pagination";

const EMPTY_ROWS: Record<string, unknown>[] = [];
const rowKey = (row: Record<string, unknown>) => `${String(row.event ?? "")}:${String(row.id ?? row.filename ?? row.sha ?? JSON.stringify(row))}`;

/** Lazy tab data: failed refreshes retain the last snapshot, never masquerade as empty. */
export function usePagedPrResource(path: string, revision: string | number, limit = Infinity) {
    const [snapshot, setSnapshot] = useState<{ path: string; rows: Record<string, unknown>[] } | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const [atLimit, setAtLimit] = useState(false);
    const page = useRef(0);
    const version = useRef(0);
    const busy = useRef(false);
    const currentPath = useRef(path);

    const load = useCallback(async (more = false) => {
        if (more && busy.current) return;
        const request = ++version.current;
        busy.current = true;
        setLoading(true);
        setError(null);
        const lastPage = more ? page.current + 1 : Math.max(1, page.current);
        let rows: Record<string, unknown>[] = [];
        try {
            for (let n = more ? lastPage : 1; n <= lastPage; n += 1) {
                const result = await getGitHubPage(path, n);
                if (request !== version.current) return;
                rows = appendUnique(rows, result.rows, rowKey);
                if (!result.hasMore || n === lastPage) {
                    page.current = n;
                    setSnapshot((previous) => ({
                        path,
                        rows: more && previous?.path === path ? appendUnique(previous.rows, rows, rowKey) : rows,
                    }));
                    const limited = result.hasMore && n * PR_PAGE_SIZE >= limit;
                    setHasMore(result.hasMore && !limited);
                    setAtLimit(limited);
                    break;
                }
            }
        } catch (cause) {
            if (request === version.current) setError(cause instanceof Error ? cause.message : "Could not load GitHub data.");
        } finally {
            if (request === version.current) {
                busy.current = false;
                setLoading(false);
            }
        }
    }, [path, limit]);

    useEffect(() => {
        if (currentPath.current !== path) {
            currentPath.current = path;
            page.current = 0;
            setHasMore(false);
            setAtLimit(false);
        }
        void load();
        return () => { version.current += 1; busy.current = false; };
    }, [load, path, revision]);

    return {
        rows: snapshot?.path === path ? snapshot.rows : EMPTY_ROWS,
        loaded: snapshot?.path === path,
        loading, error, hasMore, atLimit,
        loadMore: () => { if (hasMore) void load(true); },
        retry: () => void load(),
    };
}
