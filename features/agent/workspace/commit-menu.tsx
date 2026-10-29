"use client";

import { GithubMark } from "@/components/ui/github-mark";
import { Branch20Regular } from "@fluentui/react-icons/headless/svg/branch";
import { ChevronDown20Regular } from "@fluentui/react-icons/headless/svg/chevron-down";


import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { commands, type GitFileParams } from "@/lib/backend";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icon";

import { FileIcon } from "@/components/ui/file-icon";
import { Input } from "@/components/ui/input";
import { notify } from "@/features/notifications";
import { GenerateStarButton } from "@/features/git/ui/shared/generate-star";
import { QuickPick, type QuickPickItem } from "@/components/ui/quick-pick";
import {
    AzureDevOpsMark,
    BitbucketMark,
    GitHubMark,
    GitLabMark,
    GitUrlMark,
} from "@/features/chat/ui/shell/brand-marks";
import {
    CLONE_PLACEHOLDER,
    toCloneUrl,
    type CloneKind,
} from "@/features/chat/ui/shell/project-pick";
import { discoverGitRepos, invalidateGitRepoCache, pickDefaultRepo } from "@/lib/git/repos";
import { loginGitHub, useGitHubAuth } from "@/lib/github/store";
import { getSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import {
    AlertDialog,
    AlertDialogBody,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Extracts the trailing file or directory name from a repository path. */
function fileName(path: string) {
    return path.split(/[\\/]/).pop() || path;
}

/** Returns the parent directory portion of a repository-relative file path. */
function parentFolder(path: string) {
    const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
    return parts.length > 1 ? (parts[parts.length - 2] ?? "") : "";
}

/** Opens a native folder-selection dialog and resolves the chosen directory path. */
async function pickDirectory(title: string): Promise<string | null> {
    const { open: pick } = await import("@tauri-apps/plugin-dialog");
    const selected = await pick({ directory: true, multiple: false, title });
    return typeof selected === "string" ? selected : null;
}

/** Wraps a Git provider brand glyph inside a uniform icon slot. */
function hostMark(node: ReactNode) {
    return <span className="flex size-4 items-center justify-center">{node}</span>;
}

/** Renders the repository initialization and clone quick-pick modal when no repo is open. */
function GitSetupPick({
    open,
    onOpenChange,
    projectPath,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    projectPath: string;
}) {
    const [step, setStep] = useState<"setup" | "clone">("setup");
    const [cloneKind, setCloneKind] = useState<CloneKind>("git");
    const [query, setQuery] = useState("");

    // Reset the dialog when it closes (adjusting state during render, no effect).
    const [seenOpen, setSeenOpen] = useState(open);
    if (open !== seenOpen) {
        setSeenOpen(open);
        if (!open) {
            setStep("setup");
            setQuery("");
        }
    }

    const close = () => onOpenChange(false);

    const initialize = async () => {
        if (!projectPath) {
            notify.error("Git", "Open a folder first.");
            return;
        }
        try {
            await commands.gitInit(projectPath);
            invalidateGitRepoCache();
            window.dispatchEvent(new Event("bettershape-git-refresh"));
            notify.success("Git", "Repository initialized.");
            close();
        } catch (err) {
            notify.gitError(err, "Failed to initialize repository");
        }
    };

    const cloneFromUrl = async (repoUrl: string) => {
        const parent = await pickDirectory("Select folder to clone into");
        if (!parent) return;
        notify.info("Git", "Cloning repository…");
        try {
            const clonedPath = await commands.gitClone(repoUrl, parent);
            invalidateGitRepoCache();
            window.dispatchEvent(new Event("bettershape-git-refresh"));
            notify.success("Git", "Repository cloned.");
            close();
            window.dispatchEvent(new CustomEvent("bettershape-open-project", { detail: { path: clonedPath } }));
        } catch (err) {
            notify.error("Git", err instanceof Error ? err.message : String(err));
        }
    };

    const setupItems: QuickPickItem[] = [
        {
            id: "init",
            label: "Initialize repository",
            description: projectPath || "Open a folder first",
            icon: Branch20Regular,
        },
        {
            id: "git",
            label: "Git URL",
            description: "Clone from any git remote",
            iconNode: hostMark(<GitUrlMark />),
        },
        {
            id: "github",
            label: "GitHub repository",
            description: "Clone GitHub owner/repo",
            iconNode: hostMark(<GitHubMark />),
        },
        {
            id: "gitlab",
            label: "GitLab repository",
            description: "Clone group/project",
            iconNode: hostMark(<GitLabMark />),
        },
        {
            id: "bitbucket",
            label: "Bitbucket repository",
            description: "Clone workspace/repo",
            iconNode: hostMark(<BitbucketMark />),
        },
        {
            id: "azure",
            label: "Azure DevOps repository",
            description: "Clone org/project/repo",
            iconNode: hostMark(<AzureDevOpsMark />),
        },
    ];

    if (!open) return null;

    if (step === "clone") {
        return (
            <QuickPick
                open={open}
                onOpenChange={(next) => {
                    if (next) return;
                    setStep("setup");
                    setQuery("");
                }}
                title="Clone repository"
                placeholder={CLONE_PLACEHOLDER[cloneKind]}
                query={query}
                onQueryChange={setQuery}
                items={[]}
                emptyText="Press Enter to clone."
                onSelect={() => undefined}
                onSubmitQuery={(value) => {
                    const url = toCloneUrl(cloneKind, value);
                    if (!url) {
                        notify.error("Git", `Use ${CLONE_PLACEHOLDER[cloneKind]}`);
                        return;
                    }
                    cloneFromUrl(url).catch(() => undefined);
                }}
            />
        );
    }

    const q = query.trim().toLowerCase();
    return (
        <QuickPick
            open={open}
            onOpenChange={onOpenChange}
            title="Set up Git"
            placeholder="Initialize this folder or clone a repository…"
            query={query}
            onQueryChange={setQuery}
            items={setupItems.filter((item) => {
                if (!q) return true;
                return (
                    item.label.toLowerCase().includes(q) ||
                    (item.description ?? "").toLowerCase().includes(q)
                );
            })}
            onSelect={(item) => {
                if (item.id === "init") {
                    initialize().catch(() => undefined);
                    return;
                }
                setQuery("");
                setCloneKind(item.id as CloneKind);
                setStep("clone");
            }}
        />
    );
}

/** Maps a Git porcelain status string to its single-letter badge code. */
function statusLetter(status: string) {
    const code = status.trim().replace("?", "U").charAt(0).toUpperCase();
    return code || "M";
}

/** Parses `--numstat` diff output into per-file added and deleted line counts. */
function parseDiffFileStats(raw: string): Record<string, { plus: number; minus: number }> {
    const stats: Record<string, { plus: number; minus: number }> = {};
    let current: string | null = null;
    for (const line of raw.split("\n")) {
        const gitHeader = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
        if (gitHeader) {
            current = gitHeader[2].replace(/\\/g, "/");
            if (!stats[current]) stats[current] = { plus: 0, minus: 0 };
            continue;
        }
        if (!current) continue;
        if (line.startsWith("+") && !line.startsWith("+++")) stats[current].plus += 1;
        if (line.startsWith("-") && !line.startsWith("---")) stats[current].minus += 1;
    }
    return stats;
}

type RepoSnapshot = {
    repo: string | null;
    files: GitFileParams[];
    stats: Record<string, { plus: number; minus: number }>;
    lastMessage: string;
    hasRemote: boolean;
    ahead: number;
    behind: number;
    branch: string;
};

const EMPTY_REPO_SNAPSHOT: RepoSnapshot = {
    repo: null,
    files: [],
    stats: {},
    lastMessage: "",
    hasRemote: false,
    ahead: 0,
    behind: 0,
    branch: "",
};

const GIT_STATUS_TONES: Partial<Record<string, string>> = {
    A: "text-success",
    D: "text-error",
};

/** Extracts the first subject line from a single-commit git log response. */
const extractHeadSubject = (log: Array<{ message?: string }>): string =>
    log.at(0)?.message?.split("\n")[0] ?? "";

/** Normalizes ahead/behind sync counters when `gitSyncStatus` returns `null`. */
const extractSyncCounts = (sync: { ahead?: number; behind?: number } | null) => ({
    ahead: sync?.ahead ?? 0,
    behind: sync?.behind ?? 0,
});

/** Loads repository status, diff line totals, sync counts, and current branch for `projectPath`. */
const loadRepoSnapshot = async (projectPath: string): Promise<RepoSnapshot> => {
    const repos = await discoverGitRepos(projectPath);
    const path = pickDefaultRepo(projectPath, repos);
    if (!path) return EMPTY_REPO_SNAPSHOT;
    const files = await commands.gitStatus(path);
    const rawDiff = await commands.gitDiff(path).catch(() => "");
    const [log, sync, hasRemote, current] = await Promise.all([
        commands.gitLog(path, 1).catch(() => []),
        commands.gitSyncStatus(path).catch(() => null),
        commands.gitHasRemote(path).catch(() => false),
        commands.gitCurrentBranch(path).catch(() => ""),
    ]);
    return {
        repo: path,
        files,
        stats: parseDiffFileStats(rawDiff),
        lastMessage: extractHeadSubject(log),
        hasRemote,
        ...extractSyncCounts(sync),
        branch: current,
    };
};

/** Confirms staging unstaged changes into an amended commit. */
const resolveAmendPathsToStage = async (paths: string[]): Promise<string[]> => {
    if (paths.length === 0) return [];
    const stageAll = await confirm("Stage these changes into the amended commit?", {
        title: "Amend commit",
        kind: "info",
        okLabel: "Stage and amend",
        cancelLabel: "Message only",
    });
    return stageAll ? paths : [];
};

/** Confirms unstaged-changes staging policy for normal commits or amends. */
const resolvePathsToStage = async (
    paths: string[],
    hasStaged: boolean,
    amend: boolean,
): Promise<string[] | null> => {
    if (hasStaged) return paths;
    if (amend) return resolveAmendPathsToStage(paths);
    const ok = await confirm("Nothing is staged. Stage these changes and commit?", {
        title: "Stage and commit",
        kind: "warning",
        okLabel: "Stage and commit",
        cancelLabel: "Cancel",
    });
    return ok ? paths : null;
};

/** Prompts before rewriting a commit that is already published to a remote. */
const confirmPublishedAmendGuard = (
    amend: boolean,
    hasRemote: boolean,
    ahead: number,
): Promise<boolean> => {
    if (!amend || !hasRemote || ahead > 0) return Promise.resolve(true);
    return confirm("The latest commit is already on the remote. Amending rewrites that history.", {
        title: "Amend published commit",
        kind: "warning",
        okLabel: "Amend",
        cancelLabel: "Cancel",
    });
};

/** Prompts for final commit confirmation when `git.confirmBeforeCommit` is enabled. */
const confirmFinalCommitStep = (message: string, amend: boolean): Promise<boolean> => {
    if (!getSettings().git.confirmBeforeCommit) return Promise.resolve(true);
    const prompt = amend ? `Amend the last commit?\n\n${message}` : `Create this commit?\n\n${message}`;
    return confirm(prompt, {
        title: amend ? "Amend commit" : "Create commit",
        kind: "info",
        okLabel: amend ? "Amend" : "Commit",
        cancelLabel: "Cancel",
    });
};

/** Confirms published-amend and optional pre-commit gates for an already-resolved stage set. */
const verifyCommitGates = async (
    message: string,
    amend: boolean,
    hasRemote: boolean,
    ahead: number,
): Promise<boolean> => {
    if (!(await confirmPublishedAmendGuard(amend, hasRemote, ahead))) return false;
    return confirmFinalCommitStep(message, amend);
};

/** Confirms staging, published-amend history rewrite, and optional commit confirmation gates. */
const resolveApprovedCommitPaths = async ({
    paths,
    files,
    message,
    amend,
    hasRemote,
    ahead,
}: {
    paths: string[];
    files: GitFileParams[];
    message: string;
    amend: boolean;
    hasRemote: boolean;
    ahead: number;
}): Promise<string[] | null> => {
    if (paths.length === 0 && !amend) return null;
    const toStage = await resolvePathsToStage(paths, files.some((file) => file.staged), amend);
    if (!toStage) return null;
    return (await verifyCommitGates(message, amend, hasRemote, ahead)) ? toStage : null;
};

/** Sums diff `+` / `-` line counts across tracked files in the working tree. */
const sumWorkingTreeDiffStats = (
    files: GitFileParams[],
    stats: Partial<Record<string, { plus: number; minus: number }>>,
) => {
    let plus = 0;
    let minus = 0;
    for (const file of files) {
        const row = stats[file.path.replace(/\\/g, "/")];
        if (!row) continue;
        plus += row.plus;
        minus += row.minus;
    }
    return { plus, minus };
};

/** Subscribes `bettershape-git-refresh` and exposes the latest `RepoSnapshot` + `refresh` handle. */
const useCommitMenuSnapshot = (projectPath: string) => {
    const [snapshot, setSnapshot] = useState<RepoSnapshot>(EMPTY_REPO_SNAPSHOT);
    const refresh = useCallback(
        () =>
            loadRepoSnapshot(projectPath)
                .then(setSnapshot)
                .catch(() => setSnapshot(EMPTY_REPO_SNAPSHOT)),
        [projectPath],
    );

    useEffect(() => {
        refresh().catch(() => undefined);
        /** Refreshes repository status whenever git state mutates. */
        const on = () => {
            refresh().catch(() => undefined);
        };
        window.addEventListener("bettershape-git-refresh", on);
        return () => window.removeEventListener("bettershape-git-refresh", on);
    }, [refresh]);

    return { snapshot, setSnapshot, refresh };
};

/** Renders the Commit trigger button with live `+` / `−` diff counters. */
const CommitTriggerButton = ({
    busy,
    totals,
}: {
    busy: boolean;
    totals: { plus: number; minus: number };
}) => (
    <DropdownMenuTrigger asChild>
        <Button
            variant="outline"
            size="sm"
            disabled={busy}
            className="px-1.5 text-sm font-normal text-text-muted hover:bg-[var(--btn-hover)] hover:text-text-primary"
        >
            <span>Commit</span>
            {totals.plus > 0 ? <span className="tabular-nums text-success">+{totals.plus}</span> : null}
            {totals.minus > 0 ? <span className="tabular-nums text-error">−{totals.minus}</span> : null}
            <Icon icon={ChevronDown20Regular} className="opacity-60" />
        </Button>
    </DropdownMenuTrigger>
);

/** Renders the framed commit message + optional description box inside `CommitMenu`. */
const CommitMessageComposer = ({
    title,
    setTitle,
    description,
    setDescription,
    descriptionOpen,
    setDescriptionOpen,
    busy,
    hasFiles,
    onCommitAll,
    onSuggest,
}: {
    title: string;
    setTitle: (next: string) => void;
    description: string;
    setDescription: (next: string) => void;
    descriptionOpen: boolean;
    setDescriptionOpen: (next: boolean) => void;
    busy: boolean;
    hasFiles: boolean;
    onCommitAll: () => void;
    onSuggest: () => void;
}) => (
    <div className="overflow-hidden squircle-xl border border-border-subtle bg-surface-2 transition-colors focus-within:border-border-secondary">
        <div className="relative flex items-center">
            <Input
                value={title}
                placeholder="Message"
                className="h-[34px] border-none bg-transparent px-3 pr-9 text-sm shadow-none focus-visible:ring-0"
                disabled={busy}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key !== "Enter") return;
                    if (event.ctrlKey || event.metaKey) {
                        event.preventDefault();
                        onCommitAll();
                    } else if (event.shiftKey) {
                        event.preventDefault();
                        setDescriptionOpen(true);
                    }
                }}
            />
            <GenerateStarButton
                placement="inline"
                loading={busy}
                disabled={!hasFiles}
                onClick={onSuggest}
            />
        </div>
        {description || descriptionOpen ? (
            <textarea
                value={description}
                placeholder="Description (optional)"
                disabled={busy}
                rows={2}
                onChange={(event) => {
                    setDescriptionOpen(true);
                    setDescription(event.target.value);
                }}
                onKeyDown={(event) => {
                    if (event.key !== "Escape") event.stopPropagation();
                    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                        event.preventDefault();
                        onCommitAll();
                    }
                }}
                className="w-full resize-none border-t border-border-subtle bg-transparent px-3 py-2 text-xs leading-relaxed text-text-secondary outline-none placeholder:text-text-disabled"
            />
        ) : null}
    </div>
);

/** Formats optional parenthesized count suffix (`Pull (2)`, `Push (1)`). */
const formatCountSuffix = (label: string, count: number): string =>
    count > 0 ? `${label} (${count})` : label;

/** Formats dynamic labels for `Pull`, `Push`, and `New branch` submenu items. */
const deriveSubmenuLabels = (snapshot: RepoSnapshot) => ({
    pullLabel: formatCountSuffix("Pull", snapshot.behind),
    pushLabel: formatCountSuffix("Push", snapshot.ahead),
    branchLabel: snapshot.branch ? `New branch from ${snapshot.branch}` : "New branch",
});

/** Computes repo/remote disabled flags for `CommitSecondarySubmenu`. */
const deriveSubmenuRemoteFlags = (snapshot: RepoSnapshot, busy: boolean) => {
    const noRepoOrBusy = !snapshot.repo || busy;
    return {
        noRepoOrBusy,
        noRemoteOrBusy: !snapshot.hasRemote || busy,
        disablePublish: noRepoOrBusy || snapshot.hasRemote,
    };
};

/** Computes disabled flags and dynamic menu item labels for `CommitSecondarySubmenu`. */
const deriveSubmenuState = (snapshot: RepoSnapshot, busy: boolean) => ({
    canAmend: !busy && Boolean(snapshot.lastMessage),
    canCommitStaged: !busy && snapshot.files.some((file) => file.staged),
    noFilesOrBusy: snapshot.files.length === 0 || busy,
    ...deriveSubmenuRemoteFlags(snapshot, busy),
    ...deriveSubmenuLabels(snapshot),
});

/** Renders the secondary git actions submenu (`Amend`, `Stage`, `Fetch`, `Pull`, `Push`, `Stash`, `Publish`). */
const CommitSecondarySubmenu = ({
    snapshot,
    busy,
    stashTitle,
    onAmend,
    onCommitStaged,
    onStageAll,
    onDiscardAll,
    onPush,
    onCreateBranch,
    onOpenPublish,
    withRepo,
    runGit,
}: {
    snapshot: RepoSnapshot;
    busy: boolean;
    stashTitle: string;
    onAmend: () => void;
    onCommitStaged: () => void;
    onStageAll: () => void;
    onDiscardAll: () => void;
    onPush: () => void;
    onCreateBranch: () => void;
    onOpenPublish: () => void;
    withRepo: (run: (path: string) => void) => () => void;
    runGit: (label: string, task: () => Promise<unknown>) => Promise<void>;
}) => {
    const state = deriveSubmenuState(snapshot, busy);

    return (
        <DropdownMenuSub>
            <DropdownMenuSubTrigger
                aria-label="Commit options"
                disabled={busy}
                className="h-9 w-9 shrink-0 justify-center squircle-2xl border border-border-subtle bg-surface-3 px-0! py-0! hover:bg-[var(--btn-hover)] [&>svg]:ml-0"
            />
            <DropdownMenuSubContent className="min-w-52">
                <DropdownMenuItem disabled={!state.canAmend} onSelect={onAmend}>
                    Amend last commit
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!state.canCommitStaged} onSelect={onCommitStaged}>
                    Commit staged
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={state.noFilesOrBusy} onSelect={onStageAll}>
                    Stage all
                </DropdownMenuItem>
                <DropdownMenuItem
                    disabled={state.noRepoOrBusy}
                    onSelect={withRepo((path) => {
                        runGit("Unstaged", () => commands.gitUnstageAll(path)).catch(() => undefined);
                    })}
                >
                    Unstage all
                </DropdownMenuItem>
                <DropdownMenuItem disabled={state.noFilesOrBusy} onSelect={onDiscardAll}>
                    Discard all changes
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    disabled={state.noRemoteOrBusy}
                    onSelect={withRepo((path) => {
                        runGit("Fetched", () => commands.gitFetch(path)).catch(() => undefined);
                    })}
                >
                    Fetch
                </DropdownMenuItem>
                <DropdownMenuItem
                    disabled={state.noRemoteOrBusy}
                    onSelect={withRepo((path) => {
                        runGit("Pulled", () => commands.gitPull(path)).catch(() => undefined);
                    })}
                >
                    {state.pullLabel}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={state.noRemoteOrBusy} onSelect={onPush}>
                    {state.pushLabel}
                </DropdownMenuItem>
                <DropdownMenuItem
                    disabled={state.noRemoteOrBusy}
                    onSelect={withRepo((path) => {
                        runGit("Synced", () => commands.gitSync(path)).catch(() => undefined);
                    })}
                >
                    Sync
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    disabled={state.noFilesOrBusy}
                    onSelect={withRepo((path) => {
                        runGit("Stashed", () => commands.gitStashSave(path, stashTitle, true)).catch(() => undefined);
                    })}
                >
                    Stash changes
                </DropdownMenuItem>
                <DropdownMenuItem
                    disabled={state.noRepoOrBusy}
                    onSelect={withRepo((path) => {
                        runGit("Stash applied", () => commands.gitStashPop(path, 0)).catch(() => undefined);
                    })}
                >
                    Pop stash
                </DropdownMenuItem>
                <DropdownMenuItem disabled={state.noRepoOrBusy} onSelect={onCreateBranch}>
                    {state.branchLabel}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={state.disablePublish} onSelect={onOpenPublish}>
                    Publish repository
                </DropdownMenuItem>
            </DropdownMenuSubContent>
        </DropdownMenuSub>
    );
};

/** Renders the scrollable changed-files list inside `CommitMenu`. */
const CommitChangesList = ({ files }: { files: GitFileParams[] }) => (
    <>
        <div className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-text-muted">
            <span className="flex-1">Changes</span>
            {files.length > 0 ? (
                <span className="squircle-md bg-surface-3 px-1.5 py-0.5 text-2xs tabular-nums text-text-secondary">
                    {files.length}
                </span>
            ) : null}
        </div>
        <div className="max-h-64 overflow-y-auto">
            {files.length === 0 ? (
                <div className="px-2 py-2 text-sm text-text-muted">No changes</div>
            ) : (
                files.map((file) => {
                    const letter = statusLetter(file.status);
                    const folder = parentFolder(file.path);
                    const tone = GIT_STATUS_TONES[letter] ?? "text-warning";
                    return (
                        <div
                            key={`${file.path}-${file.staged}`}
                            className="flex items-center gap-2 px-2 py-1 text-sm"
                        >
                            <FileIcon name={fileName(file.path)} className="size-4 shrink-0" />
                            <span className="min-w-0 flex-1 truncate text-text-primary">{fileName(file.path)}</span>
                            {folder ? <span className="shrink-0 text-sm text-text-muted">{folder}</span> : null}
                            <span className={cn("w-4 shrink-0 text-center text-sm", tone)}>{letter}</span>
                        </div>
                    );
                })
            )}
        </div>
    </>
);

/** Provides bound git mutation commands (`commitAll`, `amend`, `commitStaged`, `push`, `stageAll`, `discardAll`, `createBranch`, `suggest`, `withRepo`, `runGit`) for `CommitMenu`. */
const useCommitMenuCommands = ({
    snapshot,
    refresh,
    title,
    setTitle,
    description,
    setDescription,
    setDescriptionOpen,
    setBusy,
}: {
    snapshot: RepoSnapshot;
    refresh: () => Promise<void>;
    title: string;
    setTitle: (next: string) => void;
    description: string;
    setDescription: (next: string) => void;
    setDescriptionOpen: (next: boolean) => void;
    setBusy: (next: boolean) => void;
}) => {
    const { repo, files, lastMessage, hasRemote, ahead } = snapshot;

    /** Formats the combined commit subject and optional body text. */
    const messageBody = () => {
        const head = title.trim();
        const body = description.trim();
        return body ? `${head}\n\n${body}` : head;
    };

    /** Runs a busy-guarded Git command and refreshes repository state on completion. */
    const runGit = async (label: string, task: () => Promise<unknown>) => {
        if (!repo) return;
        setBusy(true);
        try {
            await task();
            window.dispatchEvent(new Event("bettershape-git-refresh"));
            notify.success("Git", label);
            await refresh();
        } catch (err) {
            notify.gitError(err);
        } finally {
            setBusy(false);
        }
    };

    /** Stages approved paths and commits or amends with secret-scan protection. */
    const commitPaths = async (paths: string[], message: string, isAmend = false) => {
        if (!repo || !message.trim()) {
            notify.error("Git", "Enter a commit title");
            return;
        }
        const approved = await resolveApprovedCommitPaths({
            paths,
            files,
            message,
            amend: isAmend,
            hasRemote,
            ahead,
        });
        if (!approved) return;
        await runGit(isAmend ? "Commit amended" : "Committed", async () => {
            for (const path of approved) await commands.gitStage(repo, path);
            if (isAmend) await commands.gitCommitAmend(repo, message);
            else await commands.gitCommit(repo, message);
            setTitle("");
            setDescription("");
            setDescriptionOpen(false);
        });
    };

    /** Stages and commits all modified working-tree paths. */
    const commitAll = () => {
        commitPaths(files.map((file) => file.path), messageBody()).catch(() => undefined);
    };

    /** Commits only the currently staged working-tree paths. */
    const commitStaged = () => {
        const staged = files.filter((file) => file.staged).map((file) => file.path);
        commitPaths(staged, messageBody()).catch(() => undefined);
    };

    /** Amends the previous commit with current paths and message. */
    const amend = () => {
        const nextMessage = title.trim() ? messageBody() : lastMessage;
        if (!nextMessage) {
            notify.error("Git", "Nothing to amend");
            return;
        }
        commitPaths(files.map((file) => file.path), nextMessage, true).catch(() => undefined);
    };

    /** Confirms and pushes local commits to the configured remote. */
    const push = async () => {
        if (!repo) return;
        const prompt =
            ahead > 0 ? `Push ${ahead} commit${ahead === 1 ? "" : "s"} to the remote?` : "Push to the remote?";
        const ok = await confirm(prompt, {
            title: "Push",
            kind: "info",
            okLabel: "Push",
            cancelLabel: "Cancel",
        });
        if (ok) await runGit("Pushed", () => commands.gitPush(repo));
    };

    /** Stages all modified working-tree files without committing. */
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

    /** Confirms and discards all uncommitted working-tree changes. */
    const discardAll = async () => {
        if (!repo || files.length === 0) return;
        const ok = await confirm("Discard every uncommitted change in this repo?", {
            title: "Discard changes",
            kind: "warning",
            okLabel: "Discard",
            cancelLabel: "Cancel",
        });
        if (!ok) return;
        await runGit("Changes discarded", async () => {
            for (const file of files) await commands.gitDiscardChanges(repo, file.path);
        });
    };

    /** Creates and checks out a new branch with the given name. */
    const createBranch = async (rawName: string) => {
        const name = rawName.trim();
        if (!repo || !name) return;
        await runGit(`Switched to ${name}`, async () => {
            await commands.gitCreateBranch(repo, name);
            await commands.gitSwitchBranch(repo, name);
        });
    };

    /** Stages changes and generates a commit subject and body via AI. */
    const suggest = async () => {
        if (!repo) return;
        setBusy(true);
        try {
            await commands.gitStageAll(repo);
            const lines = (await commands.generateCommitMessage(repo)).trim().split("\n");
            setTitle(lines.at(0) ?? "");
            setDescription(lines.slice(1).join("\n").trim());
        } catch (err) {
            notify.gitError(err);
        } finally {
            setBusy(false);
        }
    };

    /** Binds a callback to run only when an active repository path is resolved. */
    const withRepo = (run: (path: string) => void) => () => {
        if (repo) run(repo);
    };

    return {
        commitAll,
        commitStaged,
        amend,
        push,
        stageAll,
        discardAll,
        createBranch,
        suggest,
        withRepo,
        runGit,
    };
};

/** Resolves repository availability when the Commit dropdown opens, falling back to `GitSetupPick`. */
const handleCommitMenuOpenChange = ({
    next,
    projectPath,
    setSnapshot,
    setMenuOpen,
    setSetupOpen,
}: {
    next: boolean;
    projectPath: string;
    setSnapshot: React.Dispatch<React.SetStateAction<RepoSnapshot>>;
    setMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setSetupOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
    if (!next) {
        setMenuOpen(false);
        return;
    }
    discoverGitRepos(projectPath)
        .catch(() => [])
        .then((repos) => {
            const found = pickDefaultRepo(projectPath, repos);
            setSnapshot((prev) => ({ ...prev, repo: found }));
            setMenuOpen(Boolean(found));
            if (!found) setSetupOpen(true);
        })
        .catch(() => undefined);
};

/** Renders the composer, primary Commit button, secondary submenu, and file list inside `CommitMenu`. */
const CommitDropdownPanel = ({
    snapshot,
    busy,
    canCommit,
    title,
    setTitle,
    description,
    setDescription,
    descriptionOpen,
    setDescriptionOpen,
    git,
    onOpenNewBranch,
    onOpenPublish,
}: {
    snapshot: RepoSnapshot;
    busy: boolean;
    canCommit: boolean;
    title: string;
    setTitle: (next: string) => void;
    description: string;
    setDescription: (next: string) => void;
    descriptionOpen: boolean;
    setDescriptionOpen: React.Dispatch<React.SetStateAction<boolean>>;
    git: ReturnType<typeof useCommitMenuCommands>;
    onOpenNewBranch: () => void;
    onOpenPublish: () => void;
}) => (
    <DropdownMenuContent align="end" className="w-[320px]">
        <div
            className="flex flex-col gap-2 p-1.5"
            onPointerDown={(event) => event.stopPropagation()}
        >
            <CommitMessageComposer
                title={title}
                setTitle={setTitle}
                description={description}
                setDescription={setDescription}
                descriptionOpen={descriptionOpen}
                setDescriptionOpen={setDescriptionOpen}
                busy={busy}
                hasFiles={snapshot.files.length > 0}
                onCommitAll={git.commitAll}
                onSuggest={() => {
                    git.suggest().catch(() => undefined);
                }}
            />
            <div className="flex items-center gap-1.5">
                <Button
                    variant="default"
                    size="md"
                    className="flex-1"
                    disabled={!canCommit}
                    onClick={git.commitAll}
                >
                    Commit
                </Button>
                <CommitSecondarySubmenu
                    snapshot={snapshot}
                    busy={busy}
                    stashTitle={title.trim() || "WIP"}
                    onAmend={git.amend}
                    onCommitStaged={git.commitStaged}
                    onStageAll={() => {
                        git.stageAll().catch(() => undefined);
                    }}
                    onDiscardAll={() => {
                        git.discardAll().catch(() => undefined);
                    }}
                    onPush={() => {
                        git.push().catch(() => undefined);
                    }}
                    onCreateBranch={onOpenNewBranch}
                    onOpenPublish={onOpenPublish}
                    withRepo={git.withRepo}
                    runGit={git.runGit}
                />
            </div>
        </div>
        <CommitChangesList files={snapshot.files} />
    </DropdownMenuContent>
);

/** Modal dialog for naming and switching to a newly created Git branch. */
const CreateBranchDialog = ({
    open,
    busy,
    onClose,
    onSubmit,
}: {
    open: boolean;
    busy: boolean;
    onClose: () => void;
    onSubmit: (name: string) => void;
}) => {
    const [branchName, setBranchName] = useState("");
    /** Validates and submits the trimmed branch name when non-empty. */
    const submitIfValid = () => {
        const trimmed = branchName.trim();
        if (!trimmed) return;
        setBranchName("");
        onSubmit(trimmed);
    };
    return (
        <AlertDialog open={open} onOpenChange={(next) => { if (!next) { setBranchName(""); onClose(); } }}>
            <AlertDialogContent sizeClassName="max-w-[400px]">
                <AlertDialogHeader>
                    <AlertDialogTitle>New branch</AlertDialogTitle>
                    <AlertDialogDescription>Create a new branch from HEAD and switch to it.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogBody>
                    <Input
                        value={branchName}
                        placeholder="feature/branch-name"
                        spellCheck={false}
                        onChange={(event) => setBranchName(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") { event.preventDefault(); submitIfValid(); }
                        }}
                    />
                </AlertDialogBody>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => { setBranchName(""); onClose(); }}>Cancel</AlertDialogCancel>
                    <Button variant="default" size="sm" disabled={busy || !branchName.trim()} onClick={submitIfValid}>
                        Create branch
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

/** Renders the CommitMenu UI component. */
export const CommitMenu = ({ projectPath }: { projectPath: string }) => {
    const { snapshot, setSnapshot, refresh } = useCommitMenuSnapshot(projectPath);
    const [busy, setBusy] = useState(false);
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [descriptionOpen, setDescriptionOpen] = useState(false);
    const [publishOpen, setPublishOpen] = useState(false);
    const [newBranchOpen, setNewBranchOpen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [setupOpen, setSetupOpen] = useState(false);
    const github = useGitHubAuth();

    const totals = useMemo(
        () => sumWorkingTreeDiffStats(snapshot.files, snapshot.stats),
        [snapshot.files, snapshot.stats],
    );

    const git = useCommitMenuCommands({
        snapshot,
        refresh,
        title,
        setTitle,
        description,
        setDescription,
        setDescriptionOpen,
        setBusy,
    });

    const canCommit = snapshot.files.length > 0 && !busy && Boolean(title.trim());

    return (
        <>
            <DropdownMenu
                open={menuOpen}
                onOpenChange={(next) =>
                    handleCommitMenuOpenChange({
                        next,
                        projectPath,
                        setSnapshot,
                        setMenuOpen,
                        setSetupOpen,
                    })
                }
            >
                <CommitTriggerButton busy={busy} totals={totals} />
                <CommitDropdownPanel
                    snapshot={snapshot}
                    busy={busy}
                    canCommit={canCommit}
                    title={title}
                    setTitle={setTitle}
                    description={description}
                    setDescription={setDescription}
                    descriptionOpen={descriptionOpen}
                    setDescriptionOpen={setDescriptionOpen}
                    git={git}
                    onOpenNewBranch={() => setNewBranchOpen(true)}
                    onOpenPublish={() => setPublishOpen(true)}
                />
            </DropdownMenu>
            <CreateBranchDialog
                open={newBranchOpen}
                busy={busy}
                onClose={() => setNewBranchOpen(false)}
                onSubmit={(branchName) => {
                    setNewBranchOpen(false);
                    git.createBranch(branchName).catch(() => undefined);
                }}
            />
            <PublishRepoDialog
                open={publishOpen}
                repo={snapshot.repo}
                githubUser={github.loggedIn ? github.username : null}
                onClose={() => setPublishOpen(false)}
                onPublished={() => {
                    setPublishOpen(false);
                    refresh().catch(() => undefined);
                }}
            />
            <GitSetupPick open={setupOpen} onOpenChange={setSetupOpen} projectPath={projectPath} />
        </>
    );
};

/** Renders a multi-step dialog for linking a remote host and pushing the first commit. */
function PublishRepoDialog({
    open,
    repo,
    githubUser,
    onClose,
    onPublished,
}: {
    open: boolean;
    repo: string | null;
    githubUser: string | null;
    onClose: () => void;
    onPublished: () => void;
}) {
    const [step, setStep] = useState<"provider" | "repository" | "summary">("provider");
    const [name, setName] = useState("");
    const [busy, setBusy] = useState(false);
    const remoteUrl = githubUser && name.trim()
        ? `https://github.com/${githubUser}/${name.trim()}.git`
        : name.trim();

    const [dialogScope, setDialogScope] = useState<readonly [typeof open] | null>(null);
    if (dialogScope === null || !Object.is(dialogScope[0], open)) {
        setDialogScope([open]);
        if (!open) {
            setStep("provider");
            setName("");
        }

    }

    const publish = async () => {
        if (!repo || !remoteUrl.startsWith("http")) return;
        setBusy(true);
        try {
            await commands.gitAddRemote(repo, "origin", remoteUrl);
            await commands.gitPush(repo);
            window.dispatchEvent(new Event("bettershape-git-refresh"));
            notify.success("Git", "Repository published");
            onPublished();
        } catch (err) {
            notify.gitError(err);
        } finally {
            setBusy(false);
        }
    };

    return (
        <AlertDialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
            <AlertDialogContent sizeClassName="max-w-[520px]">
                <AlertDialogHeader>
                    <AlertDialogTitle>Publish repository</AlertDialogTitle>
                    <AlertDialogDescription>
                        Pick where to host it, then point at a repo to push to. Commits stay local until you publish.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogBody>
                    <div className="grid grid-cols-3 gap-2">
                        {(["provider", "repository", "summary"] as const).map((id, index) => (
                            <div
                                key={id}
                                className={cn(
                                    "rounded-lg border px-2 py-1.5 text-xs",
                                    step === id ? "border-accent bg-surface-2 text-text-primary" : "border-border-subtle text-text-muted",
                                )}
                            >
                                <div>Step {index + 1}</div>
                                <div className="capitalize">{id}</div>
                            </div>
                        ))}
                    </div>
                    {step === "provider" ? (
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                className="flex items-center gap-2 rounded-lg border border-accent px-3 py-2 text-left text-sm text-text-primary"
                                onClick={() => {
                                    if (!githubUser) {
                                        loginGitHub().catch(() => undefined);
                                        return;
                                    }
                                    setStep("repository");
                                }}
                            >
                                <Icon icon={GithubMark} />
                                <span className="flex-1">GitHub</span>
                                {githubUser ? null : <span className="text-xs text-warning">Setup required</span>}
                            </button>
                            {["Azure DevOps", "Bitbucket", "GitLab"].map((label) => (
                                <div key={label} className="flex items-center gap-2 rounded-lg border border-border-subtle px-3 py-2 text-sm text-text-muted">
                                    <span className="flex-1">{label}</span>
                                    <span className="text-xs text-warning">Setup required</span>
                                </div>
                            ))}
                        </div>
                    ) : null}
                    {step === "repository" ? (
                        <Input
                            value={name}
                            placeholder={githubUser ? "Repository name" : "https://github.com/you/repo.git"}
                            onChange={(event) => setName(event.target.value)}
                        />
                    ) : null}
                    {step === "summary" ? (
                        <p className="text-sm text-text-secondary">
                            Push this folder to <span className="text-text-primary">{remoteUrl}</span>
                        </p>
                    ) : null}
                </AlertDialogBody>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
                    {step === "provider" ? null : (
                        <Button variant="secondary" size="sm" onClick={() => setStep(step === "summary" ? "repository" : "provider")}>
                            Back
                        </Button>
                    )}
                    {step === "repository" ? (
                        <Button variant="default" size="sm" disabled={!name.trim()} onClick={() => setStep("summary")}>
                            Next
                        </Button>
                    ) : null}
                    {step === "summary" ? (
                        <Button variant="default" size="sm" disabled={busy || !remoteUrl.startsWith("http")} onClick={() => { publish().catch(() => undefined); }}>
                            Publish
                        </Button>
                    ) : null}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
