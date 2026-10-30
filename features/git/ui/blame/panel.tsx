"use client";

import { ArrowExportUp20Regular } from "@fluentui/react-icons/headless/svg/arrow-export-up";
import { ArrowSync20Regular } from "@fluentui/react-icons/headless/svg/arrow-sync";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { PanelStateMessage, openWorkspaceFilesTab } from "@/components/ui/state-message";
import { cn } from "@/lib/utils";
import {
    DEFAULT_GROUP_LIMIT,
    formatBlameDate,
    pluralAuthors,
    pluralCommits,
    pluralRegions,
    visibleBlameGroups,
    type BlameGroup,
    type BlameState,
} from "./model";

export type BlameCommitTarget = {
    commit: string;
    author: string;
    summary: string;
    /** First and last file line the group covers. */
    from: number;
    to: number;
};

function BlameGroupRow({
    group,
    nowSeconds,
    onOpenCommit,
}: {
    group: BlameGroup;
    nowSeconds: number;
    onOpenCommit: (target: BlameCommitTarget) => void;
}) {
    const span = group.from === group.to ? `${group.from}` : `${group.from}-${group.to}`;
    const shortHash = group.commit.slice(0, 7) || "unknown";
    const date = formatBlameDate(group.at, nowSeconds);
    const label = `${group.author}, ${group.summary}, commit ${shortHash}, lines ${span}`;
    return (
        <li className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--row-hover)]">
            <span
                className="w-16 shrink-0 pt-0.5 text-right font-mono text-2xs tabular-nums text-text-muted"
                title="File lines this commit is responsible for"
            >
                {span}
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                    <span className="truncate text-xs text-text-primary">{group.author}</span>
                    <span className="shrink-0 font-mono text-2xs text-text-muted">{shortHash}</span>
                    <span className="shrink-0 text-2xs text-text-muted">{date}</span>
                </div>
                <p className="truncate text-xs text-text-secondary" title={group.summary}>
                    {group.summary}
                </p>
            </div>
            <button
                type="button"
                onClick={() =>
                    onOpenCommit({
                        commit: group.commit,
                        author: group.author,
                        summary: group.summary,
                        from: group.from,
                        to: group.to,
                    })
                }
                aria-label={`Open the diff for ${label}`}
                title="Open the commit diff"
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-[var(--btn-hover)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus-ring"
            >
                <Icon icon={ArrowExportUp20Regular} className="icon-sm" />
            </button>
        </li>
    );
}

export function BlamePanel({
    state,
    busy,
    showAll,
    nowSeconds,
    onRefresh,
    onShowAll,
    onOpenCommit,
}: {
    state: BlameState;
    busy: boolean;
    showAll: boolean;
    /** Unix epoch seconds. Passed in so the relative dates are stable under test. */
    nowSeconds: number;
    onRefresh: () => void;
    onShowAll: () => void;
    onOpenCommit: (target: BlameCommitTarget) => void;
}) {
    const ready = state.kind === "ready" ? state : null;
    const rows = ready ? visibleBlameGroups(ready.groups, showAll ? ready.groups.length : DEFAULT_GROUP_LIMIT) : [];
    const capped = ready !== null && rows.length < ready.groups.length;

    return (
        <div className="flex h-full min-h-0 flex-col bg-panel">
            <div className="flex shrink-0 items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">Blame</span>
                {ready ? (
                    <span
                        className="min-w-0 shrink truncate font-mono text-xs text-text-muted"
                        title={ready.fileLabel}
                    >
                        {ready.fileLabel}
                    </span>
                ) : null}
                {ready ? (
                    <span className="shrink-0 text-xs text-text-muted">
                        {pluralRegions(ready.regions)}
                    </span>
                ) : null}
                <button
                    type="button"
                    aria-label="Re-run git blame"
                    onClick={onRefresh}
                    disabled={busy}
                    className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-[var(--btn-hover)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus-ring disabled:cursor-not-allowed disabled:opacity-40"
                >
                    <Icon
                        icon={ArrowSync20Regular}
                        className={cn(busy && "animate-spin motion-reduce:animate-none")}
                    />
                </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {state.kind === "no-project" ? (
                    <PanelStateMessage title="No project open" detail="Open a git repository to blame its files." />
                ) : state.kind === "blocked" ? (
                    <PanelStateMessage
                        title="No file to blame"
                        detail={state.reason}
                        actionLabel="Browse files"
                        onAction={openWorkspaceFilesTab}
                    />
                ) : state.kind === "loading" ? (
                    <PanelStateMessage title="Running git blame..." />
                ) : state.kind === "failed" ? (
                    <PanelStateMessage
                        title="Git blame did not run"
                        detail={state.message}
                        tone="error"
                        actionLabel="Try again"
                        onAction={onRefresh}
                        actionDisabled={busy}
                    />
                ) : ready && ready.groups.length === 0 ? (
                    <PanelStateMessage
                        title="Nothing to blame"
                        detail="Git returned no blame regions for this file."
                        actionLabel="Run again"
                        onAction={onRefresh}
                        actionDisabled={busy}
                    />
                ) : (
                    <ul className="flex flex-col">
                        {rows.map((group) => (
                            <BlameGroupRow
                                key={`${group.commit}:${group.from}`}
                                group={group}
                                nowSeconds={nowSeconds}
                                onOpenCommit={onOpenCommit}
                            />
                        ))}
                    </ul>
                )}
            </div>

            {ready ? (
                <div className="flex shrink-0 items-center gap-2 border-t border-border-subtle px-3 py-1.5 text-xs text-text-muted">
                    <span className="min-w-0 flex-1 truncate">
                        {pluralCommits(ready.commits)} · {pluralAuthors(ready.authors)} · file lines
                    </span>
                    {capped ? (
                        <Button size="xs" variant="ghost" onClick={onShowAll} aria-label="Show every blame region">
                            {rows.length} of {ready.groups.length} shown
                        </Button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}