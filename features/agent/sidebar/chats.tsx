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
import { useChatStreamOptional } from "@/features/chat/lib/chat-stream-store";
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
    type ChatShelfRowProps,
    type ChatShelfSection,
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

/** A chat's display title, with the fallback the rows and the action menus share. */
const chatTitle = (chat: Conversation) => chat.title?.trim() || "Untitled";

/** A chat's project path, with the project that is open as the fallback. */
const chatPath = (chat: Conversation, projectPath: string | null) =>
    chat.project_path || projectPath || "";

/** Whether a stored string is one of the sort orders this build offers. */
const isSortOrder = (value: string | null): value is ChatSort =>
    SORT_OPTIONS.some((option) => option.value === value);

/** The sort order the shelf opens with: what was stored, or the default. */
const loadSort = (): ChatSort => {
    try {
        const value = window.localStorage.getItem(SORT_KEY);
        if (isSortOrder(value)) return value;
    } catch {
        /* private mode */
    }
    return "recent";
};

/** The fields that answer undo themselves, so the shelf's chord must not steal it. */
const EDITABLE_TAGS = /^(INPUT|TEXTAREA|SELECT)$/;

/** Whether a key event came from a field with its own undo history. */
const isEditableTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    return target.isContentEditable || EDITABLE_TAGS.test(target.tagName);
};

/**
 * Whether a keydown is a plain undo chord.
 *
 * Shift is the redo chord and alt belongs to the menus, so only the bare chord reaches the
 * shelf's own undo.
 */
const isUndoChord = (event: KeyboardEvent) => {
    if (event.altKey || event.shiftKey) return false;
    if (!(event.ctrlKey || event.metaKey)) return false;
    return event.key.toLowerCase() === "z";
};

/** The chat a generating event should mark unread, or undefined when it should not. */
const unreadIdFrom = (
    detail: { id?: string; generating?: boolean } | undefined,
    activeId: string | null,
) => {
    if (!detail?.id || detail.generating) return undefined;
    if (detail.id === activeId) return undefined;
    return detail.id;
};

/** Whether every shelf is collapsed, which the menu offers to undo in one click. */
const everyShelfCollapsed = (
    sections: readonly { id: ChatShelfId }[],
    collapsed: ReadonlySet<ChatShelfId>,
) => sections.length > 1 && sections.every((section) => collapsed.has(section.id));

/** The label over a selection: a count once something is selected, the shelf's name otherwise. */
const selectionLabel = (count: number) => (count > 0 ? `${count} selected` : "Sessions");

/** One row's lifecycle target: what the action menus name and act on. */
const toLifecycleTarget = (
    chat: Conversation,
    projectPath: string | null,
    pinned: ReadonlySet<string>,
): ChatLifecycleTarget => ({
    id: chat.id,
    title: chatTitle(chat),
    path: chatPath(chat, projectPath),
    pinned: pinned.has(chat.id),
});

/** One icon button in the shelf header, which is the whole of the header's controls. */
const HeaderIconBtn = ({
    label,
    onClick,
    active,
    children,
}: {
    label: string;
    onClick?: () => void;
    active?: boolean;
    children: ReactNode;
}) => {
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
};

/** The drain bar under the undo card. Keyed per entry so it restarts each time. */
const UndoCountdown = () => {
    const [draining, setDraining] = useState(false);
    useEffect(() => {
        // Two frames, not one: the bar is painted at its full width for one frame, so the
        // drain below has a starting width to travel from.
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
};

/** The undo card: what the last shelf action did, and the way back for its window. */
const UndoBar = () => {
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
                className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-sm text-text-secondary transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-primary"
            >
                <Icon icon={ArrowUndo20Regular} className="icon-sm" />
                Undo
            </button>
            <button
                type="button"
                aria-label="Dismiss undo"
                onClick={() => dismissChatUndo()}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-primary"
            >
                <Icon icon={Dismiss20Regular} className="icon-sm" />
            </button>
            <UndoCountdown key={entry.id} />
        </div>
    );
};

/** The primitives the lifecycle actions render into, which are the menu's own parts. */
const selectionPrimitives = {
    Item: (props: { onClick?: () => void; className?: string; children?: ReactNode }) => (
        <DropdownMenuItem {...props} />
    ),
    Separator: () => <DropdownMenuSeparator />,
};

/** The lifecycle actions for the current selection, or nothing while nothing is selected. */
const SelectionActions = ({
    targets,
    handlers,
    onAddToCollection,
}: {
    targets: ChatLifecycleTarget[];
    handlers: ChatLifecycleHandlers;
    onAddToCollection: () => void;
}) =>
    targets.length > 0 ? (
        <>
            {renderLifecycleActions(
                buildChatLifecycleActions(targets, handlers),
                selectionPrimitives,
            )}
            <DropdownMenuItem onClick={onAddToCollection}>
                <Icon icon={Collections20Regular} />
                Add to collection
            </DropdownMenuItem>
            <DropdownMenuSeparator />
        </>
    ) : null;

/** The collapse-all item, which only means something while there is more than one shelf. */
const CollapseAllItem = ({
    sections,
    allCollapsed,
    onToggle,
}: {
    sections: readonly ChatShelfSection[];
    allCollapsed: boolean;
    onToggle: () => void;
}) =>
    sections.length > 1 ? (
        <DropdownMenuItem onClick={onToggle}>
            {allCollapsed ? "Expand all sections" : "Collapse all sections"}
        </DropdownMenuItem>
    ) : null;

/** The list itself: a way to start while there is nothing to show, the shelves otherwise. */
const ChatListBody = ({
    projectPath,
    hasChats,
    sections,
    rowProps,
    collapsed,
    onToggleShelf,
    onNewChat,
}: {
    projectPath: string | null;
    hasChats: boolean;
    sections: readonly ChatShelfSection[];
    rowProps: (chat: Conversation) => Omit<ChatShelfRowProps, "variant">;
    collapsed: ReadonlySet<ChatShelfId>;
    onToggleShelf: (shelf: ChatShelfId) => void;
    onNewChat: () => void;
}) => (
    <ScrollArea fadeFrom="from-sidebar" className="min-h-0 flex-1 px-1.5 pb-2">
        {!projectPath ? (
            <button
                type="button"
                onClick={() => window.dispatchEvent(new Event("bettershape-new-project"))}
                className="mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-text-muted transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--row-hover)] hover:text-text-secondary"
            >
                <Icon icon={FolderOpen20Regular} />
                New project
            </button>
        ) : hasChats ? (
            <ChatShelves
                sections={sections}
                rowProps={rowProps}
                collapsed={collapsed}
                onToggleShelf={onToggleShelf}
            />
        ) : (
            <button
                type="button"
                onClick={onNewChat}
                className="mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-text-muted transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--row-hover)] hover:text-text-secondary"
            >
                <Icon icon={Compose20Regular} className="shrink-0" />
                <span>New chat</span>
            </button>
        )}
    </ScrollArea>
);

/**
 * The filter and sort menu.
 *
 * Both live in one menu because they answer the same question, which sessions and in what
 * order, and two more triggers in a 24px header row would crowd out search.
 */
const ShelfViewMenu = ({
    filter,
    sort,
    onFilter,
    onSort,
}: {
    filter: ChatFilter;
    sort: ChatSort;
    onFilter: (value: ChatFilter) => void;
    onSort: (value: ChatSort) => void;
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
            <DropdownMenuLabel>Show</DropdownMenuLabel>
            <DropdownMenuRadioGroup
                value={filter}
                onValueChange={(value) => onFilter(value as ChatFilter)}
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
                onValueChange={(value) => onSort(value as ChatSort)}
            >
                {SORT_OPTIONS.map((opt) => (
                    <DropdownMenuRadioItem key={opt.value} value={opt.value}>
                        {opt.label}
                    </DropdownMenuRadioItem>
                ))}
            </DropdownMenuRadioGroup>
        </DropdownMenuContent>
    </DropdownMenu>
);

/**
 * The sessions menu: the selection read back, then the actions that apply to it.
 *
 * It stays open across a selection change, because picking a chat and reaching for an action
 * in the same gesture is the point of the menu; the destructive rows come from
 * `renderLifecycleActions`, which states its own confirmation.
 */
const SelectionMenu = ({
    selectedCount,
    targets,
    handlers,
    onAddToCollection,
    onClearSelection,
    sections,
    allCollapsed,
    onToggleAll,
    onNewChat,
}: {
    selectedCount: number;
    targets: ChatLifecycleTarget[];
    handlers: ChatLifecycleHandlers;
    onAddToCollection: () => void;
    onClearSelection: () => void;
    sections: readonly ChatShelfSection[];
    allCollapsed: boolean;
    onToggleAll: () => void;
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
            <DropdownMenuLabel>{selectionLabel(selectedCount)}</DropdownMenuLabel>
            <SelectionActions
                targets={targets}
                handlers={handlers}
                onAddToCollection={onAddToCollection}
            />
            <DropdownMenuItem disabled={selectedCount === 0} onClick={onClearSelection}>
                Clear selection
            </DropdownMenuItem>
            <CollapseAllItem
                sections={sections}
                allCollapsed={allCollapsed}
                onToggle={onToggleAll}
            />
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onNewChat}>
                <Icon icon={Compose20Regular} />
                New chat
            </DropdownMenuItem>
        </DropdownMenuContent>
    </DropdownMenu>
);

/**
 * The chat shelf: the sessions list with its filter, sort, selection and undo affordances.
 *
 * It reads the chat stores directly rather than taking them as props, because the shelf is
 * the only surface that projects them this way.
 */
export const ChatList = ({
    onNewChat,
}: {
    onNewChat: () => void;
    /** @deprecated unified Sessions list, ignored */
    listKind?: "chat";
}) => {
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
        listen("agent-subagent", (event) => {
            applySubagentEvent((event.payload ?? {}) as Parameters<typeof applySubagentEvent>[0]);
        })
            .then((fn) => {
                unlisten = fn;
            })
            .catch(() => undefined);
        return () => unlisten?.();
    }, []);

    /** The sort order is stored as it is set, so the shelf opens the way it was left. */
    const persistSort = useCallback((next: ChatSort) => {
        setSort(next);
        try {
            window.localStorage.setItem(SORT_KEY, next);
        } catch {
            /* ignore */
        }
    }, []);

    /** The backend owns the list, and a project with none open clears the shelf. */
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
        loadChats().catch(() => undefined);
        /** The three events all mean the list changed, and none of them carries the change. */
        const onRefresh = () => {
            loadChats().catch(() => undefined);
        };
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
        // The new-chat tab is not a chat, so it reads as no active chat rather than as an
        // id nothing in the list matches.
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
        // Only a chat that started generating is news, and the chat on screen is not.
        const onGenerating = (e: Event) => {
            const detail = (e as CustomEvent<{ id?: string; generating?: boolean }>).detail;
            const id = unreadIdFrom(detail, activeId);
            if (id) markChatUnread(id);
        };
        window.addEventListener("bettershape-chat-generating", onGenerating as EventListener);
        return () => window.removeEventListener("bettershape-chat-generating", onGenerating as EventListener);
    }, [activeId]);

    // Highlight the chat on screen. The backend's current chat can be another one while a
    // background chat runs, so it is not used here.
    const viewedChatId = useChatStreamOptional().viewedConversationId;
    useEffect(() => {
        setActiveId(viewedChatId);
    }, [viewedChatId]);

    /** Opening a chat clears its unread mark and asks the shell to load it. */
    const openChat = useCallback((id: string) => {
        clearChatUnread(id);
        window.dispatchEvent(new CustomEvent("bettershape-chat-load", { detail: { id } }));
    }, []);

    /** The shelf asks for a refresh through the event the whole app listens on. */
    const refresh = useCallback(() => {
        window.dispatchEvent(new CustomEvent("bettershape-chat-refresh"));
    }, []);

    /** What an undo entry calls the chats it acts on, which is one title or a count. */
    const nameOf = useCallback(
        (ids: readonly string[]) => {
            if (ids.length > 1) return `${ids.length} sessions`;
            const title = chats.find((chat) => chat.id === ids[0])?.title?.trim();
            return title ? `“${title}”` : "this session";
        },
        [chats],
    );

    /** Pinning is itself undoable, so the entry flips the same ids back. */
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

    /** Archiving closes the chat's tab as well, since a tab to a hidden chat is a dead end. */
    const archiveChats = useCallback(
        (ids: readonly string[]) => {
            for (const id of ids) {
                commands.setConversationArchived(id, true).catch(() => undefined);
            }
            for (const id of ids) {
                window.dispatchEvent(new CustomEvent("bettershape-chat-close-tab", { detail: { id } }));
            }
            refresh();
            pushChatUndo({
                kind: "archive",
                chatId: ids[0],
                label: `Archived ${nameOf(ids)}`,
                revert: () => {
                    for (const id of ids) {
                        commands.setConversationArchived(id, false).catch(() => undefined);
                    }
                    refresh();
                },
            });
        },
        [nameOf, refresh],
    );

    /** Deleting waits for the undo window to close before the backend hears about it. */
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
                    for (const id of ids) {
                        commands.deleteConversation(id).catch(() => undefined);
                    }
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
            copyTitle: (title) => {
                navigator.clipboard.writeText(title).catch(() => undefined);
            },
            revealFolder: (path) => {
                commands.revealPath(path).catch(() => undefined);
            },
            archive: archiveChats,
            remove: removeChats,
            addToCollection: (ids) => setCollectionDraft([...ids]),
        }),
        [openChat, pinChats, archiveChats, removeChats],
    );

    useEffect(() => {
        // The chord reads as the undo it is before the shelf claims it, and the capture
        // phase is only swallowed once something came back: with nothing pending, another
        // surface's own mod+Z still fires.
        const onKey = (event: KeyboardEvent) => {
            if (!isUndoChord(event)) return;
            if (isEditableTarget(event.target)) return;
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

    /** Rows toggle in and out of the selection, and the menus act on what is in it. */
    const toggleSelect = useCallback((id: string) => {
        setSelectedIds((current) =>
            current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
        );
    }, []);

    /** A shelf is collapsed or expanded, and the set is copied rather than mutated. */
    const toggleShelf = useCallback((shelf: ChatShelfId) => {
        setCollapsed((current) => {
            const next = new Set(current);
            if (next.has(shelf)) next.delete(shelf);
            else next.add(shelf);
            return next;
        });
    }, []);

    /** The selected rows in the shape the lifecycle menus take. */
    const selectedTargets = useMemo<ChatLifecycleTarget[]>(
        () =>
            filtered
                .filter((chat) => selectedIds.includes(chat.id))
                .map((chat) => toLifecycleTarget(chat, project_path, pinnedIds)),
        [filtered, selectedIds, pinnedIds, project_path],
    );

    /** Which collection a chat belongs to, or null when it is in none. */
    const collectionOf = useCallback(
        (chatId: string) => collections.find((entry) => entry.chatIds.includes(chatId))?.name ?? null,
        [collections],
    );

    /** Everything one row needs, resolved once per chat rather than inside the row. */
    const rowProps = useCallback(
        (chat: Conversation) => ({
            title: chatTitle(chat),
            path: chatPath(chat, project_path),
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

    /** The header's search button opens the palette rather than a field of its own. */
    const openCommandPalette = () => {
        window.dispatchEvent(
            new CustomEvent("bettershape-command-palette", {
                detail: { placeholder: "Search…" },
            }),
        );
    };

    const allCollapsed = everyShelfCollapsed(sections, collapsed);
    /** Collapse-all and expand-all are the same call with the other set of shelves. */
    const setAllCollapsed = (next: boolean) => {
        setCollapsed(next ? new Set<ChatShelfId>(sections.map((section) => section.id)) : new Set<ChatShelfId>());
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between pl-3 pr-1 pb-1 pt-3">
                <span className="text-sm font-medium text-text-muted">Sessions</span>
                <div className="flex items-center">
                    <HeaderIconBtn label="Search" onClick={openCommandPalette}>
                        <Icon icon={Search20Regular} />
                    </HeaderIconBtn>
<ShelfViewMenu filter={filter} sort={sort} onFilter={setFilter} onSort={persistSort} />
                    <SelectionMenu
                        selectedCount={selectedIds.length}
                        targets={selectedTargets}
                        handlers={handlers}
                        onAddToCollection={() => setCollectionDraft([...selectedIds])}
                        onClearSelection={() => setSelectedIds([])}
                        sections={sections}
                        allCollapsed={allCollapsed}
                        onToggleAll={() => setAllCollapsed(!allCollapsed)}
                        onNewChat={onNewChat}
                    />
                    <HeaderIconBtn label="New chat" onClick={onNewChat}>
                        <Icon icon={Compose20Regular} />
                    </HeaderIconBtn>
                </div>
            </div>

            <ChatListBody
                projectPath={project_path}
                hasChats={filtered.length > 0}
                sections={sections}
                rowProps={rowProps}
                collapsed={collapsed}
                onToggleShelf={toggleShelf}
                onNewChat={onNewChat}
            />

            <UndoBar />

            {collectionDraft ? (
                <CollectionDialog chatIds={collectionDraft} onClose={() => setCollectionDraft(null)} />
            ) : null}
        </div>
    );
}