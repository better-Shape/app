"use client";

import { useEffect, useState } from "react";
import { Play20Filled } from "@fluentui/react-icons/headless/svg/play";

import { Button } from "@/components/ui/button";
import { Favicon } from "@/components/ui/favicon";
import { Icon } from "@/components/ui/icon";
import { commands } from "@/lib/backend";
import type { BrowserHistoryEntry } from "@/lib/backend/types";
import { hostnameOf } from "@/lib/ui/favicon";
import { cn } from "@/lib/utils";
import { getLastDevUrl } from "@/features/preview/store";
import { iconFor } from "./model";

/** How many recently visited pages the new tab offers. */
const RECENT_LIMIT = 8;

/** The tool panes the new tab can open, in the order they are offered. */
const TOOLS: Array<{ kind: "files" | "graph" | "prs"; label: string; shortcut?: string }> = [
    { kind: "files", label: "Files", shortcut: "Ctrl+G" },
    { kind: "graph", label: "Graph" },
    { kind: "prs", label: "Pull requests" },
];

/** The recently visited pages this profile has, or none when the read fails. */
const useRecentPages = () => {
    const [recent, setRecent] = useState<BrowserHistoryEntry[]>([]);

    useEffect(() => {
        const read = async () => {
            try {
                setRecent(await commands.browserHistory("", RECENT_LIMIT));
            } catch {
                setRecent([]);
            }
        };
        read().catch(() => undefined);
    }, []);

    return recent;
};

/** One row of the fill: a tile the tab's own stylesheet is shared with the recent grid. */
const tileClass = cn(
    "flex min-w-0 items-center gap-2 rounded-lg bg-surface-1 px-2.5 text-left",
    "transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--row-hover)]",
);

/** A tool the new tab can hand over to, with the shortcut that would have done the same. */
const ToolTile = ({
    kind,
    label,
    shortcut,
    onUseTool,
}: {
    kind: "files" | "graph" | "prs";
    label: string;
    shortcut?: string;
    onUseTool: (kind: "files" | "graph" | "prs") => void;
}) => (
    <button type="button" onClick={() => onUseTool(kind)} className={cn(tileClass, "h-10")}>
        <Icon icon={iconFor(kind)} className="text-text-muted" />
        <span className="min-w-0 flex-1 truncate text-xs text-text-primary">{label}</span>
        {shortcut ? <span className="text-2xs text-text-muted">{shortcut}</span> : null}
    </button>
);

/** The tools the workspace offers, when the window can switch to them. */
const ToolGrid = ({ onUseTool }: { onUseTool: (kind: "files" | "graph" | "prs") => void }) => (
    <div className="flex w-full max-w-xl flex-col gap-2">
        <span className="text-sm text-text-primary">Tools</span>
        <div className="grid grid-cols-2 gap-2">
            {TOOLS.map((tool) => (
                <ToolTile key={tool.kind} {...tool} onUseTool={onUseTool} />
            ))}
        </div>
    </div>
);

/** The dev server this session last ran, offered as one press to open it. */
const DevServerButton = ({ url, onOpen }: { url: string; onOpen: (url: string) => void }) => (
    <Button variant="secondary" size="sm" onClick={() => onOpen(url)} className="gap-2 font-normal">
        <Icon icon={Play20Filled} className="text-text-muted" />
        <span className="truncate">{url}</span>
    </Button>
);

/** One recently visited page, as a tile with its mark, its name and its host. */
const RecentTile = ({
    entry,
    onOpen,
}: {
    entry: BrowserHistoryEntry;
    onOpen: (url: string) => void;
}) => (
    <button type="button" onClick={() => onOpen(entry.url)} className={cn(tileClass, "flex-col items-start gap-1 px-2.5 py-2")}>
        <Favicon url={entry.url} size={14} />
        <span className="w-full truncate text-xs text-text-primary">
            {entry.title || hostnameOf(entry.url)}
        </span>
        <span className="w-full truncate text-2xs text-text-muted">{hostnameOf(entry.url)}</span>
    </button>
);

/** The pages the user was on recently, in the order the history read returned them. */
const RecentGrid = ({
    recent,
    onOpen,
}: {
    recent: readonly BrowserHistoryEntry[];
    onOpen: (url: string) => void;
}) => (
    <div className="grid w-full max-w-xl grid-cols-2 gap-1.5 sm:grid-cols-4">
        {recent.map((entry) => (
            <RecentTile key={entry.url} entry={entry} onOpen={onOpen} />
        ))}
    </div>
);

/** The fallback line, which is only there when the tab has nothing better to offer. */
const HintFor = ({ shown }: { shown: boolean }) => {
    if (!shown) return null;
    return <span className="text-xs text-text-muted">Type a URL or search above.</span>;
};

/**
 * What a new tab shows: the tools it can switch to, the dev server this session ran, and the
 * pages the user was on last.
 *
 * The fallback line is only there when the tab has nothing else to offer. A new tab with a
 * dev server or a history shows those instead, because telling someone to type a URL in the
 * field above them while offering them four better options is the wrong first impression.
 */
export const NewTabPage = ({
    onOpen,
    onUseTool,
}: {
    onOpen: (url: string) => void;
    onUseTool?: (kind: "files" | "graph" | "prs") => void;
}) => {
    const recent = useRecentPages();
    const devUrl = getLastDevUrl();

    return (
        <div className="flex h-full flex-col items-center justify-center gap-6 px-6">
            {onUseTool ? <ToolGrid onUseTool={onUseTool} /> : null}
            {devUrl ? <DevServerButton url={devUrl} onOpen={onOpen} /> : null}
            {recent.length > 0 ? <RecentGrid recent={recent} onOpen={onOpen} /> : null}
            <HintFor shown={recent.length === 0 && !onUseTool} />
        </div>
    );
};
