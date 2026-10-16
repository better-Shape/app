"use client";

import { Branch20Regular } from "@fluentui/react-icons/headless/svg/branch";
import { Cloud20Regular } from "@fluentui/react-icons/headless/svg/cloud";
import { Dismiss20Regular } from "@fluentui/react-icons/headless/svg/dismiss";
import { LayoutColumnTwo20Regular } from "@fluentui/react-icons/headless/svg/layout-column-two";
import { LayoutRowTwo20Regular } from "@fluentui/react-icons/headless/svg/layout-row-two";

import { Button } from "@/components/ui/button";
import { FileIcon } from "@/components/ui/file-icon";
import { Icon } from "@/components/ui/icon";
import { SwapText } from "@/components/ui/swap";
import { Tooltip } from "@/components/ui/tooltip";
import { ManagerDiffEditor } from "@/features/git/ui/shared/manager-diff";
import type { GitFileParams } from "@/lib/backend/types";
import { cn } from "@/lib/utils";
import type { BranchItem } from "./data";
import { Avatar, SyncPills } from "./list";

/** The file name at the end of a path, which is what the compare list shows first. */
const baseName = (path: string) => path.split(/[\\/]/).pop() || path;

/** Everything before the file name, which the row shows dimmed beside it. */
const folderOf = (path: string) => {
    const name = baseName(path);
    return path.slice(0, Math.max(0, path.length - name.length - 1));
};

/**
 * The tint a status letter takes.
 *
 * `A` and `U` share a colour on purpose: both mean the file is new to the comparison, which
 * is what the reader is scanning for, and a fifth hue for an untracked file would read as a
 * different kind of change rather than the same one.
 */
const STATUS_TINTS: Record<string, string> = {
    C: "var(--git-conflict)",
    M: "var(--git-modified)",
    A: "var(--git-added)",
    U: "var(--git-added)",
    D: "var(--git-deleted)",
};

/** The tint for a status letter, defaulting to added for a letter git adds later. */
const statusTint = (status: string) => STATUS_TINTS[status] ?? "var(--git-added)";

/** The detail header: which ref is on screen, whether it is HEAD, and the way out of compare. */
const DetailHeader = ({
    item,
    isCurrent,
    comparing,
    onClearCompare,
}: {
    item: BranchItem;
    isCurrent: boolean;
    comparing: boolean;
    onClearCompare: () => void;
}) => (
    <div className="flex h-9 shrink-0 items-center gap-2 px-3">
        <Icon
            icon={item.kind === "remote" ? Cloud20Regular : Branch20Regular}
            className="shrink-0 text-text-muted"
        />
        <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{item.name}</span>
        {isCurrent ? (
            <span className="rounded-md bg-accent/20 px-1.5 py-0.5 text-xs font-medium text-accent">
                Current
            </span>
        ) : null}
        {comparing ? (
            <Tooltip content="Clear compare">
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 p-0"
                    onClick={onClearCompare}
                >
                    <Icon icon={Dismiss20Regular} />
                </Button>
            </Tooltip>
        ) : null}
    </div>
);

/** The tip of the branch: who wrote it, when, and how it sits against its upstream. */
const TipSummary = ({ item }: { item: BranchItem }) => (
    <div className="space-y-3 px-3 py-3">
        <div className="flex items-center gap-2">
            <Avatar name={item.author} email={item.authorEmail} />
            <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-text-primary">
                    {item.author || "Unknown author"}
                </div>
                <div className="truncate text-xs text-text-muted">
                    {item.date || "No recent commit info"}
                </div>
            </div>
            <SyncPills ahead={item.ahead} behind={item.behind} />
        </div>
    </div>
);

/** The copy button, whose word is its own acknowledgement while the confirmation shows. */
const CopyNameButton = ({ copied, onCopy }: { copied: boolean; onCopy: () => void }) => (
    <Button
        size="sm"
        variant="outline"
        className={cn("h-8", copied && "text-success")}
        onClick={onCopy}
    >
        {/* The word the user is already reading is the acknowledgement; nothing else moves. */}
        <SwapText value={copied ? "Copied" : "Copy"} live />
    </Button>
);

/** The one row of actions that applies to the selected branch. */
const DetailActions = ({
    item,
    isCurrent,
    comparing,
    copied,
    onCheckout,
    onCompare,
    onCopy,
    onOpenRemote,
    onDelete,
}: {
    item: BranchItem;
    isCurrent: boolean;
    comparing: boolean;
    copied: boolean;
    onCheckout: () => void;
    onCompare: () => void;
    onCopy: () => void;
    onOpenRemote: () => void;
    onDelete: () => void;
}) => (
    <div className="flex flex-wrap gap-2 px-3 pb-3">
        <Button size="sm" className="h-8" onClick={onCheckout} disabled={isCurrent}>
            Checkout
        </Button>
        <Button size="sm" variant="outline" className="h-8" onClick={onCompare} disabled={comparing}>
            Compare
        </Button>
        <CopyNameButton copied={copied} onCopy={onCopy} />
        <Button size="sm" variant="outline" className="h-8" onClick={onOpenRemote}>
            Open on GitHub
        </Button>
        {item.kind === "local" && !isCurrent ? (
            <Button
                size="sm"
                variant="outline"
                className="h-8 text-error hover:text-error"
                onClick={onDelete}
            >
                Delete
            </Button>
        ) : null}
    </div>
);

/** One file in the comparison, with the letter git gave it. */
const CompareFileRow = ({
    file,
    selected,
    onOpen,
}: {
    file: GitFileParams;
    selected: boolean;
    onOpen: () => void;
}) => {
    const name = baseName(file.path);
    const folder = folderOf(file.path);

    return (
        <button
            type="button"
            onClick={onOpen}
            className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left",
                selected
                    ? "bg-[var(--row-selected)] hover:bg-[var(--row-selected-hover)] text-text-primary"
                    : "hover:bg-[var(--row-hover)]",
            )}
        >
            <FileIcon name={name} className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                {name}
                {folder ? <span className="text-text-muted"> · {folder}</span> : null}
            </span>
            <span
                className="w-4 shrink-0 text-center text-xs font-medium"
                style={{ color: statusTint(file.status) }}
            >
                {file.status}
            </span>
        </button>
    );
};

/** The comparison's left pane: how many files, against what, and the files themselves. */
const CompareFileList = ({
    files,
    currentBranch,
    selectedPath,
    onOpenFile,
}: {
    files: readonly GitFileParams[];
    currentBranch: string;
    selectedPath: string | null;
    onOpenFile: (file: GitFileParams) => void;
}) => (
    <div className="flex w-56 shrink-0 flex-col overflow-hidden">
        <div className="flex h-8 shrink-0 items-center px-2.5 text-xs font-medium text-text-muted">
            {files.length} file{files.length === 1 ? "" : "s"}
            <span className="ml-1.5 truncate font-normal">vs {currentBranch}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
            <div className="space-y-0.5">
                {files.map((file) => (
                    <CompareFileRow
                        key={file.path}
                        file={file}
                        selected={selectedPath === file.path}
                        onOpen={() => onOpenFile(file)}
                    />
                ))}
            </div>
        </div>
    </div>
);

/** The comparison's right pane: one file's diff, or the prompt to pick one. */
const CompareDiffPane = ({
    file,
    active,
    loading,
    sideBySide,
    original,
    modified,
    onToggleLayout,
}: {
    file: GitFileParams | null;
    active: boolean;
    loading: boolean;
    sideBySide: boolean;
    original: string;
    modified: string;
    onToggleLayout: () => void;
}) => {
    if (!file) {
        return (
            <div className="flex h-full items-center justify-center text-sm text-text-muted">
                Select a file to diff
            </div>
        );
    }

    return (
        <>
            <div className="flex h-8 shrink-0 items-center gap-2 px-2.5">
                <FileIcon name={baseName(file.path)} className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
                    {file.path}
                </span>
                <Tooltip content={sideBySide ? "Inline diff" : "Side by side"}>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 p-0"
                        onClick={onToggleLayout}
                    >
                        <Icon
                            icon={sideBySide ? LayoutRowTwo20Regular : LayoutColumnTwo20Regular}
                        />
                    </Button>
                </Tooltip>
            </div>
            <div className="relative min-h-0 flex-1 overflow-hidden">
                {loading ? (
                    <div className="flex h-full items-center justify-center text-sm text-text-muted">
                        Loading diff…
                    </div>
                ) : (
                    <ManagerDiffEditor
                        active={active}
                        original={original}
                        modified={modified}
                        path={file.path}
                        sideBySide={sideBySide}
                    />
                )}
            </div>
        </>
    );
};

/** The comparison: the file list on the left, the selected diff on the right. */
const CompareBrowser = ({ view }: { view: BranchDetailView }) => (
    <div className="flex min-h-0 flex-1 overflow-hidden">
        <CompareFileList
            files={view.compare.files}
            currentBranch={view.currentBranch}
            selectedPath={view.compare.file?.path ?? null}
            onOpenFile={view.onOpenCompareFile}
        />
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <CompareDiffPane
                file={view.compare.file}
                active={view.active}
                loading={view.compare.diffLoading}
                sideBySide={view.sideBySide}
                original={view.compare.original}
                modified={view.compare.modified}
                onToggleLayout={view.onToggleLayout}
            />
        </div>
    </div>
);

/** The sentence that teaches the list's two gestures while nothing is compared. */
const CompareHint = ({ currentBranch }: { currentBranch: string }) => (
    <div className="px-3 py-3 text-xs text-text-muted">
        Double-click a branch in the list to check it out. Right-click for rename or upstream.
        Use Compare to diff against {currentBranch || "HEAD"}.
    </div>
);

/** What the comparison is showing, which is what decides the body under the actions. */
const compareBody = (view: BranchDetailView) => {
    if (view.compare.loading) {
        return (
            <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-text-muted">
                Loading compare…
            </div>
        );
    }
    if (view.compare.files.length > 0) return <CompareBrowser view={view} />;
    return <CompareHint currentBranch={view.currentBranch} />;
};

export type BranchDetailView = {
    active: boolean;
    item: BranchItem;
    currentBranch: string;
    sideBySide: boolean;
    compare: {
        files: readonly GitFileParams[];
        file: GitFileParams | null;
        original: string;
        modified: string;
        loading: boolean;
        diffLoading: boolean;
    };
    copied: boolean;
    onCheckout: () => void;
    onCompare: () => void;
    onCopy: () => void;
    onOpenRemote: () => void;
    onDelete: () => void;
    onClearCompare: () => void;
    onOpenCompareFile: (file: GitFileParams) => void;
    onToggleLayout: () => void;
};

/**
 * The right-hand pane: the selected branch's tip, its actions, and the comparison when one is
 * running.
 *
 * The pane is only mounted when a branch is selected, so there is no empty state here beyond
 * the placeholder this file's caller draws.
 */
export const BranchDetailPane = ({ view }: { view: BranchDetailView }) => {
    const isCurrent =
        view.item.name === view.currentBranch || view.item.displayName === view.currentBranch;

    return (
        <div className="workbench-panel flex h-full min-h-0 flex-col overflow-hidden border border-border-subtle bg-editor">
            <DetailHeader
                item={view.item}
                isCurrent={isCurrent}
                comparing={view.compare.files.length > 0 || view.compare.loading}
                onClearCompare={view.onClearCompare}
            />
            <TipSummary item={view.item} />
            <DetailActions
                item={view.item}
                isCurrent={isCurrent}
                comparing={view.compare.loading}
                copied={view.copied}
                onCheckout={view.onCheckout}
                onCompare={view.onCompare}
                onCopy={view.onCopy}
                onOpenRemote={view.onOpenRemote}
                onDelete={view.onDelete}
            />
            {compareBody(view)}
        </div>
    );
};
