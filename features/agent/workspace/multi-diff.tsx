"use client";

import { useScopedState } from "@/lib/ui/use-scoped-state";

import { ArrowUndo20Regular } from "@fluentui/react-icons/headless/svg/arrow-undo";
import { LayoutColumnTwo20Regular } from "@fluentui/react-icons/headless/svg/layout-column-two";


import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { commands, type GitFileParams } from "@/lib/backend";
import { Icon } from "@/components/ui/icon";

import { cn } from "@/lib/utils";
import { notify } from "@/features/notifications";
import { discoverGitRepos, pickDefaultRepo } from "@/lib/git/repos";
import { openProjectFile } from "@/lib/window/open-project-file";
import { DiffView } from "@/features/editor/ui/diff/diff-view";
import { Button } from "@/components/ui/button";
import { HoldButton } from "@/components/ui/hold-button";
import { Tooltip } from "@/components/ui/tooltip";
import { discardGitFileChange } from "./file-diff";

import { ALL_CHANGES_FOCUS_EVENT, ALL_CHANGES_FOCUS_KEY, openAllChangesTab } from "@/lib/window/open-all-changes";

export { openAllChangesTab };

/** Extracts the trailing file name from a slash- or backslash-delimited path. */
function fileName(path: string) {
    return path.split(/[\\/]/).pop() || path;
}

/** Extracts the parent directory portion of a relative path. */
function fileDir(path: string) {
    const parts = path.replaceAll("\\", "/").split("/");
    if (parts.length <= 1) return "";
    return parts.slice(0, -1).join("/");
}

/** Loads original (`HEAD`) and current working-tree text for a changed file. */
async function loadSides(
    repo: string,
    file: GitFileParams,
): Promise<{ original: string; current: string }> {
    const abs = `${repo.replace(/(?<![\\/])[\\/]+$/, "")}/${file.path.replaceAll("\\", "/")}`;
    let current = "";
    try {
        current = await commands.readFile(abs);
    } catch {
        current = "";
    }
    let original = "";
    try {
        original = await commands.gitGetFileAtRef(repo, "HEAD", file.path);
    } catch {
        original = "";
    }
    return { original, current };
}

type FileDiff = {
    file: GitFileParams;
    original: string;
    current: string;
    loading: boolean;
};

/** Lazily load + mount a single file diff when scrolled into view. */
function LazyFileDiff({
    repo,
    file,
    split,
    focused,
    revision,
}: {
    repo: string;
    file: GitFileParams;
    split: boolean;
    focused: boolean;
    /** Bumped by every refresh; a changed value drops the cached diff. */
    revision: number;
}) {
    const hostRef = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(focused);
    const [hover, setHover] = useState(false);
    const [focusWithin, setFocusWithin] = useState(false);
    const [holdActive, setHoldActive] = useState(false);
    const key = `${file.staged ? "s" : "u"}:${file.path}`;
    const [diff, setDiff] = useScopedState<FileDiff | null>(
        [visible, repo, key, revision],
        () => (visible && repo ? { file, original: "", current: "", loading: true } : null),
    );
    const dir = fileDir(file.path);
    const name = fileName(file.path);
    const domId = `md-file-${file.path.replaceAll("\\", "-").replaceAll("/", "-")}`;

    if (focused && !visible) setVisible(true);

    useEffect(() => {
        const el = hostRef.current;
        if (!el || visible) return;
        const io = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting)) {
                    setVisible(true);
                    io.disconnect();
                }
            },
            { rootMargin: "240px 0px" },
        );
        io.observe(el);
        return () => io.disconnect();
    }, [visible]);

    useEffect(() => {
        if (!visible || !repo) return;
        let cancelled = false;
        loadSides(repo, file)
            .then((sides) => {
                if (cancelled) return;
                setDiff({ file, ...sides, loading: false });
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when path/stage/revision flips
    }, [visible, repo, key, revision, setDiff]);

    const toggleStage = async () => {
        try {
            if (file.staged) await commands.gitUnstage(repo, file.path);
            else await commands.gitStage(repo, file.path);
            window.dispatchEvent(new Event("bettershape-git-refresh"));
        } catch (err) {
            notify.gitError(err);
        }
    };

    const discard = (): Promise<boolean> =>
        discardGitFileChange({
            repo,
            path: file.path,
            staged: file.staged,
            status: file.status,
        });

    const openFile = async () => {
        const abs = `${repo.replace(/(?<![\\/])[\\/]+$/, "")}/${file.path.replaceAll("\\", "/")}`;
        await openProjectFile(abs, name);
    };

    const showOverlay = hover || focusWithin || holdActive;

    const handleSectionBlurCapture = (event: React.FocusEvent<HTMLElement>) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
        setFocusWithin(false);
    };

    return (
        <section
            ref={hostRef}
            id={domId}
            role="presentation"
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            onFocusCapture={() => setFocusWithin(true)}
            onBlurCapture={handleSectionBlurCapture}
        >
            <div className="sticky top-1 z-[1] flex h-9 items-center gap-2 bg-panel pl-3 border-b border-border">
                <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-border-subtle">
                    <span
                        className={cn(
                            "size-3 rounded-xs",
                            file.staged ? "bg-success" : "bg-[var(--git-modified)]",
                        )}
                    />
                </span>
                <span className="inline-flex min-w-0 max-w-[50%] items-center overflow-hidden font-sans text-sm">
                    <span className="shrink-0 text-text-primary">{name}</span>
                    {dir ? <span className="ml-1.5 truncate text-text-muted">{dir}</span> : null}
                </span>
                <span className="flex-1" />
                <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                        toggleStage().catch(() => undefined);
                    }}
                >
                    {file.staged ? "Unstage" : "Stage"}
                </Button>
                <Button
                    type="button"
                    onClick={() => {
                        openFile().catch(() => undefined);
                    }}
                    variant="ghost"
                    size="xs"
                    title="Open File"
                >
                    Open File
                </Button>
                <Tooltip content="Hold to restore file">
                    <HoldButton
                        size="icon"
                        onConfirm={() => discard()}
                        ariaLabel="Restore file"
                        icon={<Icon icon={ArrowUndo20Regular} />}
                    />
                </Tooltip>
            </div>

            <div className="relative min-h-[120px] max-h-[420px]">
                {showOverlay ? (
                    <div className="absolute right-3 top-2 z-[2] flex gap-1">
                        <Button
                            type="button"
                            onClick={() => {
                                toggleStage().catch(() => undefined);
                            }}
                            variant="ghost"
                            className="bg-surface-4"
                            size="xs"
                        >
                            {file.staged ? "Unstage" : "Stage"}
                        </Button>
                        <HoldButton
                            size="xs"
                            onConfirm={() => discard()}
                            onStateChange={(next) => setHoldActive(next !== "idle")}
                            ariaLabel="Restore file"
                            label="Restore"
                            armedLabel="Confirm"
                            className="bg-surface-4 text-text-primary"
                        />
                    </div>
                ) : null}
                {!visible ? (
                    <div className="flex h-[120px] items-center px-4 text-sm text-text-muted">
                        Scroll to load diff
                    </div>
                ) : diff?.loading ? (
                    <div className="p-4 text-sm text-text-muted">Loading...</div>
                ) : (
                    <DiffView
                        path={file.path}
                        originalContent={diff?.original ?? ""}
                        content={diff?.current ?? ""}
                        mode={split ? "split" : "unified"}
                        className="max-h-[420px]"
                    />
                )}
            </div>
        </section>
    );
}

/** Shared empty list, so a pending project does not churn dependent memos. */
const EMPTY_FILES: GitFileParams[] = [];

const EMPTY_STATE_CLASS =
    "flex flex-1 flex-col items-center justify-center gap-2 px-6 text-sm text-text-muted";

/** Renders the loading, error-with-retry, or clean-tree empty state for `MultiDiffEditor`. */
function MultiDiffEmptyState({
    loading,
    error,
    busy,
    onRetry,
}: {
    loading: boolean;
    error: string | null;
    busy: boolean;
    onRetry: () => void;
}) {
    if (loading) {
        return <div className={EMPTY_STATE_CLASS}>Loading...</div>;
    }
    if (error) {
        return (
            <div className={EMPTY_STATE_CLASS}>
                <span className="text-text-primary">Could not read changes</span>
                <span className="max-w-[420px] text-center text-xs" title={error}>
                    {error}
                </span>
                <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={busy}
                    onClick={onRetry}
                >
                    Retry
                </Button>
            </div>
        );
    }
    return <div className={EMPTY_STATE_CLASS}>No local changes</div>;
}

/** Renders a scrollable stacked diff view across all modified repository files. */
export function MultiDiffEditor({
    projectPath,
    focusPath,
}: {
    projectPath: string;
    focusPath?: string;
}) {
    // The repository and the file list are tagged with the project they were read
    // for. Discovery and status are async, so a project switch has to invalidate
    // them at once: staging from another project's list would act on a repository
    // nobody is looking at.
    const [loaded, setLoaded] = useState<{
        project: string;
        repo: string;
        files: GitFileParams[];
        // A failed read is its own state: reporting it as "no local changes"
        // tells the user their tree is clean when the truth is unknown.
        error: string | null;
    } | null>(null);
    const [busy, setBusy] = useState(false);
    const [split, setSplit] = useState(true);
    // The file list can be identical after a refresh while the contents moved,
    // so every successful refresh also bumps a revision the diffs key on.
    const [revision, setRevision] = useState(0);
    const current = loaded?.project === projectPath ? loaded : null;
    const loading = Boolean(projectPath) && !current;
    const repo = current?.repo ?? null;
    const files = current?.files ?? EMPTY_FILES;

    // Latest refresh wins: a status request for a previous project must not
    // replace the current project's repo or file list when it resolves late.
    const requestRef = useRef(0);
    const refresh = useCallback(() => {
        const request = ++requestRef.current;
        return discoverGitRepos(projectPath)
            .then(async (repos) => {
                const path = pickDefaultRepo(projectPath, repos) ?? projectPath;
                const list = await commands.gitStatus(path);
                if (request !== requestRef.current) return;
                setLoaded({ project: projectPath, repo: path, files: list, error: null });
                setRevision((count) => count + 1);
            })
            .catch((err) => {
                if (request !== requestRef.current) return;
                // Settle the request so the view leaves "Loading...", keeping the
                // reason: discovery or status can fail for reasons a retry fixes.
                setLoaded({
                    project: projectPath,
                    repo: "",
                    files: EMPTY_FILES,
                    error: err instanceof Error ? err.message : String(err),
                });
                setRevision((count) => count + 1);
            });
    }, [projectPath]);

    useEffect(() => {
        refresh().catch(() => undefined);
        const on = () => {
            refresh().catch(() => undefined);
        };
        window.addEventListener("bettershape-git-refresh", on);
        return () => window.removeEventListener("bettershape-git-refresh", on);
    }, [refresh]);

    useEffect(() => {
        if (!focusPath) return;
        const id = `md-file-${focusPath.replaceAll("\\", "-").replaceAll("/", "-")}`;
        requestAnimationFrame(() => {
            document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    }, [focusPath, files]);

    const stageAll = async () => {
        if (!repo) return;
        setBusy(true);
        try {
            await commands.gitStageAll(repo);
            window.dispatchEvent(new Event("bettershape-git-refresh"));
            await refresh();
        } catch (err) {
            notify.gitError(err);
        } finally {
            setBusy(false);
        }
    };

    const unstageAll = async () => {
        if (!repo) return;
        setBusy(true);
        try {
            for (const f of files.filter((x) => x.staged)) {
                await commands.gitUnstage(repo, f.path);
            }
            window.dispatchEvent(new Event("bettershape-git-refresh"));
            await refresh();
        } catch (err) {
            notify.gitError(err);
        } finally {
            setBusy(false);
        }
    };

    const commit = async () => {
        if (!repo || files.length === 0) return;
        setBusy(true);
        try {
            await commands.gitStageAll(repo);
            const name = fileName(files[0]?.path ?? "files");
            const message =
                files.length === 1 ? `Update ${name}` : `Update ${files.length} files`;
            await commands.gitCommit(repo, message);
            window.dispatchEvent(new Event("bettershape-git-refresh"));
            await refresh();
        } catch (err) {
            notify.gitError(err);
        } finally {
            setBusy(false);
        }
    };

    const ordered = useMemo(() => {
        const staged = files.filter((f) => f.staged);
        const unstaged = files.filter((f) => !f.staged);
        return [...unstaged, ...staged];
    }, [files]);

    const normalizedFocusPath = focusPath ? focusPath.replaceAll("\\", "/") : null;

    return (
        <div className="flex h-full min-h-0 flex-col bg-panel">
            <div className="flex h-9 shrink-0 items-center gap-1 px-3 text-sm bg-panel">
                <span className="mr-1 font-medium text-text-primary">All changes</span>
                <span className="text-text-muted">{files.length}</span>
                <span className="flex-1" />
                <Button
                    type="button"
                    onClick={() => setSplit((v) => !v)}
                    variant="ghost"
                    size="xs"
                    aria-label="Toggle split"
                    title={split ? "Unified" : "Side by side"}
                >
                    <Icon icon={LayoutColumnTwo20Regular} />
                </Button>
                <Button
                    type="button"
                    disabled={busy || !files.some((f) => !f.staged)}
                    onClick={() => {
                        stageAll().catch(() => undefined);
                    }}
                    variant="ghost"
                    size="xs"
                >
                    Stage All
                </Button>
                <Button
                    type="button"
                    disabled={busy || !files.some((f) => f.staged)}
                    onClick={() => {
                        unstageAll().catch(() => undefined);
                    }}
                    variant="ghost"
                    size="xs"
                >
                    Unstage
                </Button>
                <Button
                    type="button"
                    disabled={busy || files.length === 0}
                    onClick={() => {
                        commit().catch(() => undefined);
                    }}
                    variant="default"
                    className="bg-success/20 text-success"
                    size="xs"
                >
                    Commit
                </Button>
            </div>

            {files.length === 0 || !repo ? (
                <MultiDiffEmptyState
                    loading={loading}
                    error={current?.error ?? null}
                    busy={busy}
                    onRetry={() => {
                        setBusy(true);
                        refresh().finally(() => setBusy(false));
                    }}
                />
            ) : (
                <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
                    {ordered.map((file) => {
                        const key = `${file.staged ? "s" : "u"}:${file.path}`;
                        const focused =
                            normalizedFocusPath !== null &&
                            file.path.replaceAll("\\", "/") === normalizedFocusPath;
                        return (
                            <LazyFileDiff
                                key={key}
                                repo={repo}
                                file={file}
                                split={split}
                                focused={focused}
                                revision={revision}
                            />
                        );
                    })}
                </div>
            )}
        </div>
    );
}

/**
 * Workspace tab body for the all-changes view. The focus path is handed over
 * once through sessionStorage because the tab is created by an event that
 * carries only its kind.
 */
export function AllChangesTab({ projectPath }: { projectPath: string }) {
    const [focusPath, setFocusPath] = useState<string | undefined>(() => {
        try {
            return sessionStorage.getItem(ALL_CHANGES_FOCUS_KEY) ?? undefined;
        } catch {
            return undefined;
        }
    });
    useEffect(() => {
        try {
            sessionStorage.removeItem(ALL_CHANGES_FOCUS_KEY);
        } catch {
            /* ignore */
        }
        // Opening the tab again while it is already mounted must move the view
        // to the new file, so the request is also delivered as an event.
        const onFocus = (event: Event) => {
            // The event has now been delivered, so the stored copy has to go: a
            // later mount that reads it would focus a file nobody asked for.
            try {
                sessionStorage.removeItem(ALL_CHANGES_FOCUS_KEY);
            } catch {
                /* unavailable storage cannot hold a stale path either */
            }
            setFocusPath((event as CustomEvent<string | undefined>).detail || undefined);
        };
        window.addEventListener(ALL_CHANGES_FOCUS_EVENT, onFocus);
        return () => window.removeEventListener(ALL_CHANGES_FOCUS_EVENT, onFocus);
    }, []);
    return (
        <div className="h-full min-h-0 bg-sidebar">
            <MultiDiffEditor projectPath={projectPath} focusPath={focusPath} />
        </div>
    );
}
