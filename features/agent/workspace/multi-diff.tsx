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

import { ALL_CHANGES_FOCUS_KEY, openAllChangesTab } from "@/lib/window/open-all-changes";

export { openAllChangesTab };

function fileName(path: string) {
    return path.split(/[\\/]/).pop() || path;
}

function fileDir(path: string) {
    const parts = path.replace(/\\/g, "/").split("/");
    if (parts.length <= 1) return "";
    return parts.slice(0, -1).join("/");
}

async function loadSides(
    repo: string,
    file: GitFileParams,
): Promise<{ original: string; current: string }> {
    const abs = `${repo.replace(/(?<![\\/])[\\/]+$/, "")}/${file.path.replace(/\\/g, "/")}`;
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
}: {
    repo: string;
    file: GitFileParams;
    split: boolean;
    focused: boolean;
}) {
    const hostRef = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(focused);
    const key = `${file.staged ? "s" : "u"}:${file.path}`;
    const [diff, setDiff] = useScopedState<FileDiff | null>([visible, repo, key], () => visible && repo ? { file, original: "", current: "", loading: true } : null);
    const dir = fileDir(file.path);
    const name = fileName(file.path);
    const domId = `md-file-${file.path.replace(/[\\/]/g, "-")}`;

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
        void loadSides(repo, file).then((sides) => {
            if (cancelled) return;
            setDiff({ file, ...sides, loading: false });
        });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when path/stage flips
    }, [visible, repo, key, setDiff]);

    const toggleStage = async () => {
        try {
            if (file.staged) await commands.gitUnstage(repo, file.path);
            else await commands.gitStage(repo, file.path);
            window.dispatchEvent(new Event("bettershape-git-refresh"));
        } catch (err) {
            notify.gitError(err);
        }
    };

    const discard = async () => {
        try {
            await commands.gitDiscardChanges(repo, file.path);
            window.dispatchEvent(new Event("bettershape-git-refresh"));
        } catch (err) {
            notify.error("Git", err instanceof Error ? err.message : String(err));
        }
    };

    const openFile = async () => {
        const abs = `${repo.replace(/(?<![\\/])[\\/]+$/, "")}/${file.path.replace(/\\/g, "/")}`;
        await openProjectFile(abs, name);
    };

    return (
        <section
            ref={hostRef}
            id={domId}
            role="presentation"
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
                    onClick={() => void toggleStage()}
                >
                    {file.staged ? "Unstage" : "Stage"}
                </Button>
                <Button
                    type="button"
                    onClick={() => void openFile()}
                    variant="ghost"
                    size="xs"
                    title="Open File"
                >
                    Open File
                </Button>
                <Button
                    type="button"
                    onClick={() => void discard()}
                    variant="ghost"
                    size="icon"
                    aria-label="Restore"
                    title="Restore"
                >
                    <Icon icon={ArrowUndo20Regular} />
                </Button>
            </div>

            <div className="relative min-h-[120px] max-h-[420px]">
                {!visible ? (
                    <div className="flex h-[120px] items-center px-4 text-sm text-text-muted">
                        Scroll to load diff
                    </div>
                ) : diff?.loading ? (
                    <div className="p-4 text-sm text-text-muted">Loading…</div>
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

export function MultiDiffEditor({
    projectPath,
    focusPath,
}: {
    projectPath: string;
    focusPath?: string;
}) {
    const [repo, setRepo] = useState<string | null>(null);
    const [files, setFiles] = useState<GitFileParams[]>([]);
    const [busy, setBusy] = useState(false);
    const [split, setSplit] = useState(true);

    // Latest refresh wins: a status request for a previous project must not
    // replace the current project's repo or file list when it resolves late.
    const requestRef = useRef(0);
    const refresh = useCallback(() => {
        const request = ++requestRef.current;
        return discoverGitRepos(projectPath).then(async repos => {
            const path = pickDefaultRepo(projectPath, repos) ?? projectPath;
            const list = await commands.gitStatus(path);
            if (request !== requestRef.current) return;
            setRepo(path);
            setFiles(list);
        }).catch(() => {
            if (request === requestRef.current) setFiles([]);
        });
    }, [projectPath]);

    useEffect(() => {
        void refresh();
        const on = () => void refresh();
        window.addEventListener("bettershape-git-refresh", on);
        return () => window.removeEventListener("bettershape-git-refresh", on);
    }, [refresh]);

    useEffect(() => {
        if (!focusPath) return;
        const id = `md-file-${focusPath.replace(/[\\/]/g, "-")}`;
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
                    onClick={() => void stageAll()}
                    variant="ghost"
                    size="xs"
                >
                    Stage All
                </Button>
                <Button
                    type="button"
                    disabled={busy || !files.some((f) => f.staged)}
                    onClick={() => void unstageAll()}
                    variant="ghost"
                    size="xs"
                >
                    Unstage
                </Button>
                <Button
                    type="button"
                    disabled={busy || files.length === 0}
                    onClick={() => void commit()}
                    variant="default"
                    className="bg-success/20 text-success"
                    size="xs"
                >
                    Commit
                </Button>
            </div>

            {files.length === 0 || !repo ? (
                <div className="flex flex-1 items-center justify-center text-sm text-text-muted">
                    {files.length === 0 ? "No local changes" : "Loading…"}
                </div>
            ) : (
                <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
                    {ordered.map((file) => {
                        const key = `${file.staged ? "s" : "u"}:${file.path}`;
                        const focused =
                            Boolean(focusPath) &&
                            file.path.replace(/\\/g, "/") === focusPath!.replace(/\\/g, "/");
                        return (
                            <LazyFileDiff
                                key={key}
                                repo={repo}
                                file={file}
                                split={split}
                                focused={focused}
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
    const [focusPath] = useState<string | undefined>(() => {
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
    }, []);
    return (
        <div className="h-full min-h-0 bg-sidebar">
            <MultiDiffEditor projectPath={projectPath} focusPath={focusPath} />
        </div>
    );
}
