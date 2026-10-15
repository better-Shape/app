"use client";

import { useIsMounted } from "@/lib/ui/use-mounted";

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
    useRef,
    useState,
    useSyncExternalStore,
    type ReactNode,
} from "react";
import { isComposingKey, isSidebarShortcut } from "./shortcuts";
import {
    getChatDispositions, getChatDispositionsServer,
    setChatDisposition, subscribeChatDispositions, type ChatDisposition,
} from "@/lib/sidebar/chat-disposition";
import { notify } from "@/features/notifications";
import { commands, useProjectState } from "@/lib/backend";
import type { Conversation } from "@/lib/backend/types";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { SearchInput } from "@/components/ui/search";
import { GROUP_OPTIONS, matchesChatSearch, type ChatGrouping } from "./grouping";
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
import { useChatStreamOptional } from "@/features/chat/lib/chat-stream-store";
import { useChatActivities } from "@/features/chat/lib/chat-activity";
import { useGeneratingChatIds } from "@/features/chat/lib/generating-chats";
import { ScrollArea } from "@/components/ui/scroll";
import { dispositionForShelf, moveChatsToShelf, SHELF_ACTIONS, type DropShelf } from "./drag";
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

const GROUP_KEY = "bettershape-sidebar-chat-grouping";
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

/** Keep menu and row labels consistent without coupling them to shelf state. */
function chatLabels(chat: Conversation, projectPath: string | null | undefined) {
    return { title: chat.title?.trim() || "Untitled", path: chat.project_path || projectPath || "" };
}

/** Render project sessions with shared lifecycle, keyboard and selection ownership. */
export function ChatList({
    onNewChat,
}: {
    onNewChat: () => void;
    /** @deprecated unified Sessions list — ignored */
    listKind?: "chat";
}) {
    const viewedChatId = useChatStreamOptional().viewedConversationId;
    const { project_path } = useProjectState();
    const [chats, setChats] = useState<Conversation[]>([]);
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchText, setSearchText] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const composing = useRef(false);
    const searchInput = useRef<HTMLInputElement>(null);
    const [grouping, setGrouping] = useState<ChatGrouping>("none");
    const [sort, setSort] = useState<ChatSort>("recent");
    const [filter, setFilter] = useState<ChatFilter>("all");
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [activeId, setActiveId] = useState<string | null>(viewedChatId);
    const [collapsed, setCollapsed] = useState<ReadonlySet<ChatShelfId>>(() => new Set());
    const [collectionDraft, setCollectionDraft] = useState<string[] | null>(null);

    const dispositions = useSyncExternalStore(subscribeChatDispositions, getChatDispositions, getChatDispositionsServer);
    const pinnedIds = useSyncExternalStore(subscribePinnedChats, getPinnedChatIds, getPinnedChatIdsServer);
    const unreadIds = useSyncExternalStore(subscribeUnreadChats, getUnreadChatIds, getUnreadChatIdsServer);
    const colors = useSyncExternalStore(subscribeChatColors, getChatColors, getChatColorsServer);
    const collections = useSyncExternalStore(subscribeCollections, getCollections, getCollectionsServer);
    const generatingIds = useGeneratingChatIds();
    const activities = useChatActivities();
    // Same store, different projection: a chat inside a live archive or delete
    // entry is off screen until the entry is undone or swept.
    const hiddenIds = useSyncExternalStore(
        subscribeChatUndo,
        pendingRemovalChatIds,
        pendingRemovalChatIdsServer,
    );
    const allSubagents = useSyncExternalStore(subscribeSubagents, getSubagents, getSubagents);

    const hydrated = useIsMounted();
    const [restoredPreferences, setRestoredPreferences] = useState(false);
    if (hydrated && !restoredPreferences) {
        setRestoredPreferences(true);
        setSort(loadSort());
        try {
            const stored = window.localStorage.getItem(GROUP_KEY);
            if (stored === "collection" || stored === "project") setGrouping(stored);
        } catch { /* Use the default when storage is unavailable. */ }

    }

    useEffect(() => { if (searchOpen) searchInput.current?.focus(); }, [searchOpen]);

    /** Accept known grouping modes and retain the in-session choice even when persistence is unavailable. */
    const persistGrouping = (value: string) => {
        if (value !== "none" && value !== "collection" && value !== "project") return;
        setGrouping(value);
        try { window.localStorage.setItem(GROUP_KEY, value); } catch { /* Session-local fallback. */ }
    };

    useEffect(() => {
        let unlisten: (() => void) | undefined;
        let cancelled = false;
        listen("agent-subagent", (event) => {
            applySubagentEvent((event.payload ?? {}) as Parameters<typeof applySubagentEvent>[0]);
        }).then((fn) => {
            if (cancelled) fn();
            else unlisten = fn;
        }).catch(() => {
            if (!cancelled) notify.error("Could not receive subagent updates", "Reload the app to retry.");
        });
        return () => { cancelled = true; unlisten?.(); };
    }, []);

    const persistSort = useCallback((next: ChatSort) => {
        setSort(next);
        try {
            window.localStorage.setItem(SORT_KEY, next);
        } catch {
            /* ignore */
        }
    }, []);

    const chatsVersion = useRef(0);
    const refreshFailed = useRef(false);
    const [listOwner, setListOwner] = useState(project_path);
    if (listOwner !== project_path) {
        setListOwner(project_path);
        setChats([]);
        setSelectedIds([]);
    }
    const loadChats = useCallback(() => {
        const version = ++chatsVersion.current;
        if (!project_path) return Promise.resolve();
        return commands.getConversations(project_path).then(next => {
            if (version !== chatsVersion.current) return;
            setChats(next);
            if (refreshFailed.current) {
                refreshFailed.current = false;
                notify.success("Chats refreshed");
            }
        }).catch(() => {
            if (version !== chatsVersion.current) return;
            refreshFailed.current = true;
            notify.error("Could not refresh chats", "Showing the last loaded chats. Try again.");
        });
    }, [project_path]);

    useEffect(() => {
        void loadChats();
        /** Reload chats through the version-fenced loader when a conversation event invalidates the list. */
        const onRefresh = () => { loadChats(); };
        window.addEventListener("bettershape-chat-refresh", onRefresh);
        window.addEventListener("bettershape-chats-changed", onRefresh);
        window.addEventListener("bettershape-chat-active", onRefresh);
        return () => {
            chatsVersion.current += 1;
            refreshFailed.current = false;
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

    const [viewScope, setViewScope] = useState(viewedChatId);
    if (viewScope !== viewedChatId) {
        setViewScope(viewedChatId);
        setActiveId(viewedChatId);
    }

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
            if (ids.length === 0) return;
            if (pinned) {
                moveChatsToShelf(ids, "pinned", nameOf(ids));
                return;
            }
            const previous = new Map(ids.map((id) => [id, getPinnedChatIds().has(id)]));
            for (const id of ids) setChatPinned(id, pinned);
            pushChatUndo({
                kind: "pin",
                chatId: ids[0],
                chatIds: ids,
                label: `Unpinned ${nameOf(ids)}`,
                revert: () => {
                    for (const [id, wasPinned] of previous) setChatPinned(id, wasPinned);
                },
            });
        },
        [nameOf],
    );

    const removeFromList = useCallback(
        (ids: readonly string[], kind: "archive" | "delete") => {
            const targets = [...new Set(ids)].filter((id) => !pendingRemovalChatIds().has(id));
            if (targets.length === 0) return;
            // Both operations wait for undo to expire. Keep every row hidden until
            // persistence has finished; successful rows are removed before reloading.
            pushChatUndo({
                kind,
                chatId: targets[0],
                chatIds: targets,
                label: `${kind === "archive" ? "Archived" : "Deleted"} ${nameOf(targets)}`,
                commit: async () => {
                    await Promise.all(targets.map(async (id) => {
                        try {
                            if (kind === "archive") await commands.setConversationArchived(id, true);
                            else await commands.deleteConversation(id);
                            setChats((previous) => previous.filter((chat) => chat.id !== id));
                            window.dispatchEvent(new CustomEvent("bettershape-chat-close-tab", { detail: { id } }));
                        } catch (error) {
                            notify.error(error instanceof Error ? error.message : `Could not ${kind} session`);
                        }
                    }));
                    refresh();
                },
            });
        },
        [nameOf, refresh],
    );
    const archiveChats = useCallback((ids: readonly string[]) => removeFromList(ids, "archive"), [removeFromList]);
    const removeChats = useCallback((ids: readonly string[]) => removeFromList(ids, "delete"), [removeFromList]);

    const changeDisposition = useCallback((ids: readonly string[], state: ChatDisposition["state"]) => {
        if (ids.length === 0) return;
        const dispositions = getChatDispositions();
        const previous = new Map(ids.map((id) => [id, dispositions[id]]));
        const value = dispositionForShelf(state);
        const action = SHELF_ACTIONS[state];
        for (const id of ids) setChatDisposition(id, value);
        pushChatUndo({
            kind: action.kind,
            chatId: ids[0], chatIds: ids,
            label: `${action.past} ${nameOf(ids)}`,
            revert: () => { for (const [id, old] of previous) setChatDisposition(id, old); },
        });
    }, [nameOf]);

    const handlers = useMemo<ChatLifecycleHandlers>(
        () => ({
            open: openChat,
            setDisposition: changeDisposition,
            setPinned: pinChats,
            markUnread: markChatUnread,
            copyTitle: (title) => {
                navigator.clipboard.writeText(title).catch(() => notify.error("Could not copy session title"));
            },
            revealFolder: (path) => {
                commands.revealPath(path).catch(() => notify.error("Could not reveal project folder"));
            },
            archive: archiveChats,
            remove: removeChats,
            addToCollection: (ids) => setCollectionDraft([...ids]),
        }),
        [openChat, pinChats, archiveChats, removeChats, changeDisposition],
    );

    useEffect(() => {
        /** Consume primary-modifier undo only when a sidebar action is pending and text editing does not own the key. */
        const onKey = (event: KeyboardEvent) => {
            if (!isSidebarShortcut(event) || event.key.toLowerCase() !== "z") return;
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
        return live.filter((chat) => {
            if (filter === "pinned" && !pinnedIds.has(chat.id)) return false;
            if (filter === "unread" && !unreadIds.has(chat.id)) return false;
            const collection = collections.find((entry) => entry.chatIds.includes(chat.id));
            return matchesChatSearch(chat, searchQuery, collection?.name);
        });
    }, [live, filter, pinnedIds, unreadIds, collections, searchQuery]);

    const visibleSelection = useMemo(() => {
        const visible = new Set(filtered.filter(chat => !hiddenIds.has(chat.id)).map(chat => chat.id));
        return selectedIds.filter(id => visible.has(id));
    }, [filtered, hiddenIds, selectedIds]);
    // Counts, lifecycle actions and collection assignment share one selection.
    // Prune during render so no committed menu can target a filtered-out chat.
    if (visibleSelection.length !== selectedIds.length) setSelectedIds(visibleSelection);

    const sections = useMemo(
        () =>
            buildShelves({
                chats: filtered,
                sort,
                pinned: pinnedIds,
                generating: generatingIds,
                activeId,
                hidden: hiddenIds,
                dispositions,
                grouping,
                collections,
            }),
        [filtered, sort, pinnedIds, generatingIds, activeId, hiddenIds, dispositions, grouping, collections],
    );

    useEffect(() => {
        /** Open a numbered visible chat without stealing IME input or shortcuts from text-editing surfaces. */
        const jump = (event: KeyboardEvent) => {
            if (!isSidebarShortcut(event) || !/^[1-9]$/.test(event.key)) return;
            const chats = sections.filter((section) => !collapsed.has(section.id)).flatMap((section) => section.chats);
            const chat = chats[Number(event.key) - 1];
            if (!chat) return;
            event.preventDefault();
            event.stopPropagation();
            openChat(chat.id);
        };
        window.addEventListener("keydown", jump);
        return () => window.removeEventListener("keydown", jump);
    }, [sections, collapsed, openChat]);

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

    /** Read stored disposition without interpreting ordinary viewing as an explicit Resume. */
    const dispositionOf = useCallback((id: string) =>
        dispositions[id]?.state ?? (id === activeId ? "active" : "settled"), [dispositions, activeId]);

    const selectedTargets = useMemo<ChatLifecycleTarget[]>(
        () =>
            filtered
                .filter((chat) => selectedIds.includes(chat.id))
                .map((chat) => ({
                    id: chat.id,
                    ...chatLabels(chat, project_path),
                    pinned: pinnedIds.has(chat.id),
                    disposition: dispositionOf(chat.id),
                })),
        [filtered, selectedIds, pinnedIds, project_path, dispositionOf],
    );

    const collectionOf = useCallback(
        (chatId: string) => collections.find((entry) => entry.chatIds.includes(chatId))?.name ?? null,
        [collections],
    );

    const rowProps = useCallback(
        (chat: Conversation) => ({
            activity: activities.get(chat.id) ?? (generatingIds.has(chat.id) ? "working" as const : "ready" as const),
            disposition: dispositionOf(chat.id),
            ...chatLabels(chat, project_path),
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
            activities,
            generatingIds,
            dispositionOf,
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

    const moveChat = useCallback((id: string, shelf: DropShelf) => {
        const ids = selectedIds.includes(id) ? selectedTargets.map((target) => target.id) : [id];
        // Filter each selected row, not only the dragged row: mixed selections may
        // still move other rows without renewing an already-snoozed destination.
        const movableIds = new Set(sections.flatMap(section => section.id === shelf ? [] : section.chats.map(chat => chat.id)));
        const targets = ids.filter((id) => movableIds.has(id));
        if (targets.length) moveChatsToShelf(targets, shelf, nameOf(targets));
    }, [sections, nameOf, selectedIds, selectedTargets]);

    /** Close search and clear both visible/composed text and the committed filter query. */
    const closeSearch = () => {
        setSearchOpen(false);
        setSearchText("");
        setSearchQuery("");
        composing.current = false;
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

    /** Open only the first visible matching result; empty queries and collapsed shelves are not commands. */
    const openSearchResult = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (!searchQuery.trim()) return;
        const first = sections.find(section => !collapsed.has(section.id))?.chats[0];
        if (!first) return;
        event.preventDefault();
        openChat(first.id);
    };

    /** Keep composition input separate from search navigation and dismissal. */
    const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (composing.current || isComposingKey(event.nativeEvent)) return;
        switch (event.key) {
            case "Escape": event.preventDefault(); closeSearch(); break;
            case "Enter": openSearchResult(event); break;
            default: break; // Ordinary text keys remain owned by the input.
        }
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between pl-3 pr-1 pb-1 pt-3">
                <span className="text-sm font-medium text-text-muted">Sessions</span>
                <div className="flex items-center">
                    <HeaderIconBtn label="Search" active={searchOpen} onClick={() => { if (searchOpen) closeSearch(); else setSearchOpen(true); }}>
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
                            <DropdownMenuLabel>Group by</DropdownMenuLabel>
                            <DropdownMenuRadioGroup value={grouping} onValueChange={persistGrouping}>
                                {GROUP_OPTIONS.map((option) => (
                                    <DropdownMenuRadioItem key={option.value} value={option.value}>{option.label}</DropdownMenuRadioItem>
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

            {searchOpen ? (
                <div className="px-3 pb-1">
                    <SearchInput
                        ref={searchInput}
                        value={searchText}
                        aria-label="Search sessions"
                        placeholder="Search sessions"
                        onChange={(event) => {
                            setSearchText(event.target.value);
                            if (!composing.current) setSearchQuery(event.target.value);
                        }}
                        onCompositionStart={() => { composing.current = true; }}
                        onCompositionEnd={(event) => {
                            composing.current = false;
                            setSearchText(event.currentTarget.value);
                            setSearchQuery(event.currentTarget.value);
                        }}
                        onKeyDown={onSearchKeyDown}
                    />
                </div>
            ) : null}

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
                ) : filtered.length === 0 && searchQuery.trim() ? (
                    <p role="status" className="px-2.5 py-2 text-sm text-text-muted">No matching sessions</p>
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
                        onMoveChat={moveChat}
                        grouping={grouping}
                        collections={collections}
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
