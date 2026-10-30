"use client";

import { Chat20Regular } from "@fluentui/react-icons/headless/svg/chat";
import { ChevronDown20Regular } from "@fluentui/react-icons/headless/svg/chevron-down";
import { ChevronRight20Regular } from "@fluentui/react-icons/headless/svg/chevron-right";
import { Search20Regular } from "@fluentui/react-icons/headless/svg/search";
import { Folder20Regular } from "@fluentui/react-icons/headless/svg/folder";
import { Dismiss20Regular } from "@fluentui/react-icons/headless/svg/dismiss";


import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { commands, type FileEntry } from "@/lib/backend";
import { Icon } from "@/components/ui/icon";
import { FileIcon } from "@/components/ui/file-icon";

import { cn } from "@/lib/utils";
import {
    getExtraWorkspaceFolders,
    isSameWorkspacePath,
    removeWorkspaceFolder,
    workspaceFolderLabel,
} from "@/lib/workspace/folders";
import {
    getFileClipboard,
    pasteFileClipboard,
    setFileClipboard,
    subscribeFileClipboard,
} from "@/lib/workspace/file-clipboard";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "@/components/ui/context";

function gitMark(status: string | undefined): { letter: string; className: string } | null {
    const raw = (status ?? "").trim().toUpperCase();
    if (!raw) return null;
    if (raw.includes("?")) return { letter: "U", className: "text-warning" };
    if (raw.includes("A")) return { letter: "A", className: "text-success" };
    if (raw.includes("D")) return { letter: "D", className: "text-error" };
    if (raw.includes("M") || raw.includes("R")) return { letter: "M", className: "text-success" };
    return { letter: raw[0] ?? "", className: "text-text-muted" };
}

/** Normalize for path comparisons (case-insensitive, slash-agnostic). */
function pathKey(filePath: string): string {
    return filePath.replace(/\\/g, "/").replace(/(?<!\/)\/+$/, "").toLowerCase();
}

function parentDir(filePath: string): string {
    const normalized = filePath.replace(/\\/g, "/").replace(/(?<!\/)\/+$/, "");
    const idx = normalized.lastIndexOf("/");
    return idx <= 0 ? "" : normalized.slice(0, idx);
}

/** True when `candidate` is `prefix` or lives underneath it. */
function isWithin(prefix: string, candidate: string): boolean {
    const a = pathKey(prefix);
    const b = pathKey(candidate);
    return b === a || b.startsWith(`${a}/`);
}

function sortEntries(list: FileEntry[]) {
    return [...list].sort((a, b) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
}

import { formatMentionToken } from "@/lib/chat/mentions";

type ClipboardAction = "cut" | "copy" | "paste";

/** Strips trailing forward slashes without regex backtracking. */
const trimTrailingSlashes = (value: string): string => {
    let end = value.length;
    while (end > 0 && value.charCodeAt(end - 1) === 47) end--;
    return value.slice(0, end);
};

/**
 * Applies the header filter to one level of the tree. Folders stay visible so a
 * match deeper down can still be reached; files have to match by name.
 */
const filterEntries = (entries: FileEntry[], query: string): FileEntry[] => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) => entry.is_dir || entry.name.toLowerCase().includes(needle));
};

/** Resolves an explorer entry path relative to the workspace root when nested inside it. */
const relativeExplorerPath = (entryPath: string, projectPath: string): string => {
    const cleanEntry = entryPath.replace(/\\/g, "/");
    const cleanRoot = trimTrailingSlashes(projectPath.replace(/\\/g, "/"));
    if (!cleanRoot) return cleanEntry;
    const prefix = `${cleanRoot.toLowerCase()}/`;
    return cleanEntry.toLowerCase().startsWith(prefix)
        ? cleanEntry.slice(cleanRoot.length + 1)
        : cleanEntry;
};

/** Appends a trailing slash for directory mentions unless one is already present. */
const withDirectorySlash = (relPath: string, isDir: boolean): string => {
    if (!isDir) return relPath;
    return relPath.endsWith("/") ? relPath : `${relPath}/`;
};

/** Formats a file or folder explorer entry as a structured `@` mention token. */
const formatExplorerMentionToken = (entryPath: string, projectPath: string, isDir: boolean): string => {
    const rel = relativeExplorerPath(entryPath, projectPath);
    const fullRel = withDirectorySlash(rel, isDir);
    const base = trimTrailingSlashes(rel).split("/").pop() ?? rel;
    return `${formatMentionToken({
        kind: isDir ? "folder" : "file",
        path: fullRel,
        label: base,
    })} `;
};

/** A folder added to the workspace, listed after the primary project. */
type ExtraRoot = { path: string; entries: FileEntry[]; error: string | null };

type TreeNodeProps = {
    entry: FileEntry;
    depth: number;
    projectPath: string;
    activePath: string | null;
    query: string;
    onOpenFile: (path: string) => void;
    statusFor: (path: string) => string | undefined;
    revealDir?: string;
    revealPath?: string | null;
    selectedPath?: string | null;
    cutPaths?: Set<string>;
    onSelect?: (entry: FileEntry) => void;
    onClipboard?: (action: ClipboardAction, entry: FileEntry) => void;
};

/** Checks whether two workspace file paths refer to the same normalized file. */
const isSameNormalizedPath = (a: string | null, b: string): boolean =>
    a != null && a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();

/** Filters directory children against the explorer search needle while keeping subdirectories inspectable. */
const filterDirectoryChildren = (
    children: FileEntry[] | null,
    needle: string,
): FileEntry[] | undefined =>
    children?.filter((child) => !needle || child.is_dir || child.name.toLowerCase().includes(needle));

/** Returns true when a filtered directory has loaded with zero matching descendants or name match. */
const shouldHideFilteredDir = (
    name: string,
    needle: string,
    children: FileEntry[] | null,
    visibleChildren: FileEntry[] | undefined,
): boolean =>
    Boolean(
        needle &&
            !name.toLowerCase().includes(needle) &&
            children &&
            visibleChildren &&
            visibleChildren.length === 0,
    );

/** Loads directory children on demand and refreshes when `bettershape-files-changed` fires. */
const useDirectoryChildren = (entry: FileEntry, isExpanded: boolean) => {
    const [children, setChildren] = useState<FileEntry[] | null>(null);
    const seq = useRef(0);

    const load = useCallback(() => {
        if (!entry.is_dir) return undefined;
        const id = ++seq.current;
        return commands
            .lsDir(entry.path)
            .then((entries) => {
                if (seq.current === id) setChildren(sortEntries(entries));
            })
            .catch(() => {
                if (seq.current === id) setChildren([]);
            });
    }, [entry.is_dir, entry.path]);

    useEffect(() => {
        if (isExpanded && children === null) load();
    }, [isExpanded, children, load]);

    useEffect(() => {
        if (!isExpanded || !entry.is_dir) return undefined;
        /** Reloads expanded directory entries when workspace files change. */
        const fn = () => {
            load();
        };
        window.addEventListener("bettershape-files-changed", fn);
        return () => window.removeEventListener("bettershape-files-changed", fn);
    }, [isExpanded, entry.is_dir, load]);

    return children;
};

/** Builds explorer context-menu actions (`reveal`, `copyPath`, `addToChat`) for an entry. */
const createEntryActions = (entry: FileEntry, projectPath: string) => ({
    reveal: () => {
        commands.revealPath(entry.path).catch(() => undefined);
    },
    copyPath: () => {
        navigator.clipboard.writeText(entry.path).catch(() => undefined);
    },
    addToChat: () => {
        const token = formatExplorerMentionToken(entry.path, projectPath, entry.is_dir);
        window.dispatchEvent(
            new CustomEvent("bettershape-chat-insert-prompt", {
                detail: { prompt: token, send: false, append: true },
            }),
        );
        window.dispatchEvent(new CustomEvent("bettershape-chat-focus-input"));
    },
});

/** Computes row selection/cut class names for explorer tree items. */
const treeRowToneClass = (highlighted: boolean, cut: boolean, baseRest: string): string =>
    cn(
        highlighted
            ? "bg-[var(--row-selected)] hover:bg-[var(--row-selected-hover)] text-text-primary"
            : baseRest,
        cut && "opacity-50",
    );

/** Renders Cut / Copy / Paste menu items for an explorer tree entry. */
const ClipboardMenuItems = ({
    entry,
    pasteLabel,
    onClipboard,
}: {
    entry: FileEntry;
    pasteLabel: string;
    onClipboard?: (action: ClipboardAction, entry: FileEntry) => void;
}) => (
    <>
        <ContextMenuItem onClick={() => onClipboard?.("cut", entry)}>Cut</ContextMenuItem>
        <ContextMenuItem onClick={() => onClipboard?.("copy", entry)}>Copy</ContextMenuItem>
        <ContextMenuItem onClick={() => onClipboard?.("paste", entry)}>{pasteLabel}</ContextMenuItem>
    </>
);

const treeNodeRenderer: { render?: (props: TreeNodeProps) => React.ReactNode } = {};

/** Renders the context menu wrapper for a directory row inside `DirectoryTreeBranch`. */
const DirectoryRowContextMenu = ({
    entry,
    nodeRef,
    isExpanded,
    highlighted,
    cut,
    pad,
    onSelect,
    onClipboard,
    setOpen,
    actions,
}: {
    entry: FileEntry;
    nodeRef: React.RefObject<HTMLButtonElement | null>;
    isExpanded: boolean;
    highlighted: boolean;
    cut: boolean;
    pad: number;
    onSelect?: (entry: FileEntry) => void;
    onClipboard?: TreeNodeProps["onClipboard"];
    setOpen: React.Dispatch<React.SetStateAction<boolean>>;
    actions: ReturnType<typeof createEntryActions>;
}) => {
    const chevronIcon = isExpanded ? ChevronDown20Regular : ChevronRight20Regular;
    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <button
                    ref={nodeRef}
                    type="button"
                    onClick={() => {
                        onSelect?.(entry);
                        setOpen((prevOpen) => !prevOpen);
                    }}
                    className={cn(
                        "flex h-6 w-full items-center gap-1 rounded-md pr-2 text-left text-sm",
                        treeRowToneClass(
                            highlighted,
                            cut,
                            "text-text-secondary hover:bg-[var(--row-hover)] hover:text-text-primary",
                        ),
                    )}
                    style={{ paddingLeft: pad }}
                >
                    <Icon icon={chevronIcon} className="icon-sm shrink-0 text-text-muted" />
                    <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                </button>
            </ContextMenuTrigger>
            <ContextMenuContent className="min-w-40">
                <ContextMenuItem onClick={() => setOpen(true)}>Open</ContextMenuItem>
                <ContextMenuItem onClick={actions.addToChat}>
                    <Icon icon={Chat20Regular} />
                    Add to Chat
                </ContextMenuItem>
                <ContextMenuItem onClick={actions.reveal}>Reveal in Explorer</ContextMenuItem>
                <ContextMenuItem onClick={actions.copyPath}>Copy Path</ContextMenuItem>
                <ContextMenuSeparator />
                <ClipboardMenuItems entry={entry} pasteLabel="Paste" onClipboard={onClipboard} />
            </ContextMenuContent>
        </ContextMenu>
    );
};

/** Renders an expandable directory row and its context menu inside the file tree. */
const DirectoryTreeBranch = ({
    props,
    nodeRef,
    isExpanded,
    highlighted,
    cut,
    pad,
    needle,
    childEntries,
    setOpen,
    actions,
}: {
    props: TreeNodeProps;
    nodeRef: React.RefObject<HTMLButtonElement | null>;
    isExpanded: boolean;
    highlighted: boolean;
    cut: boolean;
    pad: number;
    needle: string;
    childEntries: FileEntry[] | null;
    setOpen: React.Dispatch<React.SetStateAction<boolean>>;
    actions: ReturnType<typeof createEntryActions>;
}) => {
    const { entry, onSelect, onClipboard } = props;
    const visibleChildren = filterDirectoryChildren(childEntries, needle);
    if (shouldHideFilteredDir(entry.name, needle, childEntries, visibleChildren)) return null;

    return (
        <div>
            <DirectoryRowContextMenu
                entry={entry}
                nodeRef={nodeRef}
                isExpanded={isExpanded}
                highlighted={highlighted}
                cut={cut}
                pad={pad}
                onSelect={onSelect}
                onClipboard={onClipboard}
                setOpen={setOpen}
                actions={actions}
            />
            {isExpanded ? (
                <div>
                    {visibleChildren?.map((child) =>
                        treeNodeRenderer.render?.({
                            ...props,
                            entry: child,
                            depth: props.depth + 1,
                        }),
                    )}
                </div>
            ) : null}
        </div>
    );
};

/** Renders a leaf file row and its context menu inside the file tree. */
const FileTreeLeaf = ({
    props,
    nodeRef,
    highlighted,
    cut,
    pad,
    needle,
    actions,
}: {
    props: TreeNodeProps;
    nodeRef: React.RefObject<HTMLButtonElement | null>;
    highlighted: boolean;
    cut: boolean;
    pad: number;
    needle: string;
    actions: ReturnType<typeof createEntryActions>;
}) => {
    const { entry, onOpenFile, statusFor, onSelect, onClipboard } = props;
    if (needle && !entry.name.toLowerCase().includes(needle)) return null;
    const mark = gitMark(statusFor(entry.path));

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <button
                    ref={nodeRef}
                    type="button"
                    onClick={() => {
                        onSelect?.(entry);
                        onOpenFile(entry.path);
                    }}
                    className={cn(
                        "flex h-6 w-full items-center gap-1.5 rounded-md pr-2 text-left text-sm",
                        treeRowToneClass(
                            highlighted,
                            cut,
                            "text-text-secondary hover:bg-[var(--row-hover)] hover:text-text-primary",
                        ),
                    )}
                    style={{ paddingLeft: pad }}
                >
                    <FileIcon name={entry.name} className="size-4 shrink-0" />
                    <span className={cn("min-w-0 flex-1 truncate", mark?.className)}>{entry.name}</span>
                    {mark ? (
                        <span className={cn("shrink-0 text-xs font-medium", mark.className)}>{mark.letter}</span>
                    ) : null}
                </button>
            </ContextMenuTrigger>
            <ContextMenuContent className="min-w-40">
                <ContextMenuItem onClick={() => onOpenFile(entry.path)}>Open</ContextMenuItem>
                <ContextMenuItem onClick={actions.addToChat}>
                    <Icon icon={Chat20Regular} />
                    Add to Chat
                </ContextMenuItem>
                <ContextMenuItem onClick={actions.reveal}>Reveal in Explorer</ContextMenuItem>
                <ContextMenuItem onClick={actions.copyPath}>Copy Path</ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                    onClick={() => {
                        window.dispatchEvent(
                            new CustomEvent("bettershape-open-workspace-terminal", { detail: { path: entry.path } }),
                        );
                    }}
                >
                    Open Terminal
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ClipboardMenuItems entry={entry} pasteLabel="Paste into Folder" onClipboard={onClipboard} />
            </ContextMenuContent>
        </ContextMenu>
    );
};

/** Checks whether two optional explorer paths share the same normalized `pathKey`. */
const matchesOptionalPathKey = (candidate: string | null | undefined, target: string): boolean =>
    Boolean(candidate && pathKey(candidate) === pathKey(target));

/** Checks whether a directory node should auto-expand from search or reveal trace. */
const isAutoExpandedDir = (entry: FileEntry, needle: string, revealDir?: string): boolean => {
    if (!entry.is_dir) return false;
    return Boolean(needle) || Boolean(revealDir && isWithin(entry.path, revealDir));
};

/** Computes expansion, reveal, selection, and cut state for a single explorer tree node. */
const computeTreeNodeFlags = (props: TreeNodeProps, open: boolean) => {
    const needle = props.query.trim().toLowerCase();
    const revealed = matchesOptionalPathKey(props.revealPath, props.entry.path);
    const selected = matchesOptionalPathKey(props.selectedPath, props.entry.path);
    return {
        needle,
        revealed,
        dirHighlighted: revealed || selected,
        fileHighlighted: isSameNormalizedPath(props.activePath, props.entry.path) || revealed || selected,
        isExpanded: open || isAutoExpandedDir(props.entry, needle, props.revealDir),
        cut: Boolean(props.cutPaths?.has(pathKey(props.entry.path))),
    };
};

/** Renders the TreeNode UI component. */
const TreeNode = (props: TreeNodeProps) => {
    const [open, setOpen] = useState(false);
    const nodeRef = useRef<HTMLButtonElement | null>(null);
    const flags = computeTreeNodeFlags(props, open);
    const children = useDirectoryChildren(props.entry, flags.isExpanded);

    useEffect(() => {
        if (flags.revealed) nodeRef.current?.scrollIntoView({ block: "nearest" });
    }, [flags.revealed]);

    const pad = 8 + props.depth * 12;
    const actions = createEntryActions(props.entry, props.projectPath);

    if (props.entry.is_dir) {
        return (
            <DirectoryTreeBranch
                props={props}
                nodeRef={nodeRef}
                isExpanded={flags.isExpanded}
                highlighted={flags.dirHighlighted}
                cut={flags.cut}
                pad={pad}
                needle={flags.needle}
                childEntries={children}
                setOpen={setOpen}
                actions={actions}
            />
        );
    }

    return (
        <FileTreeLeaf
            props={props}
            nodeRef={nodeRef}
            highlighted={flags.fileHighlighted}
            cut={flags.cut}
            pad={pad}
            needle={flags.needle}
            actions={actions}
        />
    );
};

treeNodeRenderer.render = (childProps) => <TreeNode key={childProps.entry.path} {...childProps} />;

/** Renders the FileTree UI component. */
export const FileTree = ({
    projectPath,
    activePath,
    onOpenFile,
}: {
    projectPath: string;
    activePath: string | null;
    onOpenFile: (path: string) => void;
}) => {
    const [roots, setRoots] = useState<FileEntry[]>([]);
    /**
     * Folders added with "Add Folder to Workspace". The backend already grants
     * them IPC access; without a row here the action looked like it did nothing.
     */
    const [extraRoots, setExtraRoots] = useState<ExtraRoot[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [statusByPath, setStatusByPath] = useState<Map<string, string>>(() => new Map());
    const title = projectPath.replace(/(?<![\\/])[\\/]+$/, "").split(/[\\/]/).pop() || projectPath;
    const shown = filterEntries(roots, query);

    const [refreshTick, setRefreshTick] = useState(0);
    useEffect(() => {
        const b = () => setRefreshTick((n) => n + 1);
        window.addEventListener("bettershape-files-changed", b);
        window.addEventListener("bettershape-workspace-folders-changed", b);
        return () => {
            window.removeEventListener("bettershape-files-changed", b);
            window.removeEventListener("bettershape-workspace-folders-changed", b);
        };
    }, []);

    useEffect(() => {
        // A folder the user adds twice, or the project folder itself, would draw a
        // second tree for files that are already listed above it.
        const paths = getExtraWorkspaceFolders().filter((path) => !isSameWorkspacePath(path, projectPath));
        let cancelled = false;
        void Promise.all(
            paths.map(async (path): Promise<ExtraRoot> => {
                try {
                    return { path, entries: sortEntries(await commands.lsDir(path)), error: null };
                } catch (cause) {
                    return {
                        path,
                        entries: [],
                        error: cause instanceof Error ? cause.message : String(cause),
                    };
                }
            }),
        )
            .then((list) => {
                if (!cancelled) setExtraRoots(list);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [refreshTick, projectPath]);

    // The tree's own clipboard: which row the keyboard acts on, what is cut
    // (drawn dimmed), and the last refusal so it can be shown instead of
    // failing silently.
    const [selected, setSelected] = useState<FileEntry | null>(null);
    const selectedRef = useRef<FileEntry | null>(null);
    const [clipboardError, setClipboardError] = useState<string | null>(null);
    const [clipboardTick, setClipboardTick] = useState(0);
    useEffect(() => {
        const unsub = subscribeFileClipboard(() => {
            setClipboardTick((n) => n + 1);
        });
        return () => {
            unsub();
        };
    }, []);
    const cutPaths = useMemo(() => {
        const set = new Set<string>();
        const clip = getFileClipboard();
        if (clip?.mode === "cut") for (const path of clip.paths) set.add(pathKey(path));
        return set;
        // `clipboardTick` is a cache-invalidation tick, not a value the body reads:
        // dropping it would freeze `cutPaths` at the value from first render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clipboardTick]);

    const select = useCallback((entry: FileEntry) => {
        selectedRef.current = entry;
        setSelected(entry);
    }, []);

    const runClipboard = useCallback((action: ClipboardAction, entry: FileEntry) => {
        select(entry);
        setClipboardError(null);
        if (action === "cut" || action === "copy") {
            setFileClipboard(action, [entry.path]);
            return;
        }
        const targetDir = entry.is_dir ? entry.path : parentDir(entry.path);
        pasteFileClipboard(targetDir).catch((e) => {
            setClipboardError(e instanceof Error ? e.message : String(e));
        });
    }, [select]);

    // Ctrl+X/C/V with the tree focused. The shortcut layer already dispatches
    // this event; until now nothing listened.
    useEffect(() => {
        const onAction = (event: Event) => {
            const action = (event as CustomEvent<{ action?: string }>).detail?.action;
            if (action !== "cut" && action !== "copy" && action !== "paste") return;
            const entry = selectedRef.current;
            if (!entry) return;
            runClipboard(action, entry);
        };
        window.addEventListener("bettershape-explorer-action", onAction);
        return () => window.removeEventListener("bettershape-explorer-action", onAction);
    }, [runClipboard]);

    // "Reveal in Explorer" (editor breadcrumb, command palette, chat files).
    const [revealPath, setRevealPath] = useState<string | null>(null);
    useEffect(() => {
        const onReveal = (e: Event) => {
            const target = (e as CustomEvent<{ path?: string }>).detail?.path?.trim();
            if (target) setRevealPath(target);
        };
        window.addEventListener("bettershape-reveal-in-explorer", onReveal);
        return () => window.removeEventListener("bettershape-reveal-in-explorer", onReveal);
    }, []);
    const revealDir = useMemo(() => (revealPath ? parentDir(revealPath) : ""), [revealPath]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const list = sortEntries(await commands.lsDir(projectPath));
                if (!cancelled) {
                    setRoots(list);
                    setError(null);
                }
            } catch (e) {
                if (!cancelled) {
                    setError(e instanceof Error ? e.message : String(e));
                    setRoots([]);
                }
            }
        })().catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [projectPath, refreshTick]);

    useEffect(() => {
        let cancelled = false;
        commands.gitStatus(projectPath).then((files) => {
            if (cancelled) return;
            const next = new Map<string, string>();
            const root = projectPath.replace(/\\/g, "/").replace(/(?<!\/)\/+$/, "").toLowerCase();
            for (const file of files) {
                const rel = file.path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
                next.set(rel, file.status);
                next.set(`${root}/${rel}`, file.status);
            }
            setStatusByPath(next);
        }).catch(() => {
            if (!cancelled) setStatusByPath(new Map());
        });
        return () => {
            cancelled = true;
        };
    }, [projectPath, refreshTick]);

    const statusFor = useCallback((path: string) => {
        const key = path.replace(/\\/g, "/").toLowerCase();
        return statusByPath.get(key);
    }, [statusByPath]);

    // Padding on the wrapper (not margin on the island) keeps the flex parent
    // from shifting, the island sits inset without pushing layout sideways.
    return (
        <div
            data-explorer-root="true"
            className="box-border flex h-full min-h-0 w-full flex-col bg-transparent"
        >
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="px-2 pb-1 pt-2">
                    <div className="flex h-8 items-center gap-2 rounded-lg bg-panel-hover px-2">
                        <Icon icon={Search20Regular} className="icon-sm shrink-0 text-text-muted" />
                        <input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Filter files..."
                            aria-label="Filter files"
                            className="h-7 min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
                        />
                    </div>
                    <span className="sr-only">{title}</span>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2 custom-scrollbar">
                    {error ? <div className="p-2 text-sm text-error">{error}</div> : null}
                    {clipboardError ? (
                        <div className="mx-1 mb-1 rounded-md border border-error/40 px-2 py-1.5 text-xs text-error">
                            {clipboardError}
                        </div>
                    ) : null}
                    {shown.map((entry) => (
                        <TreeNode
                            key={entry.path}
                            entry={entry}
                            depth={0}
                            projectPath={projectPath}
                            activePath={activePath}
                            query={query}
                            onOpenFile={onOpenFile}
                            statusFor={statusFor}
                            revealDir={revealDir}
                            revealPath={revealPath}
                            selectedPath={selected?.path ?? null}
                            cutPaths={cutPaths}
                            onSelect={select}
                            onClipboard={runClipboard}
                        />
                    ))}
                    {extraRoots.map((root) => {
                        const filtered = filterEntries(root.entries, query);
                        return (
                            <section key={root.path} aria-label={workspaceFolderLabel(root.path)} className="mt-3">
                                <div className="group flex h-7 items-center gap-1.5 rounded-md pl-2 pr-1 text-text-muted hover:bg-[var(--row-hover)]">
                                    <Icon icon={Folder20Regular} className="icon-sm shrink-0" />
                                    <span
                                        className="min-w-0 flex-1 truncate text-xs font-medium text-text-secondary"
                                        title={root.path}
                                    >
                                        {workspaceFolderLabel(root.path)}
                                    </span>
                                    <button
                                        type="button"
                                        aria-label={`Remove ${workspaceFolderLabel(root.path)} from the workspace`}
                                        onClick={() => removeWorkspaceFolder(root.path)}
                                        className="flex size-5 shrink-0 items-center justify-center rounded text-text-muted opacity-0 outline-none transition-opacity hover:text-text-primary focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-border-focus group-hover:opacity-100"
                                    >
                                        <Icon icon={Dismiss20Regular} className="icon-sm" />
                                    </button>
                                </div>
                                {root.error ? (
                                    <div className="px-2 py-1 text-xs text-error">{root.error}</div>
                                ) : filtered.length === 0 ? (
                                    query.trim() ? null : (
                                        <div className="px-2 py-1 text-xs text-text-muted">Empty folder</div>
                                    )
                                ) : (
                                    filtered.map((entry) => (
                                        <TreeNode
                                            key={entry.path}
                                            entry={entry}
                                            depth={0}
                                            projectPath={root.path}
                                            activePath={activePath}
                                            query={query}
                                            onOpenFile={onOpenFile}
                                            statusFor={statusFor}
                                            revealDir={revealDir}
                                            revealPath={revealPath}
                                            selectedPath={selected?.path ?? null}
                                            cutPaths={cutPaths}
                                            onSelect={select}
                                            onClipboard={runClipboard}
                                        />
                                    ))
                                )}
                            </section>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
