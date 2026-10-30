"use client";

import { ChevronLeft20Regular } from "@fluentui/react-icons/headless/svg/chevron-left";
import { ChevronRight20Regular } from "@fluentui/react-icons/headless/svg/chevron-right";
import { Add20Regular } from "@fluentui/react-icons/headless/svg/add";
import { ArrowUndo20Regular } from "@fluentui/react-icons/headless/svg/arrow-undo";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Tooltip } from "@/components/ui/tooltip";
import { commands } from "@/lib/backend/commands";
import type { GitHunk } from "@/lib/backend/types";
import { notify } from "@/features/notifications";

export type HunkMode = "staged" | "unstaged";

/** Loads the hunks of one file diff and refreshes them after any Git mutation. */
export function useFileHunks(repoPath: string | null, filePath: string, mode: HunkMode) {
    const [hunks, setHunks] = useState<GitHunk[]>([]);
    const [index, setIndex] = useState(0);
    const [busy, setBusy] = useState(false);
    const [reloadToken, setReloadToken] = useState(0);

    const reload = useCallback(() => setReloadToken((token) => token + 1), []);

    // Without a repository there is nothing to list; cleared during render, not in an effect.
    if (!repoPath && hunks.length > 0) setHunks([]);

    useEffect(() => {
        if (!repoPath) return;
        let cancelled = false;
        void commands
            .gitListHunks(repoPath, filePath, mode === "staged")
            .then((list) => {
                if (cancelled) return;
                setHunks(list.hunks);
                setIndex((current) => (list.hunks.length === 0 ? 0 : Math.min(current, list.hunks.length - 1)));
            })
            .catch(() => {
                if (!cancelled) setHunks([]);
            });
        return () => {
            cancelled = true;
        };
    }, [repoPath, filePath, mode, reloadToken]);

    useEffect(() => {
        const onRefresh = () => reload();
        window.addEventListener("bettershape-git-refresh", onRefresh);
        return () => window.removeEventListener("bettershape-git-refresh", onRefresh);
    }, [reload]);

    /** Stages, unstages or restores the whole hunk, then re-reads the diff. */
    const apply = useCallback(
        async (operation: "stage" | "unstage" | "restore") => {
            const hunk = hunks[index];
            if (!repoPath || !hunk || busy) return;
            setBusy(true);
            try {
                if (operation === "stage") await commands.gitStageHunk(repoPath, filePath, hunk.index);
                else if (operation === "unstage") await commands.gitUnstageHunk(repoPath, filePath, hunk.index);
                else await commands.gitRestoreHunk(repoPath, filePath, hunk.index);
                window.dispatchEvent(new Event("bettershape-git-refresh"));
            } catch (error) {
                notify.error("Git", error instanceof Error ? error.message : String(error));
            } finally {
                setBusy(false);
            }
        },
        [busy, filePath, hunks, index, repoPath],
    );

    const step = useCallback(
        (delta: number) => {
            setIndex((current) => {
                if (hunks.length === 0) return 0;
                return (current + delta + hunks.length) % hunks.length;
            });
        },
        [hunks.length],
    );

    return { hunks, index, busy, step, apply, reload };
}

/**
 * Hunk staging for the diff on screen. Ctrl+Y stages the current hunk and
 * Ctrl+Shift+Y unstages it, matching the editor diff conventions.
 */
export function HunkActions({
    repoPath,
    filePath,
    mode,
    active,
}: {
    repoPath: string | null;
    filePath: string;
    mode: HunkMode;
    active: boolean;
}) {
    const { hunks, index, busy, step, apply } = useFileHunks(repoPath, filePath, mode);
    const hunk = hunks[index];

    useEffect(() => {
        if (!active || hunks.length === 0) return;
        const onKey = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
            const key = event.key.toLowerCase();
            if (key !== "y") return;
            if (event.shiftKey && mode === "staged") {
                event.preventDefault();
                void apply("unstage");
            } else if (!event.shiftKey && mode === "unstaged") {
                event.preventDefault();
                void apply("stage");
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [active, apply, hunks.length, mode]);

    if (!hunk) return null;

    return (
        <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label="Hunk actions">
            <Tooltip content="Previous hunk">
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Previous hunk"
                    className="h-6 w-6"
                    onClick={() => step(-1)}
                >
                    <Icon icon={ChevronLeft20Regular} />
                </Button>
            </Tooltip>
            <span className="min-w-8 text-center text-xs text-text-muted tabular-nums">
                {index + 1}/{hunks.length}
            </span>
            <Tooltip content="Next hunk">
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Next hunk"
                    className="h-6 w-6"
                    onClick={() => step(1)}
                >
                    <Icon icon={ChevronRight20Regular} />
                </Button>
            </Tooltip>
            {mode === "unstaged" ? (
                <>
                    <Tooltip content="Stage hunk (Ctrl+Y)">
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Stage hunk"
                            className="h-6 w-6"
                            disabled={busy}
                            onClick={() => void apply("stage")}
                        >
                            <Icon icon={Add20Regular} />
                        </Button>
                    </Tooltip>
                    <Tooltip content="Restore hunk">
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Restore hunk"
                            className="h-6 w-6"
                            disabled={busy}
                            onClick={() => void apply("restore")}
                        >
                            <Icon icon={ArrowUndo20Regular} />
                        </Button>
                    </Tooltip>
                </>
            ) : (
                <Tooltip content="Unstage hunk (Ctrl+Shift+Y)">
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Unstage hunk"
                        className="h-6 w-6"
                        disabled={busy}
                        onClick={() => void apply("unstage")}
                    >
                        <Icon icon={ArrowUndo20Regular} />
                    </Button>
                </Tooltip>
            )}
        </div>
    );
}
