"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { commands, useProjectState, type BlameLine } from "@/lib/backend";
import { openCommitFileDiffTab } from "@/features/agent/workspace/file-diff";
import { BlamePanel, type BlameCommitTarget } from "@/features/git/ui/blame/panel";
import { blameBlockedReason, blameState, relativeLabel } from "@/features/git/ui/blame/model";
import { describeError } from "@/features/git/ui/search/model";

const SIDEBAR_SURFACE = {
    "--panel": "var(--sidebar)",
    "--color-panel": "var(--sidebar)",
    "--editor": "var(--sidebar)",
    "--color-editor": "var(--sidebar)",
} as CSSProperties;

export function BlameTab() {
    const { project_path, active_file } = useProjectState();
    const [lines, setLines] = useState<BlameLine[] | null>(null);
    const [status, setStatus] = useState<"loading" | "loaded" | "failed">("loading");
    const [message, setMessage] = useState<string | null>(null);
    const [showAll, setShowAll] = useState(false);
    const [rerunToken, setRerunToken] = useState(0);

    /**
     * Every blame run takes a ticket. libgit2 walks the whole history of the
     * file, so switching tabs mid-run would otherwise let the older file's answer
     * land last and label the newer file with the older file's commits.
     */
    const ticket = useRef(0);

    const blocked = useMemo(
        () => blameBlockedReason(active_file, project_path),
        [active_file, project_path],
    );

    useEffect(() => {
        if (!project_path || !active_file || blocked) return;
        const id = ++ticket.current;
        let cancelled = false;
        setStatus("loading");
        setMessage(null);
        void commands
            .gitBlameFile(project_path, active_file)
            .then((result) => {
                if (cancelled || id !== ticket.current) return;
                // A body that is not an array is not a file with no blame in it.
                if (!Array.isArray(result)) {
                    setLines(null);
                    setMessage("The backend returned no blame list.");
                    setStatus("failed");
                    return;
                }
                setLines(result);
                setStatus("loaded");
            })
            .catch((error: unknown) => {
                if (cancelled || id !== ticket.current) return;
                setLines(null);
                setMessage(describeError(error));
                setStatus("failed");
            });
        return () => {
            cancelled = true;
        };
    }, [project_path, active_file, blocked, rerunToken]);

    useEffect(() => {
        setShowAll(false);
    }, [active_file, rerunToken]);

    const state = useMemo(
        () =>
            blameState({
                projectPath: project_path,
                filePath: active_file,
                status,
                message,
                lines,
            }),
        [project_path, active_file, status, message, lines],
    );

    const onOpenCommit = useCallback(
        (target: BlameCommitTarget) => {
            if (!project_path || !active_file || !target.commit) return;
            openCommitFileDiffTab({
                path: relativeLabel(project_path, active_file),
                // `git_blame_file` reports no per-file status for the commit, and
                // the diff tab only uses this for a badge it falls back on.
                status: "",
                repo: project_path,
                commit: target.commit,
            });
        },
        [project_path, active_file],
    );

    const onRefresh = useCallback(() => setRerunToken((token) => token + 1), []);
    const onShowAll = useCallback(() => setShowAll(true), []);

    return (
        <div role="region" aria-label="Blame" className="h-full min-h-0 bg-sidebar" style={SIDEBAR_SURFACE}>
            <BlamePanel
                state={state}
                busy={status === "loading" && blocked === null}
                showAll={showAll}
                nowSeconds={Math.floor(Date.now() / 1000)}
                onRefresh={onRefresh}
                onShowAll={onShowAll}
                onOpenCommit={onOpenCommit}
            />
        </div>
    );
}