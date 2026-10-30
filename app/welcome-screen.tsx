"use client";

import { GithubMark } from "@/components/ui/github-mark";
import { ArrowDownload20Regular } from "@fluentui/react-icons/headless/svg/arrow-download";
import { Folder20Filled } from "@fluentui/react-icons/headless/svg/folder";
import { Open20Regular } from "@fluentui/react-icons/headless/svg/open";
import { WindowConsole20Regular } from "@fluentui/react-icons/headless/svg/window-console";


import * as React from "react";
import { Collapse } from "@/components/ui/collapse";
import { type IconGlyph, Icon } from "@/components/ui/icon";

import {
    getRepoName,
    getRepoHistorySnapshot,
    getServerRepoHistorySnapshot,
    subscribeRepoHistory,
    type RepoHistoryEntry,
} from "@/lib/workspace/repo-history";
import { cn } from "@/lib/utils";

/** Parent directory portion of a path, rendered with the path's own separators. */
const parentDir = (path: string): string => {
    const normalized = path.replaceAll("\\", "/");
    const idx = normalized.lastIndexOf("/");
    if (idx <= 0) return path;
    const parent = normalized.slice(0, idx);
    return path.includes("\\") ? parent.replaceAll("/", "\\") : parent;
};

/** Single welcome-screen action tile (icon over label, +1 surface step on hover). */
const ActionCard = ({
    icon,
    label,
    onClick,
    external,
}: {
    icon: IconGlyph;
    label: string;
    onClick: () => void;
    external?: boolean;
}) => {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                "group press-spring relative flex flex-col items-start gap-3 rounded-xl bg-surface-3 px-4 py-4 text-left",
                "text-text-secondary transition-[background-color,color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]",
                "hover:bg-surface-4 hover:text-text-primary",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
            )}
        >
            {external ? (
                <Icon
                    icon={Open20Regular}
                    className="absolute right-3 top-3 opacity-40 transition-opacity duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] group-hover:opacity-75"
                />
            ) : null}
            <Icon icon={icon} className="shrink-0" />
            <span className="text-sm font-medium">{label}</span>
        </button>
    );
};

/** The four project entry actions: open, clone, SSH, and GitHub. */
const WelcomeActions = ({
    onPickFolder,
    onClone,
    onSsh,
    onConnectGitHub,
}: {
    onPickFolder: () => void;
    onClone: () => void;
    onSsh: () => void;
    onConnectGitHub: () => void;
}) => (
    <section className="grid w-full grid-cols-2 gap-2.5">
        <ActionCard icon={Folder20Filled} label="Open project" onClick={onPickFolder} />
        <ActionCard icon={ArrowDownload20Regular} label="Clone repo" onClick={onClone} />
        <ActionCard icon={WindowConsole20Regular} label="Connect via SSH" onClick={onSsh} />
        <ActionCard icon={GithubMark} label="Connect GitHub" onClick={onConnectGitHub} external />
    </section>
);

const RecentProjectRow = ({
    entry,
    onOpenProject,
}: {
    entry: RepoHistoryEntry;
    onOpenProject: (path: string) => void;
}) => (
    <li>
        <button
            type="button"
            onClick={() => onOpenProject(entry.path)}
            className="flex w-full items-baseline justify-between gap-4 rounded-md px-1 py-1.5 text-left text-sm transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--row-hover)]"
        >
            <span className="shrink-0 text-text-primary">{getRepoName(entry.path)}</span>
            <span className="min-w-0 truncate text-right text-text-muted">
                {parentDir(entry.path)}
            </span>
        </button>
    </li>
);

/** Recent project list, collapsed to five entries until expanded. */
const RecentProjects = ({
    recentFolders,
    showAll,
    onToggleShowAll,
    onOpenProject,
}: {
    recentFolders: RepoHistoryEntry[];
    showAll: boolean;
    onToggleShowAll: () => void;
    onOpenProject: (path: string) => void;
}) => {
    const overflowId = React.useId();
    const initialEntries = recentFolders.slice(0, 5);
    const overflowEntries = recentFolders.slice(5);

    return (
        <section className="flex w-full flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium text-text-primary">Recent projects</h2>
                {overflowEntries.length > 0 ? (
                    <button
                        type="button"
                        aria-expanded={showAll}
                        aria-controls={overflowId}
                        className="text-sm text-text-muted transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:text-text-secondary"
                        onClick={onToggleShowAll}
                    >
                        {showAll ? "Show less" : `View all (${recentFolders.length})`}
                    </button>
                ) : null}
            </div>

            {recentFolders.length === 0 ? (
                <p className="py-2 text-sm text-text-muted">No recent projects</p>
            ) : (
                <div className="flex w-full flex-col">
                    <ul className="flex w-full flex-col">
                        {initialEntries.map((entry) => (
                            <RecentProjectRow
                                key={entry.path}
                                entry={entry}
                                onOpenProject={onOpenProject}
                            />
                        ))}
                    </ul>
                    {overflowEntries.length > 0 ? (
                        <Collapse id={overflowId} open={showAll}>
                            <ul className="flex w-full flex-col">
                                {overflowEntries.map((entry) => (
                                    <RecentProjectRow
                                        key={entry.path}
                                        entry={entry}
                                        onOpenProject={onOpenProject}
                                    />
                                ))}
                            </ul>
                        </Collapse>
                    ) : null}
                </div>
            )}
        </section>
    );
};

/** First-run landing screen: project actions over the recent project list. */
export const WelcomeScreen = ({
    recentFolders,
    onOpenProject,
    onPickFolder,
    onClone,
    onSsh,
    onConnectGitHub,
}: {
    recentFolders: RepoHistoryEntry[];
    recentChats?: unknown;
    onOpenProject: (path: string) => void;
    onPickFolder: () => void;
    onClone: () => void;
    onSsh: () => void;
    onConnectGitHub: () => void;
    onSelectChat?: (id: string) => void;
}) => {
    const [showAll, setShowAll] = React.useState(false);

    return (
        <div data-testid="welcome-screen" className="flex h-full min-h-0 w-full flex-col text-text-primary select-none">
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-10 py-10 sm:px-14 md:px-16">
                <div className="flex w-full max-w-2xl flex-col items-start gap-8">
                    <WelcomeActions
                        onPickFolder={onPickFolder}
                        onClone={onClone}
                        onSsh={onSsh}
                        onConnectGitHub={onConnectGitHub}
                    />
                    <RecentProjects
                        recentFolders={recentFolders}
                        showAll={showAll}
                        onToggleShowAll={() => setShowAll((v) => !v)}
                        onOpenProject={onOpenProject}
                    />
                </div>
            </div>
        </div>
    );
};

/** Load recent folders for the welcome screen (client-only). */
export const useRecentFolders = (): RepoHistoryEntry[] => {
    const entries = React.useSyncExternalStore(subscribeRepoHistory, getRepoHistorySnapshot, getServerRepoHistorySnapshot);
    return React.useMemo(() => entries.slice(0, 15), [entries]);
};
