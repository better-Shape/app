"use client";

import { useEffect, useState } from "react";
import { loadRepoHistory, clearRepoHistory } from "@/lib/workspace/repo-history";
import type { RepoHistoryEntry } from "@/lib/workspace/repo-history";

export function useRepoHistory(projectPath: string | null) {
    const [repoHistory, setRepoHistory] = useState<RepoHistoryEntry[]>(() => loadRepoHistory());
    // Re-read when the project changes. Compared during render, so the list is right on the
    // first frame after a switch and no effect has to write it.
    const [forPath, setForPath] = useState(projectPath);
    if (forPath !== projectPath) {
        setForPath(projectPath);
        setRepoHistory(loadRepoHistory());
    }

    useEffect(() => {
        // Only the event subscription lives in an effect; the handler runs later, not during it.
        const refresh = () => setRepoHistory(loadRepoHistory());
        window.addEventListener("bettershape-open-project", refresh);
        return () => window.removeEventListener("bettershape-open-project", refresh);
    }, []);

    return {
        repoHistory,
        clearHistory: () => {
            clearRepoHistory();
            setRepoHistory([]);
        },
    };
}
