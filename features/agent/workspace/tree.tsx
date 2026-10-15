"use client";

import { ChevronDown20Regular } from "@fluentui/react-icons/headless/svg/chevron-down";
import { ChevronRight20Regular } from "@fluentui/react-icons/headless/svg/chevron-right";
import { Search20Regular } from "@fluentui/react-icons/headless/svg/search";


import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { commands, type FileEntry } from "@/lib/backend";
import { Icon } from "@/components/ui/icon";
import { FileIcon } from "@/components/ui/file-icon";

import { cn } from "@/lib/utils";
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
    return filePath.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function parentDir(filePath: string): string {
    const normalized = filePath.replace(/\\/g, "/").replace(/\/+$/, "");
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

type ClipboardAction = "cut" | "copy" | "paste";

function TreeNode({
    entry,
    depth,
    activePath,
    query,
    onOpenFile,
    statusFor,
    revealDir,
    revealPath,
    selectedPath,
    cutPaths,
    onSelect,
    onClipboard,
}: {
    entry: FileEntry;
    depth: number;
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
}) {
    const [open, setOpen] = useState(false);
    const [children, setChildren] = useState<FileEntry[] | null>(null);
    const seq = useRef(0);
    const nodeRef = useRef<HTMLButtonElement | null>(null);
    // "Reveal in Explorer" force-expands every directory on the way to the target.
    const inRevealTrace = Boolean(entry.is_dir && revealDir && isWithin(entry.path, revealDir));
    const revealed = Boolean(revealPath && pathKey(entry.path) === pathKey(revealPath));
    const isExpanded = open || Boolean(query.trim() && entry.is_dir) || inRevealTrace;
    // A cut entry stays dimmed until it lands somewhere else, the way a file
    // manager shows a pending move.
    const cut = Boolean(cutPaths?.has(pathKey(entry.path)));
    const selected = Boolean(selectedPath && pathKey(selectedPath) === pathKey(entry.path));

    useEffect(() => {
        if (!revealed) return;
        nodeRef.current?.scrollIntoView({ block: "nearest" });
    }, [revealed]);

    const load = useCallback(() => {
        if (!entry.is_dir) return;
        const id = ++seq.current;
        return commands.lsDir(entry.path).then(entries => {
            if (seq.current === id) setChildren(sortEntries(entries));
        }).catch(() => {
            if (seq.current === id) setChildren([]);
        });
    }, [entry.is_dir, entry.path]);

    useEffect(() => {
        if (isExpanded && children === null) void load();
    }, [isExpanded, children, load]);

    useEffect(() => {
        if (!isExpanded || !entry.is_dir) return;
        const fn = () => { void load(); };
        window.addEventListener("bettershape-files-changed", fn);
        return () => window.removeEventListener("bettershape-files-changed", fn);
    }, [isExpanded, entry.is_dir, load]);

    const pad = 8 + depth * 12;
    const mark = gitMark(statusFor(entry.path));
    const needle = query.trim().toLowerCase();

    const reveal = () => {
        void commands.revealPath(entry.path).catch(() => {});
    };
    const copyPath = () => {
        void navigator.clipboard.writeText(entry.path);
    };

    if (entry.is_dir) {
        const visibleChildren = children?.filter((child) => {
            if (!needle || child.is_dir) return true;
            return child.name.toLowerCase().includes(needle);
        });
        if (needle && !entry.name.toLowerCase().includes(needle) && visibleChildren && visibleChildren.length === 0 && children) {
            return null;
        }
        return (
            <div>
                <ContextMenu>
                    <ContextMenuTrigger asChild>
                <button
                    ref={nodeRef}
                    type="button"
                    onClick={() => { onSelect?.(entry); setOpen((v) => !v); }}
                    className={cn(
                        "flex h-6 w-full items-center gap-1 rounded-md pr-2 text-left text-sm text-text-secondary hover:bg-[var(--row-hover)] hover:text-text-primary",
                        revealed && "bg-panel-active text-text-primary",
                        selected && !revealed && "bg-panel-hover text-text-primary",
                        cut && "opacity-50",
                    )}
                    style={{ paddingLeft: pad }}
                >
                    <Icon
                        icon={isExpanded ? ChevronDown20Regular : ChevronRight20Regular}
                        className="icon-sm shrink-0 text-text-muted"
                    />
                    <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                </button>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="min-w-40">
                        <ContextMenuItem onClick={() => setOpen(true)}>Open</ContextMenuItem>
                        <ContextMenuItem onClick={reveal}>Reveal in Explorer</ContextMenuItem>
                        <ContextMenuItem onClick={copyPath}>Copy Path</ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem onClick={() => onClipboard?.("cut", entry)}>Cut</ContextMenuItem>
                        <ContextMenuItem onClick={() => onClipboard?.("copy", entry)}>Copy</ContextMenuItem>
                        <ContextMenuItem onClick={() => onClipboard?.("paste", entry)}>Paste</ContextMenuItem>
                    </ContextMenuContent>
                </ContextMenu>
                {isExpanded ? (
                    <div>
                        {visibleChildren?.map((child) => (
                        <TreeNode
                            key={child.path}
                            entry={child}
                            depth={depth + 1}
                            activePath={activePath}
                            query={query}
                            onOpenFile={onOpenFile}
                            statusFor={statusFor}
                            revealDir={revealDir}
                            revealPath={revealPath}
                            selectedPath={selectedPath}
                            cutPaths={cutPaths}
                            onSelect={onSelect}
                            onClipboard={onClipboard}
                        />
                        ))}
                    </div>
                ) : null}
            </div>
        );
    }

    if (needle && !entry.name.toLowerCase().includes(needle)) return null;

    const active =
        activePath != null
        && activePath.replace(/\\/g, "/").toLowerCase() === entry.path.replace(/\\/g, "/").toLowerCase();

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
        <button
            ref={nodeRef}
            type="button"
            onClick={() => { onSelect?.(entry); onOpenFile(entry.path); }}
            className={cn(
                "flex h-6 w-full items-center gap-1.5 rounded-md pr-2 text-left text-sm",
                active || revealed
                    ? "bg-panel-active text-text-primary"
                    : selected
                      ? "bg-panel-hover text-text-primary"
                      : "text-text-secondary hover:bg-[var(--row-hover)] hover:text-text-primary",
                cut && "opacity-50",
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
                <ContextMenuItem onClick={reveal}>Reveal in Explorer</ContextMenuItem>
                <ContextMenuItem onClick={copyPath}>Copy Path</ContextMenuItem>
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
                <ContextMenuItem onClick={() => onClipboard?.("cut", entry)}>Cut</ContextMenuItem>
                <ContextMenuItem onClick={() => onClipboard?.("copy", entry)}>Copy</ContextMenuItem>
                <ContextMenuItem onClick={() => onClipboard?.("paste", entry)}>Paste into Folder</ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}

export function FileTree({
    projectPath,
    activePath,
    onOpenFile,
}: {
    projectPath: string;
    activePath: string | null;
    onOpenFile: (path: string) => void;
}) {
    const [roots, setRoots] = useState<FileEntry[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [statusByPath, setStatusByPath] = useState<Map<string, string>>(() => new Map());
    const title = projectPath.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || projectPath;
    const shown = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return roots;
        return roots.filter((entry) => entry.is_dir || entry.name.toLowerCase().includes(needle));
    }, [query, roots]);

    const [refreshTick, setRefreshTick] = useState(0);
    useEffect(() => {
        const b = () => setRefreshTick((n) => n + 1);
        window.addEventListener("bettershape-files-changed", b);
        return () => window.removeEventListener("bettershape-files-changed", b);
    }, []);

    // The tree's own clipboard: which row the keyboard acts on, what is cut
    // (drawn dimmed), and the last refusal so it can be shown instead of
    // failing silently.
    const [selected, setSelected] = useState<FileEntry | null>(null);
    const selectedRef = useRef<FileEntry | null>(null);
    const [clipboardError, setClipboardError] = useState<string | null>(null);
    const [clipboardTick, setClipboardTick] = useState(0);
    useEffect(() => subscribeFileClipboard(() => setClipboardTick((n) => n + 1)), []);
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
        void pasteFileClipboard(targetDir).catch((e) => {
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
        void (async () => {
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
        })();
        return () => {
            cancelled = true;
        };
    }, [projectPath, refreshTick]);

    useEffect(() => {
        let cancelled = false;
        void commands.gitStatus(projectPath).then((files) => {
            if (cancelled) return;
            const next = new Map<string, string>();
            const root = projectPath.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
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
                </div>
            </div>
        </div>
    );
}
