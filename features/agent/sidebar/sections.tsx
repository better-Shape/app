"use client";

import { useClock } from "@/lib/ui/use-clock";

import { CHAT_SHELVES, type ChatShelfId, type RowVariant } from "./shelf-spec";

/**
 * The session list's shelves, one per state a chat can be in: pinned, working, or the chat
 * on screen. Every section derives from data BetterShape already tracks, so a shelf needs
 * nothing persisted to exist.
 *
 * A flat list cannot say "which of these is running" and "which one am I looking
 * at" without the user reading every row. t3code solves that with labelled
 * sections; the concepts port over, its Effect/server architecture does not.
 * Shelves combine live generation/selection with local pin and lifecycle intent.
 * Snooze deadlines persist independently of the backend conversation.
 *
 * Rows are emitted as a FLAT child list with the headers interleaved, not wrapped
 * one section per element. That is load-bearing: a chat moving between shelves has
 * to stay a child of the same element so React can move the node, and the only
 * thing allowed to decide whether it moves or is torn down and rebuilt is the
 * variant baked into the key.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
    DndContext, DragOverlay, KeyboardSensor, PointerSensor,
    useDraggable, useDroppable, useSensor, useSensors,
} from "@dnd-kit/core";
import { DROP_VERBS, isDropShelf, shelfCollision, createShelfKeyboardNavigation, type DropShelf } from "./drag";
import { Checkmark } from "@/components/ui/checkmark";
import { ChevronDown20Regular } from "@fluentui/react-icons/headless/svg/chevron-down";
import { ChevronRight20Regular } from "@fluentui/react-icons/headless/svg/chevron-right";
import { Color20Regular } from "@fluentui/react-icons/headless/svg/color";
import { Collections20Regular } from "@fluentui/react-icons/headless/svg/collections";
import { MoreHorizontal20Regular } from "@fluentui/react-icons/headless/svg/more-horizontal";
import { Pin20Filled, Pin20Regular } from "@fluentui/react-icons/headless/svg/pin";
import { Eclipse } from "loading-dev";

import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { useIsChatGenerating } from "@/features/chat/lib/generating-chats";
import { prefetchChatConversation } from "@/features/chat/lib/chat-stream-store";
import { openSubagent, type SubagentCard } from "@/features/agent/subagents/store";
import type { Conversation } from "@/lib/backend/types";
import { toTimestampMs } from "@/lib/ui/timestamp";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuRadioGroup,
    ContextMenuRadioItem,
    ContextMenuSeparator,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
    ContextMenuTrigger,
} from "@/components/ui/context";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import {
    CHAT_COLORS,
    CHAT_COLOR_HEX,
    clearChatUnread,
    setChatColor,
    type ChatColor,
    type ChatCollection,
} from "@/lib/sidebar/chat-list-meta";
import { CHAT_ACTIVITY_LABELS, type ChatActivity } from "@/features/chat/lib/chat-activity";
import type { ChatDisposition } from "@/lib/sidebar/chat-disposition";
import { groupChats, type ChatGrouping } from "./grouping";
import { useFlipMotion } from "./motion";
import { renderLifecycleActions, buildChatLifecycleActions, type ChatLifecycleHandlers } from "./lifecycle";

/* ------------------------------------------------------------------ sorting */

export type ChatSort = "recent" | "oldest" | "name-asc" | "name-desc";

export const SORT_OPTIONS: { value: ChatSort; label: string }[] = [
    { value: "recent", label: "Recent" },
    { value: "oldest", label: "Oldest" },
    { value: "name-asc", label: "Name A–Z" },
    { value: "name-desc", label: "Name Z–A" },
];

/**
 * Shelves own the pin split, so the sort choice is the whole answer. The id tiebreak keeps
 * equal-timestamped rows from swapping, which is what makes a reorder animate.
 */
export function sortShelf(chats: readonly Conversation[], sort: ChatSort): Conversation[] {
    const sorted = [...chats];
    sorted.sort((a, b) => {
        if (sort === "name-asc") {
            return (
                (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" })
                || a.id.localeCompare(b.id)
            );
        }
        if (sort === "name-desc") {
            return (
                (b.title || "").localeCompare(a.title || "", undefined, { sensitivity: "base" })
                || a.id.localeCompare(b.id)
            );
        }
        const delta = toTimestampMs(a.timestamp || 0) - toTimestampMs(b.timestamp || 0);
        return (sort === "oldest" ? delta : -delta) || a.id.localeCompare(b.id);
    });
    return sorted;
}

/* ------------------------------------------------------------------- shelves */

export { CHAT_SHELVES, type ChatShelfId, type RowVariant, type ChatShelfSpec } from "./shelf-spec";

export interface ShelfFacts {
    disposition?: ChatDisposition["state"];
    pinned: boolean;
    generating: boolean;
    active: boolean;
}

/** Resolve shelf intent against live generation: preserve inactive snooze/settle intent, then pin and working precedence. */
export function shelfOf(facts: ShelfFacts): ChatShelfId {
    if (!facts.generating && (facts.disposition === "snoozed" || facts.disposition === "settled")) return facts.disposition;
    if (facts.pinned) return "pinned";
    if (facts.generating) return "working";
    if (facts.active || facts.disposition === "active") return "active";
    return "settled";
}

export interface ChatShelfSection {
    id: ChatShelfId;
    label: string;
    variant: RowVariant;
    chats: Conversation[];
}

export interface BuildShelvesInput {
    grouping?: ChatGrouping;
    collections?: readonly ChatCollection[];
    dispositions?: Readonly<Record<string, ChatDisposition>>;
    chats: readonly Conversation[];
    sort: ChatSort;
    pinned: ReadonlySet<string>;
    generating: ReadonlySet<string>;
    /** The chat on screen, or null when the sidebar is showing the draft tab. */
    activeId: string | null;
    /** Chats inside an open undo window: hidden, not yet deleted. */
    hidden?: ReadonlySet<string>;
}

/** Non-empty sections only, in `CHAT_SHELVES` order, each sorted by `sort`. */
export function buildShelves(input: BuildShelvesInput): ChatShelfSection[] {
    const buckets = new Map<ChatShelfId, Conversation[]>();
    for (const chat of input.chats) {
        if (input.hidden?.has(chat.id)) continue;
        const id = shelfOf({
            disposition: input.dispositions?.[chat.id]?.state,
            pinned: input.pinned.has(chat.id),
            generating: input.generating.has(chat.id),
            active: chat.id === input.activeId,
        });
        const bucket = buckets.get(id);
        if (bucket) bucket.push(chat);
        else buckets.set(id, [chat]);
    }
    return CHAT_SHELVES.filter((spec) => (buckets.get(spec.id)?.length ?? 0) > 0).map((spec) => ({
        id: spec.id,
        label: spec.label,
        variant: spec.variant,
        chats: groupChats(sortShelf(buckets.get(spec.id) ?? [], input.sort), input.grouping ?? "none", input.collections).flatMap((group) => group.chats),
    }));
}

export interface ChatShelfHeader {
    kind: "header";
    key: string;
    shelf: ChatShelfId;
    label: string;
    count: number;
    open: boolean;
}

export interface ChatShelfRow {
    shelf: ChatShelfId;
    kind: "row";
    key: string;
    chat: Conversation;
    variant: RowVariant;
}

export interface ChatGroupHeader {
    kind: "group";
    key: string;
    label: string;
    detail?: string;
    count: number;
}

export type ChatShelfChild = ChatShelfHeader | ChatShelfRow | ChatGroupHeader;

/**
 * Headers and rows as one flat sequence. The variant in `key` is the point: same variant
 * keys the same, so React moves the node and the row slides, while crossing into the
 * pinned card changes the key and the height change crossfades instead of jumping.
 */
export function buildShelfChildren(
    sections: readonly ChatShelfSection[],
    collapsed: ReadonlySet<ChatShelfId>,
    grouping: ChatGrouping = "none",
    collections: readonly ChatCollection[] = [],
): ChatShelfChild[] {
    const showHeaders = sections.length > 1;
    const children: ChatShelfChild[] = [];
    for (const section of sections) {
        const open = !collapsed.has(section.id);
        if (showHeaders) {
            children.push({
                kind: "header",
                key: `header:${section.id}`,
                shelf: section.id,
                label: section.label,
                count: section.chats.length,
                open,
            });
        }
        if (!open) continue;
        for (const group of groupChats(section.chats, grouping, collections)) {
            if (grouping !== "none") children.push({
                kind: "group", key: `group:${section.id}:${group.id}`, label: group.label,
                detail: group.detail, count: group.chats.length,
            });
            for (const chat of group.chats) {
                children.push({
                    kind: "row",
                    shelf: section.id,
                    key: `${chat.id}:${section.variant}`,
                    chat,
                    variant: section.variant,
                });
            }
        }
    }
    return children;
}

/* -------------------------------------------------------------- row details */

/** Same scale as the relative time on the chat welcome screen. */
export function chatRelativeTime(timestamp: number, now: number): string {
    const diffMs = now - toTimestampMs(timestamp);
    if (!Number.isFinite(diffMs) || diffMs < 0) return "—";
    const minutes = Math.floor(diffMs / 60_000);
    const hours = Math.floor(diffMs / 3_600_000);
    const days = Math.floor(diffMs / 86_400_000);
    if (days >= 1) return `${days}d`;
    if (hours >= 1) return `${hours}h`;
    if (minutes < 1) return "now";
    return `${minutes}m`;
}

export function folderName(path: string): string {
    const parts = path.split(/[\\/]/).filter(Boolean);
    return parts.length === 0 ? "" : parts[parts.length - 1];
}

/** Second line of the card: the folder, then the collection it was filed under. */
export function cardMeta(path: string, collectionName: string | null): string {
    return [folderName(path), collectionName].filter(Boolean).join(" · ");
}

/** Map nested-agent completion, cancellation, and error states to the existing semantic dot colors. */
function nestedDot(status: string): string {
    if (status === "error") return "bg-error";
    if (status === "cancelled") return "bg-text-muted";
    if (status === "done") return "bg-success";
    return "bg-accent";
}

/* --------------------------------------------------------------------- rows */

export interface ChatShelfRowProps {
    activity?: ChatActivity;
    shelf?: ChatShelfId;
    draggable?: boolean;
    disposition?: ChatDisposition["state"];
    title: string;
    path: string;
    timestamp: number;
    /** Name of the collection holding this chat, when there is one. */
    collection: string | null;
    variant: RowVariant;
    active: boolean;
    pinned: boolean;
    unread: boolean;
    color: ChatColor | null;
    subagents: SubagentCard[];
    selecting: boolean;
    selected: boolean;
    onToggleSelect: () => void;
    onOpen: () => void;
    /** Routes through the undo store, unlike the `pin` action inside `handlers`. */
    onTogglePin: (pinned: boolean) => void;
    handlers: ChatLifecycleHandlers;
}











/**
 * The row ladder for an uncoloured row. These two used to be the same fill, so a row could
 * not answer the question a hover exists for and a selected row went inert.
 */
const uncolouredChromeClass = (color: ChatColor | null, active: boolean): string | false =>
    !color &&
    (active
        ? "bg-[var(--row-selected)] text-text-primary hover:bg-[var(--row-selected-hover)]"
        : "text-text-primary hover:bg-[var(--row-hover)]");

/** Row chrome classes: card height, uncoloured squircle/hover states, coloured hover wash. */
const rowChromeClass = (variant: RowVariant, color: ChatColor | null, active: boolean): string =>
    cn(
        "group/chat relative flex w-full items-center gap-1 px-2 text-sm",
        variant === "card" ? "h-[78px] py-2" : "h-10",
        !color && "squircle-2xl",
        "transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]",
        uncolouredChromeClass(color, active),
        color && "text-text-primary hover:bg-[color-mix(in_oklch,var(--chat-tint)_4%,transparent)]",
    );

/** Outer tint classes for a coloured row; the active tint stacks stronger. */
const outerTintClass = (color: ChatColor | null, active: boolean): string | null =>
    color && (active
        ? "bg-[color-mix(in_oklch,var(--chat-tint)_30%,transparent)] text-text-primary"
        : "bg-[color-mix(in_oklch,var(--chat-tint)_22%,transparent)] text-text-primary");


/** One sidebar chat row: title, card meta, pin and colour menus, subagent expansion. */
const ChatRow = ({
    id,
    title,
    path,
    timestamp,
    collection,
    variant,
    active,
    pinned,
    unread,
    color,
    subagents,
    selecting,
    selected,
    onToggleSelect,
    onOpen,
    onTogglePin,
    handlers,
    activity,
    shelf,
    draggable,
    disposition,
}: ChatShelfRowProps & { id: string }) => {
    const now = useClock();
    const generating = useIsChatGenerating(id);
    const [renaming, setRenaming] = useState(false);
    const [draft, setDraft] = useState(title);
    const [expanded, setExpanded] = useState(false);
    const nestedCount = subagents.length;
    // Expand the row the first time its subagents appear. Tracked during render, not in an effect.
    const [seenWorkers, setSeenWorkers] = useState(0);
    if (seenWorkers !== nestedCount) {
        setSeenWorkers(nestedCount);
        if (seenWorkers === 0 && nestedCount > 0) setExpanded(true);
    }
    const inputRef = useRef<HTMLInputElement>(null);

    const { attributes, listeners, setNodeRef: setDragRef, setActivatorNodeRef, isDragging } = useDraggable({
        id, disabled: !draggable || renaming,
        data: { shelf, title }, attributes: { roleDescription: "draggable session" },
    });
    const { setNodeRef: setDropRef } = useDroppable({
        id: `row:${id}`, disabled: !draggable || !isDropShelf(shelf), data: { shelf },
    });
    const rowRef = useCallback((node: HTMLDivElement | null) => {
        setDragRef(node);
        setDropRef(node);
    }, [setDragRef, setDropRef]);

    useEffect(() => {
        if (!renaming) return;
        inputRef.current?.focus();
        inputRef.current?.select();
    }, [renaming]);

    const commitRename = () => {
        const next = draft.trim();
        setRenaming(false);
        if (!next || next === title) {
            setDraft(title);
            return;
        }
        window.dispatchEvent(new CustomEvent("bettershape-chat-rename", { detail: { id, title: next } }));
        window.dispatchEvent(new CustomEvent("bettershape-chat-refresh"));
    };

    const startRename = () => {
        setDraft(title);
        setRenaming(true);
    };

    // `startRename` is the row's own so Rename always targets a row on screen.
    const actions = buildChatLifecycleActions(
        [{ id, title, path, pinned, disposition }],
        { ...handlers, startRename },
    );
    /** Open collection assignment for this row rather than the broader sidebar selection. */
    const addToCollection = () => handlers.addToCollection([id]);

    const chooseColor = (next: string) => {
        setChatColor(id, next === "none" ? null : (next as ChatColor));
    };

    const dropdown = {
        Item: (props: { onClick?: () => void; className?: string; children?: ReactNode }) => (
            <DropdownMenuItem {...props} />
        ),
        Separator: () => <DropdownMenuSeparator />,
    };
    const context = {
        Item: (props: { onClick?: () => void; className?: string; children?: ReactNode }) => (
            <ContextMenuItem {...props} />
        ),
        Separator: () => <ContextMenuSeparator />,
    };

    const fade = "1.25rem";
    const meta = cardMeta(path, collection);

    return (
        <div
            ref={rowRef}
            data-motion-id={id}
            data-row-variant={variant}
            onPointerEnter={() => {
                if (!active) prefetchChatConversation(id);
            }}
            className={cn("flex flex-col overflow-hidden", isDragging && "opacity-40", outerTintClass(color, active))}
            style={{
                ...(color ? { ["--chat-tint" as string]: CHAT_COLOR_HEX[color] } : {}),
                contentVisibility: isDragging ? "visible" : "auto",
                containIntrinsicSize: `auto ${(variant === "card" ? 78 : 40) + (expanded ? nestedCount * 32 : 0)}px`,
            }}
        >
            <ContextMenu>
                <ContextMenuTrigger asChild>
                    <div className={rowChromeClass(variant, color, active)}>
                        {renaming ? (
                            <input
                                ref={inputRef}
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                onBlur={commitRename}
                                onKeyDown={(e) => {
                                    if (e.nativeEvent.isComposing) return;
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        commitRename();
                                    }
                                    if (e.key === "Escape") {
                                        e.preventDefault();
                                        setDraft(title);
                                        setRenaming(false);
                                    }
                                }}
                                className="w-full rounded bg-transparent px-0 text-sm text-text-primary outline-none ring-1 ring-border"
                                onClick={(e) => e.stopPropagation()}
                            />
                        ) : (
                            <>
                                    <span
                                        className={cn(
                                            "grid shrink-0 transition-[grid-template-columns,opacity,margin] duration-200 ease-[var(--ease-out)]",
                                            selecting ? "mr-1 grid-cols-[14px] opacity-100" : "grid-cols-[0px] opacity-0",
                                        )}
                                    >
                                        <span className="overflow-hidden">
                                            {selecting ? <Checkmark
                                                checked={selected}
                                                onCheckedChange={() => onToggleSelect?.()}
                                            /> : null}
                                        </span>
                                    </span>
                                <button
                                    type="button"
                                    ref={setActivatorNodeRef}
                                    {...(draggable ? attributes : {})}
                                    {...(draggable ? listeners : {})}
                                    onPointerDown={(event) => {
                                        if (!draggable || event.ctrlKey || event.metaKey) return;
                                        listeners?.onPointerDown?.(event);
                                    }}
                                    onKeyDown={(event) => {
                                        if (!draggable || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
                                        listeners?.onKeyDown?.(event);
                                    }}
                                    onClick={(event) => {
                                        if (event.ctrlKey || event.metaKey) {
                                            onToggleSelect?.();
                                            return;
                                        }
                                        onOpen();
                                    }}
                                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                >
                                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                        <span
                                            className="block min-w-0 overflow-hidden whitespace-nowrap text-sm font-normal text-text-primary"
                                            style={{
                                                maskImage: `linear-gradient(to right, #000 0, #000 calc(100% - ${fade}), transparent)`,
                                            }}
                                        >
                                            {title}
                                        </span>
                                        {variant === "card" ? (
                                            <span className="flex min-w-0 items-center gap-1.5 text-xs text-text-muted">
                                                <span className="shrink-0 tabular-nums">
                                                    {chatRelativeTime(timestamp, now)}
                                                </span>
                                                {meta ? (
                                                    <>
                                                        <span aria-hidden>·</span>
                                                        <span className="min-w-0 truncate">{meta}</span>
                                                    </>
                                                ) : null}
                                            </span>
                                        ) : null}
                                    </span>
                                </button>
                                <span className="flex shrink-0 items-center gap-1">
                                    {activity && activity !== "ready" ? (
                                        <span
                                            title={CHAT_ACTIVITY_LABELS[activity]}
                                            aria-label={CHAT_ACTIVITY_LABELS[activity]}
                                            className={cn("flex items-center text-2xs", activity === "approval" || activity === "input" ? "text-warning" : activity === "failed" || activity === "limited" ? "text-error" : "text-text-muted")}
                                        >
                                            {activity === "working" ? <Eclipse size={12} aria-hidden /> : CHAT_ACTIVITY_LABELS[activity]}
                                        </span>
                                    ) : generating ? <Eclipse size={12} className="text-text-muted" aria-label="Working" /> : null}
                                    {unread ? (
                                        <span className="size-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />
                                    ) : null}
                                </span>
                                <span className="flex shrink-0 items-center">
                                    <span className="grid grid-cols-[0fr] overflow-hidden invisible transition-[grid-template-columns,visibility] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] group-hover/chat:visible group-hover/chat:grid-cols-[1fr] group-has-[[data-state=open]]/chat:visible group-has-[[data-state=open]]/chat:grid-cols-[1fr] group-focus-within/chat:visible group-focus-within/chat:grid-cols-[1fr]">
                                    <span className="flex min-w-0 overflow-hidden">
                                    {pinned ? null : (
                                    <Tooltip content="Pin" side="bottom">
                                        <button
                                            type="button"
                                            aria-label="Pin"
                                            onClick={() => onTogglePin(true)}
                                            className="flex size-6 items-center justify-center rounded-md text-text-muted transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-primary"
                                        >
                                            <Icon icon={Pin20Regular} className="icon-sm" />
                                        </button>
                                    </Tooltip>
                                    )}
                                    <DropdownMenu modal={false}>
                                        <Tooltip content="Chat actions" side="bottom">
                                        <DropdownMenuTrigger asChild>
                                            <button
                                                type="button"
                                                aria-label="Chat actions"
                                                className="flex size-6 items-center justify-center rounded-md text-text-muted transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-primary"
                                            >
                                                <Icon icon={MoreHorizontal20Regular} className="icon-sm" />
                                            </button>
                                        </DropdownMenuTrigger>
                                        </Tooltip>
                                        <DropdownMenuContent side="bottom" align="end" sideOffset={6} className="min-w-48">
                                            {renderLifecycleActions(actions, dropdown)}
                                            <DropdownMenuSeparator />
                                            <DropdownMenuSub>
                                                <DropdownMenuSubTrigger>
                                                    <Icon icon={Color20Regular} />
                                                    Colour
                                                </DropdownMenuSubTrigger>
                                                <DropdownMenuSubContent className="min-w-32">
                                                    <DropdownMenuRadioGroup value={color ?? "none"} onValueChange={chooseColor}>
                                                        <DropdownMenuRadioItem value="none">None</DropdownMenuRadioItem>
                                                        {CHAT_COLORS.map((entry) => (
                                                            <DropdownMenuRadioItem key={entry} value={entry}>
                                                                {entry.charAt(0).toUpperCase() + entry.slice(1)}
                                                            </DropdownMenuRadioItem>
                                                        ))}
                                                    </DropdownMenuRadioGroup>
                                                </DropdownMenuSubContent>
                                            </DropdownMenuSub>
                                            <DropdownMenuItem onClick={addToCollection}>
                                                <Icon icon={Collections20Regular} />
                                                Add to collection
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                    </span>
                                    </span>
                                    {pinned ? (
                                        <Tooltip content="Unpin" side="bottom">
                                            <button
                                                type="button"
                                                aria-label="Unpin"
                                                onClick={() => onTogglePin(false)}
                                                className="flex size-6 items-center justify-center rounded-md text-text-primary"
                                            >
                                                <Icon icon={Pin20Filled} className="icon-sm" />
                                            </button>
                                        </Tooltip>
                                    ) : null}
                                </span>
                                {nestedCount > 0 ? (
                                    <button
                                        type="button"
                                        aria-label={expanded ? "Hide agents" : "Show agents"}
                                        aria-expanded={expanded}
                                        onClick={() => setExpanded((open) => !open)}
                                        className="flex size-5 shrink-0 items-center justify-center text-text-muted"
                                    >
                                        <Icon
                                            icon={ChevronRight20Regular}
                                            className={cn(
                                                "icon-sm transition-transform duration-[var(--transition-fast)] ease-[var(--ease-out)]",
                                                expanded && "rotate-90",
                                            )}
                                        />
                                    </button>
                                ) : null}
                            </>
                        )}
                    </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="min-w-48">
                    {renderLifecycleActions(actions, context)}
                    <ContextMenuSeparator />
                    <ContextMenuSub>
                        <ContextMenuSubTrigger>
                            <Icon icon={Color20Regular} />
                            Colour
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent className="min-w-32">
                            <ContextMenuRadioGroup value={color ?? "none"} onValueChange={chooseColor}>
                                <ContextMenuRadioItem value="none">None</ContextMenuRadioItem>
                                {CHAT_COLORS.map((entry) => (
                                    <ContextMenuRadioItem key={entry} value={entry}>
                                        {entry.charAt(0).toUpperCase() + entry.slice(1)}
                                    </ContextMenuRadioItem>
                                ))}
                            </ContextMenuRadioGroup>
                        </ContextMenuSubContent>
                    </ContextMenuSub>
                    <ContextMenuItem onClick={addToCollection}>
                        <Icon icon={Collections20Regular} />
                        Add to collection
                    </ContextMenuItem>
                </ContextMenuContent>
            </ContextMenu>
            {expanded && nestedCount > 0 ? (
                <div className="flex flex-col">
                    {subagents.map((card) => (
                        <button
                            key={`s-${card.id}`}
                            type="button"
                            onClick={() => {
                                clearChatUnread(id);
                                onOpen();
                                openSubagent(card.id);
                            }}
                            className={cn(
                                "flex h-8 items-center gap-2 pr-2 pl-7 text-left text-sm text-text-secondary",
                                color
                                    ? "hover:bg-[color-mix(in_oklch,var(--chat-tint)_16%,transparent)] hover:text-text-primary"
                                    : "hover:bg-[var(--row-hover)] hover:text-text-primary",
                            )}
                        >
                            <span className={cn("size-1.5 shrink-0 rounded-full", nestedDot(card.status))} aria-hidden />
                            <span className="block min-w-0 flex-1 overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,#000_0,#000_calc(100%-1.5rem),transparent)]">
                                {card.title}
                            </span>
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

/* ---------------------------------------------------------------- the shelves */

function ShelfHeader({
    shelf,
    label,
    count,
    open,
    onToggle,
    dragging,
}: {
    dragging: boolean;
    shelf: ChatShelfId;
    label: string;
    count: number;
    open: boolean;
    onToggle: (shelf: ChatShelfId) => void;
}) {
    const { setNodeRef, isOver } = useDroppable({
        id: `shelf:${shelf}`, disabled: !dragging || !isDropShelf(shelf), data: { shelf },
    });
    return (
        <button
            type="button"
            ref={setNodeRef}
            data-shelf-header={shelf}
            data-drop-shelf={dragging && isDropShelf(shelf) ? shelf : undefined}
            aria-expanded={open}
            onClick={() => { if (!dragging) onToggle(shelf); }}
            className={cn(
                "flex h-6 w-full items-center gap-1 rounded-md pr-2 pl-1 text-xs font-medium text-text-muted transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus",
                isOver
                    ? "bg-[var(--row-selected)] text-text-primary hover:bg-[var(--row-selected-hover)]"
                    : "hover:bg-[var(--row-hover)] hover:text-text-secondary",
            )}
        >
            <Icon
                icon={ChevronDown20Regular}
                className={cn(
                    "icon-sm transition-transform duration-[var(--spring-flick-dur)] ease-[var(--spring-flick)]",
                    !open && "-rotate-90",
                )}
            />
            <span className="min-w-0 flex-1 truncate text-left">{label}</span>
            {dragging && isDropShelf(shelf) ? (
                <span className="rounded-full bg-panel-hover px-1.5 py-px text-2xs text-text-secondary">{DROP_VERBS[shelf]}</span>
            ) : <span className="shrink-0 tabular-nums text-text-disabled">{count}</span>}
        </button>
    );
}

export function ChatShelves({
    sections,
    rowProps,
    collapsed,
    onToggleShelf,
    onMoveChat,
    grouping = "none",
    collections = [],
}: {
    grouping?: ChatGrouping;
    collections?: readonly ChatCollection[];
    onMoveChat?: (id: string, shelf: DropShelf) => void;
    sections: readonly ChatShelfSection[];
    rowProps: (chat: Conversation) => Omit<ChatShelfRowProps, "variant">;
    collapsed: ReadonlySet<ChatShelfId>;
    onToggleShelf: (shelf: ChatShelfId) => void;
}) {
    const [dragged, setDragged] = useState<{ id: string; title: string } | null>(null);
    const [overShelf, setOverShelf] = useState<DropShelf | null>(null);
    const [keyboardNavigation] = useState(createShelfKeyboardNavigation);
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, {
            coordinateGetter: keyboardNavigation.coordinates,
            keyboardCodes: { start: ["Space"], end: ["Space", "Enter"], cancel: ["Escape", "Tab"] },
        }),
    );
    const { containerRef, trackRender } = useFlipMotion<HTMLDivElement>({ enabled: !dragged });

    useLayoutEffect(() => {
        trackRender();
    });

    const children = useMemo(() => {
        const shown = dragged ? CHAT_SHELVES.map((spec) => sections.find((section) => section.id === spec.id) ?? { ...spec, chats: [] }) : sections;
        return buildShelfChildren(shown, collapsed, grouping, collections);
    }, [sections, collapsed, dragged, grouping, collections]);

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={shelfCollision}
            accessibility={{ screenReaderInstructions: { draggable: "Press Space to move this session. Use Up and Down to choose a shelf, Space or Enter to drop, and Escape to cancel." } }}
            onDragStart={({ active }) => {
                keyboardNavigation.start(active.data.current?.shelf);
                const chat = sections.flatMap((section) => section.chats).find((chat) => chat.id === active.id);
                if (chat) setDragged({ id: chat.id, title: chat.title || "Untitled" });
            }}
            onDragOver={({ over }) => setOverShelf(isDropShelf(over?.data.current?.shelf) ? over.data.current.shelf : null)}
            onDragCancel={() => { setDragged(null); setOverShelf(null); }}
            onDragEnd={({ active, over }) => {
                const shelf = over?.data.current?.shelf;
                setDragged(null);
                setOverShelf(null);
                if (isDropShelf(shelf)) onMoveChat?.(String(active.id), shelf);
            }}
        >
        <div ref={containerRef} data-chat-shelves="" className="space-y-0.5">
            {children.map((child) =>
                child.kind === "header" ? (
                    <ShelfHeader
                        key={child.key}
                        shelf={child.shelf}
                        label={child.label}
                        count={child.count}
                        open={child.open}
                        onToggle={onToggleShelf}
                        dragging={dragged !== null}
                    />
                ) : child.kind === "group" ? (
                    <div key={child.key} data-chat-group={child.key} title={child.detail} className="flex h-6 items-center gap-1 px-2 text-xs text-text-muted">
                        <span className="min-w-0 flex-1 truncate">{child.label}</span>
                        <span className="tabular-nums text-text-disabled">{child.count}</span>
                    </div>
                ) : (
                    <ChatRow
                        key={child.key}
                        id={child.chat.id}
                        variant={child.variant}
                        {...rowProps(child.chat)}
                        shelf={child.shelf}
                        draggable={Boolean(onMoveChat)}
                    />
                ),
            )}
        </div>
        <DragOverlay dropAnimation={null}>
            {dragged ? (
                <div data-chat-drag-preview="" className="flex h-10 items-center gap-2 rounded-lg border border-border-subtle bg-panel px-2 text-sm text-text-primary shadow-lg">
                    <span className="min-w-0 flex-1 truncate">{dragged.title}</span>
                    {overShelf ? <span className="rounded-full bg-panel-hover px-1.5 py-px text-2xs text-text-secondary">{DROP_VERBS[overShelf]}</span> : null}
                </div>
            ) : null}
        </DragOverlay>
        </DndContext>
    );
}
