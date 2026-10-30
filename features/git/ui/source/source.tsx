"use client";

import { ArrowDownload20Regular } from "@fluentui/react-icons/headless/svg/arrow-download";
import { ArrowSync20Regular } from "@fluentui/react-icons/headless/svg/arrow-sync";
import { ArrowUp20Regular } from "@fluentui/react-icons/headless/svg/arrow-up";
import { ArrowUpload20Regular } from "@fluentui/react-icons/headless/svg/arrow-upload";
import { Branch20Regular } from "@fluentui/react-icons/headless/svg/branch";
import { Checkmark20Regular } from "@fluentui/react-icons/headless/svg/checkmark";
import { ChevronDown20Regular } from "@fluentui/react-icons/headless/svg/chevron-down";
import { ChevronRight20Regular } from "@fluentui/react-icons/headless/svg/chevron-right";
import { Clipboard20Regular } from "@fluentui/react-icons/headless/svg/clipboard";
import { Delete20Filled } from "@fluentui/react-icons/headless/svg/delete";
import { Dismiss20Regular } from "@fluentui/react-icons/headless/svg/dismiss";
import { DocumentText20Regular } from "@fluentui/react-icons/headless/svg/document-text";
import { Edit20Regular } from "@fluentui/react-icons/headless/svg/edit";
import { Folder20Filled } from "@fluentui/react-icons/headless/svg/folder";
import { LayoutColumnTwo20Regular } from "@fluentui/react-icons/headless/svg/layout-column-two";
import { LayoutRowTwo20Regular } from "@fluentui/react-icons/headless/svg/layout-row-two";
import { MoreHorizontal20Regular } from "@fluentui/react-icons/headless/svg/more-horizontal";


import React, { useState, useCallback, useEffect, useRef } from "react";
import { Icon } from "@/components/ui/icon";

import { cn } from "@/lib/utils";
import { useCopyToClipboard } from "@/lib/ui/use-copy";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { FileIcon } from "@/components/ui/file-icon";
import { ManagerDiffEditor } from "@/features/git/ui/shared/manager-diff";
import {
    GenerateStarButton,
    streamTextInto,
} from "@/features/git/ui/shared/generate-star";
import { GitAiAction } from "@/features/git/ui/shared/ai-insight";
import { Panel, SidebarPanelHeaderFrame } from "@/features/panels";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger
} from "@/components/ui/context";
import { Checkmark, DrawnCheck } from "@/components/ui/checkmark";
import {
    commands,
    useProjectState,
    GitFileParams,
    GitLogEntry,
    GitRepoInfo,
} from "@/lib/backend";
import { notify } from "@/features/notifications";
import { statusProgress } from "@/lib/ui/status-progress";
import { getSettings, useSettings } from "@/lib/settings";
import { Tooltip } from "@/components/ui/tooltip";
import {
    AlertDialog,
    AlertDialogBody,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown";
import { useLoading } from "@/features/loading/context";
import { GitManagerTrigger } from "@/features/git/ui/manager/git-manager-trigger";
import { GitChromeActions } from "@/features/git/ui/manager/chrome";
import { useGitRepos } from "@/lib/git/repos";

/** Error fragments that mean "no usable repo here", not a failure worth surfacing. */
const BENIGN_GIT_ERROR_FRAGMENTS = [
    "not a git repository",
    "could not find repository",
    ".invalid",
    "unborn",
];

/** Whether error text reports an invalid git reference. */
const hasInvalidReference = (message: string): boolean =>
    message.includes("reference") && message.includes("not valid");

/** Errors that mean "no usable repo here", not a failure worth surfacing. */
const isBenignGitError = (err: unknown): boolean => {
    const message = String(err).toLowerCase();
    return BENIGN_GIT_ERROR_FRAGMENTS.some((fragment) => message.includes(fragment)) || hasInvalidReference(message);
};

/** Display text for an unknown thrown value. */
const errorText = (err: unknown): string => err instanceof Error ? err.message : String(err);

/** Last segment of a file path, falling back to the whole path. */
const pathBaseName = (path: string): string => path.split(/[/\\]/).pop() || path;

/** Absolute path for a repo-relative path, adding the separator only when missing. */
const repoAbsolutePath = (repo: string, path: string): string =>
    repo + (repo.endsWith('/') || repo.endsWith('\\') ? '' : repo.includes('\\') ? '\\' : '/') + path;

import { confirm } from "@tauri-apps/plugin-dialog";

const STATUS_COLOR: Record<string, string> = {
    C: "var(--git-conflict)",
    M: "var(--git-modified)",
    A: "var(--git-added)",
    U: "var(--git-added)",
    D: "var(--git-deleted)",
    R: "var(--git-modified)",
};

/** File name and parent-path label for one change row. */
const ChangeRowPathLabel = ({ path }: { path: string }) => (
    <span className="text-sm font-medium text-text-primary group-hover:text-text-primary transition-colors flex-1 truncate mr-2 pointer-events-none">
        {path.split(/[/\\]/).pop()}
        {path.includes('/') || path.includes('\\') ? (
            <span className="text-text-secondary ml-1 font-normal">
                {path.split(/[/\\]/).slice(0, -1).join('/')}
            </span>
        ) : null}
    </span>
);

/** Coloured status letter for one change row. */
const ChangeRowStatusLetter = ({ status }: { status: string }) => (
    <span
        className="text-xs font-bold w-4 text-center shrink-0 pointer-events-none"
        style={{ color: STATUS_COLOR[status] ?? "var(--git-added)" }}
    >
        {status}
    </span>
);

/** Context menu for one change row: stage toggle, diff, discard, copy path. */
const ChangeRowMenu = ({
    file,
    projectPath,
    onToggleState,
    onRefresh,
    onShowDiff,
}: {
    file: GitFileParams;
    projectPath: string;
    onToggleState: () => Promise<void>;
    onRefresh: () => void;
    onShowDiff: (path: string, staged: boolean) => void;
}) => {
            const { copy } = useCopyToClipboard();
            /** Discard this file's unstaged changes after confirmation. */
            const handleDiscard = async () => {
                const ok = await confirm(
                    `Discard all unstaged changes in "${file.path.split(/[/\\]/).pop()}"? This cannot be undone.`,
                    {
                        title: "Discard Changes",
                        kind: "warning",
                        okLabel: "Discard",
                        cancelLabel: "Cancel",
                    },
                );
                if (!ok) return;
                try {
                    await commands.gitDiscardChanges(projectPath, file.path);
                    onRefresh();
                    window.dispatchEvent(new Event("bettershape-git-refresh"));
                } catch (err) {
                    notify.gitError(err);
                }
            };

            return (
            <ContextMenuContent>
                <ContextMenuItem onClick={() => onToggleState()}>
                    {file.staged ? "Unstage Changes" : "Stage Changes"}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onShowDiff(file.path, file.staged)}>
                    Open Changes
                </ContextMenuItem>
                {!file.staged && (
                    <ContextMenuItem onClick={handleDiscard}>
                        Discard Changes
                    </ContextMenuItem>
                )}
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => copy(file.path, "File path copied to clipboard.")}>
                    Copy Path
                </ContextMenuItem>
            </ContextMenuContent>
            );
};

/** One changed-file row: staging checkbox, status letter, and context menu. */
const ChangeRow = ({
    file,
    projectPath,
    onRefresh,
    onShowDiff,
    selected,
}: {
    file: GitFileParams;
    projectPath: string;
    onRefresh: () => void;
    onShowDiff: (path: string, staged: boolean) => void;
    selected?: boolean;
}) => {
    /** Stage or unstage this file, matching its current staged state. */
    const handleToggleState = async () => {
        try {
            if (file.staged) {
                await commands.gitUnstage(projectPath, file.path);
            } else {
                await commands.gitStage(projectPath, file.path);
            }
            onRefresh();
        } catch (err) {
            notify.gitError(err);
        }
    };

    return (
        <ContextMenu>
            <ContextMenuTrigger>
                <div
                    className={cn(
                        "flex items-center px-0.5 py-0.5 rounded-lg group relative h-7 transition-colors",
                        selected ? "bg-[var(--row-selected)] hover:bg-[var(--row-selected-hover)]" : "hover:bg-[var(--row-hover)]",
                    )}
                >
                    {/*
                        `mr-1.5`, not `mr-1`: the stage checkbox is 11.4px and clears
                        WCAG 2.5.8 on the spacing exception, not on size, so the gap to
                        the diff button beside it is load-bearing. At `mr-1` the safe
                        clickable diameter is 22.8px and `e2e/audit.spec.ts` fails the
                        /git target-size baseline; at `mr-1.5` it is 26px. The diff
                        action became a real sibling <button> (a target axe measures
                        against) when the row was given real roles, which is what made
                        this margin start mattering. Matches the icon margin below.
                    */}
                    <div
                        role="presentation"
                        className="w-5 h-5 flex items-center justify-center shrink-0 cursor-pointer text-text-muted hover:text-text-primary mr-1.5"
                        onClick={handleToggleState}
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        <Checkmark
                            checked={file.staged}
                            onCheckedChange={() => handleToggleState()}
                            label={file.staged ? `Unstage ${file.path}` : `Stage ${file.path}`}
                        />
                    </div>
                    <button
                        type="button"
                        onClick={() => onShowDiff(file.path, file.staged)}
                        className="flex min-w-0 flex-1 cursor-pointer items-center text-left"
                    >
                        <div className="w-4 mr-1.5 flex justify-center shrink-0 pointer-events-none">
                            <FileIcon name={file.path.split(/[/\\]/).pop() || ""} />
                        </div>
                        <ChangeRowPathLabel path={file.path} />

                        <ChangeRowStatusLetter status={file.status} />
                    </button>
                </div>
            </ContextMenuTrigger>
            <ChangeRowMenu
                file={file}
                projectPath={projectPath}
                onToggleState={handleToggleState}
                onRefresh={onRefresh}
                onShowDiff={onShowDiff}
            />
        </ContextMenu>
    );
};

/** Header row for a change section: stage-all checkbox, title, and file count. */
const ChangeSectionHeader = ({ title, count, isAllStaged, isSomeStaged, onToggleOpen, onToggleStage }: {
    title: string;
    count: number;
    isAllStaged: boolean;
    isSomeStaged: boolean;
    onToggleOpen: () => void;
    onToggleStage: () => void;
}) => (
    <div className="flex items-center group py-1 pl-1.5 rounded-lg shrink-0 hover:bg-[var(--row-hover)] transition-colors">
        <div role="presentation" className="flex shrink-0 items-center justify-center h-full mr-2">
            <Checkmark
                checked={isAllStaged ? true : isSomeStaged ? "indeterminate" : false}
                onCheckedChange={onToggleStage}
                label={isAllStaged ? "Unstage all changes" : "Stage all changes"}
            />
        </div>
        <button
            type="button"
            onClick={onToggleOpen}
            className="flex min-w-0 flex-1 cursor-pointer items-center text-left"
        >
            <span className="truncate text-sm font-normal text-text-secondary group-hover:text-text-primary transition-colors">
                {title} <span className="text-text-muted font-normal ml-1">{count} {count === 1 ? "file" : "files"}</span>
            </span>
        </button>
    </div>
);

/** Windowed change rows for a section, with the Show more control. */
const ChangeSectionRows = ({ isOpen, files, visibleCount, setVisibleCount, title, projectPath, onRefresh, onShowDiff, selectedPath, selectedStaged }: {
    isOpen: boolean;
    files: GitFileParams[];
    visibleCount: number;
    setVisibleCount: React.Dispatch<React.SetStateAction<number>>;
    title: string;
    projectPath: string;
    onRefresh: () => void;
    onShowDiff: (path: string, staged: boolean) => void;
    selectedPath?: string | null;
    selectedStaged?: boolean | null;
}) => isOpen ? (
            <div className="space-y-0.5 mt-1">
                {files.slice(0, visibleCount).map((file) => (
                    <ChangeRow
                        key={`${title}-${file.path}-${file.staged ? "s" : "u"}`}
                        file={file}
                        projectPath={projectPath}
                        onRefresh={onRefresh}
                        onShowDiff={onShowDiff}
                        selected={
                            selectedPath === file.path && selectedStaged === file.staged
                        }
                    />
                ))}
                {files.length > visibleCount ? (
                    <div className="flex items-center gap-2 px-2 py-1.5">
                        <p className="text-xs text-text-muted">
                            Showing {visibleCount} of {files.length} files.
                        </p>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => setVisibleCount((count) => count + 400)}
                        >
                            Show more
                        </Button>
                    </div>
                ) : null}
            </div>
        ) : null;

/** A collapsible staged/unstaged group of change rows (windowed, with Show more). */
const ChangeSection = ({
    title,
    files,
    isOpen,
    onToggleOpen,
    isAllStaged,
    isSomeStaged,
    onToggleStage,
    onRefresh,
    onShowDiff,
    projectPath,
    selectedPath,
    selectedStaged,
}: {
    title: string;
    files: GitFileParams[];
    isOpen: boolean;
    onToggleOpen: () => void;
    isAllStaged: boolean;
    isSomeStaged: boolean;
    onToggleStage: () => void;
    onRefresh: () => void;
    onShowDiff: (path: string, staged: boolean) => void;
    projectPath: string;
    selectedPath?: string | null;
    selectedStaged?: boolean | null;
}) => {
    // Rows render in windows of 400 with a Show more control: capping the
    // render keeps huge working trees responsive without making files
    // beyond the window unreachable.
    const [visibleCount, setVisibleCount] = useState(400);
    if (files.length === 0) return null;

    return (
        <div className="flex flex-col">
            <ChangeSectionHeader
                title={title}
                count={files.length}
                isAllStaged={isAllStaged}
                isSomeStaged={isSomeStaged}
                onToggleOpen={onToggleOpen}
                onToggleStage={onToggleStage}
            />
            <ChangeSectionRows
                isOpen={isOpen}
                files={files}
                visibleCount={visibleCount}
                setVisibleCount={setVisibleCount}
                title={title}
                projectPath={projectPath}
                onRefresh={onRefresh}
                onShowDiff={onShowDiff}
                selectedPath={selectedPath}
                selectedStaged={selectedStaged}
            />
        </div>
    );
};

/** Read the original and modified text for one diff file. */
const loadDiffContent = async (
    gitRepo: string,
    diffFile: { path: string; staged: boolean },
): Promise<{ original: string; modified: string }> => {
    const original = await commands
        .gitGetItemContent(gitRepo, diffFile.path, diffFile.staged)
        .catch(() => "");
    let modified = "";
    if (diffFile.staged) {
        modified = await commands
            .gitGetItemContent(gitRepo, diffFile.path, false)
            .catch(() => "");
    } else {
        modified = await commands
            .readFile(repoAbsolutePath(gitRepo, diffFile.path))
            .catch(() => "");
    }
    return { original, modified };
};

/**
 * Load the original/modified pair for the embedded diff view.
 *
 * The content is reset while rendering, when the inputs change, rather than in
 * the effect body. An effect runs after the paint, so switching files showed the
 * previous file's diff for a frame, and clearing inside the effect also raced the
 * load that the same effect had just started.
 */
const useEmbeddedDiffContent = (
    embedded: boolean,
    gitRepo: string | null,
    diffFile: { path: string; staged: boolean } | null,
    setDiffOriginal: (value: string) => void,
    setDiffModified: (value: string) => void,
    setDiffLoading: (value: boolean) => void,
) => {
    const [inputs, setInputs] = useState<readonly unknown[] | null>(null);
    if (
        inputs === null ||
        !Object.is(inputs[0], embedded) ||
        !Object.is(inputs[1], gitRepo) ||
        !Object.is(inputs[2], diffFile)
    ) {
        setInputs([embedded, gitRepo, diffFile]);
        setDiffOriginal("");
        setDiffModified("");
        setDiffLoading(embedded && gitRepo !== null && diffFile !== null);
    }

    useEffect(() => {
        if (!embedded || !gitRepo || !diffFile) return undefined;
        let cancelled = false;
        (async () => {
            try {
                const { original, modified } = await loadDiffContent(gitRepo, diffFile);
                if (!cancelled) {
                    setDiffOriginal(original);
                    setDiffModified(modified);
                }
            } catch {
                if (!cancelled) {
                    setDiffOriginal("");
                    setDiffModified("");
                }
            } finally {
                if (!cancelled) setDiffLoading(false);
            }
        })().catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [embedded, gitRepo, diffFile, setDiffOriginal, setDiffModified, setDiffLoading]);
};

/** Whether a refresh has both a project and a repo to query. */
const hasRepoTarget = (
    projectPath: string | null | undefined,
    repoPath: string | null,
): repoPath is string => Boolean(projectPath && repoPath);

/** Whether refresh should clear status: project open, discovery done, no repo. */
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
const useGitStatusRefresh = (args: {
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

    return useCallback(async (opts?: { track?: boolean }) => {
        const track = opts?.track !== false;
        const repoPath = scmRepoPath;
        const keyAtStart = repoKey;
        /** Whether the repo changed after this refresh started. */
        const stale = () => latestRepoKeyRef.current !== keyAtStart;
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
                statusProgress.remove("git-refresh");
            }
        } else if (shouldClearWithoutRepo(projectPath, reposLoading, isGitRepo || changeCount > 0 || hasLastCommit)) {
            // Only clear after discovery finished with no repo — never during the async gap.
            setIsGitRepo(false);
            setChanges([]);
            setLastCommit(null);
        }
    }, [
        projectPath, scmRepoPath, repoKey, reposCount, reposLoading,
        startLoading, stopLoading, setChanges, setCurrentBranch, setHasRemote,
        setLastCommit, setNeedsSync, setIsGitRepo, latestRepoKeyRef,
        isGitRepo, changeCount, hasLastCommit,
    ]);
};

/** Stage every unstaged change, one command per file. */
const stageUnstaged = async (repo: string, changes: GitFileParams[]) => {
    for (const file of changes.filter((c: GitFileParams) => !c.staged)) {
        await commands.gitStage(repo, file.path);
    }
};

/** Warn when amending a commit that already sits on the remote. Returns false to abort. */
const confirmAmendPublished = async (repo: string): Promise<boolean> => {
    const status = await commands.gitSyncStatus(repo).catch(() => ({ ahead: 0, behind: 0 }));
    if (status.ahead !== 0) return true;
    const rewrite = await confirm(
        "The latest commit appears to be on the remote. Amending rewrites history. Continue?",
        {
            title: "Amend published commit",
            kind: "warning",
            okLabel: "Amend",
            cancelLabel: "Cancel",
        },
    );
    return rewrite;
};

/** Offer to sync immediately after a commit that leaves the branch ahead. */
const promptSyncNow = async (handleSync: () => Promise<void>): Promise<void> => {
    const syncNow = await confirm(
        "Commit created. Sync with remote now?",
        {
            title: "Sync",
            kind: "info",
            okLabel: "Sync",
            cancelLabel: "Not now",
        },
    );
    if (syncNow) {
        await handleSync();
    }
};

/** Whether a finished commit should offer an immediate sync. */
const shouldPromptSyncAfterCommit = (
    args: { promptSyncAfter: boolean; hasRemote: boolean },
    ahead: number,
): boolean => args.promptSyncAfter && args.hasRemote && ahead > 0;

/** After a commit: refresh sync state and optionally prompt to sync. */
const runPostCommit = async (args: {
    gitRepo: string;
    hasRemote: boolean;
    setNeedsSync: (value: boolean) => void;
    refresh: (opts?: { track?: boolean }) => void;
    handleSync: () => Promise<void>;
    amend: boolean;
    promptSyncAfter: boolean;
}): Promise<void> => {
    let ahead = 0;
    if (args.hasRemote) {
        const status = await commands.gitSyncStatus(args.gitRepo).catch(() => ({ ahead: 0, behind: 0 }));
        ahead = status.ahead;
        args.setNeedsSync(ahead > 0);
    }
    args.refresh();
    notify.success("Git", args.amend ? "Commit amended" : "Commit successful");
    if (shouldPromptSyncAfterCommit(args, ahead)) {
        await promptSyncNow(args.handleSync);
    }
};

/** Stage changes into an amended commit when the user agrees. */
const ensureStagedForAmend = async (
    repo: string,
    changes: GitFileParams[],
): Promise<void> => {
    if (changes.length === 0) return;
    const stageAll = await confirm(
        "Stage all changes into the amended commit?",
        {
            title: "Amend commit",
            kind: "info",
            okLabel: "Stage & Amend",
            cancelLabel: "Amend message only",
        },
    );
    if (stageAll) await stageUnstaged(repo, changes);
};

/** Ask before staging everything into a commit with nothing staged. Returns false to abort. */
const ensureStagedForCommit = async (
    repo: string,
    staged: GitFileParams[],
    amend: boolean,
    changes: GitFileParams[],
): Promise<boolean> => {
    if (staged.length > 0) return true;
    if (!amend) {
        const stageAll = await confirm(
            "There are no staged changes to commit. Stage all changes and commit?",
            {
                title: "Stage and commit",
                kind: "info",
                okLabel: "Stage & Commit",
                cancelLabel: "Cancel",
            },
        );
        if (!stageAll) return false;
        await stageUnstaged(repo, changes);
        return true;
    }
    await ensureStagedForAmend(repo, changes);
    return true;
};

/** Confirm the composer message when the user enabled confirm-before-commit. Returns false to abort. */
const confirmCommitMessage = async (amend: boolean, fullMessage: string): Promise<boolean> => {
    if (!getSettings().git.confirmBeforeCommit) return true;
    const ok = await confirm(
        amend ? `Amend last commit?\n\n${fullMessage}` : `Create commit?\n\n${fullMessage}`,
        {
            title: amend ? "Amend commit" : "Create commit",
            kind: "info",
            okLabel: amend ? "Amend" : "Commit",
            cancelLabel: "Cancel",
        },
    );
    return ok;
};

/** Whether an amend may proceed: only a published amend needs confirmation. */
const mayAmendWithRemote = async (
    amend: boolean,
    hasRemote: boolean,
    gitRepo: string,
): Promise<boolean> => !amend || !hasRemote || (await confirmAmendPublished(gitRepo));

/** Check the guard rails before a commit or amend runs: title, amend target, published-amend confirm. */
const checkCommitPreconditions = async (
    ctx: {
        gitRepo: string | null;
        commitTitle: string;
        lastCommit: GitLogEntry | null;
        hasRemote: boolean;
    },
    amend: boolean,
): Promise<boolean> => {
    const { gitRepo, commitTitle, lastCommit, hasRemote } = ctx;
    if (!gitRepo || !commitTitle.trim()) {
        notify.error("Git", "Please enter a commit title");
        return false;
    }
    if (amend && !lastCommit) {
        notify.error("Git", "Nothing to amend");
        return false;
    }
    return await mayAmendWithRemote(amend, hasRemote, gitRepo);
};

/** Join a commit title and description into the full message. */
const buildCommitMessage = (commitTitle: string, commitDescription: string): string =>
    commitDescription ? `${commitTitle}\n\n${commitDescription}` : commitTitle;

/** Stage for a commit: everything for Commit All, else the staged-changes guard. Returns false to abort. */
const stageForCommit = async (
    repo: string,
    all: boolean,
    amend: boolean,
    changes: GitFileParams[],
): Promise<boolean> => {
    if (all) {
        await stageUnstaged(repo, changes);
        return true;
    }
    return ensureStagedForCommit(repo, changes.filter((c: GitFileParams) => c.staged), amend, changes);
};

/** Run the commit command for a new commit or an amend. */
const applyCommit = async (repo: string, fullMessage: string, amend: boolean): Promise<void> => {
    if (amend) {
        await commands.gitCommitAmend(repo, fullMessage);
    } else {
        await commands.gitCommit(repo, fullMessage);
    }
};

/** Report a failed commit or amend to the console and the user. */
const reportCommitError = (e: unknown, amend: boolean) => {
    console.error("Commit failed:", e);
    notify.gitError(e, amend ? "Amend failed" : "Commit failed");
};

/** Handle for the composer commit flow: amend guards, staging fallback, confirm, sync prompt. */
const useHandleCommit = (ctx: {
    gitRepo: string | null;
    commitTitle: string;
    commitDescription: string;
    lastCommit: GitLogEntry | null;
    hasRemote: boolean;
    changes: GitFileParams[];
    setCommitTitle: (value: string) => void;
    setCommitDescription: (value: string) => void;
    setCommitSuggestionStatus: (value: "idle" | "loading") => void;
    setNeedsSync: (value: boolean) => void;
    refresh: (opts?: { track?: boolean }) => void;
    handleSync: () => Promise<void>;
}) => {
    /** Commit or amend the staged changes, then run the post-commit flow. */
    const commitNow = async (
        all = false,
        opts?: { amend?: boolean; promptSyncAfter?: boolean },
    ): Promise<boolean> => {
        const { commitTitle, commitDescription, hasRemote, changes } = ctx;
        const amend = opts?.amend === true;
        if (!(await checkCommitPreconditions(ctx, amend))) return false;
        const gitRepo = ctx.gitRepo as string;
        try {
            if (!(await stageForCommit(gitRepo, all, amend, changes))) return false;
            const fullMessage = buildCommitMessage(commitTitle, commitDescription);
            if (!(await confirmCommitMessage(amend, fullMessage))) return false;
            await applyCommit(gitRepo, fullMessage, amend);
            ctx.setCommitTitle("");
            ctx.setCommitDescription("");
            ctx.setCommitSuggestionStatus("idle");
            await runPostCommit({
                gitRepo,
                hasRemote,
                setNeedsSync: ctx.setNeedsSync,
                refresh: ctx.refresh,
                handleSync: ctx.handleSync,
                amend,
                promptSyncAfter: opts?.promptSyncAfter === true,
            });
            return true;
        } catch (e) {
            reportCommitError(e, amend);
            return false;
        }
    };
    return commitNow;
};


/** Stream a generated commit message into the composer title and description. */
const applyGeneratedCommitMessage = async (
    message: string,
    setCommitTitle: (value: string) => void,
    setCommitDescription: (value: string) => void,
): Promise<void> => {
    const lines = message.trim().split("\n");
    const title = lines[0] ?? "";
    const description = lines.slice(1).join("\n").trim();
    setCommitTitle("");
    setCommitDescription("");
    await streamTextInto(title, setCommitTitle);
    if (description) {
        await streamTextInto(description, setCommitDescription, { msPerChar: 4 });
    }
};

/** Remote, sync, menu, and AI-assist handlers for the Source panel, split out to bound Source complexity. */
const useGitPanelHandlers = (ctx: {
    gitRepo: string | null;
    projectPath: string | null;
    embedded: boolean;
    startLoading: () => void;
    stopLoading: () => void;
    refresh: (opts?: { track?: boolean }) => Promise<void>;
    changes: GitFileParams[];
    newRemoteName: string;
    newRemoteUrl: string;
    editingRemote: { name: string; url: string } | null;
    setRemoteDialogOpen: (value: boolean) => void;
    setRemoteLoading: (value: boolean) => void;
    setRemotes: (value: { name: string; url: string }[]) => void;
    setEditingRemote: (value: { name: string; url: string } | null) => void;
    setNewRemoteName: (value: string) => void;
    setNewRemoteUrl: (value: string) => void;
    setHasRemote: (value: boolean) => void;
    setNeedsSync: (value: boolean) => void;
    setCommitTitle: (value: string) => void;
    setCommitDescription: (value: string) => void;
    setCommitSuggestionStatus: (value: "idle" | "loading") => void;
    setConflictHelp: (value: string | null) => void;
    setConflictHelpLoading: (value: boolean) => void;
    setDiffFile: (value: { path: string; staged: boolean } | null) => void;
}) => {
    const {
        gitRepo, projectPath, embedded, startLoading, stopLoading, refresh, changes,
        newRemoteName, newRemoteUrl, editingRemote,
        setRemoteDialogOpen, setRemoteLoading, setRemotes, setEditingRemote, setNewRemoteName,
        setNewRemoteUrl, setHasRemote, setNeedsSync, setCommitTitle, setCommitDescription,
        setCommitSuggestionStatus, setConflictHelp, setConflictHelpLoading, setDiffFile,
    } = ctx;

    /** Open the remotes dialog and load the current remote list. */
    const openRemoteDialog = async () => {
        if (!gitRepo) return;
        setRemoteDialogOpen(true);
        setRemoteLoading(true);
        setEditingRemote(null);
        setNewRemoteName("origin");
        setNewRemoteUrl("");
        try {
            const list = await commands.gitListRemotes(gitRepo);
            setRemotes(list);
        } catch {
            setRemotes([]);
        } finally {
            setRemoteLoading(false);
        }
    };

    /** Reload remotes after an add, remove, or URL edit. */
    const reloadRemotes = async () => {
        if (!gitRepo) return;
        setRemoteLoading(true);
        try {
            const list = await commands.gitListRemotes(gitRepo);
            setRemotes(list);
            setHasRemote(list.length > 0);
        } catch (e) {
            notify.gitError(e);
        } finally {
            setRemoteLoading(false);
        }
    };

    /** Add the remote named in the dialog form. */
    const handleAddRemote = async () => {
        if (!gitRepo || !newRemoteName.trim() || !newRemoteUrl.trim()) return;
        try {
            await commands.gitAddRemote(gitRepo, newRemoteName.trim(), newRemoteUrl.trim());
            notify.success("Git", `Added remote ${newRemoteName.trim()}`);
            setNewRemoteName("origin");
            setNewRemoteUrl("");
            await reloadRemotes();
        } catch (e) {
            notify.gitError(e);
        }
    };

    /** Remove a remote after confirmation. */
    const handleRemoveRemote = async (name: string) => {
        if (!gitRepo) return;
        const ok = await confirm(`Remove remote "${name}"?`, {
            title: "Remove Remote",
            kind: "warning",
            okLabel: "Remove",
            cancelLabel: "Cancel",
        });
        if (!ok) return;
        try {
            await commands.gitRemoveRemote(gitRepo, name);
            notify.success("Git", `Removed remote ${name}`);
            await reloadRemotes();
        } catch (e) {
            notify.gitError(e);
        }
    };

    /** Save an edited remote URL. */
    const handleSaveRemoteUrl = async () => {
        if (!gitRepo || !editingRemote) return;
        const url = editingRemote.url.trim();
        if (!url) return;
        try {
            await commands.gitSetRemoteUrl(gitRepo, editingRemote.name, url);
            notify.success("Git", `Updated remote ${editingRemote.name}`);
            setEditingRemote(null);
            await reloadRemotes();
        } catch (e) {
            notify.gitError(e);
        }
    };

    /** Sync (rebase) with the remote and clear the needs-sync flag. */
    const handleSync = async () => {
        if (!gitRepo) return;
        startLoading();
        try {
            await commands.gitSync(gitRepo);
            notify.info("Git Sync", "Successfully synced with remote.");
            setNeedsSync(false);
            await refresh({ track: false });
        } catch (err) {
            notify.gitError(err, "Sync failed");
        } finally {
            stopLoading();
        }
    };


    /** Push the current branch and clear the needs-sync flag. */
    const handlePush = async () => {
        if (!gitRepo) return;
        startLoading();
        try {
            await commands.gitPush(gitRepo);
            notify.info("Git", "Pushed successfully.");
            setNeedsSync(false);
            await refresh({ track: false });
        } catch (err) {
            notify.gitError(err, "Push failed");
        } finally {
            stopLoading();
        }
    };

    /** Pull the current branch. */
    const handlePull = async () => {
        if (!gitRepo) return;
        startLoading();
        try {
            await commands.gitPull(gitRepo);
            notify.info("Git", "Pulled successfully.");
            await refresh({ track: false });
        } catch (err) {
            notify.gitError(err, "Pull failed");
        } finally {
            stopLoading();
        }
    };

    /** Fetch all remotes. */
    const handleFetch = async () => {
        if (!gitRepo) return;
        startLoading();
        try {
            await commands.gitFetch(gitRepo);
            notify.info("Git", "Fetched from all remotes.");
            await refresh({ track: false });
        } catch (err) {
            notify.gitError(err, "Fetch failed");
        } finally {
            stopLoading();
        }
    };

    /** Generate a commit message from the staged diff and stream it into the composer. */
    const handleGenerateCommitMessage = async () => {
        if (!projectPath) {
            notify.error("AI Error", "Open a project to generate a commit message.");
            return;
        }
        const stagedChanges = changes.filter((c) => c.staged);
        if (stagedChanges.length === 0) {
            notify.error("AI Error", "Stage at least one change to generate a commit message.");
            return;
        }
        setCommitSuggestionStatus("loading");
        try {
            const message = await commands.generateCommitMessage(gitRepo);
            await applyGeneratedCommitMessage(message, setCommitTitle, setCommitDescription);
        } catch (err) {
            notify.error("AI Error", errorText(err));
        } finally {
            setCommitSuggestionStatus("idle");
        }
    };

    /** Ask the AI to explain the current conflict state. */
    const runConflictHelp = async () => {
        if (!gitRepo) return;
        setConflictHelpLoading(true);
        try {
            const text = await commands.explainGitChanges("conflict", { repoPath: gitRepo });
            setConflictHelp(text.trim());
        } catch (err) {
            notify.error("AI Error", errorText(err));
        } finally {
            setConflictHelpLoading(false);
        }
    };

    /** Show a file diff inline (embedded) or in the diff window. */
    const handleShowDiff = async (path: string, staged: boolean) => {
        if (!gitRepo) return;
        if (embedded) {
            setDiffFile({ path, staged });
            return;
        }
        const name = pathBaseName(path);
        const absPath = repoAbsolutePath(gitRepo, path);
        try {
            await commands.gitOpenDiff(absPath, name, staged);
        } catch (e) {
            notify.error("Git Error", `Failed to open diff: ${e}`);
        }
    };

    /** Stage every change (More actions menu). */
    const stageAllChanges = async () => {
        if (!gitRepo) return;
        try {
            await commands.gitStageAll(gitRepo);
            refresh().catch(() => undefined);
        } catch (e) {
            notify.gitError(e, "Stage all failed");
        }
    };

    /** Unstage every change (More actions menu). */
    const unstageAllChanges = async () => {
        if (!gitRepo) return;
        try {
            await commands.gitUnstageAll(gitRepo);
            refresh().catch(() => undefined);
        } catch (e) {
            notify.gitError(e, "Unstage all failed");
        }
    };

    /** Stash every change, including untracked files (More actions menu). */
    const stashChanges = async () => {
        if (!gitRepo) return;
        try {
            await commands.gitStashSave(gitRepo, "", true);
            notify.success("Git", "Changes stashed.");
            refresh().catch(() => undefined);
        } catch (e) {
            notify.gitError(e, "Stash failed");
        }
    };

    /** Apply and drop the latest stash (More actions menu). */
    const popLatestStash = async () => {
        if (!gitRepo) return;
        try {
            await commands.gitStashPop(gitRepo, 0);
            notify.success("Git", "Stash applied and dropped.");
            refresh().catch(() => undefined);
        } catch (e) {
            notify.gitError(e, "Stash pop failed");
        }
    };

    /** Abort an in-progress merge (More actions menu). */
    const abortMerge = async () => {
        if (!gitRepo) return;
        try {
            await commands.gitMergeAbort(gitRepo);
            notify.info("Git", "Merge aborted.");
            refresh().catch(() => undefined);
        } catch (e) {
            notify.gitError(e, "Merge abort failed");
        }
    };

    /** Abort an in-progress rebase (More actions menu). */
    const abortRebase = async () => {
        if (!gitRepo) return;
        try {
            await commands.gitRebaseAbort(gitRepo);
            notify.info("Git", "Rebase aborted.");
            refresh().catch(() => undefined);
        } catch (e) {
            notify.gitError(e, "Rebase abort failed");
        }
    };

    return {
        openRemoteDialog, reloadRemotes, handleAddRemote, handleRemoveRemote, handleSaveRemoteUrl,
        handleSync, handlePush, handlePull, handleFetch, handleGenerateCommitMessage,
        runConflictHelp, handleShowDiff, stageAllChanges, unstageAllChanges, stashChanges,
        popLatestStash, abortMerge, abortRebase,
    };
};


/** Refresh and sync handler bundle shared by the panel header and source chrome. */
type PanelSyncHandlers = {
    refresh: (opts?: { track?: boolean }) => void;
    handleSync: () => void;
    handleFetch: () => void;
    handlePull: () => void;
    handlePush: () => void;
    stageAllChanges: () => void;
    unstageAllChanges: () => void;
    stashChanges: () => void;
    popLatestStash: () => void;
    abortMerge: () => void;
    abortRebase: () => void;
};

/** Handler bundle for the More actions menu and its dropdown portion. */
type MoreActionsHandlers = {
    handleSync: () => void;
    handleFetch: () => void;
    handlePull: () => void;
    handlePush: () => void;
    stageAllChanges: () => void;
    unstageAllChanges: () => void;
    stashChanges: () => void;
    popLatestStash: () => void;
    abortMerge: () => void;
    abortRebase: () => void;
    openRemoteDialog: () => void;
    setIsGitRepo: (value: boolean) => void;
};

/** Trigger button for the More actions menu, split out to bound JSX depth. */
const MoreActionsMenuTrigger = () => (
<DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="w-6 h-6" aria-label="More actions">
            <Icon icon={MoreHorizontal20Regular} />
        </Button>
    </DropdownMenuTrigger>
);

/** Dropdown portion of the More actions menu. */
const MoreActionsDropdown = ({
    handleSync,
    handleFetch,
    handlePull,
    handlePush,
    stageAllChanges,
    unstageAllChanges,
    stashChanges,
    popLatestStash,
    abortMerge,
    abortRebase,
    openRemoteDialog,
    setIsGitRepo,
}: MoreActionsHandlers) => (
    <DropdownMenu modal={false}>
        <MoreActionsMenuTrigger />
        <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={handleSync}>Sync (Pull / Push)</DropdownMenuItem>
            <DropdownMenuItem onClick={handleFetch}>Fetch All</DropdownMenuItem>
            <DropdownMenuItem onClick={handlePull}>Pull</DropdownMenuItem>
            <DropdownMenuItem onClick={handlePush}>Push</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={stageAllChanges}>Stage All Changes</DropdownMenuItem>
            <DropdownMenuItem onClick={unstageAllChanges}>Unstage All Changes</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={stashChanges}>Stash Changes</DropdownMenuItem>
            <DropdownMenuItem onClick={popLatestStash}>Pop Latest Stash</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={abortMerge}>Abort Merge</DropdownMenuItem>
            <DropdownMenuItem onClick={abortRebase}>Abort Rebase</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => openRemoteDialog()}>Manage Remotes...</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setIsGitRepo(false)}>Disconnect Repository</DropdownMenuItem>
        </DropdownMenuContent>
    </DropdownMenu>
);

/** More actions menu for the panel header: sync, staging, stash, merge, and remotes items. */
const MoreActionsMenu = (props: MoreActionsHandlers) => (
    <Tooltip content="More actions">
        <span className="inline-flex">
            <MoreActionsDropdown {...props} />
        </span>
    </Tooltip>
);

/** Header actions for the Source Control panel: refresh, pull, push, sync, manager, and More menu. */
const PanelHeaderActions = ({
    embedded,
    project_path,
    refresh,
    handleSync,
    handleFetch,
    handlePull,
    handlePush,
    stageAllChanges,
    unstageAllChanges,
    stashChanges,
    popLatestStash,
    abortMerge,
    abortRebase,
    openRemoteDialog,
    setIsGitRepo,
}: PanelSyncHandlers & {
    embedded: boolean;
    project_path: string | null | undefined;
    openRemoteDialog: () => void;
    setIsGitRepo: (value: boolean) => void;}) => (
    <div className="flex shrink-0 items-center gap-0.5">
    <Tooltip content="Refresh Repository">
        <Button variant="ghost" size="icon" className="w-6 h-6 hover:bg-[var(--btn-hover)]" onClick={() => refresh()}>
            <Icon icon={ArrowSync20Regular} />
        </Button>
    </Tooltip>
    <Tooltip content="Pull">
        <Button variant="ghost" size="icon" className="w-6 h-6 hover:bg-[var(--btn-hover)]" onClick={handlePull}>
            <Icon icon={ArrowDownload20Regular} />
        </Button>
    </Tooltip>
    <Tooltip content="Push">
        <Button variant="ghost" size="icon" className="w-6 h-6 hover:bg-[var(--btn-hover)]" onClick={handlePush}>
            <Icon icon={ArrowUp20Regular} />
        </Button>
    </Tooltip>
    <Tooltip content="Sync Changes">
        <Button variant="ghost" size="icon" className="w-6 h-6 hover:bg-[var(--btn-hover)]" onClick={handleSync}>
            <Icon icon={ArrowUpload20Regular} />
        </Button>
    </Tooltip>
    {!embedded && project_path ? <GitManagerTrigger /> : null}
    {/* Tooltip must wrap the whole menu - nesting Tooltip around DropdownMenuTrigger breaks both. */}
    <MoreActionsMenu
        handleSync={handleSync}
        handleFetch={handleFetch}
        handlePull={handlePull}
        handlePush={handlePush}
        stageAllChanges={stageAllChanges}
        unstageAllChanges={unstageAllChanges}
        stashChanges={stashChanges}
        popLatestStash={popLatestStash}
        abortMerge={abortMerge}
        abortRebase={abortRebase}
        openRemoteDialog={openRemoteDialog}
        setIsGitRepo={setIsGitRepo}
    />
    </div>
);

/** Embedded-mode chrome actions: refresh, pull, push, and sync icon buttons. */
const EmbeddedChromeActions = ({
    refresh,
    handlePull,
    handlePush,
    handleSync,
}: {
    refresh: (opts?: { track?: boolean }) => void;
    handlePull: () => void;
    handlePush: () => void;
    handleSync: () => void;
}) => (
    <GitChromeActions>
        <Tooltip content="Refresh">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refresh()} aria-label="Refresh">
                <Icon icon={ArrowSync20Regular} />
            </Button>
        </Tooltip>
        <Tooltip content="Pull">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handlePull} aria-label="Pull">
                <Icon icon={ArrowDownload20Regular} />
            </Button>
        </Tooltip>
        <Tooltip content="Push">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handlePush} aria-label="Push">
                <Icon icon={ArrowUp20Regular} />
            </Button>
        </Tooltip>
        <Tooltip content="Sync">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleSync} aria-label="Sync">
                <Icon icon={ArrowUpload20Regular} />
            </Button>
        </Tooltip>
    </GitChromeActions>
);

/** Conflict banner with AI guidance and the merge/rebase abort action. */
const ConflictBanner = ({
    gitRepo,
    conflictHelp,
    conflictHelpLoading,
    runConflictHelp,
    refresh,
}: {
    gitRepo: string;
    conflictHelp: string | null;
    conflictHelpLoading: boolean;
    runConflictHelp: () => void;
    refresh: (opts?: { track?: boolean }) => void;
}) => (
    <div className="mx-3 mb-2 flex flex-wrap items-center gap-2 rounded-md border border-[color:var(--git-conflict)]/40 bg-[color:var(--git-conflict)]/10 px-2 py-1.5 text-xs text-text-primary">
        <span className="flex-1">
            Merge conflicts detected. Resolve conflicted files, then continue or abort.
        </span>
        <GitAiAction
            compact
            label="Help resolve"
            title="Conflict guidance"
            content={conflictHelp}
            loading={conflictHelpLoading}
            onRun={runConflictHelp}
        />
        <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2"
            onClick={async () => {
                try {
                    await commands.gitMergeAbort(gitRepo);
                    notify.info("Git", "Merge aborted.");
                    void refresh();
                } catch {
                    try {
                        await commands.gitRebaseAbort(gitRepo);
                        notify.info("Git", "Rebase aborted.");
                        void refresh();
                    } catch (e) {
                        notify.gitError(e, "Could not abort merge/rebase");
                    }
                }
            }}
        >
            Abort
        </Button>
    </div>
);

/** Trigger button for the repo selector, split out to bound JSX depth. */
const RepoSelectorTrigger = ({
    repos,
    activeRepoPath,
}: {
    repos: GitRepoInfo[];
    activeRepoPath: string | null;
}) => (
    <DropdownMenuTrigger asChild>
        <Button
            variant="ghost"
            size="sm"
            className="h-7 w-full justify-between gap-2 px-2 hover:bg-[var(--row-hover)] text-text-secondary hover:text-text-primary"
        >
            <span className="flex items-center gap-1.5 min-w-0">
                <Icon icon={Folder20Filled} className="shrink-0" />
                <span className="truncate text-sm">
                    {repos.find((r) => r.path === activeRepoPath)?.name ?? "Repository"}
                </span>
            </span>
            <Icon icon={ChevronDown20Regular} className="shrink-0" />
        </Button>
    </DropdownMenuTrigger>
);

/** Repository selector shown when the workspace holds more than one repo. */
const RepoSelector = ({
    repos,
    activeRepoPath,
    setActiveRepo,
}: {
    repos: GitRepoInfo[];
    activeRepoPath: string | null;
    setActiveRepo: (path: string) => void;
}) => (
    <div className="px-3 pb-2 shrink-0">
        <DropdownMenu modal={false}>
            <RepoSelectorTrigger repos={repos} activeRepoPath={activeRepoPath} />
            <DropdownMenuContent align="start" className="w-56">
                {repos.map((repo) => (
                    <DropdownMenuItem
                        key={repo.path}
                        onClick={() => {
                            setActiveRepo(repo.path);
                            window.dispatchEvent(new Event("bettershape-git-refresh"));
                        }}
                    >
                        <span className="truncate">{repo.name}</span>
                        {activeRepoPath === repo.path && (
                            <Icon icon={Checkmark20Regular} className="ml-auto shrink-0" />
                        )}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    </div>
);

/** Panel header frame for the Source Control panel, split out to bound SourceChrome complexity. */
const PanelHeader = ({
    embedded,
    project_path,
    isGitRepo,
    refresh,
    handleSync,
    handleFetch,
    handlePull,
    handlePush,
    stageAllChanges,
    unstageAllChanges,
    stashChanges,
    popLatestStash,
    abortMerge,
    abortRebase,
    openRemoteDialog,
    setIsGitRepo,
}: {
    embedded: boolean;
    project_path: string | null | undefined;
    isGitRepo: boolean;
    refresh: (opts?: { track?: boolean }) => void;
    handleSync: () => void;
    handleFetch: () => void;
    handlePull: () => void;
    handlePush: () => void;
    stageAllChanges: () => void;
    unstageAllChanges: () => void;
    stashChanges: () => void;
    popLatestStash: () => void;
    abortMerge: () => void;
    abortRebase: () => void;
    openRemoteDialog: () => void;
    setIsGitRepo: (value: boolean) => void;
}) => (
    <SidebarPanelHeaderFrame
        title="Source Control"
        className={embedded ? "bg-editor" : undefined}
        actions={
            isGitRepo ? (
                <PanelHeaderActions
                    embedded={embedded}
                    project_path={project_path}
                    refresh={refresh}
                    handleSync={handleSync}
                    handleFetch={handleFetch}
                    handlePull={handlePull}
                    handlePush={handlePush}
                    stageAllChanges={stageAllChanges}
                    unstageAllChanges={unstageAllChanges}
                    stashChanges={stashChanges}
                    popLatestStash={popLatestStash}
                    abortMerge={abortMerge}
                    abortRebase={abortRebase}
                    openRemoteDialog={openRemoteDialog}
                    setIsGitRepo={setIsGitRepo}
                />
            ) : undefined
        }
    />
);

/** Embedded toolbar or panel header for the source chrome. */
const SourceChromeHeaderSlot = ({ embedded, active, isGitRepo, project_path, refresh, handlePull, handlePush, handleSync, handleFetch, stageAllChanges, unstageAllChanges, stashChanges, popLatestStash, abortMerge, abortRebase, openRemoteDialog, setIsGitRepo }: PanelSyncHandlers & {
    embedded: boolean;
    active: boolean;
    isGitRepo: boolean;
    project_path: string | null | undefined;
    openRemoteDialog: () => void;
    setIsGitRepo: (value: boolean) => void;}) => (
    <>
        {embedded && active && isGitRepo ? (
            <EmbeddedChromeActions refresh={refresh} handlePull={handlePull} handlePush={handlePush} handleSync={handleSync} />
        ) : null}
        {embedded ? null : (
            <PanelHeader
                embedded={embedded}
                project_path={project_path}
                isGitRepo={isGitRepo}
                refresh={refresh}
                handleSync={handleSync}
                handleFetch={handleFetch}
                handlePull={handlePull}
                handlePush={handlePush}
                stageAllChanges={stageAllChanges}
                unstageAllChanges={unstageAllChanges}
                stashChanges={stashChanges}
                popLatestStash={popLatestStash}
                abortMerge={abortMerge}
                abortRebase={abortRebase}
                openRemoteDialog={openRemoteDialog}
                setIsGitRepo={setIsGitRepo}
            />
        )}
    </>
);

/** Conflict banner slot, shown only while conflicts exist in a repo. */
const SourceConflictBannerSlot = ({ changes, gitRepo, conflictHelp, conflictHelpLoading, runConflictHelp, refresh }: {
    changes: GitFileParams[];
    gitRepo: string | null;
    conflictHelp: string | null;
    conflictHelpLoading: boolean;
    runConflictHelp: () => void;
    refresh: (opts?: { track?: boolean }) => void;
}) => (
        changes.some((c) => c.status === "C") && gitRepo ? (
            <ConflictBanner gitRepo={gitRepo} conflictHelp={conflictHelp} conflictHelpLoading={conflictHelpLoading} runConflictHelp={runConflictHelp} refresh={refresh} />
        ) : null
);

/** Repository selector slot, shown only for multi-repo workspaces. */
const SourceRepoSelectorSlot = ({ hasMultipleRepos, isGitRepo, repos, activeRepoPath, setActiveRepo }: {
    hasMultipleRepos: boolean;
    isGitRepo: boolean;
    repos: GitRepoInfo[];
    activeRepoPath: string | null;
    setActiveRepo: (path: string) => void;
}) => (
        hasMultipleRepos && isGitRepo ? (
            <RepoSelector repos={repos} activeRepoPath={activeRepoPath} setActiveRepo={setActiveRepo} />
        ) : null
);

/** Chrome rendered above the source panel: embedded toolbar, panel header, conflict banner, and repo selector. */
const SourceChrome = ({
    embedded,
    active,
    isGitRepo,
    project_path,
    gitRepo,
    changes,
    conflictHelp,
    conflictHelpLoading,
    hasMultipleRepos,
    repos,
    activeRepoPath,
    refresh,
    handlePull,
    handlePush,
    handleSync,
    handleFetch,
    runConflictHelp,
    openRemoteDialog,
    setIsGitRepo,
    setActiveRepo,
    stageAllChanges,
    unstageAllChanges,
    stashChanges,
    popLatestStash,
    abortMerge,
    abortRebase,
}: {
    embedded: boolean;
    active: boolean;
    isGitRepo: boolean;
    project_path: string | null | undefined;
    gitRepo: string | null;
    changes: GitFileParams[];
    conflictHelp: string | null;
    conflictHelpLoading: boolean;
    hasMultipleRepos: boolean;
    repos: GitRepoInfo[];
    activeRepoPath: string | null;
    refresh: (opts?: { track?: boolean }) => void;
    handlePull: () => void;
    handlePush: () => void;
    handleSync: () => void;
    handleFetch: () => void;
    runConflictHelp: () => void;
    openRemoteDialog: () => void;
    setIsGitRepo: (value: boolean) => void;
    setActiveRepo: (path: string) => void;
    stageAllChanges: () => void;
    unstageAllChanges: () => void;
    stashChanges: () => void;
    popLatestStash: () => void;
    abortMerge: () => void;
    abortRebase: () => void;
}) => (
    <>
        <SourceChromeHeaderSlot
            embedded={embedded}
            active={active}
            isGitRepo={isGitRepo}
            project_path={project_path}
            refresh={refresh}
            handlePull={handlePull}
            handlePush={handlePush}
            handleSync={handleSync}
            handleFetch={handleFetch}
            stageAllChanges={stageAllChanges}
            unstageAllChanges={unstageAllChanges}
            stashChanges={stashChanges}
            popLatestStash={popLatestStash}
            abortMerge={abortMerge}
            abortRebase={abortRebase}
            openRemoteDialog={openRemoteDialog}
            setIsGitRepo={setIsGitRepo}
        />
        <SourceConflictBannerSlot
            changes={changes}
            gitRepo={gitRepo}
            conflictHelp={conflictHelp}
            conflictHelpLoading={conflictHelpLoading}
            runConflictHelp={runConflictHelp}
            refresh={refresh}
        />
        <SourceRepoSelectorSlot
            hasMultipleRepos={hasMultipleRepos}
            isGitRepo={isGitRepo}
            repos={repos}
            activeRepoPath={activeRepoPath}
            setActiveRepo={setActiveRepo}
        />
    </>
);

/** Icon button in a remote row: tooltip, label, and click action. */
const RemoteActionButton = ({
    content,
    label,
    icon,
    onClick,
    className = "h-6 w-6",
    copied = false,
    disabled = false,
}: {
    content: string;
    label: string;
    icon: typeof Edit20Regular;
    onClick: () => void;
    className?: string;
    copied?: boolean;
    disabled?: boolean;
}) => (
    <Tooltip content={content}>
        <Button variant="ghost" size="icon" className={className} onClick={onClick} aria-label={label} disabled={disabled}>
            {copied ? <DrawnCheck className="size-3.5 text-success" motion="compact" /> : <Icon icon={icon} />}
        </Button>
    </Tooltip>
);

/** One remote row: URL display with edit, copy, and remove actions, or the URL editor. */
const RemoteRow = ({
    remote,
    editingRemote,
    setEditingRemote,
    handleSaveRemoteUrl,
    handleRemoveRemote,
}: {
    remote: { name: string; url: string };
    editingRemote: { name: string; url: string } | null;
    setEditingRemote: (value: { name: string; url: string } | null) => void;
    handleSaveRemoteUrl: () => void;
    handleRemoveRemote: (name: string) => void;
}) => {
    // Copying a remote URL used to give no sign at all that anything happened. The
    // button now holds its own confirmation: green glyph, "Copied" tooltip, and the
    // toast only fires once the write has landed.
    const { copied, failed, copiedText, copy } = useCopyToClipboard({ resetMs: 1200 });
    const urlCopied = Boolean(remote.url) && copied && copiedText === remote.url;
    const urlFailed = Boolean(remote.url) && failed;
    const copyLabel = urlCopied ? "Copied" : urlFailed ? "Couldn't copy" : "Copy URL";

    return (
    <div key={remote.name} className="rounded-lg border border-border-subtle bg-panel-secondary p-2">
        {editingRemote?.name === remote.name ? (
            <div className="space-y-2">
                <div className="text-xs font-medium text-text-primary">{remote.name}</div>
                <Input
                    value={editingRemote.url}
                    onChange={(e) => setEditingRemote({ ...editingRemote, url: e.target.value })}
                    className="h-7 text-xs"
                />
                <div className="flex gap-2">
                    <Button size="sm" className="h-7 text-xs" onClick={() => handleSaveRemoteUrl()}>Save</Button>
                    <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => setEditingRemote(null)}>Cancel</Button>
                </div>
            </div>
        ) : (
            <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-text-primary">{remote.name}</div>
                    <div className="text-xs text-text-muted break-all">{remote.url || "No URL"}</div>
                </div>
                <div className="flex gap-1 shrink-0">
                    <RemoteActionButton content="Edit URL" label="Edit URL" icon={Edit20Regular} onClick={() => setEditingRemote(remote)} />
                    <RemoteActionButton
                        content={copyLabel}
                        label={copyLabel}
                        icon={Clipboard20Regular}
                        onClick={() => copy(remote.url, "Remote URL copied")}
                        className={cn("h-6 w-6", urlCopied && "text-success", urlFailed && "text-error")}
                        copied={urlCopied}
                        disabled={!remote.url}
                    />
                    <RemoteActionButton content="Remove" label="Remove remote" icon={Delete20Filled} onClick={() => handleRemoveRemote(remote.name)} className="h-6 w-6 text-error" />
                </div>
            </div>
        )}
        </div>
    );
};

/** Remote list inside the remotes dialog: loading, empty, and row states. */
const RemoteList = ({
    remoteLoading,
    remotes,
    editingRemote,
    setEditingRemote,
    handleSaveRemoteUrl,
    handleRemoveRemote,
}: {
    remoteLoading: boolean;
    remotes: { name: string; url: string }[];
    editingRemote: { name: string; url: string } | null;
    setEditingRemote: (value: { name: string; url: string } | null) => void;
    handleSaveRemoteUrl: () => void;
    handleRemoveRemote: (name: string) => void;
}) => (
<div className="space-y-2 mb-4 max-h-[220px] overflow-y-auto custom-scrollbar">
    {remoteLoading && remotes.length === 0 ? (
        <div className="text-xs text-text-muted px-1 py-2">Loading remotes...</div>
    ) : remotes.length === 0 ? (
        <div className="text-xs text-text-muted px-1 py-2">No remotes configured.</div>
    ) : (
        remotes.map((remote) => (
            <RemoteRow
                key={remote.name}
                remote={remote}
                editingRemote={editingRemote}
                setEditingRemote={setEditingRemote}
                handleSaveRemoteUrl={handleSaveRemoteUrl}
                handleRemoveRemote={handleRemoveRemote}
            />
        ))
    )}
</div>
);

/** Add-remote form inside the remotes dialog. */
const AddRemoteForm = ({
    newRemoteName,
    setNewRemoteName,
    newRemoteUrl,
    setNewRemoteUrl,
    handleAddRemote,
}: {
    newRemoteName: string;
    setNewRemoteName: (value: string) => void;
    newRemoteUrl: string;
    setNewRemoteUrl: (value: string) => void;
    handleAddRemote: () => void;
}) => (
<div className="pt-3 space-y-2">
    <div className="text-xs font-medium text-text-secondary">Add Remote</div>
    <div className="flex gap-2">
        <Input
            placeholder="Name"
            value={newRemoteName}
            onChange={(e) => setNewRemoteName(e.target.value)}
            className="h-7 text-xs w-28 shrink-0"
        />
        <Input
            placeholder="https://github.com/user/repo.git"
            value={newRemoteUrl}
            onChange={(e) => setNewRemoteUrl(e.target.value)}
            className="h-7 text-xs flex-1"
        />
        <Button size="sm" className="h-7 text-xs shrink-0" onClick={() => handleAddRemote()}>
            Add
        </Button>
    </div>
</div>
);

/** Manage Remotes dialog: remote list plus the add-remote form. */
const RemotesDialog = ({
    remoteDialogOpen,
    setRemoteDialogOpen,
    remoteLoading,
    remotes,
    editingRemote,
    setEditingRemote,
    handleSaveRemoteUrl,
    handleRemoveRemote,
    newRemoteName,
    setNewRemoteName,
    newRemoteUrl,
    setNewRemoteUrl,
    handleAddRemote,
}: {
    remoteDialogOpen: boolean;
    setRemoteDialogOpen: (value: boolean) => void;
    remoteLoading: boolean;
    remotes: { name: string; url: string }[];
    editingRemote: { name: string; url: string } | null;
    setEditingRemote: (value: { name: string; url: string } | null) => void;
    handleSaveRemoteUrl: () => void;
    handleRemoveRemote: (name: string) => void;
    newRemoteName: string;
    setNewRemoteName: (value: string) => void;
    newRemoteUrl: string;
    setNewRemoteUrl: (value: string) => void;
    handleAddRemote: () => void;
}) => (
    <AlertDialog open={remoteDialogOpen} onOpenChange={setRemoteDialogOpen}>
        <AlertDialogContent sizeClassName="max-w-[520px]">
            <AlertDialogHeader>
                <AlertDialogTitle>Manage Remotes</AlertDialogTitle>
                <AlertDialogDescription>
                    Add, edit, or remove remotes for this repository.
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogBody>
                <RemoteList
                    remoteLoading={remoteLoading}
                    remotes={remotes}
                    editingRemote={editingRemote}
                    setEditingRemote={setEditingRemote}
                    handleSaveRemoteUrl={handleSaveRemoteUrl}
                    handleRemoveRemote={handleRemoveRemote}
                />
                <AddRemoteForm
                    newRemoteName={newRemoteName}
                    setNewRemoteName={setNewRemoteName}
                    newRemoteUrl={newRemoteUrl}
                    setNewRemoteUrl={setNewRemoteUrl}
                    handleAddRemote={handleAddRemote}
                />
            </AlertDialogBody>
            <AlertDialogFooter>
                <Button variant="default" size="sm" onClick={() => setRemoteDialogOpen(false)}>
                    Done
                </Button>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
);

/** Commit action returned by the commit hook: commit or amend, optionally prompting to sync after. */
type CommitNow = (all: boolean, opts?: { amend?: boolean; promptSyncAfter?: boolean }) => Promise<boolean>;

/** Staged and unstaged change sections for the source list. */
const ChangeList = ({
    stagedChanges,
    unstagedChanges,
    isChangesOpen,
    setIsChangesOpen,
    stageAllChanges,
    unstageAllChanges,
    refresh,
    handleShowDiff,
    gitRepo,
    selectedPath,
    selectedStaged,
}: {
    stagedChanges: GitFileParams[];
    unstagedChanges: GitFileParams[];
    isChangesOpen: boolean;
    setIsChangesOpen: (value: boolean) => void;
    stageAllChanges: () => void;
    unstageAllChanges: () => void;
    refresh: (opts?: { track?: boolean }) => void;
    handleShowDiff: (path: string, staged: boolean) => void;
    gitRepo: string | null;
    selectedPath?: string;
    selectedStaged?: boolean;
}) => (
    <div className="overflow-y-auto custom-scrollbar flex-1 space-y-4 py-2 px-2">
        <ChangeSection
            title="Staged Changes"
            files={stagedChanges}
            isOpen={isChangesOpen}
            onToggleOpen={() => setIsChangesOpen(!isChangesOpen)}
            isAllStaged={stagedChanges.length > 0}
            isSomeStaged={stagedChanges.length > 0}
            onToggleStage={unstageAllChanges}
            onRefresh={refresh}
            onShowDiff={handleShowDiff}
            projectPath={gitRepo || ""}
            selectedPath={selectedPath}
            selectedStaged={selectedStaged}
        />
        <ChangeSection
            title="Changes"
            files={unstagedChanges}
            isOpen={isChangesOpen}
            onToggleOpen={() => setIsChangesOpen(!isChangesOpen)}
            isAllStaged={false}
            isSomeStaged={false}
            onToggleStage={stageAllChanges}
            onRefresh={refresh}
            onShowDiff={handleShowDiff}
            projectPath={gitRepo || ""}
            selectedPath={selectedPath}
            selectedStaged={selectedStaged}
        />
    </div>
);

/** Last-commit summary row shown above the commit composer. */
const LastCommitRow = ({
    lastCommit,
    currentBranch,
}: {
    lastCommit: GitLogEntry;
    currentBranch: string;
}) => (
    <div className="flex items-center text-sm text-text-muted gap-0.5 px-2 min-w-0">
        <Icon icon={Branch20Regular} className="shrink-0" />
        <span className="font-medium shrink-0 truncate max-w-[30%]">{currentBranch}</span>
        <Icon icon={ChevronRight20Regular} className="shrink-0" />
        <span className="truncate flex-1 min-w-0">
            {lastCommit.message.split('\n')[0]}
        </span>
    </div>
);

/** Commit message composer: title, description, and AI generate action. */
const CommitComposer = ({
    commitTitle,
    setCommitTitle,
    commitDescription,
    setCommitDescription,
    commitSuggestionStatus,
    changes,
    handleGenerateCommitMessage,
    handleCommit,
    commitShortcut = false,
}: {
    commitTitle: string;
    setCommitTitle: (value: string) => void;
    commitDescription: string;
    setCommitDescription: (value: string) => void;
    commitSuggestionStatus: "idle" | "loading";
    changes: GitFileParams[];
    handleGenerateCommitMessage: () => void;
    handleCommit: CommitNow;
    commitShortcut?: boolean;
}) => {
    /** Commit on Ctrl/Cmd+Enter when the composer shortcut is enabled. */
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            handleCommit(false, { promptSyncAfter: true }).catch(() => undefined);
        }
    };
    return (
    <div
        className="relative m-2 flex flex-col gap-0.5 overflow-hidden squircle-xl border border-border-subtle bg-surface-2 transition-colors focus-within:border-border-secondary"
        aria-busy={commitSuggestionStatus === "loading" || undefined}
    >
        <Input
            placeholder="Commit title"
            value={commitTitle}
            onChange={(e) => setCommitTitle(e.target.value)}
            onKeyDown={commitShortcut ? handleKeyDown : undefined}
            className="border-none bg-transparent px-3 pr-9 py-2 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
        />
        <Textarea
            placeholder="Add description..."
            value={commitDescription}
            onChange={(e) => setCommitDescription(e.target.value)}
            onKeyDown={commitShortcut ? handleKeyDown : undefined}
            className="custom-scrollbar mt-0 min-h-[60px] max-h-[min(168px,26vh)] overflow-y-auto resize-none rounded-none border-none bg-transparent px-3 pt-1 pb-8 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            rows={2}
        />
        <GenerateStarButton
            loading={commitSuggestionStatus === "loading"}
            disabled={changes.filter((c) => c.staged).length === 0}
            onClick={() => handleGenerateCommitMessage()}
        />
    </div>
    );
};

/** Commit and Commit (Amend) items of the commit options menu. */
const CommitStandardItems = ({ commitTitle, changes, lastCommit, handleCommit }: {
    commitTitle: string;
    changes: GitFileParams[];
    lastCommit: GitLogEntry | null;
    handleCommit: CommitNow;
}) => (
    <>
        <DropdownMenuItem
            disabled={!commitTitle.trim() || changes.length === 0}
            onClick={() =>
                handleCommit(false, {
                    promptSyncAfter: true,
                })
            }
        >
            Commit
        </DropdownMenuItem>
        <DropdownMenuItem
            disabled={!commitTitle.trim() || !lastCommit}
            onClick={() =>
                handleCommit(false, {
                    amend: true,
                    promptSyncAfter: true,
                })
            }
        >
            Commit (Amend)
        </DropdownMenuItem>
    </>
);

/** Commit & Push and Commit & Sync items of the commit options menu. */
const CommitRemoteItems = ({ commitTitle, changes, hasRemote, handleCommit, handlePush, handleSync }: {
    commitTitle: string;
    changes: GitFileParams[];
    hasRemote: boolean;
    handleCommit: CommitNow;
    handlePush: () => void;
    handleSync: () => void;
}) => {
    const remoteItemDisabled = !commitTitle.trim() || changes.length === 0 || !hasRemote;
    return (
        <>
            <DropdownMenuItem
                disabled={remoteItemDisabled}
                onClick={async () => {
                    if (
                        await handleCommit(false, {
                            promptSyncAfter: false,
                        })
                    ) {
                        await handlePush();
                    }
                }}
            >
                Commit & Push
            </DropdownMenuItem>
            <DropdownMenuItem
                disabled={remoteItemDisabled}
                onClick={async () => {
                    if (
                        await handleCommit(false, {
                            promptSyncAfter: false,
                        })
                    ) {
                        handleSync();
                    }
                }}
            >
                Commit & Sync
            </DropdownMenuItem>
        </>
    );
};

/** Commit options menu: commit, amend, commit and push, and commit and sync. */
const CommitOptionsMenu = ({
    commitTitle,
    changes,
    lastCommit,
    hasRemote,
    handleCommit,
    handlePush,
    handleSync,
}: {
    commitTitle: string;
    changes: GitFileParams[];
    lastCommit: GitLogEntry | null;
    hasRemote: boolean;
    handleCommit: CommitNow;
    handlePush: () => void;
    handleSync: () => void;
}) => (
    <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
            <Button
                variant="default"
                size="sm"
                className="h-7 rounded-none border-l border-white/20 px-1.5"
                disabled={!commitTitle.trim()}
                aria-label="Commit options"
            >
                <Icon icon={ChevronDown20Regular} />
            </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
            <CommitStandardItems
                commitTitle={commitTitle}
                changes={changes}
                lastCommit={lastCommit}
                handleCommit={handleCommit}
            />
            <DropdownMenuSeparator />
            <CommitRemoteItems
                commitTitle={commitTitle}
                changes={changes}
                hasRemote={hasRemote}
                handleCommit={handleCommit}
                handlePush={handlePush}
                handleSync={handleSync}
            />
        </DropdownMenuContent>
    </DropdownMenu>
);

/** Commit action row: Push when only sync is pending, otherwise Commit with its options menu. */
const CommitActionsRow = ({
    needsSync,
    changes,
    commitTitle,
    lastCommit,
    hasRemote,
    handleCommit,
    handlePush,
    handleSync,
}: {
    needsSync: boolean;
    changes: GitFileParams[];
    commitTitle: string;
    lastCommit: GitLogEntry | null;
    hasRemote: boolean;
    handleCommit: CommitNow;
    handlePush: () => void;
    handleSync: () => void;
}) => (
    <div className="flex w-full flex-col gap-1.5 px-2">
        <div className="flex w-full items-center justify-end gap-1">
        <div className="flex items-center gap-1.5">
            {needsSync && changes.length === 0 ? (
                <Button
                    variant="default"
                    size="sm"
                    className="gap-1 px-3 h-7 text-xs font-medium"
                    onClick={handlePush}
                >
                    <Icon icon={ArrowUpload20Regular} />
                    <span>Push</span>
                </Button>
            ) : (
                <div className="flex items-stretch overflow-hidden rounded-lg">
                    <Button
                        variant="default"
                        size="sm"
                        className="h-7 rounded-none px-3 text-xs font-medium"
                        onClick={() =>
                            handleCommit(false, { promptSyncAfter: true })
                        }
                        disabled={!commitTitle.trim() || changes.length === 0}
                    >
                        Commit
                    </Button>
<CommitOptionsMenu
                                commitTitle={commitTitle}
                                changes={changes}
                                lastCommit={lastCommit}
                                hasRemote={hasRemote}
                                handleCommit={handleCommit}
                                handlePush={handlePush}
                                handleSync={handleSync}
                            />
                </div>
            )}
        </div>
        </div>
    </div>
);

/** Header for the embedded diff pane: file name, staged state, layout toggle, and close. */
const DiffPaneHeader = ({
    diffFile,
    sideBySide,
    setSideBySide,
    setDiffFile,
}: {
    diffFile: { path: string; staged: boolean };
    sideBySide: boolean;
    setSideBySide: (value: boolean | ((previous: boolean) => boolean)) => void;
    setDiffFile: (value: { path: string; staged: boolean } | null) => void;
}) => (
<div className="flex h-9 shrink-0 items-center gap-2 px-3">
    <FileIcon
        name={
            diffFile.path.split(/[/\\]/).pop()
            || diffFile.path
        }
        className="h-3.5 w-3.5 shrink-0"
    />
    <span className="min-w-0 flex-1 truncate text-sm text-text-secondary">
        {diffFile.path}
    </span>
    <span className="shrink-0 text-xs text-text-muted">
        {diffFile.staged ? "Staged" : "Unstaged"}
    </span>
    <Tooltip content={sideBySide ? "Inline diff" : "Side by side"}>
        <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 p-0"
            onClick={() => setSideBySide((v) => !v)}
        >
            <Icon
                icon={
                    sideBySide
                        ? LayoutRowTwo20Regular
                        : LayoutColumnTwo20Regular
                }
            />
        </Button>
    </Tooltip>
    <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 p-0"
        onClick={() => setDiffFile(null)}
    >
        <Icon icon={Dismiss20Regular} />
    </Button>
</div>
);

/** Embedded diff pane: empty state, or the diff header plus the Monaco diff editor. */
const DiffPane = ({
    diffFile,
    diffLoading,
    diffOriginal,
    diffModified,
    active,
    sideBySide,
    setSideBySide,
    setDiffFile,
}: {
    diffFile: { path: string; staged: boolean } | null;
    diffLoading: boolean;
    diffOriginal: string;
    diffModified: string;
    active: boolean;
    sideBySide: boolean;
    setSideBySide: (value: boolean | ((previous: boolean) => boolean)) => void;
    setDiffFile: (value: { path: string; staged: boolean } | null) => void;
}) => (
    <div className="workbench-panel flex h-full min-h-0 flex-col overflow-hidden border border-border-subtle bg-editor">
        {!diffFile ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-text-muted">
                <Icon icon={DocumentText20Regular} className="text-text-muted" />
                <p>Select a file to view changes</p>
            </div>
        ) : (
            <>
<DiffPaneHeader diffFile={diffFile} sideBySide={sideBySide} setSideBySide={setSideBySide} setDiffFile={setDiffFile} />
                <div className="relative min-h-0 flex-1 overflow-hidden">
                    {diffLoading ? (
                        <div className="flex h-full items-center justify-center text-sm text-text-muted">
                            Loading diff…
                        </div>
                    ) : (
                        <ManagerDiffEditor
                            active={active}
                            original={diffOriginal}
                            modified={diffModified}
                            path={diffFile.path}
                            sideBySide={sideBySide}
                        />
                    )}
                </div>
            </>
        )}
    </div>
);

/** Empty state shown when the open folder has no Git repository. */
const NotGitRepo = ({
    project_path,
    setIsGitRepo,
}: {
    project_path: string | null | undefined;
    setIsGitRepo: (value: boolean) => void;
}) => (
<div className="flex flex-col items-center p-4 text-center h-full gap-4">
    <p className="text-sm text-text-primary text-left font-normal leading-normal">
        The folder currently open doesn&apos;t have a Git repository. You can initialize a repository which will enable source control features powered by Git. To learn more about how to use Git and source control in BetterShape <a href="#" className="text-accent hover:underline">Read our docs</a>.
    </p>
    <Button
        variant="default"
        className="w-full mb-4"
        onClick={async () => {
            if (!project_path) return;
            try {
                await commands.gitInit(project_path);
                setIsGitRepo(true);
                window.dispatchEvent(new Event("bettershape-git-refresh"));
                notify.success("Git", "Repository initialized.");
            } catch (e) {
                notify.gitError(e, "Failed to initialize repository");
            }
        }}
    >
        Initialize Repository
    </Button>
</div>
);

/** Props for the embedded source body: chrome, diff, and change-list state. */
interface EmbeddedSourceBodyProps {
    sourceChrome: React.ReactNode;
    diffFile: { path: string; staged: boolean } | null;
    setDiffFile: (value: { path: string; staged: boolean } | null) => void;
    active: boolean;
    diffLoading: boolean;
    diffOriginal: string;
    diffModified: string;
    sideBySide: boolean;
    setSideBySide: (value: boolean | ((previous: boolean) => boolean)) => void;
    needsSync: boolean;
    hasRemote: boolean;
    handlePush: () => void;
    handleSync: () => void;
    stagedChanges: GitFileParams[];
    unstagedChanges: GitFileParams[];
    isChangesOpen: boolean;
    setIsChangesOpen: (value: boolean) => void;
    stageAllChanges: () => void;
    unstageAllChanges: () => void;
    refresh: (opts?: { track?: boolean }) => void;
    handleShowDiff: (path: string, staged: boolean) => void;
    gitRepo: string | null;
    lastCommit: GitLogEntry | null;
    currentBranch: string;
    commitTitle: string;
    setCommitTitle: (value: string) => void;
    commitDescription: string;
    setCommitDescription: (value: string) => void;
    commitSuggestionStatus: "idle" | "loading";
    changes: GitFileParams[];
    handleGenerateCommitMessage: () => void;
    handleCommit: CommitNow;
}

/** Props for the source body switch: the embedded body props plus repo discovery state. */
interface SourceBodyProps extends EmbeddedSourceBodyProps {
    reposLoading: boolean;
    scmRepoPath: string | null;
    isGitRepo: boolean;
    embedded: boolean;
    project_path: string | null | undefined;
    setIsGitRepo: (value: boolean) => void;
}

/** Embedded source body: change list and commit footer beside the diff pane. */
const EmbeddedSourceBody = ({
    sourceChrome,
    diffFile,
    setDiffFile,
    active,
    diffLoading,
    diffOriginal,
    diffModified,
    sideBySide,
    setSideBySide,
    needsSync,
    hasRemote,
    handlePush,
    handleSync,
    stagedChanges,
    unstagedChanges,
    isChangesOpen,
    setIsChangesOpen,
    stageAllChanges,
    unstageAllChanges,
    refresh,
    handleShowDiff,
    gitRepo,
    lastCommit,
    currentBranch,
    commitTitle,
    setCommitTitle,
    commitDescription,
    setCommitDescription,
    commitSuggestionStatus,
    changes,
    handleGenerateCommitMessage,
    handleCommit,
}: EmbeddedSourceBodyProps) => (
    <Panel
        direction="horizontal"
        paneGap="var(--workbench-gap)"
        storageKey="git-source-split"
        hideSeparator
        className="min-h-0 flex-1"
        panes={[
            {
                id: "source-list",
                preferredSize: 360,
                minSize: 260,
                maxSize: 520,
                children: (
    <div className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
        {sourceChrome}
        <ChangeList
            stagedChanges={stagedChanges}
            unstagedChanges={unstagedChanges}
            isChangesOpen={isChangesOpen}
            setIsChangesOpen={setIsChangesOpen}
            stageAllChanges={stageAllChanges}
            unstageAllChanges={unstageAllChanges}
            refresh={refresh}
            handleShowDiff={handleShowDiff}
            gitRepo={gitRepo}
            selectedPath={diffFile?.path}
            selectedStaged={diffFile?.staged}
        />

        <div className={cn("py-2 flex flex-col shrink-0 z-10 relative", "bg-editor")}>
            <div
                className={cn(
                    "absolute left-0 right-0 top-0 -translate-y-full pb-10 h-8 bg-linear-to-t to-transparent pointer-events-none z-10",
                    "from-editor",
                )}
            />
            {lastCommit && (
                <LastCommitRow lastCommit={lastCommit} currentBranch={currentBranch} />
            )}

            <CommitComposer
                commitTitle={commitTitle}
                setCommitTitle={setCommitTitle}
                commitDescription={commitDescription}
                setCommitDescription={setCommitDescription}
                commitSuggestionStatus={commitSuggestionStatus}
                changes={changes}
                handleGenerateCommitMessage={handleGenerateCommitMessage}
                handleCommit={handleCommit}
                commitShortcut
            />

            <CommitActionsRow
                needsSync={needsSync}
                changes={changes}
                commitTitle={commitTitle}
                lastCommit={lastCommit}
                hasRemote={hasRemote}
                handleCommit={handleCommit}
                handlePush={handlePush}
                handleSync={handleSync}
            />
        </div>
    </div>
            ),
            },
            {
                id: "source-diff",
                flexible: true,
                minSize: 280,
                children: (
                    <DiffPane
                        diffFile={diffFile}
                        diffLoading={diffLoading}
                        diffOriginal={diffOriginal}
                        diffModified={diffModified}
                        active={active}
                        sideBySide={sideBySide}
                        setSideBySide={setSideBySide}
                        setDiffFile={setDiffFile}
                    />
                ),
            },
        ]}
    />
);

/** Panel source body: change list and commit footer for the sidebar panel. */
const PanelSourceBody = ({
    stagedChanges,
    unstagedChanges,
    isChangesOpen,
    setIsChangesOpen,
    stageAllChanges,
    unstageAllChanges,
    refresh,
    handleShowDiff,
    gitRepo,
    lastCommit,
    currentBranch,
    commitTitle,
    setCommitTitle,
    commitDescription,
    setCommitDescription,
    commitSuggestionStatus,
    changes,
    handleGenerateCommitMessage,
    handleCommit,
}: {
    stagedChanges: GitFileParams[];
    unstagedChanges: GitFileParams[];
    isChangesOpen: boolean;
    setIsChangesOpen: (value: boolean) => void;
    stageAllChanges: () => void;
    unstageAllChanges: () => void;
    refresh: (opts?: { track?: boolean }) => void;
    handleShowDiff: (path: string, staged: boolean) => void;
    gitRepo: string | null;
    lastCommit: GitLogEntry | null;
    currentBranch: string;
    commitTitle: string;
    setCommitTitle: (value: string) => void;
    commitDescription: string;
    setCommitDescription: (value: string) => void;
    commitSuggestionStatus: "idle" | "loading";
    changes: GitFileParams[];
    handleGenerateCommitMessage: () => void;
    handleCommit: CommitNow;
}) => (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0 relative">
        <ChangeList
            stagedChanges={stagedChanges}
            unstagedChanges={unstagedChanges}
            isChangesOpen={isChangesOpen}
            setIsChangesOpen={setIsChangesOpen}
            stageAllChanges={stageAllChanges}
            unstageAllChanges={unstageAllChanges}
            refresh={refresh}
            handleShowDiff={handleShowDiff}
            gitRepo={gitRepo}
        />
        <div className={cn("py-2 flex flex-col shrink-0 z-10 relative", "bg-panel")}>
            <div
                className={cn(
                    "absolute left-0 right-0 top-0 -translate-y-full pb-10 h-8 bg-linear-to-t to-transparent pointer-events-none z-10",
                    "from-panel",
                )}
            />
            {lastCommit && (
                <LastCommitRow lastCommit={lastCommit} currentBranch={currentBranch} />
            )}
            <CommitComposer
                commitTitle={commitTitle}
                setCommitTitle={setCommitTitle}
                commitDescription={commitDescription}
                setCommitDescription={setCommitDescription}
                commitSuggestionStatus={commitSuggestionStatus}
                changes={changes}
                handleGenerateCommitMessage={handleGenerateCommitMessage}
                handleCommit={handleCommit}
            />
            <div className="flex w-full items-center justify-end gap-1 px-2">
                <Button
                    variant="default"
                    size="sm"
                    onClick={() =>
                        handleCommit(false, { promptSyncAfter: true })
                    }
                    disabled={!commitTitle.trim() || changes.length === 0}
                >
                    Commit
                </Button>
            </div>
        </div>
    </div>
);

/** Source body switch: loading, no-repo, embedded, and panel states in original order. */
const SourceBody = (props: SourceBodyProps) => {
    const {
        reposLoading,
        scmRepoPath,
        isGitRepo,
        embedded,
        project_path,
        setIsGitRepo,
        stagedChanges,
        unstagedChanges,
        isChangesOpen,
        setIsChangesOpen,
        stageAllChanges,
        unstageAllChanges,
        refresh,
        handleShowDiff,
        gitRepo,
        lastCommit,
        currentBranch,
        commitTitle,
        setCommitTitle,
        commitDescription,
        setCommitDescription,
        commitSuggestionStatus,
        changes,
        handleGenerateCommitMessage,
        handleCommit,
    } = props;
    return (
    <div className="flex-1 flex flex-col overflow-hidden">
        {reposLoading && !scmRepoPath ? (
            <div className="flex h-full items-center justify-center p-4 text-sm text-text-muted">
                Looking for Git repositories…
            </div>
        ) : !isGitRepo ? (
            <NotGitRepo project_path={project_path} setIsGitRepo={setIsGitRepo} />
        ) : embedded ? (
            <EmbeddedSourceBody {...props} />
        ) : (
            <PanelSourceBody
                stagedChanges={stagedChanges}
                unstagedChanges={unstagedChanges}
                isChangesOpen={isChangesOpen}
                setIsChangesOpen={setIsChangesOpen}
                stageAllChanges={stageAllChanges}
                unstageAllChanges={unstageAllChanges}
                refresh={refresh}
                handleShowDiff={handleShowDiff}
                gitRepo={gitRepo}
                lastCommit={lastCommit}
                currentBranch={currentBranch}
                commitTitle={commitTitle}
                setCommitTitle={setCommitTitle}
                commitDescription={commitDescription}
                setCommitDescription={setCommitDescription}
                commitSuggestionStatus={commitSuggestionStatus}
                changes={changes}
                handleGenerateCommitMessage={handleGenerateCommitMessage}
                handleCommit={handleCommit}
            />
        )}
    </div>
    );
};

/** Drop stale status when the project or repo changes; runs during render like the inline pattern it replaces. */
const useResetStatusOnRepoChange = (repoKey: string, resetStatus: () => void) => {
    const [statusKey, setStatusKey] = useState(repoKey);
    if (statusKey !== repoKey) {
        setStatusKey(repoKey);
        resetStatus();
    }
};

/** Full-width chrome slot above the source body; hidden while embedded in a repo pane. */
const SourceChromeSlot = ({ embedded, isGitRepo, children }: {
    embedded: boolean;
    isGitRepo: boolean;
    children: React.ReactNode;
}) => (!(embedded && isGitRepo) ? children : null);

/** Source Control panel for one project: changes, branches, remotes, and commits. */
const Source = ({
    className,
    /** When true (e.g. inside the Git manager window), hide the Git-manager opener. */
    embedded = false,
    /** Keep-alive: unmount Monaco when the source pane is hidden. */
    active = true,
}: {
    className?: string;
    embedded?: boolean;
    active?: boolean;
}) => {
    const [commitTitle, setCommitTitle] = useState("");
    const [commitDescription, setCommitDescription] = useState("");
    const [commitSuggestionStatus, setCommitSuggestionStatus] = useState<"idle" | "loading">("idle");
    const [conflictHelp, setConflictHelp] = useState<string | null>(null);
    const [conflictHelpLoading, setConflictHelpLoading] = useState(false);
    const [diffFile, setDiffFile] = useState<{ path: string; staged: boolean } | null>(null);
    const [diffOriginal, setDiffOriginal] = useState("");
    const [diffModified, setDiffModified] = useState("");
    const [diffLoading, setDiffLoading] = useState(false);
    const [sideBySide, setSideBySide] = useState(false);
    const { project_path } = useProjectState();
    const { repos, scmRepoPath, hasMultipleRepos, setActiveRepo, activeRepoPath, loading: reposLoading } = useGitRepos(project_path);
    const gitRepo = scmRepoPath;
    const [changes, setChanges] = useState<GitFileParams[]>([]);
    const [currentBranch, setCurrentBranch] = useState("...");
    const [hasRemote, setHasRemote] = useState(false);
    const [lastCommit, setLastCommit] = useState<GitLogEntry | null>(null);
    const [needsSync, setNeedsSync] = useState(false);
    // Assume repo until discovery proves otherwise, avoids empty-state flash on remount.
    const [isGitRepo, setIsGitRepo] = useState(true);

    const [isChangesOpen, setIsChangesOpen] = useState(true);
    const [remoteDialogOpen, setRemoteDialogOpen] = useState(false);
    const [remotes, setRemotes] = useState<{ name: string; url: string }[]>([]);
    const [remoteLoading, setRemoteLoading] = useState(false);
    const [newRemoteName, setNewRemoteName] = useState("origin");
    const [newRemoteUrl, setNewRemoteUrl] = useState("");
    const [editingRemote, setEditingRemote] = useState<{ name: string; url: string } | null>(null);

    // Status belongs to one project + repo. When either changes, drop the old status during
    // render (React's "adjust state on prop change" pattern), so no frame shows the previous repo.
    const repoKey = `${project_path ?? ""}\n${scmRepoPath ?? ""}`;
    useResetStatusOnRepoChange(repoKey, () => {
        setChanges([]);
        setRemotes([]);
        setEditingRemote(null);
        setCurrentBranch("...");
        setHasRemote(false);
        setLastCommit(null);
        setNeedsSync(false);
        setIsGitRepo(true);
    });
    // Results of a refresh started for an earlier repo are dropped, not written over this one.
    const latestRepoKeyRef = useRef(repoKey);
    useEffect(() => {
        latestRepoKeyRef.current = repoKey;
        // Park the ref on a value no repo key can take (keys always contain
        // the newline separator) so a refresh still in flight at unmount or
        // key change reads as stale and drops its results.
        return () => {
            latestRepoKeyRef.current = "unmounted";
        };
    }, [repoKey]);

    const { startLoading, stopLoading } = useLoading();
    const settings = useSettings();

    const refresh = useGitStatusRefresh({
        projectPath: project_path,
        scmRepoPath,
        repoKey,
        reposCount: repos.length,
        reposLoading,
        startLoading,
        stopLoading,
        setChanges,
        setCurrentBranch,
        setHasRemote,
        setLastCommit,
        setNeedsSync,
        setIsGitRepo,
        latestRepoKeyRef,
        isGitRepo,
        changeCount: changes.length,
        hasLastCommit: lastCommit !== null,
    });

    useEffect(() => {
        // Soft refresh on mount, don't flash the global loading bar for routine open.
        void refresh({ track: false });
    }, [refresh]);

    useEffect(() => {
        /** Refresh on the window-level git-refresh event (staging, discard, repo switch). */
        const handleGitRefresh = () => { refresh().catch(() => undefined); };
        window.addEventListener("bettershape-git-refresh", handleGitRefresh);
        return () => window.removeEventListener("bettershape-git-refresh", handleGitRefresh);
    }, [refresh]);

    useEffect(() => {
        if (!project_path || !hasRemote || !settings.git.autoFetch || !gitRepo) return undefined;
        const intervalMs = settings.git.autoFetchInterval * 1000;
        const id = setInterval(() => {
            commands.gitFetch(gitRepo).catch(() => undefined);
        }, intervalMs);
        return () => clearInterval(id);
    }, [project_path, gitRepo, hasRemote, settings.git.autoFetch, settings.git.autoFetchInterval]);

    const {
        openRemoteDialog, handleAddRemote, handleRemoveRemote, handleSaveRemoteUrl,
        handleSync, handlePush, handlePull, handleFetch, handleGenerateCommitMessage,
        runConflictHelp, handleShowDiff, stageAllChanges, unstageAllChanges, stashChanges,
        popLatestStash, abortMerge, abortRebase,
    } = useGitPanelHandlers({
        gitRepo, projectPath: project_path, embedded, startLoading, stopLoading, refresh, changes,
        newRemoteName, newRemoteUrl, editingRemote,
        setRemoteDialogOpen, setRemoteLoading, setRemotes, setEditingRemote, setNewRemoteName,
        setNewRemoteUrl, setHasRemote, setNeedsSync, setCommitTitle, setCommitDescription,
        setCommitSuggestionStatus, setConflictHelp, setConflictHelpLoading, setDiffFile,
    });


    useEmbeddedDiffContent(embedded, gitRepo, diffFile, setDiffOriginal, setDiffModified, setDiffLoading);

    const handleCommit = useHandleCommit({
        gitRepo, commitTitle, commitDescription, lastCommit, hasRemote, changes,
        setCommitTitle, setCommitDescription, setCommitSuggestionStatus, setNeedsSync,
        refresh, handleSync,
    });



    const stagedChanges = changes.filter(c => c.staged);
    const unstagedChanges = changes.filter(c => !c.staged);

    const sourceChrome = (
        <SourceChrome
            embedded={embedded}
            active={active}
            isGitRepo={isGitRepo}
            project_path={project_path}
            gitRepo={gitRepo}
            changes={changes}
            conflictHelp={conflictHelp}
            conflictHelpLoading={conflictHelpLoading}
            hasMultipleRepos={hasMultipleRepos}
            repos={repos}
            activeRepoPath={activeRepoPath}
            refresh={refresh}
            handlePull={handlePull}
            handlePush={handlePush}
            handleSync={handleSync}
            handleFetch={handleFetch}
            runConflictHelp={runConflictHelp}
            openRemoteDialog={openRemoteDialog}
            setIsGitRepo={setIsGitRepo}
            setActiveRepo={setActiveRepo}
            stageAllChanges={stageAllChanges}
            unstageAllChanges={unstageAllChanges}
            stashChanges={stashChanges}
            popLatestStash={popLatestStash}
            abortMerge={abortMerge}
            abortRebase={abortRebase}
        />
    );


    return (
        <div className={cn("w-full h-full flex flex-col select-none overflow-hidden font-sans", className)}>
            {/* Sidebar: chrome spans full width. Embedded + repo: chrome only over the left list, like Graph. */}
            <SourceChromeSlot embedded={embedded} isGitRepo={isGitRepo}>{sourceChrome}</SourceChromeSlot>

            <SourceBody
                reposLoading={reposLoading}
                scmRepoPath={scmRepoPath}
                isGitRepo={isGitRepo}
                embedded={embedded}
                project_path={project_path}
                setIsGitRepo={setIsGitRepo}
                sourceChrome={sourceChrome}
                diffFile={diffFile}
                setDiffFile={setDiffFile}
                active={active}
                diffLoading={diffLoading}
                diffOriginal={diffOriginal}
                diffModified={diffModified}
                sideBySide={sideBySide}
                setSideBySide={setSideBySide}
                needsSync={needsSync}
                hasRemote={hasRemote}
                handlePush={handlePush}
                handleSync={handleSync}
                stagedChanges={stagedChanges}
                unstagedChanges={unstagedChanges}
                isChangesOpen={isChangesOpen}
                setIsChangesOpen={setIsChangesOpen}
                stageAllChanges={stageAllChanges}
                unstageAllChanges={unstageAllChanges}
                refresh={refresh}
                handleShowDiff={handleShowDiff}
                gitRepo={gitRepo}
                lastCommit={lastCommit}
                currentBranch={currentBranch}
                commitTitle={commitTitle}
                setCommitTitle={setCommitTitle}
                commitDescription={commitDescription}
                setCommitDescription={setCommitDescription}
                commitSuggestionStatus={commitSuggestionStatus}
                changes={changes}
                handleGenerateCommitMessage={handleGenerateCommitMessage}
                handleCommit={handleCommit}
            />

            <RemotesDialog
                remoteDialogOpen={remoteDialogOpen}
                setRemoteDialogOpen={setRemoteDialogOpen}
                remoteLoading={remoteLoading}
                remotes={remotes}
                editingRemote={editingRemote}
                setEditingRemote={setEditingRemote}
                handleSaveRemoteUrl={handleSaveRemoteUrl}
                handleRemoveRemote={handleRemoveRemote}
                newRemoteName={newRemoteName}
                setNewRemoteName={setNewRemoteName}
                newRemoteUrl={newRemoteUrl}
                setNewRemoteUrl={setNewRemoteUrl}
                handleAddRemote={handleAddRemote}
            />
        </div >
    );
};

export default Source;
