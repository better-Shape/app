"use client";

import { useEffect, useState } from "react";
import { loadRepoHistory, clearRepoHistory } from "@/lib/workspace/repo-history";
import type { RepoHistoryEntry } from "@/lib/workspace/repo-history";

/**
 * The recently opened projects, and the two events that change them.
 *
 * The list is re-read when the project changes by comparing during render instead of from an
 * effect: React discards a render-phase `setState` and re-runs the component immediately, so
 * the list is already right on the first frame after a switch and no effect writes it after
 * paint.
 */
export const useRepoHistory = (projectPath: string | null) => {
    const [repoHistory, setRepoHistory] = useState<RepoHistoryEntry[]>(() => loadRepoHistory());
    const [forPath, setForPath] = useState(projectPath);
    if (forPath !== projectPath) {
        setForPath(projectPath);
        setRepoHistory(loadRepoHistory());
    }

    useEffect(() => {
        /** A project opened anywhere in the app puts itself at the top of the list. */
        const refresh = () => setRepoHistory(loadRepoHistory());
        window.addEventListener("bettershape-open-project", refresh);
        return () => {
            window.removeEventListener("bettershape-open-project", refresh);
        };
    }, []);

    return {
        repoHistory,
        clearHistory: () => {
            clearRepoHistory();
            setRepoHistory([]);
        },
    };
};
