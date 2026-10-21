"use client";

import { ArrowUndo20Regular } from "@fluentui/react-icons/headless/svg/arrow-undo";
import { Collections20Regular } from "@fluentui/react-icons/headless/svg/collections";
import { Compose20Regular } from "@fluentui/react-icons/headless/svg/compose";
import { Dismiss20Regular } from "@fluentui/react-icons/headless/svg/dismiss";
import { Filter20Regular } from "@fluentui/react-icons/headless/svg/filter";
import { FolderOpen20Regular } from "@fluentui/react-icons/headless/svg/folder-open";
import { MoreHorizontal20Regular } from "@fluentui/react-icons/headless/svg/more-horizontal";
import { Search20Regular } from "@fluentui/react-icons/headless/svg/search";

import {
    useCallback,
    useEffect,
    useMemo,
    useState,
    useSyncExternalStore,
    type ReactNode,
} from "react";
import { commands, useProjectState } from "@/lib/backend";
import type { Conversation } from "@/lib/backend/types";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { NEW_CHAT_TAB_ID } from "@/features/chat/ui/shell/tabs";
import {
    clearChatUnread,
    getChatColors,
    getChatColorsServer,
    getCollections,
    getCollectionsServer,
    getPinnedChatIds,
    getPinnedChatIdsServer,
    getUnreadChatIds,
    getUnreadChatIdsServer,
    markChatUnread,
    setChatPinned,
    subscribeChatColors,
    subscribeCollections,
    subscribePinnedChats,
    subscribeUnreadChats,
} from "@/lib/sidebar/chat-list-meta";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import {
    applySubagentEvent,
    getSubagents,
    subscribeSubagents,
} from "@/features/agent/subagents/store";
import { listen } from "@tauri-apps/api/event";
import { useChatStreamMeta } from "@/features/chat/lib/chat-stream-store";
import { useGeneratingChatIds } from "@/features/chat/lib/generating-chats";
import { ScrollArea } from "@/components/ui/scroll";
import { CollectionDialog } from "./collection-dialog";
import {
    buildChatLifecycleActions,
    renderLifecycleActions,
    type ChatLifecycleHandlers,
    type ChatLifecycleTarget,
} from "./lifecycle";
import {
    ChatShelves,
    SORT_OPTIONS,
    buildShelves,
    type ChatShelfId,
    type ChatSort,
} from "./sections";
import {
    CHAT_UNDO_WINDOW_MS,
    dismissChatUndo,
    pendingRemovalChatIds,
    pendingRemovalChatIdsServer,
    pushChatUndo,
    subscribeChatUndo,
    undoChat,
    useChatUndo,
} from "./undo";

export type ChatFilter = "all" | "pinned" | "unread";

const SORT_KEY = "bettershape-sidebar-chat-sort";
const FILTER_OPTIONS: { value: ChatFilter; label: string }[] = [
    { value: "all", label: "All sessions" },
    { value: "pinned", label: "Pinned" },
    { value: "unread", label: "Unread" },
];

function loadSort(): ChatSort {
    try {
        const value = window.localStorage.getItem(SORT_KEY);
        if (value === "recent" || value === "oldest" || value === "name-asc" || value === "name-desc") {
            return value;
        }
    } catch {
        /* ignore */
    }
    return "recent";
}

function HeaderIconBtn({
    label,
    onClick,
    active,
    children,
}: {
    label: string;
    onClick?: () => void;
    active?: boolean;
    children: ReactNode;
}) {
    return (
        <Tooltip content={label} side="bottom" delayDuration={80}>
            <button
                type="button"
                aria-label={label}
                aria-pressed={active}
                onClick={onClick}
                className={cn(
                    "flex size-7 items-center justify-center rounded-md text-text-muted",
                    "transition-colors duration-[var(--transition-fast)] ease-[var(--ease-out)]",
                    "hover:bg-panel-hover hover:text-text-primary",
                    active && "bg-panel-hover text-text-primary",
                )}
            >
                {children}
            </button>
        </Tooltip>
    );
}

/** The drain bar under the undo card. Keyed per entry so it restarts each time. */
function UndoCountdown() {
    const [draining, setDraining] = useState(false);
    useEffect(() => {
        const frame = window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => setDraining(true));
        });
        return () => window.cancelAnimationFrame(frame);
    }, []);
    return (
        <span
            aria-hidden
            className={cn(
                "absolute inset-x-0 bottom-0 h-[3px] origin-left bg-accent",
                "transition-transform ease-linear",
                draining ? "scale-x-0" : "scale-x-100",
            )}
            style={{ transitionDuration: `${CHAT_UNDO_WINDOW_MS}ms` }}
        />
    );
}

function UndoBar() {
    const entry = useChatUndo();
    if (!entry) return null;
    return (
        <div
            data-chat-undo={entry.kind}
            role="status"
            aria-live="polite"
            className="relative mx-1.5 mb-1 flex items-center gap-2 squircle-2xl border border-border-subtle bg-surface-3 px-2 py-1.5 shadow-lg"
        >
            <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{entry.label}</span>
            <button
                type="button"
                onClick={() => undoChat()}
                className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-sm text-text-secondary transition-colors duration-[var(--transition-fast)] ease-[var(--ease-out)] hover:bg-panel-hover hover:text-text-primary"
            >
                <Icon icon={ArrowUndo20Regular} className="icon-sm" />
                Undo
            </button>
            <button
                type="button"
                aria-label="Dismiss undo"
                onClick={() => dismissChatUndo()}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors duration-[var(--transition-fast)] ease-[var(--ease-out)] hover:bg-panel-hover hover:text-text-primary"
            >
                <Icon icon={Dismiss20Regular} className="icon-sm" />
            </button>
            <UndoCountdown key={entry.id} />
        </div>
    );
}

export function ChatList({
    onNewChat,
}: {
    onNewChat: () => void;
    /** @deprecated unified Sessions list — ignored */
    listKind?: "chat";
}) {
    const { project_path } = useProjectState();
    const [chats, setChats] = useState<Conversation[]>([]);
    const [sort, setSort] = useState<ChatSort>("recent");
    const [filter, setFilter] = useState<ChatFilter>("all");
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [collapsed, setCollapsed] = useState<ReadonlySet<ChatShelfId>>(() => new Set());
    const [collectionDraft, setCollectionDraft] = useState<string[] | null>(null);

    const pinnedIds = useSyncExternalStore(subscribePinnedChats, getPinnedChatIds, getPinnedChatIdsServer);
    const unreadIds = useSyncExternalStore(subscribeUnreadChats, getUnreadChatIds, getUnreadChatIdsServer);
    const colors = useSyncExternalStore(subscribeChatColors, getChatColors, getChatColorsServer);
    const collections = useSyncExternalStore(subscribeCollections, getCollections, getCollectionsServer);
    const generatingIds = useGeneratingChatIds();
    // Same store, different projection: a chat inside a live archive or delete
    // entry is off screen until the entry is undone or swept.
    const hiddenIds = useSyncExternalStore(
        subscribeChatUndo,
        pendingRemovalChatIds,
        pendingRemovalChatIdsServer,
    );
    const allSubagents = useSyncExternalStore(subscribeSubagents, getSubagents, getSubagents);

    useEffect(() => {
        setSort(loadSort());
    }, []);

    useEffect(() => {
        let unlisten: (() => void) | undefined;
        void listen("agent-subagent", (event) => {
            applySubagentEvent((event.payload ?? {}) as Parameters<typeof applySubagentEvent>[0]);
        }).then((fn) => {
            unlisten = fn;
        });
        return () => unlisten?.();
    }, []);

    const persistSort = useCallback((next: ChatSort) => {
        setSort(next);
        try {
            window.localStorage.setItem(SORT_KEY, next);
        } catch {
            /* ignore */
        }
    }, []);

    const loadChats = useCallback(async () => {
        if (!project_path) {
            setChats([]);
            return;
        }
        try {
            setChats(await commands.getConversations(project_path));
        } catch {
            setChats([]);
        }
    }, [project_path]);

    useEffect(() => {
        void loadChats();
        const onRefresh = () => void loadChats();
        window.addEventListener("bettershape-chat-refresh", onRefresh);
        window.addEventListener("bettershape-chats-changed", onRefresh);
        window.addEventListener("bettershape-chat-active", onRefresh);
        return () => {
            window.removeEventListener("bettershape-chat-refresh", onRefresh);
            window.removeEventListener("bettershape-chats-changed", onRefresh);
            window.removeEventListener("bettershape-chat-active", onRefresh);
        };
    }, [loadChats]);

    useEffect(() => {
        const onActive = (e: Event) => {
            const id = (e as CustomEvent<{ id?: string }>).detail?.id;
            const next = id && id !== NEW_CHAT_TAB_ID ? id : null;
            setActiveId(next);
            if (next) clearChatUnread(next);
        };
        window.addEventListener("bettershape-chat-active", onActive as EventListener);
        return () => window.removeEventListener("bettershape-chat-active", onActive as EventListener);
    }, []);

    useEffect(() => {
        const onGenerating = (e: Event) => {
            const detail = (e as CustomEvent<{ id?: string; generating?: boolean }>).detail;
            const id = detail?.id;
            if (!id || detail?.generating) return;
            if (id !== activeId) markChatUnread(id);
        };
        window.addEventListener("bettershape-chat-generating", onGenerating as EventListener);
        return () => window.removeEventListener("bettershape-chat-generating", onGenerating as EventListener);
    }, [activeId]);

    // Highlight the chat on screen. The backend's current chat can be another one while a
    // background chat runs, so it is not used here.
    const viewedChatId = useChatStreamMeta().viewedConversationId;
    useEffect(() => {
        setActiveId(viewedChatId);
    }, [viewedChatId]);

    const openChat = useCallback((id: string) => {
        clearChatUnread(id);
        window.dispatchEvent(new CustomEvent("bettershape-chat-load", { detail: { id } }));
    }, []);

    const refresh = useCallback(() => {
        window.dispatchEvent(new CustomEvent("bettershape-chat-refresh"));
    }, []);

    const nameOf = useCallback(
        (ids: readonly string[]) => {
            if (ids.length > 1) return `${ids.length} sessions`;
            const title = chats.find((chat) => chat.id === ids[0])?.title?.trim();
            return title ? `“${title}”` : "this session";
        },
        [chats],
    );

    const pinChats = useCallback(
        (ids: readonly string[], pinned: boolean) => {
            for (const id of ids) setChatPinned(id, pinned);
            pushChatUndo({
                kind: "pin",
                chatId: ids[0],
                label: `${pinned ? "Pinned" : "Unpinned"} ${nameOf(ids)}`,
                revert: () => {
                    for (const id of ids) setChatPinned(id, !pinned);
                },
            });
        },
        [nameOf],
    );

    const archiveChats = useCallback(
        (ids: readonly string[]) => {
            for (const id of ids) void commands.setConversationArchived(id, true).catch(() => {});
            for (const id of ids) {
                window.dispatchEvent(new CustomEvent("bettershape-chat-close-tab", { detail: { id } }));
            }
            refresh();
            pushChatUndo({
                kind: "archive",
                chatId: ids[0],
                label: `Archived ${nameOf(ids)}`,
                revert: () => {
                    for (const id of ids) void commands.setConversationArchived(id, false).catch(() => {});
                    refresh();
                },
            });
        },
        [nameOf, refresh],
    );

    const removeChats = useCallback(
        (ids: readonly string[]) => {
            // Nothing can bring a conversation back once the backend has it, so the
            // delete is only sent once the undo window has closed. The row leaves
            // the list now and the conversation outlives it by five seconds.
            pushChatUndo({
                kind: "delete",
                chatId: ids[0],
                label: `Deleted ${nameOf(ids)}`,
                commit: () => {
                    for (const id of ids) void commands.deleteConversation(id).catch(() => {});
                    for (const id of ids) {
                        window.dispatchEvent(new CustomEvent("bettershape-chat-close-tab", { detail: { id } }));
                    }
                    refresh();
                },
            });
        },
        [nameOf, refresh],
    );

    const handlers = useMemo<ChatLifecycleHandlers>(
        () => ({
            open: openChat,
            setPinned: pinChats,
            markUnread: markChatUnread,
            copyTitle: (title) => void navigator.clipboard.writeText(title),
            revealFolder: (path) => void commands.revealPath(path).catch(() => {}),
            archive: archiveChats,
            remove: removeChats,
            addToCollection: (ids) => setCollectionDraft([...ids]),
        }),
        [openChat, pinChats, archiveChats, removeChats],
    );

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
            if (event.key.toLowerCase() !== "z" || event.shiftKey) return;
            const target = event.target as HTMLElement | null;
            if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
            // Capture phase, and only swallow the key once something came back:
            // with nothing pending, another surface's own mod+Z still fires.
            const entry = undoChat();
            if (!entry) return;
            event.preventDefault();
            event.stopPropagation();
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, []);

    const live = useMemo(() => chats.filter((chat) => !chat.archived), [chats]);

    const filtered = useMemo(() => {
        if (filter === "pinned") return live.filter((chat) => pinnedIds.has(chat.id));
        if (filter === "unread") return live.filter((chat) => unreadIds.has(chat.id));
        return live;
    }, [live, filter, pinnedIds, unreadIds]);

    const sections = useMemo(
        () =>
            buildShelves({
                chats: filtered,
                sort,
                pinned: pinnedIds,
                generating: generatingIds,
                activeId,
                hidden: hiddenIds,
            }),
        [filtered, sort, pinnedIds, generatingIds, activeId, hiddenIds],
    );

    const toggleSelect = useCallback((id: string) => {
        setSelectedIds((current) =>
            current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
        );
    }, []);

    const toggleShelf = useCallback((shelf: ChatShelfId) => {
        setCollapsed((current) => {
            const next = new Set(current);
            if (next.has(shelf)) next.delete(shelf);
            else next.add(shelf);
            return next;
        });
    }, []);

    const selectedTargets = useMemo<ChatLifecycleTarget[]>(
        () =>
            filtered
                .filter((chat) => selectedIds.includes(chat.id))
                .map((chat) => ({
                    id: chat.id,
                    title: chat.title?.trim() || "Untitled",
                    path: chat.project_path || project_path || "",
                    pinned: pinnedIds.has(chat.id),
                })),
        [filtered, selectedIds, pinnedIds, project_path],
    );

    const collectionOf = useCallback(
        (chatId: string) => collections.find((entry) => entry.chatIds.includes(chatId))?.name ?? null,
        [collections],
    );

    const rowProps = useCallback(
        (chat: Conversation) => ({
            title: chat.title?.trim() || "Untitled",
            path: chat.project_path || project_path || "",
            timestamp: chat.timestamp || 0,
            collection: collectionOf(chat.id),
            active: chat.id === activeId,
            pinned: pinnedIds.has(chat.id),
            unread: unreadIds.has(chat.id),
            color: colors[chat.id] ?? null,
            subagents: allSubagents.filter((card) => card.parentId === chat.id),
            selecting: selectedIds.length > 0,
            selected: selectedIds.includes(chat.id),
            onToggleSelect: () => toggleSelect(chat.id),
            onOpen: () => openChat(chat.id),
            onTogglePin: (next: boolean) => pinChats([chat.id], next),
            handlers,
        }),
        [
            activeId,
            allSubagents,
            collectionOf,
            colors,
            handlers,
            openChat,
            pinChats,
            pinnedIds,
            project_path,
            selectedIds,
            toggleSelect,
            unreadIds,
        ],
    );

    const openCommandPalette = () => {
        window.dispatchEvent(
            new CustomEvent("bettershape-command-palette", {
                detail: { placeholder: "Search…" },
            }),
        );
    };

    const allCollapsed = sections.length > 1 && sections.every((section) => collapsed.has(section.id));
    const setAllCollapsed = (next: boolean) => {
        setCollapsed(next ? new Set<ChatShelfId>(sections.map((section) => section.id)) : new Set<ChatShelfId>());
    };

    const selectionPrimitives = {
        Item: (props: { onClick?: () => void; className?: string; children?: ReactNode }) => (
            <DropdownMenuItem {...props} />
        ),
        Separator: () => <DropdownMenuSeparator />,
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between pl-3 pr-1 pb-1 pt-3">
                <span className="text-sm font-medium text-text-muted">Sessions</span>
                <div className="flex items-center">
                    <HeaderIconBtn label="Search" onClick={openCommandPalette}>
                        <Icon icon={Search20Regular} />
                    </HeaderIconBtn>
                    <DropdownMenu modal={false}>
                        <Tooltip content="Filter" side="bottom" delayDuration={80}>
                            <DropdownMenuTrigger asChild>
                                <button
                                    type="button"
                                    aria-label="Filter"
                                    className="flex size-7 items-center justify-center rounded-md text-text-muted transition-colors duration-[var(--transition-fast)] ease-[var(--ease-out)] hover:bg-panel-hover hover:text-text-primary data-[state=open]:bg-panel-hover data-[state=open]:text-text-primary"
                                >
                                    <Icon icon={Filter20Regular} />
                                </button>
                            </DropdownMenuTrigger>
                        </Tooltip>
                        <DropdownMenuContent align="end" className="min-w-40">
                            <DropdownMenuLabel>Show</DropdownMenuLabel>
                            <DropdownMenuRadioGroup
                                value={filter}
                                onValueChange={(value) => setFilter(value as ChatFilter)}
                            >
                                {FILTER_OPTIONS.map((opt) => (
                                    <DropdownMenuRadioItem key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </DropdownMenuRadioItem>
                                ))}
                            </DropdownMenuRadioGroup>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel>Sort</DropdownMenuLabel>
                            <DropdownMenuRadioGroup
                                value={sort}
                                onValueChange={(value) => persistSort(value as ChatSort)}
                            >
                                {SORT_OPTIONS.map((opt) => (
                                    <DropdownMenuRadioItem key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </DropdownMenuRadioItem>
                                ))}
                            </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <DropdownMenu modal={false}>
                        <Tooltip content="Sessions actions" side="bottom" delayDuration={80}>
                            <DropdownMenuTrigger asChild>
                                <button
                                    type="button"
                                    aria-label="Sessions actions"
                                    className="flex size-7 items-center justify-center rounded-md text-text-muted transition-colors duration-[var(--transition-fast)] ease-[var(--ease-out)] hover:bg-panel-hover hover:text-text-primary data-[state=open]:bg-panel-hover data-[state=open]:text-text-primary"
                                >
                                    <Icon icon={MoreHorizontal20Regular} />
                                </button>
                            </DropdownMenuTrigger>
                        </Tooltip>
                        <DropdownMenuContent align="end" className="min-w-48">
                            <DropdownMenuLabel>
                                {selectedIds.length > 0 ? `${selectedIds.length} selected` : "Sessions"}
                            </DropdownMenuLabel>
                            {selectedTargets.length > 0 ? (
                                <>
                                    {renderLifecycleActions(
                                        buildChatLifecycleActions(selectedTargets, handlers),
                                        selectionPrimitives,
                                    )}
                                    <DropdownMenuItem onClick={() => setCollectionDraft([...selectedIds])}>
                                        <Icon icon={Collections20Regular} />
                                        Add to collection
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                </>
                            ) : null}
                            <DropdownMenuItem
                                disabled={selectedIds.length === 0}
                                onClick={() => setSelectedIds([])}
                            >
                                Clear selection
                            </DropdownMenuItem>
                            {sections.length > 1 ? (
                                <DropdownMenuItem onClick={() => setAllCollapsed(!allCollapsed)}>
                                    {allCollapsed ? "Expand all sections" : "Collapse all sections"}
                                </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={onNewChat}>
                                <Icon icon={Compose20Regular} />
                                New chat
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <HeaderIconBtn label="New chat" onClick={onNewChat}>
                        <Icon icon={Compose20Regular} />
                    </HeaderIconBtn>
                </div>
            </div>

            <ScrollArea fadeFrom="from-sidebar" className="min-h-0 flex-1 px-1.5 pb-2">
                {!project_path ? (
                    <button
                        type="button"
                        onClick={() => window.dispatchEvent(new Event("bettershape-new-project"))}
                        className="mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-text-muted hover:bg-panel-hover hover:text-text-secondary"
                    >
                        <Icon icon={FolderOpen20Regular} />
                        New project
                    </button>
                ) : filtered.length === 0 ? (
                    <button
                        type="button"
                        onClick={onNewChat}
                        className="mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-text-muted hover:bg-panel-hover hover:text-text-secondary"
                    >
                        <Icon icon={Compose20Regular} className="shrink-0" />
                        <span>New chat</span>
                    </button>
                ) : (
                    <ChatShelves
                        sections={sections}
                        rowProps={rowProps}
                        collapsed={collapsed}
                        onToggleShelf={toggleShelf}
                    />
                )}
            </ScrollArea>

            <UndoBar />

            {collectionDraft ? (
                <CollectionDialog chatIds={collectionDraft} onClose={() => setCollectionDraft(null)} />
            ) : null}
        </div>
    );
}