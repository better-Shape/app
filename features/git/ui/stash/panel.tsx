"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { Add20Regular } from "@fluentui/react-icons/headless/svg/add";
import { Archive20Regular } from "@fluentui/react-icons/headless/svg/archive";
import { ArrowSync20Regular } from "@fluentui/react-icons/headless/svg/arrow-sync";

import { Button } from "@/components/ui/button";
import { FadeTruncate } from "@/components/ui/fade-truncate";
import { FileIcon } from "@/components/ui/file-icon";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll";
import { Toggle } from "@/components/ui/switch";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "@/components/ui/context";
import { commands, useProjectState } from "@/lib/backend";
import type { GitStashEntry } from "@/lib/backend/types";
import { formatCommandError } from "@/lib/errors/format";
import { useGitRepos } from "@/lib/git/repos";
import { notify } from "@/features/notifications";
import { useFilter } from "@/features/git/ui/manager/filter-context";
import { cn } from "@/lib/utils";
import {
    describeStashChange,
    filterStashRows,
    parseStashDiff,
    stashConfirmCopy,
    stashNow,
    stashSaveOutcome,
    stashState,
    type StashAction,
    type StashDiff,
    type StashDiffLine,
    type StashRow,
} from "./model";

type Preview =
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ready"; diff: StashDiff }
    | { kind: "failed"; message: string };

const LINE_MARK: Record<StashDiffLine["kind"], string> = {
    added: "+",
    removed: "-",
    context: " ",
};

const STATUS_WORD: Record<StashDiff["files"][number]["status"], string | null> = {
    added: "added",
    removed: "removed",
    modified: null,
    renamed: "renamed",
    binary: "binary",
};

function lineBackground(kind: StashDiffLine["kind"]): CSSProperties | undefined {
    if (kind === "added") return { background: "var(--diff-added-line-bg)" };
    if (kind === "removed") return { background: "var(--diff-removed-line-bg)" };
    return undefined;
}

function StateMessage({ title, detail }: { title: string; detail?: string }) {
    return (
        <div className="flex flex-col gap-1 px-3 py-4">
            <p className="text-sm text-text-primary">{title}</p>
            {detail ? <p className="text-xs text-text-muted">{detail}</p> : null}
        </div>
    );
}

function DiffLines({ lines }: { lines: StashDiffLine[] }) {
    return (
        <ul className="mt-1 font-mono text-xs">
            {lines.map((line, position) => (
                <li key={position} className="px-1" style={lineBackground(line.kind)}>
                    <span className="select-none text-text-muted">{LINE_MARK[line.kind]}</span>
                    <span className="ml-1 whitespace-pre text-text-secondary">{line.text}</span>
                </li>
            ))}
        </ul>
    );
}

function DiffFile({ file }: { file: StashDiff["files"][number] }) {
    const status = STATUS_WORD[file.status];
    return (
        <li className="px-2 py-1.5">
            <div className="flex items-center gap-1.5">
                <FileIcon name={file.path} className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary">
                    {file.previousPath ? `${file.previousPath} -> ${file.path}` : file.path}
                </span>
                {status ? <span className="shrink-0 text-2xs text-text-muted">{status}</span> : null}
                <span className="shrink-0 text-xs tabular-nums">
                    {file.insertions > 0 ? (
                        <span className="text-git-added">+{file.insertions}</span>
                    ) : null}
                    {file.insertions > 0 && file.deletions > 0 ? " " : null}
                    {file.deletions > 0 ? (
                        <span className="text-git-deleted">-{file.deletions}</span>
                    ) : null}
                </span>
            </div>
            {file.lines.length > 0 ? <DiffLines lines={file.lines} /> : null}
            {file.linesTruncated ? (
                <p className="mt-1 text-2xs text-text-muted">
                    More lines in this file are not shown. The counts above are for the whole file.
                </p>
            ) : null}
        </li>
    );
}

function PreviewPanel({
    preview,
    busy,
    onAction,
}: {
    preview: Preview;
    busy: StashAction | null;
    onAction: (action: StashAction) => void;
}) {
    if (preview.kind === "loading") {
        return <p className="px-2 py-2 text-xs text-text-muted">Loading changes...</p>;
    }
    if (preview.kind === "failed") {
        return <p className="px-2 py-2 text-xs text-error">{preview.message}</p>;
    }
    if (preview.kind !== "ready") return null;
    const diff = preview.diff;
    return (
        <>
            <p className="px-2 pt-1.5 text-xs text-text-muted">{describeStashChange(diff)}</p>
            {diff.files.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-text-muted">
                    This diff is empty. Files saved with the untracked toggle are not part of it,
                    so a stash that only holds new files looks like this.
                </p>
            ) : (
                <ul className="flex flex-col divide-y divide-border-subtle">
                    {diff.files.map((file) => (
                        <DiffFile key={file.path} file={file} />
                    ))}
                </ul>
            )}
            {diff.filesTruncated ? (
                <p className="px-2 py-1.5 text-2xs text-text-muted">
                    Showing {diff.files.length} of {diff.filesChanged} files. The counts above cover
                    every file.
                </p>
            ) : null}
            <div className="flex items-center gap-1.5 border-t border-border-subtle px-1.5 py-1.5">
                <Button
                    size="xs"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => onAction("apply")}
                >
                    Apply
                </Button>
                <Button
                    size="xs"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => onAction("pop")}
                >
                    Pop
                </Button>
                <Button
                    size="xs"
                    variant="destructive"
                    disabled={busy !== null}
                    onClick={() => onAction("drop")}
                >
                    Drop
                </Button>
            </div>
        </>
    );
}

function successCopy(action: StashAction, row: StashRow): string {
    if (action === "apply") return `Applied ${row.ref}. The stash stays in the list.`;
    if (action === "pop") return `Applied and dropped ${row.ref}.`;
    return `Dropped ${row.ref}.`;
}

export function StashPanel() {
    const { project_path } = useProjectState();
    const { scmRepoPath } = useGitRepos(project_path);
    const repoPath = scmRepoPath ?? project_path ?? null;
    const { query } = useFilter();

    const [entries, setEntries] = useState<GitStashEntry[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [message, setMessage] = useState("");
    const [includeUntracked, setIncludeUntracked] = useState(true);
    const [saving, setSaving] = useState(false);

    const [openKey, setOpenKey] = useState<string | null>(null);
    const [preview, setPreview] = useState<Preview>({ kind: "idle" });
    const [previews, setPreviews] = useState<Record<string, StashDiff>>({});
    const [pending, setPending] = useState<{ key: string; action: StashAction } | null>(null);
    const [actionError, setActionError] = useState<{ key: string; message: string } | null>(null);

    // Two guards. `listSeq` keeps a slow `git stash list` from overwriting a newer one,
    // and `previewSeq` keeps a slow preview of one row from landing under another row.
    const listSeq = useRef(0);
    const previewSeq = useRef(0);
    const previewId = useId();

    const load = useCallback(async () => {
        if (!repoPath) return;
        const seq = ++listSeq.current;
        setLoading(true);
        try {
            const list = await commands.gitStashList(repoPath);
            if (seq !== listSeq.current) return;
            setEntries(list);
            setError(null);
        } catch (err) {
            if (seq !== listSeq.current) return;
            setEntries(null);
            setError(formatCommandError(err, "Could not read stashes").message);
        } finally {
            if (seq === listSeq.current) setLoading(false);
        }
    }, [repoPath]);

    /**
     * Clear the previous repo's stashes while rendering, so a repo switch never
     * paints the old rows under the new path even for one frame. The fetch that
     * fills them stays in the effect below, keyed on `load`.
     */
    const [shownFor, setShownFor] = useState(repoPath);
    if (shownFor !== repoPath) {
        setShownFor(repoPath);
        setEntries(null);
    }

    useEffect(() => {
        // `load` is the fetch, and its `setLoading(true)` is that fetch's own
        // loading flag, so the write belongs to this effect rather than to a
        // render-derived value. The stashes it replaces are cleared while
        // rendering, above.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load();
    }, [load]);

    useEffect(() => {
        const onRefresh = () => void load();
        window.addEventListener("bettershape-git-refresh", onRefresh);
        return () => window.removeEventListener("bettershape-git-refresh", onRefresh);
    }, [load]);

    const state = stashState({
        repoPath,
        projectPath: project_path ?? null,
        loading,
        error,
        entries,
        nowMs: stashNow(),
    });

    const rows = state.kind === "ready" ? filterStashRows(state.rows, query) : [];
    const total = state.kind === "ready" ? state.rows.length : 0;

    const closePreview = useCallback(() => {
        previewSeq.current += 1;
        setOpenKey(null);
        setPreview({ kind: "idle" });
    }, []);

    const togglePreview = useCallback(
        async (row: StashRow) => {
            if (row.index === null) return;
            if (openKey === row.key) {
                closePreview();
                return;
            }
            const seq = ++previewSeq.current;
            setOpenKey(row.key);
            const cached = previews[row.key];
            if (cached) {
                setPreview({ kind: "ready", diff: cached });
                return;
            }
            if (!repoPath) return;
            setPreview({ kind: "loading" });
            try {
                const patch = await commands.gitStashShow(repoPath, row.index);
                if (seq !== previewSeq.current) return;
                const diff = parseStashDiff(patch);
                setPreviews((prev) => ({ ...prev, [row.key]: diff }));
                setPreview({ kind: "ready", diff });
            } catch (err) {
                if (seq !== previewSeq.current) return;
                setPreview({
                    kind: "failed",
                    message: formatCommandError(err, "Could not read this stash").message,
                });
            }
        },
        [openKey, previews, repoPath, closePreview],
    );

    const handleSave = useCallback(async () => {
        if (!repoPath || saving) return;
        setSaving(true);
        try {
            const before = await commands.gitStashList(repoPath);
            await commands.gitStashSave(repoPath, message.trim(), includeUntracked);
            const after = await commands.gitStashList(repoPath);
            if (stashSaveOutcome(before, after) === "nothing-to-stash") {
                notify.info("Git", "Nothing to stash. The working tree has no changes git can save.");
            } else {
                notify.success("Git", "Changes stashed.");
                setMessage("");
            }
            closePreview();
            setPreviews({});
        } catch (err) {
            notify.gitError(err, "Stash failed");
        } finally {
            setSaving(false);
            window.dispatchEvent(new Event("bettershape-git-refresh"));
            await load();
        }
    }, [repoPath, saving, message, includeUntracked, load, closePreview]);

    const runAction = useCallback(
        async (row: StashRow, action: StashAction) => {
            if (!repoPath || row.index === null) return;
            const diff = previews[row.key] ?? null;
            const copy = stashConfirmCopy(action, row, diff);
            const ok = await confirm(copy.message, {
                title: copy.title,
                kind: action === "apply" ? "info" : "warning",
                okLabel: copy.okLabel,
                cancelLabel: "Cancel",
            });
            if (!ok) return;

            setPending({ key: row.key, action });
            setActionError(null);
            try {
                if (action === "apply") await commands.gitStashApply(repoPath, row.index);
                else if (action === "pop") await commands.gitStashPop(repoPath, row.index);
                else await commands.gitStashDrop(repoPath, row.index);
                notify.success("Git", successCopy(action, row));
                closePreview();
                setPreviews({});
            } catch (err) {
                setActionError({
                    key: row.key,
                    message: formatCommandError(err, `Stash ${action} failed`).message,
                });
                notify.gitError(err, `Stash ${action} failed`);
            } finally {
                setPending(null);
                // A failed pop can leave conflict markers in the working tree, so the
                // source panel needs the nudge whether or not the action succeeded.
                window.dispatchEvent(new Event("bettershape-git-refresh"));
                await load();
            }
        },
        [repoPath, previews, closePreview, load],
    );

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex h-9 shrink-0 items-center justify-between gap-2 px-3">
                <FadeTruncate className="min-w-0 flex-1 text-sm font-regular" title="Stash">
                    Stash
                </FadeTruncate>
                {total > 0 ? (
                    <span className="shrink-0 text-xs text-text-muted">
                        {total} {total === 1 ? "stash" : "stashes"}
                    </span>
                ) : null}
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    aria-label="Refresh stashes"
                    disabled={!repoPath}
                    onClick={() => void load()}
                >
                    <Icon
                        icon={ArrowSync20Regular}
                        className={cn(loading && "animate-spin motion-reduce:animate-none")}
                    />
                </Button>
            </div>

            {repoPath ? (
                <div className="shrink-0 px-2.5 pb-2">
                    <div className="flex items-center gap-2">
                        <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-transparent px-2.5">
                            <Icon icon={Add20Regular} className="shrink-0 text-text-muted" />
                            <Input
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                placeholder="Stash message (optional)"
                                aria-label="Stash message"
                                className="h-auto! bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
                                disabled={saving}
                                spellCheck={false}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        void handleSave();
                                    }
                                }}
                            />
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-8 shrink-0"
                            disabled={saving}
                            onClick={() => void handleSave()}
                        >
                            {saving ? "Saving..." : "Save stash"}
                        </Button>
                    </div>
                    <div className="mt-1.5 flex items-center">
                        <Toggle
                            label="Include untracked files"
                            labelPosition="left"
                            checked={includeUntracked}
                            onCheckedChange={setIncludeUntracked}
                            disabled={saving}
                        />
                    </div>
                </div>
            ) : null}

            <ScrollArea className="min-h-0 flex-1 px-2 pb-3" fadeFrom="from-panel">
                {state.kind === "blocked" ? (
                    <StateMessage
                        title={state.reason === "no-project" ? "No project open" : "No Git repository"}
                        detail={
                            state.reason === "no-project"
                                ? "Open a folder to work with its stashes."
                                : "This folder is not a Git repository yet."
                        }
                    />
                ) : state.kind === "loading" ? (
                    <StateMessage title="Reading stashes..." />
                ) : state.kind === "failed" ? (
                    <div className="flex flex-col items-start gap-2 px-3 py-4">
                        <p className="text-sm text-text-primary">Stashes didn&apos;t load</p>
                        <p className="text-xs text-text-muted">{state.message}</p>
                        <Button size="xs" variant="outline" onClick={() => void load()}>
                            Try again
                        </Button>
                    </div>
                ) : total === 0 ? (
                    <StateMessage
                        title="No stashes"
                        detail="Save one above, or stash your changes from Source Control."
                    />
                ) : rows.length === 0 ? (
                    <p className="px-2 py-6 text-sm text-text-muted">No stash matches the search.</p>
                ) : (
                    <ul className="flex flex-col gap-0.5">
                        {rows.map((row) => {
                            const busy = pending && pending.key === row.key ? pending.action : null;
                            const open = openKey === row.key;
                            return (
                                <li key={row.key}>
                                    <ContextMenu>
                                        <ContextMenuTrigger asChild>
                                            <button
                                                type="button"
                                                aria-expanded={open}
                                                aria-controls={open ? previewId : undefined}
                                                aria-label={`${row.ref} ${row.label}${
                                                    row.branch ? ` on ${row.branch}` : ""
                                                }, ${row.when}`}
                                                disabled={row.index === null}
                                                onClick={() => void togglePreview(row)}
                                                className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--row-hover)] focus-visible:bg-panel-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus-ring disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                <Icon
                                                    icon={Archive20Regular}
                                                    className="mt-0.5 shrink-0 text-text-muted"
                                                />
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate text-sm text-text-primary">
                                                        {row.label}
                                                    </span>
                                                    <span className="block truncate text-xs text-text-muted">
                                                        {row.ref}
                                                        {row.branch ? ` · ${row.branch}` : ""} ·{" "}
                                                        {row.when}
                                                    </span>
                                                </span>
                                            </button>
                                        </ContextMenuTrigger>
                                        <ContextMenuContent>
                                            <ContextMenuItem
                                                disabled={row.index === null}
                                                onClick={() => void togglePreview(row)}
                                            >
                                                {open ? "Hide changes" : "Preview changes"}
                                            </ContextMenuItem>
                                            <ContextMenuItem
                                                disabled={row.index === null}
                                                onClick={() => {
                                                    void navigator.clipboard.writeText(row.ref);
                                                    notify.success("Copied", "Stash ref copied.");
                                                }}
                                            >
                                                Copy stash ref
                                            </ContextMenuItem>
                                            <ContextMenuItem
                                                disabled={row.index === null}
                                                onClick={() => {
                                                    void navigator.clipboard.writeText(row.label);
                                                    notify.success("Copied", "Stash message copied.");
                                                }}
                                            >
                                                Copy message
                                            </ContextMenuItem>
                                            <ContextMenuSeparator />
                                            <ContextMenuItem
                                                disabled={row.index === null || busy !== null}
                                                onClick={() => void runAction(row, "pop")}
                                            >
                                                Pop stash...
                                            </ContextMenuItem>
                                            <ContextMenuItem
                                                className="text-error focus:text-error"
                                                disabled={row.index === null || busy !== null}
                                                onClick={() => void runAction(row, "drop")}
                                            >
                                                Drop stash...
                                            </ContextMenuItem>
                                        </ContextMenuContent>
                                    </ContextMenu>

                                    {actionError?.key === row.key ? (
                                        <p className="mx-2 mb-1 ml-6 rounded-md border border-border-subtle px-2 py-1.5 text-xs text-error">
                                            {actionError.message}
                                        </p>
                                    ) : null}

                                    {open ? (
                                        <div
                                            id={previewId}
                                            className="mb-1 ml-6 mr-2 overflow-hidden rounded-md border border-border-subtle bg-editor"
                                        >
                                            <PreviewPanel
                                                preview={preview}
                                                busy={busy}
                                                onAction={(action) => void runAction(row, action)}
                                            />
                                        </div>
                                    ) : null}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </ScrollArea>
        </div>
    );
}