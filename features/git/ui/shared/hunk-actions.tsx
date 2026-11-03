"use client";

import { ChevronLeft20Regular } from "@fluentui/react-icons/headless/svg/chevron-left";
import { ChevronRight20Regular } from "@fluentui/react-icons/headless/svg/chevron-right";
import { Add20Regular } from "@fluentui/react-icons/headless/svg/add";
import { ArrowUndo20Regular } from "@fluentui/react-icons/headless/svg/arrow-undo";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Tooltip } from "@/components/ui/tooltip";
import { commands } from "@/lib/backend/commands";
import type { GitHunk } from "@/lib/backend/types";
import { notify } from "@/features/notifications";

export type HunkMode = "staged" | "unstaged";

/**
 * What makes a hunk the change it is: its position in the diff, its header, and
 * the lines it holds. A reload can leave a different change at the same index
 * with the same range, and restoring would then delete the wrong lines.
 */
const hunkSignature = (hunk: GitHunk): string =>
    JSON.stringify([
        hunk.index,
        hunk.header,
        hunk.oldStart,
        hunk.oldLines,
        hunk.newStart,
        hunk.newLines,
        hunk.lines.map((line) => [line.type, line.content]),
    ]);

/** True when a keystroke landed in a field that owns that key. */
const isEditableTarget = (target: EventTarget | null): boolean => {
    const element = target as HTMLElement | null;
    if (!element || typeof element.tagName !== "string") return false;
    const tag = element.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || element.isContentEditable === true;
};

/**
 * Asks before a hunk's changes are thrown away.
 *
 * A missing dialog plugin answers `false`: refusing the restore is the safe
 * failure, because the lines it would have deleted are not recoverable.
 */
const confirmRestore = async (): Promise<boolean> => {
    try {
        const { ask } = await import("@tauri-apps/plugin-dialog");
        return await ask("Discard the changes in this hunk? This cannot be undone.", {
            title: "Discard Hunk",
            kind: "warning",
            okLabel: "Discard",
        });
    } catch {
        return false;
    }
};

/**
 * Loads the hunks of one file diff and refreshes them after any Git mutation.
 *
 * The listing is keyed by the repository, file and mode it was read for. A
 * list for a different target is never shown, because its index would address
 * a hunk in another diff and Stage or Restore would act on the wrong lines.
 */
export const useFileHunks = (repoPath: string | null, filePath: string, mode: HunkMode) => {
    const targetKey = `${repoPath ?? ""}\u0000${filePath}\u0000${mode}`;
    const [loaded, setLoaded] = useState<{
        key: string;
        hunks: GitHunk[];
        error: string | null;
        /**
         * Which reload produced this list. After a Git mutation the old list is
         * still on screen, and its indexes address a diff that no longer exists,
         * so the hook reports `loading` until the matching list arrives.
         */
        token: number;
    }>({
        key: "",
        hunks: [],
        error: null,
        token: -1,
    });
    const [index, setIndex] = useState(0);
    const [busy, setBusy] = useState(false);
    const [reloadToken, setReloadToken] = useState(0);

    const reload = useCallback(() => setReloadToken((token) => token + 1), []);

    useEffect(() => {
        if (!repoPath) return;
        let cancelled = false;
        const token = reloadToken;
        commands
            .gitListHunks(repoPath, filePath, mode === "staged")
            .then((list) => {
                if (cancelled) return;
                setLoaded({ key: targetKey, hunks: list.hunks, error: null, token });
                setIndex((current) => (list.hunks.length === 0 ? 0 : Math.min(current, list.hunks.length - 1)));
            })
            .catch((error: unknown) => {
                if (cancelled) return;
                const message = error instanceof Error ? error.message : String(error);
                setLoaded({ key: targetKey, hunks: [], error: message, token });
            });
        return () => {
            cancelled = true;
        };
    }, [repoPath, filePath, mode, reloadToken, targetKey]);

    const current = loaded.key === targetKey;
    const hunks = useMemo(() => (current ? loaded.hunks : []), [current, loaded.hunks]);
    // The stale list stays visible, but nothing may act on it.
    const loading = Boolean(repoPath) && (!current || loaded.token !== reloadToken);
    const error = current ? loaded.error : null;

    useEffect(() => {
        const onRefresh = () => reload();
        window.addEventListener("bettershape-git-refresh", onRefresh);
        return () => window.removeEventListener("bettershape-git-refresh", onRefresh);
    }, [reload]);

    // The restore dialog is a window in which the diff can reload: a refresh
    // from another pane, a save, a file watcher event. The captured hunk belongs
    // to the list it was read from, so the action checks that the same change is
    // still listed before it deletes anything.
    const hunksRef = useRef(hunks);
    useEffect(() => {
        hunksRef.current = hunks;
    }, [hunks]);

    /** True while the captured hunk is still the listed change, body included. */
    const stillListed = useCallback((target: GitHunk): boolean => {
        const signature = hunkSignature(target);
        return hunksRef.current.some((candidate) => hunkSignature(candidate) === signature);
    }, []);

    /** Stages, unstages or restores the whole hunk, then re-reads the diff. */
    const apply = useCallback(
        async (operation: "stage" | "unstage" | "restore") => {
            const hunk = hunks[index];
            if (!repoPath || !hunk || busy || loading) return;
            setBusy(true);
            try {
                // Restoring throws the hunk's changes away with nothing to undo
                // it, so it asks first, the same way discarding a whole file
                // does. Staging is an edit a second press can reverse.
                if (operation === "restore") {
                    if (!(await confirmRestore())) return;
                    // A reused position would discard a different hunk than the
                    // one the dialog described, which is why the check is here
                    // and not before the question.
                    if (!stillListed(hunk)) {
                        notify.error(
                            "Git",
                            "The diff changed while the dialog was open. Check the hunk again before restoring it.",
                        );
                        return;
                    }
                }
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
        [busy, filePath, hunks, index, loading, repoPath, stillListed],
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

    return { hunks, index, busy, loading, error, step, apply, reload };
}

/**
 * Hunk staging for the diff on screen. Ctrl+Y stages the current hunk and
 * Ctrl+Shift+Y unstages it, matching the editor diff conventions.
 */
export const HunkActions = ({
    repoPath,
    filePath,
    mode,
    active,
}: {
    repoPath: string | null;
    filePath: string;
    mode: HunkMode;
    active: boolean;
}) => {
    const { hunks, index, busy, loading, error, step, apply } = useFileHunks(repoPath, filePath, mode);
    const hunk = hunks[index];

    useEffect(() => {
        if (!active || hunks.length === 0) return;
        const onKey = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
            const key = event.key.toLowerCase();
            if (key !== "y") return;
            // A redo inside a text field must stay a redo; this handler listens
            // on the window, so it has to check where the keystroke landed.
            if (isEditableTarget(event.target)) return;
            if (event.shiftKey && mode === "staged") {
                event.preventDefault();
                apply("unstage").catch(() => undefined);
            } else if (!event.shiftKey && mode === "unstaged") {
                event.preventDefault();
                apply("stage").catch(() => undefined);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [active, apply, hunks.length, mode]);

    if (error && hunks.length === 0) {
        return (
            <span className="px-1 text-xs text-text-muted" role="status" title={error}>
                Hunks unavailable
            </span>
        );
    }
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
                            disabled={busy || loading}
                            onClick={() => { apply("stage").catch(() => undefined); }}
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
                            disabled={busy || loading}
                            onClick={() => { apply("restore").catch(() => undefined); }}
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
                        disabled={busy || loading}
                        onClick={() => { apply("unstage").catch(() => undefined); }}
                    >
                        <Icon icon={ArrowUndo20Regular} />
                    </Button>
                </Tooltip>
            )}
        </div>
    );
}
