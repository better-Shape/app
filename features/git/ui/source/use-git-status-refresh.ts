"use client";

import { useCallback, useRef } from "react";

import { commands } from "@/lib/backend";
import type { GitFileParams, GitLogEntry } from "@/lib/backend/types";
import { notify } from "@/features/notifications";
import { statusProgress } from "@/lib/ui/status-progress";

import { errorText, isBenignGitError } from "./git-errors";

/** Whether a refresh has both a project and a repo to query. */
const hasRepoTarget = (
    projectPath: string | null | undefined,
    repoPath: string | null,
): repoPath is string => Boolean(projectPath && repoPath);

/**
 * Whether the panel still shows git state for a project that has no repository.
 *
 * `hasStaleStatus` keeps the clear from running when there is nothing to clear.
 * Writing `setIsGitRepo(false)` over an already-false value still schedules a
 * render, so the predicate carries the current state instead of assuming it.
 */
const shouldClearWithoutRepo = (
    projectPath: string | null | undefined,
    reposLoading: boolean,
    hasStaleStatus: boolean,
): boolean => Boolean(projectPath && !reposLoading && hasStaleStatus);

/** Status refresh for one project+repo, dropping results written after a repo switch. */
export const useGitStatusRefresh = (args: {
    projectPath: string | null | undefined;
    scmRepoPath: string | null;
    repoKey: string;
    reposCount: number;
    reposLoading: boolean;
    startLoading: () => void;
    stopLoading: () => void;
    setChanges: (files: GitFileParams[]) => void;
    setCurrentBranch: (branch: string) => void;
    setHasRemote: (value: boolean) => void;
    setLastCommit: (entry: GitLogEntry | null) => void;
    setNeedsSync: (value: boolean) => void;
    setIsGitRepo: (value: boolean) => void;
    latestRepoKeyRef: React.RefObject<string>;
    /** Whether the panel currently shows git state worth clearing. */
    isGitRepo: boolean;
    changeCount: number;
    hasLastCommit: boolean;
}) => {
    const {
        projectPath, scmRepoPath, repoKey, reposCount, reposLoading,
        startLoading, stopLoading, setChanges, setCurrentBranch, setHasRemote,
        setLastCommit, setNeedsSync, setIsGitRepo, latestRepoKeyRef,
        isGitRepo, changeCount, hasLastCommit,
    } = args;
    // Every refresh takes a number, and only the newest may write. Two refreshes
    // for the same repo overlap whenever a command answers while a status read is
    // in flight, and without this the slower, older answer could land last and put
    // pre-command status back on screen.
    const latestRequestRef = useRef(0);

    return useCallback(async (opts?: { track?: boolean }) => {
        const track = opts?.track !== false;
        const repoPath = scmRepoPath;
        const keyAtStart = repoKey;
        latestRequestRef.current += 1;
        const requestId = latestRequestRef.current;
        /** Whether a newer refresh started, or the repo changed, since this one. */
        const stale = () =>
            latestRepoKeyRef.current !== keyAtStart || latestRequestRef.current !== requestId;
        if (hasRepoTarget(projectPath, repoPath)) {
            statusProgress.push("git-refresh", "Refreshing git status...");
            if (track) startLoading();
            try {
                await Promise.all([
                    commands.gitStatus(repoPath).then((files) => {
                        if (stale()) return;
                        setIsGitRepo(true);
                        setChanges(files);
                    }).catch((err) => {
                        if (stale()) return;
                        if (isBenignGitError(err)) {
                            setIsGitRepo(reposCount > 0);
                            setChanges([]);
                        } else {
                            notify.error("Source Control Error", `Failed to load git status: ${errorText(err)}`);
                        }
                    }),
                    commands.gitCurrentBranch(repoPath).then((branch) => {
                        if (!stale()) setCurrentBranch(branch);
                    }).catch(() => {
                        if (!stale()) setCurrentBranch("master");
                    }),
                    commands.gitHasRemote(repoPath).then((value) => {
                        if (!stale()) setHasRemote(value);
                    }).catch(() => {
                        if (!stale()) setHasRemote(false);
                    }),
                    commands.gitLog(repoPath, 1)
                        .then((logs) => {
                            if (stale()) return;
                            setLastCommit(logs.length > 0 ? logs[0] : null);
                        }).catch(() => { if (!stale()) setLastCommit(null); }),
                    commands.gitSyncStatus(repoPath).then((status) => {
                        if (!stale()) setNeedsSync(status.ahead > 0);
                    }).catch(() => { if (!stale()) setNeedsSync(false); }),
                ]);
            } finally {
                if (track) stopLoading();
                // The progress entry belongs to whichever refresh is newest: an
                // older read finishing first would blank the status bar while the
                // newer one is still running. The loading count needs no such
                // guard, it is a count rather than one shared entry.
                if (latestRequestRef.current === requestId) statusProgress.remove("git-refresh");
            }
        } else {
            if (shouldClearWithoutRepo(projectPath, reposLoading, isGitRepo || changeCount > 0 || hasLastCommit)) {
                // Only clear after discovery finished with no repo — never during the async gap.
                setIsGitRepo(false);
                setChanges([]);
                setLastCommit(null);
            }
            // This path pushes no entry, so the newest one has to take an earlier
            // refresh's entry away: the read it belonged to is superseded and skips
            // its own removal, and the store has no expiry.
            if (latestRequestRef.current === requestId) statusProgress.remove("git-refresh");
        }
    }, [
        projectPath, scmRepoPath, repoKey, reposCount, reposLoading,
        startLoading, stopLoading, setChanges, setCurrentBranch, setHasRemote,
        setLastCommit, setNeedsSync, setIsGitRepo, latestRepoKeyRef,
        isGitRepo, changeCount, hasLastCommit,
    ]);
};
