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

import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
import { useViewedConversationId } from "@/features/chat/lib/chat-stream-store";
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
                    "transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-primary",
                    active && "bg-[var(--btn-open)] hover:bg-[var(--btn-open-hover)] text-text-primary",
                )}
            >
                {children}
            </button>
        </Tooltip>
    );
}

/** The drain bar under the undo card. Keyed per entry so it restarts each time. */
const UndoCountdown = () => {
    const [draining, setDraining] = useState(false);
    useEffect(() => {
        let inner = 0;
        const outer = window.requestAnimationFrame(() => {
            inner = window.requestAnimationFrame(() => setDraining(true));
        });
        return () => {
            window.cancelAnimationFrame(outer);
            if (inner) window.cancelAnimationFrame(inner);
        };
    }, []);
    return (
        <span
            aria-hidden
            className={cn(
                "pointer-events-none absolute inset-x-0 bottom-0 h-[2px] origin-left bg-accent/80",
                "transition-transform ease-linear",
                draining ? "scale-x-0" : "scale-x-100",
            )}
            style={{ transitionDuration: `${CHAT_UNDO_WINDOW_MS}ms` }}
        />
    );
};

/** Renders the UndoBar UI component. */
const UndoBar = () => {
    const entry = useChatUndo();
    if (!entry) return null;
    return (
        <div
            data-chat-undo={entry.kind}
            role="status"
            aria-live="polite"
            className="relative mx-2 mb-1.5 flex items-center gap-2 overflow-hidden rounded-xl border border-border-secondary bg-surface-3 px-2.5 py-2 shadow-md"
        >
            <span className="min-w-0 flex-1 break-words line-clamp-2 text-xs font-medium leading-[17px] text-text-primary">
                {entry.label}
            </span>
            <button
                type="button"
                onClick={() => undoChat()}
                className="inline-flex min-h-[24px] shrink-0 items-center gap-1 rounded-md border border-border-subtle bg-surface-2 px-2 py-0.5 text-xs font-medium text-text-primary transition-[background-color,color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] active:scale-[0.97] motion-reduce:transform-none motion-reduce:transition-none"
            >
                <Icon icon={ArrowUndo20Regular} className="size-3.5" />
                Undo
            </button>
            <button
                type="button"
                aria-label="Dismiss undo"
                onClick={() => dismissChatUndo()}
                className="flex size-[24px] shrink-0 items-center justify-center rounded-md text-text-muted transition-[background-color,color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-primary active:scale-[0.95] motion-reduce:transform-none motion-reduce:transition-none"
            >
                <Icon icon={Dismiss20Regular} className="size-3.5" />
            </button>
            <UndoCountdown key={entry.id} />
        </div>
    );
};

/** Keep menu and row labels consistent without coupling them to shelf state. */
function chatLabels(chat: Conversation, projectPath: string | null | undefined) {
    return { title: chat.title?.trim() || "Untitled", path: chat.project_path || projectPath || "" };
}

const CHAT_SELECTION_PRIMITIVES = {
    Item: (props: { onClick?: () => void; className?: string; children?: ReactNode }) => (
        <DropdownMenuItem {...props} />
    ),
    Separator: () => <DropdownMenuSeparator />,
};

/** Reads persisted chat grouping (`collection` or `project`) from `localStorage`. */
const loadStoredGrouping = (): ChatGrouping | undefined => {
    try {
        const stored = window.localStorage.getItem(GROUP_KEY);
        return stored === "collection" || stored === "project" ? stored : undefined;
    } catch {
        return undefined;
    }
};

/** Subscribes subagent events, active-chat sync, unread tracking, and sidebar keyboard shortcuts. */
const useChatListEventBindings = ({
    activeId,
    setActiveId,
    sections,
    collapsed,
    openChat,
}: {
    activeId: string | null;
    setActiveId: React.Dispatch<React.SetStateAction<string | null>>;
    sections: ReturnType<typeof buildShelves>;
    collapsed: ReadonlySet<ChatShelfId>;
    openChat: (id: string) => void;
}) => {
    useEffect(() => {
        let unlisten: (() => void) | undefined;
        let cancelled = false;
        listen("agent-subagent", (event) => {
            applySubagentEvent((event.payload ?? {}) as Parameters<typeof applySubagentEvent>[0]);
        })
            .then((fn) => {
                if (cancelled) fn();
                else unlisten = fn;
            })
            .catch(() => {
                if (!cancelled) notify.error("Could not receive subagent updates", "Reload the app to retry.");
            });
        return () => {
            cancelled = true;
            unlisten?.();
        };
    }, []);

    useEffect(() => {
        /** Syncs the highlighted session row and clears its unread badge when opened. */
        const onActive = (e: Event) => {
            const id = (e as CustomEvent<{ id?: string } | null>).detail?.id;
            const next = id && id !== NEW_CHAT_TAB_ID ? id : null;
            setActiveId(next);
            if (next) clearChatUnread(next);
        };
        window.addEventListener("bettershape-chat-active", onActive as EventListener);
        return () => window.removeEventListener("bettershape-chat-active", onActive as EventListener);
    }, [setActiveId]);

    useEffect(() => {
        /** Marks background sessions unread when a streaming turn completes off-screen. */
        const onGenerating = (event: Event) => {
            const detail = (event as CustomEvent<{ id?: string; generating?: boolean } | null>).detail;
            if (detail?.id && !detail.generating && detail.id !== activeId) markChatUnread(detail.id);
        };
        window.addEventListener("bettershape-chat-generating", onGenerating as EventListener);
        return () => window.removeEventListener("bettershape-chat-generating", onGenerating as EventListener);
    }, [activeId]);

    useEffect(() => {
        /** Consumes primary-modifier undo when a sidebar action is pending. */
        const onKey = (event: KeyboardEvent) => {
            if (!isSidebarShortcut(event) || event.key.toLowerCase() !== "z") return;
            if (!undoChat()) return;
            event.preventDefault();
            event.stopPropagation();
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, []);

    useEffect(() => {
        /** Opens numbered visible chats (`Mod+1..9`) outside editable surfaces. */
        const jump = (event: KeyboardEvent) => {
            if (!isSidebarShortcut(event) || !/^[1-9]$/.test(event.key)) return;
            const visibleChats = sections
                .filter((section) => !collapsed.has(section.id))
                .flatMap((section) => section.chats);
            const chat = visibleChats.at(Number(event.key) - 1);
            if (!chat) return;
            event.preventDefault();
            event.stopPropagation();
            openChat(chat.id);
        };
        window.addEventListener("keydown", jump);
        return () => window.removeEventListener("keydown", jump);
    }, [sections, collapsed, openChat]);
};

/** Loads project conversations with version fencing and refreshes on conversation lifecycle events. */
const useProjectConversationsLoader = (
    projectPath: string | null,
    setChats: React.Dispatch<React.SetStateAction<Conversation[]>>,
) => {
    const chatsVersion = useRef(0);
    const refreshFailed = useRef(false);
    const loadedProject = useRef(projectPath);

    useLayoutEffect(() => {
        if (loadedProject.current === projectPath) return;
        loadedProject.current = projectPath;
        chatsVersion.current += 1;
    }, [projectPath]);

    const loadChats = useCallback(() => {
        const version = ++chatsVersion.current;
        if (!projectPath) return Promise.resolve();
        return commands
            .getConversations(projectPath)
            .then((next) => {
                if (version !== chatsVersion.current) return;
                setChats(next);
                if (refreshFailed.current) {
                    refreshFailed.current = false;
                    notify.success("Chats refreshed");
                }
            })
            .catch(() => {
                if (version !== chatsVersion.current) return;
                refreshFailed.current = true;
                notify.error("Could not refresh chats", "Showing the last loaded chats. Try again.");
            });
    }, [projectPath, setChats]);

    useEffect(() => {
        loadChats().catch(() => undefined);
        /** Reloads chats through the version-fenced loader when conversation events fire. */
        const onRefresh = () => {
            loadChats().catch(() => undefined);
        };
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
};

/** Renders a labeled radio group section inside `SessionsFilterDropdown`. */
const FilterMenuRadioSection = <T extends string>({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: T;
    options: ReadonlyArray<{ value: T; label: string }>;
    onChange: (next: T) => void;
}) => (
    <>
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(next as T)}>
            {options.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                    {option.label}
                </DropdownMenuRadioItem>
            ))}
        </DropdownMenuRadioGroup>
    </>
);

/** Renders the Filter/Group/Sort dropdown menu in `ChatListHeaderToolbar`. */
const SessionsFilterDropdown = ({
    filter,
    onFilterChange,
    grouping,
    onGroupingChange,
    sort,
    onSortChange,
}: {
    filter: ChatFilter;
    onFilterChange: (next: ChatFilter) => void;
    grouping: ChatGrouping;
    onGroupingChange: (value: string) => void;
    sort: ChatSort;
    onSortChange: (next: ChatSort) => void;
}) => (
    <DropdownMenu modal={false}>
        <Tooltip content="Filter" side="bottom" delayDuration={80}>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label="Filter"
                    className="flex size-7 items-center justify-center rounded-md text-text-muted transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-primary data-[state=open]:bg-[var(--btn-open)] data-[state=open]:hover:bg-[var(--btn-open-hover)] data-[state=open]:text-text-primary"
                >
                    <Icon icon={Filter20Regular} />
                </button>
            </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent align="end" className="min-w-40">
            <FilterMenuRadioSection label="Show" value={filter} options={FILTER_OPTIONS} onChange={onFilterChange} />
            <DropdownMenuSeparator />
            <FilterMenuRadioSection label="Group by" value={grouping} options={GROUP_OPTIONS} onChange={onGroupingChange} />
            <DropdownMenuSeparator />
            <FilterMenuRadioSection label="Sort" value={sort} options={SORT_OPTIONS} onChange={onSortChange} />
        </DropdownMenuContent>
    </DropdownMenu>
);

/** Renders the multi-select and section-collapse actions menu in `ChatListHeaderToolbar`. */
const SessionsActionsDropdown = ({
    selectedIds,
    selectedTargets,
    handlers,
    onOpenCollectionDraft,
    onClearSelection,
    hasMultipleSections,
    allCollapsed,
    onToggleAllCollapsed,
    onNewChat,
}: {
    selectedIds: string[];
    selectedTargets: ChatLifecycleTarget[];
    handlers: ChatLifecycleHandlers;
    onOpenCollectionDraft: () => void;
    onClearSelection: () => void;
    hasMultipleSections: boolean;
    allCollapsed: boolean;
    onToggleAllCollapsed: () => void;
    onNewChat: () => void;
}) => (
    <DropdownMenu modal={false}>
        <Tooltip content="Sessions actions" side="bottom" delayDuration={80}>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label="Sessions actions"
                    className="flex size-7 items-center justify-center rounded-md text-text-muted transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-primary data-[state=open]:bg-[var(--btn-open)] data-[state=open]:hover:bg-[var(--btn-open-hover)] data-[state=open]:text-text-primary"
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
                        CHAT_SELECTION_PRIMITIVES,
                    )}
                    <DropdownMenuItem onClick={onOpenCollectionDraft}>
                        <Icon icon={Collections20Regular} />
                        Add to collection
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                </>
            ) : null}
            <DropdownMenuItem disabled={selectedIds.length === 0} onClick={onClearSelection}>
                Clear selection
            </DropdownMenuItem>
            {hasMultipleSections ? (
                <DropdownMenuItem onClick={onToggleAllCollapsed}>
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
);

/** Renders the Sessions header toolbar (`Search`, `Filter`, `Sessions actions`, and `New chat`). */
const ChatListHeaderToolbar = ({
    searchOpen,
    onToggleSearch,
    filter,
    onFilterChange,
    grouping,
    onGroupingChange,
    sort,
    onSortChange,
    selectedIds,
    selectedTargets,
    handlers,
    onOpenCollectionDraft,
    onClearSelection,
    hasMultipleSections,
    allCollapsed,
    onToggleAllCollapsed,
    onNewChat,
}: {
    searchOpen: boolean;
    onToggleSearch: () => void;
    filter: ChatFilter;
    onFilterChange: (next: ChatFilter) => void;
    grouping: ChatGrouping;
    onGroupingChange: (value: string) => void;
    sort: ChatSort;
    onSortChange: (next: ChatSort) => void;
    selectedIds: string[];
    selectedTargets: ChatLifecycleTarget[];
    handlers: ChatLifecycleHandlers;
    onOpenCollectionDraft: () => void;
    onClearSelection: () => void;
    hasMultipleSections: boolean;
    allCollapsed: boolean;
    onToggleAllCollapsed: () => void;
    onNewChat: () => void;
}) => (
    <div className="flex items-center justify-between pl-3 pr-1 pb-1 pt-3">
        <span className="text-sm font-medium text-text-muted">Sessions</span>
        <div className="flex items-center">
            <HeaderIconBtn label="Search" active={searchOpen} onClick={onToggleSearch}>
                <Icon icon={Search20Regular} />
            </HeaderIconBtn>
            <SessionsFilterDropdown
                filter={filter}
                onFilterChange={onFilterChange}
                grouping={grouping}
                onGroupingChange={onGroupingChange}
                sort={sort}
                onSortChange={onSortChange}
            />
            <SessionsActionsDropdown
                selectedIds={selectedIds}
                selectedTargets={selectedTargets}
                handlers={handlers}
                onOpenCollectionDraft={onOpenCollectionDraft}
                onClearSelection={onClearSelection}
                hasMultipleSections={hasMultipleSections}
                allCollapsed={allCollapsed}
                onToggleAllCollapsed={onToggleAllCollapsed}
                onNewChat={onNewChat}
            />
            <HeaderIconBtn label="New chat" onClick={onNewChat}>
                <Icon icon={Compose20Regular} />
            </HeaderIconBtn>
        </div>
    </div>
);

/** Renders the scrollable body of the Sessions sidebar (empty project, empty search, empty list, or shelves). */
const ChatListViewportBody = ({
    projectPath,
    filteredCount,
    searchQuery,
    onNewChat,
    sections,
    rowProps,
    collapsed,
    onToggleShelf,
    onMoveChat,
    grouping,
    collections,
}: {
    projectPath: string | null;
    filteredCount: number;
    searchQuery: string;
    onNewChat: () => void;
    sections: ReturnType<typeof buildShelves>;
    rowProps: (chat: Conversation) => React.ComponentProps<typeof ChatShelves>["rowProps"] extends (c: Conversation) => infer R ? R : never;
    collapsed: ReadonlySet<ChatShelfId>;
    onToggleShelf: (shelf: ChatShelfId) => void;
    onMoveChat: (id: string, shelf: DropShelf) => void;
    grouping: ChatGrouping;
    collections: ReturnType<typeof getCollections>;
}) => {
    if (!projectPath) {
        return (
            <button
                type="button"
                onClick={() => window.dispatchEvent(new Event("bettershape-new-project"))}
                className="mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-text-muted transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--row-hover)] hover:text-text-secondary"
            >
                <Icon icon={FolderOpen20Regular} />
                New project
            </button>
        );
    }
    if (filteredCount === 0 && searchQuery.trim()) {
        return <p role="status" className="px-2.5 py-2 text-sm text-text-muted">No matching sessions</p>;
    }
    if (filteredCount === 0) {
        return (
            <button
                type="button"
                onClick={onNewChat}
                className="mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-text-muted transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--row-hover)] hover:text-text-secondary"
            >
                <Icon icon={Compose20Regular} className="shrink-0" />
                <span>New chat</span>
            </button>
        );
    }
    return (
        <ChatShelves
            sections={sections}
            rowProps={rowProps}
            collapsed={collapsed}
            onToggleShelf={onToggleShelf}
            onMoveChat={onMoveChat}
            grouping={grouping}
            collections={collections}
        />
    );
};

/** Executes archive or delete persistence for a batch of chat IDs after undo expiry. */
const commitChatListRemoval = async (
    targets: readonly string[],
    kind: "archive" | "delete",
    setChats: React.Dispatch<React.SetStateAction<Conversation[]>>,
    refresh: () => void,
) => {
    await Promise.all(
        targets.map(async (id) => {
            try {
                if (kind === "archive") await commands.setConversationArchived(id, true);
                else await commands.deleteConversation(id);
                setChats((previous) => previous.filter((chat) => chat.id !== id));
                window.dispatchEvent(new CustomEvent("bettershape-chat-close-tab", { detail: { id } }));
            } catch (error) {
                notify.error(error instanceof Error ? error.message : `Could not ${kind} session`);
            }
        }),
    );
    refresh();
};

/** Builds lifecycle callbacks (`pinChats`, `handlers`, `moveChat`) for `ChatList`. */
const useChatListLifecycle = ({
    chats,
    sections,
    selectedIds,
    selectedTargets,
    openChat,
    setChats,
    setCollectionDraft,
}: {
    chats: Conversation[];
    sections: ReturnType<typeof buildShelves>;
    selectedIds: string[];
    selectedTargets: ChatLifecycleTarget[];
    openChat: (id: string) => void;
    setChats: React.Dispatch<React.SetStateAction<Conversation[]>>;
    setCollectionDraft: React.Dispatch<React.SetStateAction<string[] | null>>;
}) => {
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
            pushChatUndo({
                kind,
                chatId: targets[0],
                chatIds: targets,
                label: `${kind === "archive" ? "Archived" : "Deleted"} ${nameOf(targets)}`,
                commit: () => commitChatListRemoval(targets, kind, setChats, refresh),
            });
        },
        [nameOf, refresh, setChats],
    );

    const changeDisposition = useCallback(
        (ids: readonly string[], state: ChatDisposition["state"]) => {
            if (ids.length === 0) return;
            const current = getChatDispositions();
            const previous = new Map(ids.map((id) => [id, current[id]]));
            const value = dispositionForShelf(state);
            const action = SHELF_ACTIONS[state];
            for (const id of ids) setChatDisposition(id, value);
            pushChatUndo({
                kind: action.kind,
                chatId: ids[0],
                chatIds: ids,
                label: `${action.past} ${nameOf(ids)}`,
                revert: () => {
                    for (const [id, old] of previous) setChatDisposition(id, old);
                },
            });
        },
        [nameOf],
    );

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
            archive: (ids) => removeFromList(ids, "archive"),
            remove: (ids) => removeFromList(ids, "delete"),
            addToCollection: (ids) => setCollectionDraft([...ids]),
        }),
        [changeDisposition, openChat, pinChats, removeFromList, setCollectionDraft],
    );

    const moveChat = useCallback(
        (id: string, shelf: DropShelf) => {
            const ids = selectedIds.includes(id) ? selectedTargets.map((target) => target.id) : [id];
            const movableIds = new Set(
                sections.flatMap((section) =>
                    section.id === shelf ? [] : section.chats.map((chat) => chat.id),
                ),
            );
            const targets = ids.filter((item) => movableIds.has(item));
            if (targets.length) moveChatsToShelf(targets, shelf, nameOf(targets));
        },
        [nameOf, sections, selectedIds, selectedTargets],
    );

    return { pinChats, handlers, moveChat };
};

/** Subscribes external sidebar stores (`dispositions`, `pinned`, `unread`, `colors`, `collections`, `undo`, `subagents`). */
const useChatListExternalStores = () => ({
    dispositions: useSyncExternalStore(subscribeChatDispositions, getChatDispositions, getChatDispositionsServer),
    pinnedIds: useSyncExternalStore(subscribePinnedChats, getPinnedChatIds, getPinnedChatIdsServer),
    unreadIds: useSyncExternalStore(subscribeUnreadChats, getUnreadChatIds, getUnreadChatIdsServer),
    colors: useSyncExternalStore(subscribeChatColors, getChatColors, getChatColorsServer),
    collections: useSyncExternalStore(subscribeCollections, getCollections, getCollectionsServer),
    generatingIds: useGeneratingChatIds(),
    activities: useChatActivities(),
    hiddenIds: useSyncExternalStore(subscribeChatUndo, pendingRemovalChatIds, pendingRemovalChatIdsServer),
    allSubagents: useSyncExternalStore(subscribeSubagents, getSubagents, getSubagents),
});

/** Syncs render-scoped `project_path` and `viewedChatId` transitions for `ChatList`. */
const useChatListScopedState = (
    projectPath: string | null,
    viewedChatId: string | null,
    setChats: React.Dispatch<React.SetStateAction<Conversation[]>>,
    setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>,
) => {
    const [activeId, setActiveId] = useState<string | null>(viewedChatId);
    const [listOwner, setListOwner] = useState(projectPath);
    if (listOwner !== projectPath) {
        setListOwner(projectPath);
        setChats([]);
        setSelectedIds([]);
    }
    const [viewScope, setViewScope] = useState(viewedChatId);
    if (viewScope !== viewedChatId) {
        setViewScope(viewedChatId);
        setActiveId(viewedChatId);
    }
    return [activeId, setActiveId] as const;
};

/** Manages grouping, sort, filter, and search bar state for `ChatList`. */
const useChatListPreferences = () => {
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchText, setSearchText] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const composing = useRef(false);
    const searchInput = useRef<HTMLInputElement>(null);
    const [grouping, setGrouping] = useState<ChatGrouping>("none");
    const [sort, setSort] = useState<ChatSort>("recent");
    const [filter, setFilter] = useState<ChatFilter>("all");

    const hydrated = useIsMounted();
    const [restoredPreferences, setRestoredPreferences] = useState(false);
    if (hydrated && !restoredPreferences) {
        setRestoredPreferences(true);
        setSort(loadSort());
        const storedGrouping = loadStoredGrouping();
        if (storedGrouping) setGrouping(storedGrouping);
    }

    useEffect(() => {
        if (searchOpen) searchInput.current?.focus();
    }, [searchOpen]);

    const persistGrouping = useCallback((value: string) => {
        if (value !== "none" && value !== "collection" && value !== "project") return;
        setGrouping(value);
        try {
            window.localStorage.setItem(GROUP_KEY, value);
        } catch {
            /* Session-local fallback. */
        }
    }, []);

    const persistSort = useCallback((next: ChatSort) => {
        setSort(next);
        try {
            window.localStorage.setItem(SORT_KEY, next);
        } catch {
            /* ignore */
        }
    }, []);

    const closeSearch = useCallback(() => {
        setSearchOpen(false);
        setSearchText("");
        setSearchQuery("");
        composing.current = false;
    }, []);

    return {
        searchOpen,
        setSearchOpen,
        searchText,
        setSearchText,
        searchQuery,
        setSearchQuery,
        composing,
        searchInput,
        grouping,
        persistGrouping,
        sort,
        persistSort,
        filter,
        setFilter,
        closeSearch,
    };
};

/** Finds the first visible conversation across expanded shelves for Enter-to-open search navigation. */
const firstVisibleSearchMatch = (
    searchQuery: string,
    sections: ReturnType<typeof buildShelves>,
    collapsed: ReadonlySet<ChatShelfId>,
) => {
    if (!searchQuery.trim()) return undefined;
    return sections.find((section) => !collapsed.has(section.id))?.chats.at(0);
};

/** Opens the first visible matching chat when pressing Enter in Sessions search. */
const openFirstSearchMatchOnEnter = (
    event: React.KeyboardEvent<HTMLInputElement>,
    searchQuery: string,
    sections: ReturnType<typeof buildShelves>,
    collapsed: ReadonlySet<ChatShelfId>,
    openChat: (id: string) => void,
) => {
    const first = firstVisibleSearchMatch(searchQuery, sections, collapsed);
    if (!first) return;
    event.preventDefault();
    openChat(first.id);
};

/** Handles Escape dismissal and Enter navigation inside the Sessions search input. */
const handleSessionSearchKeyDown = ({
    event,
    composing,
    searchQuery,
    sections,
    collapsed,
    closeSearch,
    openChat,
}: {
    event: React.KeyboardEvent<HTMLInputElement>;
    composing: boolean;
    searchQuery: string;
    sections: ReturnType<typeof buildShelves>;
    collapsed: ReadonlySet<ChatShelfId>;
    closeSearch: () => void;
    openChat: (id: string) => void;
}) => {
    if (composing || isComposingKey(event.nativeEvent)) return;
    if (event.key === "Escape") {
        event.preventDefault();
        closeSearch();
    } else if (event.key === "Enter") {
        openFirstSearchMatchOnEnter(event, searchQuery, sections, collapsed, openChat);
    }
};

/** Checks whether a chat passes the active `pinned` / `unread` / `all` filter tab. */
const passesChatFilterTab = (
    chatId: string,
    filter: ChatFilter,
    pinnedIds: ReadonlySet<string>,
    unreadIds: ReadonlySet<string>,
): boolean => {
    if (filter === "pinned") return pinnedIds.has(chatId);
    if (filter === "unread") return unreadIds.has(chatId);
    return true;
};

/** Resolves the first matching collection name for a conversation ID. */
const findCollectionNameForChat = (
    chatId: string,
    collections: ReturnType<typeof getCollections>,
): string | null => collections.find((entry) => entry.chatIds.includes(chatId))?.name ?? null;

/** Resolves a conversation's archive/search/filter eligibility inside `useChatListProjection`. */
const isChatMatchingFilter = (
    chat: Conversation,
    filter: ChatFilter,
    pinnedIds: ReadonlySet<string>,
    unreadIds: ReadonlySet<string>,
    collections: ReturnType<typeof getCollections>,
    searchQuery: string,
): boolean => {
    if (chat.archived || !passesChatFilterTab(chat.id, filter, pinnedIds, unreadIds)) return false;
    const collectionName = findCollectionNameForChat(chat.id, collections) || undefined;
    return matchesChatSearch(chat, searchQuery, collectionName);
};

/** Derives filtered conversations, pruned selection, shelves, and row prop builders for `ChatList`. */
const useChatListProjection = ({
    chats,
    projectPath,
    activeId,
    filter,
    sort,
    grouping,
    searchQuery,
    selectedIds,
    setSelectedIds,
    stores,
}: {
    chats: Conversation[];
    projectPath: string | null;
    activeId: string | null;
    filter: ChatFilter;
    sort: ChatSort;
    grouping: ChatGrouping;
    searchQuery: string;
    selectedIds: string[];
    setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
    stores: ReturnType<typeof useChatListExternalStores>;
}) => {
    const { dispositions, pinnedIds, unreadIds, collections, generatingIds, hiddenIds } = stores;

    const filtered = useMemo(
        () =>
            chats.filter((chat) =>
                isChatMatchingFilter(chat, filter, pinnedIds, unreadIds, collections, searchQuery),
            ),
        [chats, collections, filter, pinnedIds, searchQuery, unreadIds],
    );

    const visibleSelection = useMemo(() => {
        const visible = new Set(filtered.filter((chat) => !hiddenIds.has(chat.id)).map((chat) => chat.id));
        return selectedIds.filter((id) => visible.has(id));
    }, [filtered, hiddenIds, selectedIds]);
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
        [activeId, collections, dispositions, filtered, generatingIds, grouping, hiddenIds, pinnedIds, sort],
    );

    const dispositionOf = useCallback(
        (id: string) => {
            const entry = id in dispositions ? dispositions[id] : undefined;
            return entry ? entry.state : id === activeId ? "active" : "settled";
        },
        [activeId, dispositions],
    );

    const selectedTargets = useMemo<ChatLifecycleTarget[]>(
        () =>
            filtered
                .filter((chat) => selectedIds.includes(chat.id))
                .map((chat) => ({
                    id: chat.id,
                    ...chatLabels(chat, projectPath),
                    pinned: pinnedIds.has(chat.id),
                    disposition: dispositionOf(chat.id),
                })),
        [dispositionOf, filtered, pinnedIds, projectPath, selectedIds],
    );

    return { filtered, sections, dispositionOf, selectedTargets };
};

/** Resolves activity state for a single sidebar conversation row. */
const resolveRowActivity = (
    chatId: string,
    activities: ReturnType<typeof useChatActivities>,
    generatingIds: ReadonlySet<string>,
) => activities.get(chatId) ?? (generatingIds.has(chatId) ? ("working" as const) : ("ready" as const));

/** Builds the memoized `rowProps` projector for `ChatShelves`. */
const useChatRowPropsBuilder = ({
    projectPath,
    activeId,
    selectedIds,
    stores,
    dispositionOf,
    toggleSelect,
    openChat,
    pinChats,
    handlers,
}: {
    projectPath: string | null;
    activeId: string | null;
    selectedIds: string[];
    stores: ReturnType<typeof useChatListExternalStores>;
    dispositionOf: (id: string) => ChatDisposition["state"];
    toggleSelect: (id: string) => void;
    openChat: (id: string) => void;
    pinChats: (ids: readonly string[], next: boolean) => void;
    handlers: ChatLifecycleHandlers;
}) => {
    const { activities, generatingIds, collections, pinnedIds, unreadIds, colors, allSubagents } = stores;
    return useCallback(
        (chat: Conversation) => ({
            activity: resolveRowActivity(chat.id, activities, generatingIds),
            disposition: dispositionOf(chat.id),
            ...chatLabels(chat, projectPath),
            timestamp: chat.timestamp || 0,
            collection: findCollectionNameForChat(chat.id, collections),
            active: chat.id === activeId,
            pinned: pinnedIds.has(chat.id),
            unread: unreadIds.has(chat.id),
            color: (colors as Partial<typeof colors>)[chat.id] ?? null,
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
            allSubagents,
            collections,
            colors,
            dispositionOf,
            generatingIds,
            handlers,
            openChat,
            pinChats,
            pinnedIds,
            projectPath,
            selectedIds,
            toggleSelect,
            unreadIds,
        ],
    );
};

/** Renders the collapsible search input bar beneath the Sessions header when open. */
const ChatListSearchSection = ({
    searchOpen,
    searchInputRef,
    composingRef,
    searchText,
    searchQuery,
    setSearchText,
    setSearchQuery,
    closeSearch,
    sections,
    collapsed,
    openChat,
}: {
    searchOpen: boolean;
    searchInputRef: React.RefObject<HTMLInputElement | null>;
    composingRef: React.MutableRefObject<boolean>;
    searchText: string;
    searchQuery: string;
    setSearchText: React.Dispatch<React.SetStateAction<string>>;
    setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
    closeSearch: () => void;
    sections: ReturnType<typeof buildShelves>;
    collapsed: ReadonlySet<ChatShelfId>;
    openChat: (id: string) => void;
}) => {
    if (!searchOpen) return null;
    return (
        <div className="px-3 pb-1">
            <SearchInput
                ref={searchInputRef}
                value={searchText}
                aria-label="Search sessions"
                placeholder="Search sessions"
                onChange={(event) => {
                    setSearchText(event.target.value);
                    if (!composingRef.current) setSearchQuery(event.target.value);
                }}
                onCompositionStart={() => {
                    composingRef.current = true;
                }}
                onCompositionEnd={(event) => {
                    composingRef.current = false;
                    setSearchText(event.currentTarget.value);
                    setSearchQuery(event.currentTarget.value);
                }}
                onKeyDown={(event) =>
                    handleSessionSearchKeyDown({
                        event,
                        composing: composingRef.current,
                        searchQuery,
                        sections,
                        collapsed,
                        closeSearch,
                        openChat,
                    })
                }
            />
        </div>
    );
};

/** Render project sessions with shared lifecycle, keyboard and selection ownership. */
export const ChatList = ({
    onNewChat,
}: {
    onNewChat: () => void;
    /** @deprecated unified Sessions list, ignored */
    listKind?: "chat";
}) => {
    const viewedChatId = useViewedConversationId();
    const { project_path } = useProjectState();
    const [chats, setChats] = useState<Conversation[]>([]);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [collapsed, setCollapsed] = useState<ReadonlySet<ChatShelfId>>(() => new Set());
    const [collectionDraft, setCollectionDraft] = useState<string[] | null>(null);
    const [activeId, setActiveId] = useChatListScopedState(project_path, viewedChatId, setChats, setSelectedIds);
    const stores = useChatListExternalStores();
    const prefs = useChatListPreferences();

    const openChat = useCallback((id: string) => {
        clearChatUnread(id);
        window.dispatchEvent(new CustomEvent("bettershape-chat-load", { detail: { id } }));
    }, []);

    useProjectConversationsLoader(project_path, setChats);

    const { filtered, sections, dispositionOf, selectedTargets } = useChatListProjection({
        chats,
        projectPath: project_path,
        activeId,
        filter: prefs.filter,
        sort: prefs.sort,
        grouping: prefs.grouping,
        searchQuery: prefs.searchQuery,
        selectedIds,
        setSelectedIds,
        stores,
    });

    useChatListEventBindings({ activeId, setActiveId, sections, collapsed, openChat });

    const { pinChats, handlers, moveChat } = useChatListLifecycle({
        chats,
        sections,
        selectedIds,
        selectedTargets,
        openChat,
        setChats,
        setCollectionDraft,
    });

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

    const rowProps = useChatRowPropsBuilder({
        projectPath: project_path,
        activeId,
        selectedIds,
        stores,
        dispositionOf,
        toggleSelect,
        openChat,
        pinChats,
        handlers,
    });

    const allCollapsed = sections.length > 1 && sections.every((section) => collapsed.has(section.id));

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <ChatListHeaderToolbar
                searchOpen={prefs.searchOpen}
                onToggleSearch={() => {
                    if (prefs.searchOpen) prefs.closeSearch();
                    else prefs.setSearchOpen(true);
                }}
                filter={prefs.filter}
                onFilterChange={prefs.setFilter}
                grouping={prefs.grouping}
                onGroupingChange={prefs.persistGrouping}
                sort={prefs.sort}
                onSortChange={prefs.persistSort}
                selectedIds={selectedIds}
                selectedTargets={selectedTargets}
                handlers={handlers}
                onOpenCollectionDraft={() => setCollectionDraft([...selectedIds])}
                onClearSelection={() => setSelectedIds([])}
                hasMultipleSections={sections.length > 1}
                allCollapsed={allCollapsed}
                onToggleAllCollapsed={() =>
                    setCollapsed(
                        allCollapsed
                            ? new Set<ChatShelfId>()
                            : new Set<ChatShelfId>(sections.map((section) => section.id)),
                    )
                }
                onNewChat={onNewChat}
            />

            <ChatListSearchSection
                searchOpen={prefs.searchOpen}
                searchInputRef={prefs.searchInput}
                composingRef={prefs.composing}
                searchText={prefs.searchText}
                searchQuery={prefs.searchQuery}
                setSearchText={prefs.setSearchText}
                setSearchQuery={prefs.setSearchQuery}
                closeSearch={prefs.closeSearch}
                sections={sections}
                collapsed={collapsed}
                openChat={openChat}
            />

            <ScrollArea fadeFrom="from-sidebar" className="min-h-0 flex-1 px-1.5 pb-2">
                <ChatListViewportBody
                    projectPath={project_path}
                    filteredCount={filtered.length}
                    searchQuery={prefs.searchQuery}
                    onNewChat={onNewChat}
                    sections={sections}
                    rowProps={rowProps}
                    collapsed={collapsed}
                    onToggleShelf={toggleShelf}
                    onMoveChat={moveChat}
                    grouping={prefs.grouping}
                    collections={stores.collections}
                />
            </ScrollArea>

            <UndoBar />

            {collectionDraft ? (
                <CollectionDialog chatIds={collectionDraft} onClose={() => setCollectionDraft(null)} />
            ) : null}
        </div>
    );
};
