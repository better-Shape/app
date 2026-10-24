"use client";

import { ArrowLeft20Regular } from "@fluentui/react-icons/headless/svg/arrow-left";
import { Branch20Regular } from "@fluentui/react-icons/headless/svg/branch";
import { Chat20Filled } from "@fluentui/react-icons/headless/svg/chat";
import { ChevronRight20Regular } from "@fluentui/react-icons/headless/svg/chevron-right";
import { Code20Regular } from "@fluentui/react-icons/headless/svg/code";
import { Color20Regular } from "@fluentui/react-icons/headless/svg/color";
import { Document20Regular } from "@fluentui/react-icons/headless/svg/document";
import { DocumentText20Regular } from "@fluentui/react-icons/headless/svg/document-text";
import { Folder20Filled } from "@fluentui/react-icons/headless/svg/folder";
import { Globe20Regular } from "@fluentui/react-icons/headless/svg/globe";
import { Grid20Regular } from "@fluentui/react-icons/headless/svg/grid";
import { Search20Regular } from "@fluentui/react-icons/headless/svg/search";
import { Target20Regular } from "@fluentui/react-icons/headless/svg/target";
import { WindowConsole20Regular } from "@fluentui/react-icons/headless/svg/window-console";



import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { type IconGlyph, Icon } from "@/components/ui/icon";


import { FileIcon } from "@/components/ui/file-icon";
import { Favicon } from "@/components/ui/favicon";
import { SearchInput } from "@/components/ui/search";
import { cn } from "@/lib/utils";
import { useProjectState } from "@/lib/backend";
import { formatMentionToken, type ChatMention } from "@/lib/chat/mentions";
import { DESIGN_TOKEN_MENTIONS, designTokenById } from "@/lib/chat/design-mentions";
import {
    BUILTIN_SLASH_COMMANDS,
    workflowSlashToken,
    type AgentWorkflow,
    type BuiltinSlashCommand,
} from "@/lib/chat/workflows";
import { listDesignPreviewSessions, trySelectPendingDesignConcept } from "@/lib/agent-preview/store";
import { hostnameOf } from "@/lib/ui/favicon";
import { getPreviewCurrentUrl } from "@/features/preview/store";
import { fetchPlugins, peekPluginsCache, type PluginRow } from "@/lib/plugins/api";
import { listSkills, skillIdFromName, subscribeSkills, type Skill } from "@/lib/chat/skills";
import { ensureFreshScan, useSkillIndex } from "@/lib/chat/skill-index";
import {
    fetchWarmMcpServers,
    fetchWarmProjectFiles,
    fetchWarmRecentChats,
    peekWarmMcpServers,
    peekWarmProjectFiles,
    peekWarmRecentChats,
} from "@/lib/chat/mention-warm-cache";
import { PluginLogo } from "@/components/ui/plugin-logo";

type CategoryId = "files" | "code" | "docs" | "terminals" | "chats" | "branch" | "browser" | "mcp" | "plugins" | "skills" | "design" | null;

const CATEGORIES: {
    id: Exclude<CategoryId, null>;
    label: string;
    icon: IconGlyph;
}[] = [
    { id: "files", label: "Files & Folders", icon: Folder20Filled },
    { id: "code", label: "Code", icon: Code20Regular },
    { id: "docs", label: "Docs", icon: Document20Regular },
    { id: "branch", label: "Git", icon: Branch20Regular },
    { id: "chats", label: "Past Chats", icon: Chat20Filled },
    { id: "plugins", label: "Plugins", icon: Grid20Regular },
    { id: "skills", label: "Skills", icon: DocumentText20Regular },
    { id: "mcp", label: "MCP Servers", icon: Grid20Regular },
    { id: "terminals", label: "Terminals", icon: WindowConsole20Regular },
    { id: "design", label: "Design", icon: Color20Regular },
];

function pathDir(path: string): string {
    const parts = path.replace(/\\/g, "/").split("/");
    if (parts.length <= 1) return "";
    const dir = parts.slice(0, -1).join("/");
    if (dir.length <= 28) return dir;
    return `...${dir.slice(-26)}`;
}

export function MentionPicker({
    open,
    query,
    onPick,
    onClose,
    anchorRef,
    boxRef,
    // Accepted for call-site shape; the picker's geometry uses the textarea
    // ref directly, so this is not read. `_` marks it deliberately unread.
    caretIndex: _caretIndex,
    mode = "mention",
    workflows = [],
}: {
    open: boolean;
    query: string;
    onPick: (token: string) => void;
    onClose: () => void;
    anchorRef?: RefObject<HTMLTextAreaElement | null>;
    boxRef?: RefObject<HTMLDivElement | null>;
    /** Index of the `@` that opened the menu (not the caret end of the query). */
    caretIndex?: number;
    mode?: "mention" | "slash";
    workflows?: AgentWorkflow[];
}) {
    const { project_path } = useProjectState();
    const [files, setFiles] = useState<string[]>(() => peekWarmProjectFiles(project_path) ?? []);
    const [chats, setChats] = useState<{ id: string; title: string }[]>(
        () => peekWarmRecentChats(project_path) ?? [],
    );
    const [mcpServers, setMcpServers] = useState<{ id: string; name: string }[]>(
        () => peekWarmMcpServers() ?? [],
    );
    const [plugins, setPlugins] = useState<PluginRow[]>(() => peekPluginsCache()?.plugins ?? []);
    const [skills, setSkills] = useState<Skill[]>(() => listSkills());
    const { scan } = useSkillIndex();
    const [activeCategory, setActiveCategory] = useState<CategoryId>(null);
    const [highlight, setHighlight] = useState(0);
    const [pos, setPos] = useState<{ left: number; top: number; width: number; maxListHeight?: number } | null>(null);
    const [menuEl, setMenuEl] = useState<HTMLDivElement | null>(null);
    const [filter, setFilter] = useState("");

    const [queryInputs, setQueryInputs] = useState<readonly unknown[] | null>(null);
    if (queryInputs === null || !Object.is(queryInputs[0], open) || !Object.is(queryInputs[1], query)) {
        setQueryInputs([open, query]);
        if (open) setFilter(query);
    }

    if (!open && pos !== null) setPos(null);
    const q = filter.trim().toLowerCase();

    useLayoutEffect(() => {
        if (!open) return;
        const box = boxRef?.current ?? anchorRef?.current;
        const update = () => {
            if (!box) return;
            const rect = box.getBoundingClientRect();
            const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
            const vh = typeof window !== "undefined" ? window.innerHeight : 768;
            const measured = menuEl?.offsetHeight;
            const menuHeight = measured && measured > 0 ? measured : 260;
            const maxAllowedWidth = Math.max(200, vw - 16);
            const width = rect.width > 0 ? Math.min(rect.width, maxAllowedWidth) : Math.min(320, maxAllowedWidth);
            const left = rect.width > 0 ? Math.max(8, Math.min(rect.left, vw - width - 8)) : rect.left;

            if (rect.height === 0 && rect.top === 0) {
                setPos({ left, top: 8, width });
                return;
            }

            const spaceAbove = rect.top - 12;
            const spaceBelow = vh - rect.bottom - 12;
            let top = rect.top - menuHeight - 6;
            let maxListHeight: number | undefined;

            if (top >= 8) {
                maxListHeight = Math.min(288, Math.max(120, spaceAbove - 44));
            } else if (spaceBelow > spaceAbove && spaceBelow >= 140) {
                top = rect.bottom + 6;
                maxListHeight = Math.min(288, Math.max(120, spaceBelow - 44));
            } else {
                top = 8;
                maxListHeight = Math.min(288, Math.max(110, rect.top - 52));
            }

            setPos({ left, top: Math.max(8, top), width, maxListHeight });
        };
        update();
        window.addEventListener("resize", update);
        window.addEventListener("scroll", update, true);
        return () => {
            window.removeEventListener("resize", update);
            window.removeEventListener("scroll", update, true);
        };
    }, [open, anchorRef, boxRef, filter, activeCategory, menuEl, files.length, chats.length, mode, workflows.length]);

    const [openScope, setOpenScope] = useState<readonly [typeof open] | null>(null);
    if (openScope === null || !Object.is(openScope[0], open)) {
        setOpenScope([open]);
        if (!open) {
            setActiveCategory(null);
            setHighlight(0);
        }

    }

    useEffect(() => {
        if (!open || !project_path) return;
        let cancelled = false;
        const trimmed = filter.trim();
        const warmRoot = peekWarmProjectFiles(project_path);

        if (!trimmed) {
            if (warmRoot) {
                const t = window.setTimeout(() => {
                    if (!cancelled) setFiles(warmRoot);
                }, 0);
                return () => {
                    cancelled = true;
                    window.clearTimeout(t);
                };
            }
            void fetchWarmProjectFiles(project_path, "", 40).then((rows) => {
                if (!cancelled) setFiles(rows);
            });
            return () => {
                cancelled = true;
            };
        }

        // Seed immediate client-side matches from warm root while debouncing IPC search.
        const timer = window.setTimeout(() => {
            void fetchWarmProjectFiles(project_path, trimmed, 40).then((rows) => {
                if (!cancelled) setFiles(rows);
            });
        }, 55);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [open, project_path, filter]);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        void fetchWarmRecentChats(project_path).then((rows) => {
            if (!cancelled) setChats(rows);
        });
        return () => {
            cancelled = true;
        };
    }, [open, project_path]);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        void fetchWarmMcpServers().then((rows) => {
            if (!cancelled) setMcpServers(rows);
        });
        return () => {
            cancelled = true;
        };
    }, [open]);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        const cached = peekPluginsCache()?.plugins;
        void fetchPlugins()
            .then((data) => {
                if (!cancelled) setPlugins(data.plugins);
            })
            .catch(() => {
                if (!cancelled && !cached) setPlugins([]);
            });
        return () => {
            cancelled = true;
        };
    }, [open]);

    useEffect(() => subscribeSkills(() => setSkills(listSkills())), []);
    // Find skills sitting in the project's or the user's skill folders.
    useEffect(() => {
        if (open) ensureFreshScan();
    }, [open]);

    const designItems: ChatMention[] = useMemo(() => {
        const tokens: ChatMention[] = DESIGN_TOKEN_MENTIONS.map((t) => ({
            kind: "design",
            id: t.id,
            path: t.id,
            label: t.label,
        }));
        const sessions = listDesignPreviewSessions();
        const seen = new Set<string>(tokens.map((t) => t.id || ""));
        for (const s of sessions) {
            for (const item of s.items) {
                const id = item.id || item.path;
                if (!id || seen.has(id)) continue;
                seen.add(id);
                tokens.push({
                    kind: "design",
                    id: item.id,
                    path: item.path,
                    label: item.name,
                });
            }
        }
        return tokens;
        // `open` is a refresh trigger, not a value the body reads: it re-reads the
        // design-preview sessions from storage each time the picker opens.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const fileMentions: ChatMention[] = useMemo(() => {
        return files
            .filter((path) => !q || path.toLowerCase().includes(q))
            .slice(0, 10)
            .map((path) => ({
                kind: path.endsWith("/") ? ("folder" as const) : ("file" as const),
                path,
                label: path.split("/").pop() || path,
            }));
    }, [files, q]);

    const pluginMentions: ChatMention[] = useMemo(() => {
        return plugins
            .filter((p) =>
                !q
                || p.name.toLowerCase().includes(q)
                || p.toolkit.toLowerCase().includes(q)
                || p.description.toLowerCase().includes(q),
            )
            .sort((a, b) => Number(b.connected) - Number(a.connected))
            .slice(0, 20)
            .map((p) => ({
                kind: "plugin" as const,
                id: p.toolkit,
                path: p.toolkit,
                label: p.name,
            }));
    }, [plugins, q]);

    const categoryItems: ChatMention[] = useMemo(() => {
        if (activeCategory === "files") return fileMentions;
        if (activeCategory === "docs") {
            return files
                .filter((path) => /\.(md|mdx|txt|rst)$/i.test(path) || /(^|\/)docs\//i.test(path))
                .filter((path) => !q || path.toLowerCase().includes(q))
                .slice(0, 20)
                .map((path) => ({
                    kind: "docs" as const,
                    path,
                    label: path.split("/").pop() || path,
                }));
        }
        if (activeCategory === "code") {
            return [
                { kind: "codebase" as const, label: "Codebase" },
                { kind: "selection" as const, label: "Selection" },
            ].filter((m) => !q || m.label.toLowerCase().includes(q));
        }
        if (activeCategory === "plugins") return pluginMentions;
        if (activeCategory === "skills") {
            const installed = skills
                .filter((skill) => !q || skill.name.toLowerCase().includes(q) || skill.id.includes(q))
                .map((skill) => ({
                    kind: "skill" as const,
                    id: skill.id,
                    path: skill.id,
                    label: skill.name,
                }));
            // Skills found in `.claude/skills`, `.agents/skills`, and the user's
            // own folders can be mentioned without importing them first.
            const installedIds = new Set(skills.map((skill) => skill.id));
            const rows: ChatMention[] = [...installed];
            for (const item of scan?.items ?? []) {
                if (item.projectPath !== (project_path ?? "")) continue;
                const id = skillIdFromName(item.name);
                if (installedIds.has(id)) continue;
                if (q && !item.name.toLowerCase().includes(q) && !id.includes(q) && !item.relPath.toLowerCase().includes(q)) continue;
                rows.push({ kind: "skill", id, path: item.relPath, label: `${item.name} · ${item.rootLabel}` });
            }
            return rows;
        }
        if (activeCategory === "chats") {
            return chats
                .filter((c) => !q || c.title.toLowerCase().includes(q))
                .map((c) => ({
                    kind: "chat" as const,
                    path: c.id,
                    id: c.id,
                    label: c.title || "Chat",
                }));
        }
        if (activeCategory === "mcp") {
            return mcpServers
                .filter((s) => !q || s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
                .map((s) => ({
                    kind: "mcp" as const,
                    id: s.id,
                    path: s.id,
                    label: s.name || s.id,
                }));
        }
        if (activeCategory === "design") {
            return designItems.filter(
                (d) => !q || d.label.toLowerCase().includes(q) || (d.id || "").includes(q),
            );
        }
        if (activeCategory === "terminals") {
            return [{ kind: "terminal" as const, path: "active", label: "Active terminal" }];
        }
        if (activeCategory === "branch") {
            return [{ kind: "branch" as const, path: "main", label: "Diff with main" }];
        }
        if (activeCategory === "browser") {
            const raw = filter.trim();
            const host = hostnameOf(raw);
            const currentUrl = getPreviewCurrentUrl();
            const items: ChatMention[] = [
                {
                    kind: "browser" as const,
                    path: currentUrl || "current",
                    label: currentUrl
                        ? `Current page (${hostnameOf(currentUrl) || currentUrl})`
                        : "Current page",
                },
            ];
            if (host && /\./.test(host)) {
                items.unshift({
                    kind: "browser",
                    path: /^https?:\/\//i.test(raw) ? raw : `https://${host}`,
                    label: host,
                });
            }
            return items;
        }
        return [];
    }, [activeCategory, fileMentions, files, chats, designItems, mcpServers, pluginMentions, skills, scan, project_path, q, filter]);

    const rootItems = useMemo(() => {
        if (activeCategory) return categoryItems;
        return fileMentions.slice(0, 8);
    }, [activeCategory, categoryItems, fileMentions]);

    const slashEntries = useMemo(() => {
        const needle = q.replace(/^\//, "").toLowerCase();
        type SlashEntry =
            | { kind: "builtin"; cmd: BuiltinSlashCommand; score: number }
            | { kind: "workflow"; w: AgentWorkflow; score: number };

        const scoreToken = (tokenKey: string, titleLower: string, descLower = ""): number => {
            if (!needle) return 1;
            if (tokenKey === needle) return 4;
            if (tokenKey.startsWith(needle) || titleLower.startsWith(needle)) return 3;
            if (tokenKey.includes(needle) || titleLower.includes(needle)) return 2;
            if (descLower && descLower.includes(needle)) return 1;
            return 0;
        };

        const builtins: SlashEntry[] = BUILTIN_SLASH_COMMANDS.map((cmd) => ({
            kind: "builtin" as const,
            cmd,
            score: scoreToken(
                cmd.token.replace(/^\/+/, "").toLowerCase(),
                cmd.name.toLowerCase(),
                cmd.description.toLowerCase(),
            ),
        })).filter((entry) => entry.score > 0);

        const saved: SlashEntry[] = workflows
            .map((w) => {
                const triggerKey = w.trigger.trim().replace(/^\/+/, "").toLowerCase();
                return {
                    kind: "workflow" as const,
                    w,
                    score: scoreToken(triggerKey, w.name.toLowerCase()),
                };
            })
            .filter((entry) => entry.score > 0);

        return [...saved, ...builtins]
            .sort((a, b) => b.score - a.score)
            .slice(0, 20);
    }, [workflows, q]);

    const visibleCategories = useMemo(() => {
        if (activeCategory) return [];
        if (!q) return CATEGORIES;
        return CATEGORIES.filter((c) => c.label.toLowerCase().includes(q));
    }, [activeCategory, q]);

    const showCategories = mode === "mention" && !activeCategory;
    const mentionNavLen = rootItems.length + (showCategories ? visibleCategories.length : 0);
    const listLen = mode === "slash" ? slashEntries.length : mentionNavLen;

    const [highlightScope, setHighlightScope] = useState<readonly [typeof activeCategory, typeof filter, unknown, unknown, typeof mode] | null>(null);
    if (highlightScope === null
        || !Object.is(highlightScope[0], activeCategory)
        || !Object.is(highlightScope[1], filter)
        || !Object.is(highlightScope[2], mentionNavLen)
        || !Object.is(highlightScope[3], slashEntries.length)
        || !Object.is(highlightScope[4], mode)) {
        setHighlightScope([activeCategory, filter, mentionNavLen, slashEntries.length, mode]);
        setHighlight(0);
    }

    const pickItem = useCallback(
        (item: ChatMention) => {
            if (item.kind === "design" && item.id) {
                void trySelectPendingDesignConcept(item.id);
            }
            onPick(`${formatMentionToken(item)} `);
            onClose();
        },
        [onPick, onClose],
    );

    const pickSlashToken = useCallback(
        (token: string) => {
            onPick(`${token} `);
            onClose();
        },
        [onPick, onClose],
    );

    useEffect(() => {
        if (!open || !menuEl) return;
        const activeRow = menuEl.querySelector<HTMLElement>('[data-mention-highlighted="true"]');
        if (activeRow && typeof activeRow.scrollIntoView === "function") {
            activeRow.scrollIntoView({ block: "nearest" });
        }
    }, [open, menuEl, highlight]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                if (mode === "mention" && activeCategory) setActiveCategory(null);
                else onClose();
                return;
            }
            if (e.key === "ArrowDown") {
                if (listLen <= 0) return;
                e.preventDefault();
                setHighlight((h) => Math.min(h + 1, Math.max(listLen - 1, 0)));
            } else if (e.key === "ArrowUp") {
                if (listLen <= 0) return;
                e.preventDefault();
                setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
                if (listLen <= 0) {
                    if (e.key === "Enter") {
                        onClose();
                    }
                    return;
                }
                e.preventDefault();
                if (mode === "slash") {
                    const entry = slashEntries[highlight];
                    if (entry) {
                        pickSlashToken(
                            entry.kind === "builtin" ? entry.cmd.token : workflowSlashToken(entry.w),
                        );
                    }
                } else if (highlight < rootItems.length) {
                    if (rootItems[highlight]) pickItem(rootItems[highlight]);
                } else if (showCategories) {
                    const cat = visibleCategories[highlight - rootItems.length];
                    if (cat) setActiveCategory(cat.id);
                }
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [
        open,
        activeCategory,
        rootItems,
        slashEntries,
        visibleCategories,
        showCategories,
        highlight,
        onClose,
        pickItem,
        pickSlashToken,
        mode,
        listLen,
    ]);

    if (!open || !pos) return null;

    return createPortal(
        <div
            ref={setMenuEl}
            className="bettershape-popover-content bettershape-menu-content fixed z-dropdown overflow-hidden rounded-xl border border-border-secondary bg-surface-4 shadow-lg"
            style={{ left: pos.left, top: pos.top, width: pos.width }}
        >
            <SearchInput
                borderless
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={mode === "slash" ? "Search commands & workflows..." : "Add files, folders, skills..."}
                aria-label={mode === "slash" ? "Search workflows" : "Search mentions"}
            />

            {mode === "mention" && activeCategory ? (
                <button
                    type="button"
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-sm text-text-secondary transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--row-hover)] hover:text-text-primary"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setActiveCategory(null)}
                >
                    <Icon icon={ArrowLeft20Regular} />
                    {CATEGORIES.find((c) => c.id === activeCategory)?.label ?? "Back"}
                </button>
            ) : null}

            <div
                className="overflow-y-auto no-scrollbar px-1 pb-1"
                style={{ maxHeight: pos.maxListHeight ?? 288 }}
            >
                {mode === "slash" ? (
                    slashEntries.length === 0 ? (
                        <div className="px-2.5 py-2 text-sm text-text-muted">
                            No matching commands. Add workflows in Settings.
                        </div>
                    ) : (
                        slashEntries.map((entry, idx) => {
                            const token =
                                entry.kind === "builtin"
                                    ? entry.cmd.token
                                    : workflowSlashToken(entry.w);
                            const subtitle =
                                entry.kind === "builtin" ? entry.cmd.description : entry.w.name;
                            const argsHint =
                                entry.kind === "builtin" ? entry.cmd.argsHint : undefined;
                            const key =
                                entry.kind === "builtin" ? `builtin-${entry.cmd.token}` : entry.w.id;
                            return (
                                <button
                                    key={key}
                                    type="button"
                                    data-mention-highlighted={idx === highlight ? "true" : undefined}
                                    className={cn(
                                        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]",
                                        idx === highlight
                                            ? "bg-[var(--row-selected)] text-text-primary hover:bg-[var(--row-selected-hover)]"
                                            : "text-text-primary hover:bg-[var(--row-hover)]",
                                    )}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onMouseEnter={() => setHighlight(idx)}
                                    onClick={() => pickSlashToken(token)}
                                >
                                    {entry.kind === "workflow" && entry.w.pluginToolkit ? (
                                        <PluginLogo
                                            toolkit={entry.w.pluginToolkit}
                                            name={entry.w.name}
                                            size={14}
                                            className="rounded-sm"
                                        />
                                    ) : (
                                        <Icon icon={Code20Regular} className="shrink-0 text-text-muted" />
                                    )}
                                    <span className="flex min-w-0 shrink-0 items-center gap-1 font-medium">
                                        <span>{token}</span>
                                        {argsHint ? (
                                            <span className="font-normal text-text-muted">{argsHint}</span>
                                        ) : null}
                                    </span>
                                    <span className="ml-auto min-w-0 max-w-[56%] truncate text-xs text-text-muted">
                                        {subtitle}
                                    </span>
                                </button>
                            );
                        })
                    )
                ) : (
                    <>
                {rootItems.length === 0 && (activeCategory || !showCategories) ? (
                    <div className="px-2.5 py-2 text-sm text-text-muted">No matches</div>
                ) : null}

                {rootItems.map((item, idx) => (
                    <button
                        key={`${item.kind}-${item.id ?? item.path ?? item.label}-${idx}`}
                        type="button"
                        data-mention-highlighted={idx === highlight ? "true" : undefined}
                        className={cn(
                            "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]",
                            idx === highlight
                                ? "bg-[var(--row-selected)] text-text-primary hover:bg-[var(--row-selected-hover)]"
                                : "text-text-primary hover:bg-[var(--row-hover)]",
                        )}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setHighlight(idx)}
                        onClick={() => pickItem(item)}
                    >
                        {item.kind === "file" || item.kind === "folder" || item.kind === "docs" ? (
                            <FileIcon
                                name={item.label}
                                isDir={item.kind === "folder"}
                                className="h-4 w-4 shrink-0"
                            />
                        ) : item.kind === "plugin" ? (
                            <PluginLogo
                                toolkit={item.id || item.path || item.label}
                                name={item.label}
                                size={14}
                                className="rounded-sm"
                            />
                        ) : item.kind === "browser" && item.path && item.path !== "current" ? (
                            <Favicon url={item.path} size={14} />
                        ) : (
                            <Icon
                                icon={
                                    item.kind === "codebase"
                                        ? Search20Regular
                                        : item.kind === "selection"
                                          ? Code20Regular
                                          : item.kind === "design"
                                            ? (designTokenById(item.id || item.path)?.icon ?? Color20Regular)
                                            : item.kind === "chat"
                                              ? Chat20Filled
                                              : item.kind === "terminal"
                                                ? WindowConsole20Regular
                                                : item.kind === "branch"
                                                  ? Branch20Regular
                                                  : item.kind === "browser"
                                                    ? Globe20Regular
                                                    : item.kind === "mcp"
                                                      ? Grid20Regular
                                                      : item.kind === "element"
                                                        ? Target20Regular
                                                        : item.kind === "skill"
                                                          ? DocumentText20Regular
                                                          : Document20Regular
                                }
                                className="shrink-0 text-text-muted"
                            />
                        )}
                        <span className="min-w-0 flex-1 truncate font-medium">
                            {item.kind === "browser" && item.path && item.path !== "current"
                                ? `Visit ${item.label}`
                                : item.label}
                        </span>
                        {item.path && item.kind !== "design" && item.kind !== "browser" && item.kind !== "chat" ? (
                            <span className="ml-auto max-w-[48%] truncate text-xs text-text-muted">
                                {pathDir(item.path) || item.path}
                            </span>
                        ) : null}
                    </button>
                ))}

                {showCategories && visibleCategories.length > 0 ? (
                    <>
                        {rootItems.length > 0 ? <div className="my-1 h-px bg-border-subtle" /> : null}
                        {visibleCategories.map((cat, catOffset) => {
                            const navIdx = rootItems.length + catOffset;
                            return (
                                <button
                                    key={cat.id}
                                    type="button"
                                    data-mention-highlighted={navIdx === highlight ? "true" : undefined}
                                    className={cn(
                                        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]",
                                        navIdx === highlight
                                            ? "bg-[var(--row-selected)] text-text-primary hover:bg-[var(--row-selected-hover)]"
                                            : "text-text-primary hover:bg-[var(--row-hover)]",
                                    )}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onMouseEnter={() => setHighlight(navIdx)}
                                    onClick={() => setActiveCategory(cat.id)}
                                >
                                    <Icon icon={cat.icon} className="shrink-0 text-text-muted" />
                                    <span className="flex-1 font-medium">{cat.label}</span>
                                    <Icon icon={ChevronRight20Regular} className="text-text-muted" />
                                </button>
                            );
                        })}
                    </>
                ) : null}
                    </>
                )}
            </div>
        </div>,
        document.body,
    );
}
