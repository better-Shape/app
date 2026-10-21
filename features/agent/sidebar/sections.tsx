"use client";

/**
 * The session list's shelves.
 *
 * A flat list cannot say "which of these is running" and "which one am I looking
 * at" without the user reading every row. t3code solves that with labelled
 * sections; the concepts port over, its Effect/server architecture does not.
 * Every section here is derived from data BetterShape already tracks — the pinned
 * set, the generating set, and the chat on screen — so nothing new has to be
 * persisted to make one exist.
 *
 * Rows are emitted as a FLAT child list with the headers interleaved, not wrapped
 * one section per element. That is load-bearing: a chat moving between shelves has
 * to stay a child of the same element so React can move the node, and the only
 * thing allowed to decide whether it moves or is torn down and rebuilt is the
 * variant baked into the key.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
} from "@/lib/sidebar/chat-list-meta";
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
 * List order inside one shelf.
 *
 * Pin used to lead this comparator, which turned newest-first into a tiebreak
 * within the pinned block and quietly overrode the sort menu for everything else.
 * Shelves now own the pin split, so the sort choice is the whole answer. The id
 * tiebreak keeps equal-timestamped rows from swapping between two otherwise
 * identical renders, which is what makes a reorder animate instead of flicker.
 */
/** One collator for every title comparison; `localeCompare` built a new one per call. */
const titleCollator = new Intl.Collator(undefined, { sensitivity: "base" });

/** Orders a shelf of conversations for the given sort mode (pure, stable). */
export const sortShelf = (chats: readonly Conversation[], sort: ChatSort): Conversation[] => {
    const nameSign = sort === "name-desc" ? -1 : 1;
    /** Title order for the name sorts, with the id as a stable tiebreak. */
    const byName = (a: Conversation, b: Conversation) =>
        nameSign
        * (titleCollator.compare(a.title || "", b.title || "")
            || a.id.localeCompare(b.id));
    /** Timestamp order for the age sorts, with the id as a stable tiebreak. */
    const byTime = (a: Conversation, b: Conversation) => {
        const delta = toTimestampMs(a.timestamp || 0) - toTimestampMs(b.timestamp || 0);
        return (sort === "oldest" ? delta : -delta) || a.id.localeCompare(b.id);
    };
    return [...chats].sort(sort === "name-asc" || sort === "name-desc" ? byName : byTime);
}

/* ------------------------------------------------------------------- shelves */

export type ChatShelfId = "pinned" | "working" | "active" | "settled";

export type RowVariant = "card" | "slim";

export interface ChatShelfSpec {
    id: ChatShelfId;
    label: string;
    variant: RowVariant;
}

/**
 * Precedence, top to bottom.
 *
 * t3code orders snoozed → settled → pinned → active. There is no snooze here and
 * its "settled" is the far end of this list, so only its pinned-over-active
 * precedence survives. Pinned is an instruction the user gave by hand and wins;
 * working outranks active because a chat mid-generation is the one row on screen
 * that is still changing.
 */
export const CHAT_SHELVES: readonly ChatShelfSpec[] = [
    { id: "pinned", label: "Pinned", variant: "card" },
    { id: "working", label: "Working", variant: "slim" },
    { id: "active", label: "Active", variant: "slim" },
    { id: "settled", label: "Settled", variant: "slim" },
];

export interface ShelfFacts {
    pinned: boolean;
    generating: boolean;
    active: boolean;
}

/** Shelf for one chat, in precedence order: pinned, then working, then active, else settled. */
export const shelfOf = (facts: ShelfFacts): ChatShelfId => {
    if (facts.pinned) return "pinned";
    if (facts.generating) return "working";
    if (facts.active) return "active";
    return "settled";
}

export interface ChatShelfSection {
    id: ChatShelfId;
    label: string;
    variant: RowVariant;
    chats: Conversation[];
}

export interface BuildShelvesInput {
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
export const buildShelves = (input: BuildShelvesInput): ChatShelfSection[] => {
    const buckets = new Map<ChatShelfId, Conversation[]>();
    for (const chat of input.chats) {
        if (input.hidden?.has(chat.id)) continue;
        const id = shelfOf({
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
        chats: sortShelf(buckets.get(spec.id) ?? [], input.sort),
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
    kind: "row";
    key: string;
    chat: Conversation;
    variant: RowVariant;
}

export type ChatShelfChild = ChatShelfHeader | ChatShelfRow;

/**
 * Headers and rows as one flat sequence.
 *
 * The variant in `key` is the whole point. Two rows in the same variant key the
 * same, so React moves the existing node and a chat hopping between the settled
 * and working shelves slides. Crossing into the pinned card changes height, and
 * there the key changes too: React tears the row down, the motion layer fades the
 * old box out and the new one in, and the height change reads as a crossfade
 * rather than a jump.
 *
 * With a single section there are no headers at all, which is what keeps the
 * common case — one chat, nothing pinned, nothing running — looking like the flat
 * list it replaced.
 */
export const buildShelfChildren = (
    sections: readonly ChatShelfSection[],
    collapsed: ReadonlySet<ChatShelfId>,
): ChatShelfChild[] => {
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
        for (const chat of section.chats) {
            children.push({
                kind: "row",
                key: `${chat.id}:${section.variant}`,
                chat,
                variant: section.variant,
            });
        }
    }
    return children;
}

/* -------------------------------------------------------------- row details */

/** Whether a chat age is unusable: non-finite or negative. */
const isInvalidDiffMs = (diffMs: number): boolean => !Number.isFinite(diffMs) || diffMs < 0;

/** Same scale as the relative time on the chat welcome screen. */
export const chatRelativeTime = (timestamp: number, now: number): string => {
    const diffMs = now - toTimestampMs(timestamp);
    if (isInvalidDiffMs(diffMs)) return "—";
    const minutes = Math.floor(diffMs / 60_000);
    const hours = Math.floor(diffMs / 3_600_000);
    const days = Math.floor(diffMs / 86_400_000);
    if (days >= 1) return `${days}d`;
    if (hours >= 1) return `${hours}h`;
    if (minutes < 1) return "now";
    return `${minutes}m`;
}

/** Last path segment (the folder name) of a chat's project path. */
export const folderName = (path: string): string => {
    const parts = path.split(/[\\/]/).filter(Boolean);
    return parts.length === 0 ? "" : parts[parts.length - 1];
}

/** Second line of the card: the folder, then the collection it was filed under. */
export const cardMeta = (path: string, collectionName: string | null): string => {
    return [folderName(path), collectionName].filter(Boolean).join(" · ");
}

/** Whether a subagent status or its board column marks completion. */
const isDoneStatus = (status: string, column?: string): boolean => status === "done" || column === "done";

/** Status dot colour class for a nested subagent row. */
const nestedDot = (status: string, column?: string): string => {
    if (status === "error") return "bg-error";
    if (status === "cancelled") return "bg-text-muted";
    if (isDoneStatus(status, column)) return "bg-success";
    if (column === "review") return "bg-warning";
    return "bg-accent";
}

/* --------------------------------------------------------------------- rows */

export interface ChatShelfRowProps {
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

/** Colour submenu shared shape: radio list over the chat colour palette. */
const ChatColourSubmenuItems = ({ color, chooseColor }: {
    color: ChatColor | null;
    chooseColor: (next: string) => void;
}) => (
    <>
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
    </>
);

/** Trigger button for the chat actions dropdown. */
const ChatActionsTrigger = () => (
    <Tooltip content="Chat actions" side="bottom">
        <DropdownMenuTrigger asChild>
            <button
                type="button"
                aria-label="Chat actions"
                className="flex size-6 items-center justify-center rounded-md text-text-muted hover:bg-panel-active hover:text-text-primary"
            >
                <Icon icon={MoreHorizontal20Regular} className="icon-sm" />
            </button>
        </DropdownMenuTrigger>
    </Tooltip>
);

/** Hover-revealed row actions: pin button plus the lifecycle and colour menus. */
const ChatRowActionMenus = ({ pinned, color, actions, chooseColor, addToCollection, onTogglePin }: {
    pinned: boolean;
    color: ChatColor | null;
    actions: ReturnType<typeof buildChatLifecycleActions>;
    chooseColor: (next: string) => void;
    addToCollection: () => void;
    onTogglePin: (pinned: boolean) => void;
}) => {
    const dropdown = {
        Item: (props: { onClick?: () => void; className?: string; children?: ReactNode }) => (
            <DropdownMenuItem {...props} />
        ),
        Separator: () => <DropdownMenuSeparator />,
    };
    return (
        <span className="flex min-w-0 overflow-hidden">
            {pinned ? null : (
            <Tooltip content="Pin" side="bottom">
                <button
                    type="button"
                    aria-label="Pin"
                    onClick={() => onTogglePin(true)}
                    className="flex size-6 items-center justify-center rounded-md text-text-muted hover:bg-panel-active hover:text-text-primary"
                >
                    <Icon icon={Pin20Regular} className="icon-sm" />
                </button>
            </Tooltip>
            )}
            <DropdownMenu modal={false}>
                <ChatActionsTrigger />
                <DropdownMenuContent side="bottom" align="end" sideOffset={6} className="min-w-48">
                    {renderLifecycleActions(actions, dropdown)}
                    <DropdownMenuSeparator />
                    <DropdownMenuSub>
                        <ChatColourSubmenuItems color={color} chooseColor={chooseColor} />
                    </DropdownMenuSub>
                    <DropdownMenuItem onClick={addToCollection}>
                        <Icon icon={Collections20Regular} />
                        Add to collection
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </span>
    );
};
/** Expanded list of a chat's subagents under its row. */
const ChatRowSubagents = ({ id, color, subagents, onOpen }: {
    id: string;
    color: ChatColor | null;
    subagents: SubagentCard[];
    onOpen: () => void;
}) => {
    /** Open one subagent: clear the parent chat's unread flag, open it, then show the worker. */
    const openWorker = (card: SubagentCard) => {
        clearChatUnread(id);
        onOpen();
        openSubagent(card.id);
    };
    return (
        <div className="flex flex-col">
            {subagents.map((card) => (
                <button
                    key={`s-${card.id}`}
                    type="button"
                    onClick={() => openWorker(card)}
                    className={cn(
                        "flex h-8 items-center gap-2 pr-2 pl-7 text-left text-sm text-text-secondary",
                        color
                            ? "hover:bg-[color-mix(in_oklch,var(--chat-tint)_16%,transparent)] hover:text-text-primary"
                            : "hover:bg-panel-hover hover:text-text-primary",
                    )}
                >
                    <span className={cn("size-1.5 shrink-0 rounded-full", nestedDot(card.status))} aria-hidden />
                    <span className="block min-w-0 flex-1 overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,#000_0,#000_calc(100%-1.5rem),transparent)]">
                        {card.title}
                    </span>
                </button>
            ))}
        </div>
    );
};

/** Colour submenu for the row context menu. */
const ChatColourContextSubmenu = ({ color, chooseColor }: {
    color: ChatColor | null;
    chooseColor: (next: string) => void;
}) => (
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
);

/** The row's right-click menu: lifecycle actions plus colour and collection entries. */
const ChatRowContextMenu = ({ actions, color, chooseColor, addToCollection }: {
    actions: ReturnType<typeof buildChatLifecycleActions>;
    color: ChatColor | null;
    chooseColor: (next: string) => void;
    addToCollection: () => void;
}) => {
    const context = {
        Item: (props: { onClick?: () => void; className?: string; children?: ReactNode }) => (
            <ContextMenuItem {...props} />
        ),
        Separator: () => <ContextMenuSeparator />,
    };
    return (
        <ContextMenuContent className="min-w-48">
            {renderLifecycleActions(actions, context)}
            <ContextMenuSeparator />
            <ChatColourContextSubmenu color={color} chooseColor={chooseColor} />
            <ContextMenuItem onClick={addToCollection}>
                <Icon icon={Collections20Regular} />
                Add to collection
            </ContextMenuItem>
        </ContextMenuContent>
    );
};

/** Status dots at the row edge: generation spinner and unread marker. */
const ChatRowStatusDots = ({ generating, unread }: { generating: boolean; unread: boolean }) => (
    <span className="flex shrink-0 items-center gap-1">
        {generating ? (
            <Eclipse size={12} className="text-text-muted" aria-hidden />
        ) : null}
        {unread ? (
            <span className="size-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />
        ) : null}
    </span>
);

/** Unpin button shown on pinned rows. */
const ChatRowUnpinButton = ({ pinned, onTogglePin }: {
    pinned: boolean;
    onTogglePin: (pinned: boolean) => void;
}) => pinned ? (
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
) : null;

/** Chevron toggle that expands or collapses the subagent list. */
const ChatRowSubagentToggle = ({ nestedCount, expanded, setExpanded }: {
    nestedCount: number;
    expanded: boolean;
    setExpanded: React.Dispatch<React.SetStateAction<boolean>>;
}) => nestedCount > 0 ? (
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
) : null;

/** The row's trailing cluster: status dots, hover actions, unpin, and the subagent toggle. */
const ChatRowTrailingActions = ({ generating, unread, pinned, nestedCount, expanded, color, actions, chooseColor, addToCollection, onTogglePin, setExpanded }: {
    generating: boolean;
    unread: boolean;
    pinned: boolean;
    nestedCount: number;
    expanded: boolean;
    color: ChatColor | null;
    actions: ReturnType<typeof buildChatLifecycleActions>;
    chooseColor: (next: string) => void;
    addToCollection: () => void;
    onTogglePin: (pinned: boolean) => void;
    setExpanded: React.Dispatch<React.SetStateAction<boolean>>;
}) => (
    <>
        <ChatRowStatusDots generating={generating} unread={unread} />
        <span className="flex shrink-0 items-center">
            <span className="grid grid-cols-[0fr] overflow-hidden transition-[grid-template-columns] duration-150 ease-[var(--ease-out)] group-hover/chat:grid-cols-[1fr] group-has-[[data-state=open]]/chat:grid-cols-[1fr]">
            <span className="flex min-w-0 overflow-hidden">
            <ChatRowActionMenus
                pinned={pinned}
                color={color}
                actions={actions}
                chooseColor={chooseColor}
                addToCollection={addToCollection}
                onTogglePin={onTogglePin}
            />
            </span>
            </span>
            <ChatRowUnpinButton pinned={pinned} onTogglePin={onTogglePin} />
        </span>
        <ChatRowSubagentToggle nestedCount={nestedCount} expanded={expanded} setExpanded={setExpanded} />
    </>
);

/** Row-open button: selection checkbox, title, and card meta line. */
const ChatRowOpenButton = ({ title, variant, timestamp, meta, selecting, selected, onToggleSelect, onOpen }: {
    title: string;
    variant: RowVariant;
    timestamp: number;
    meta: string;
    selecting: boolean;
    selected: boolean;
    onToggleSelect?: () => void;
    onOpen: () => void;
}) => {
    /** Cmd/Ctrl-click toggles selection instead of opening the chat. */
    const handleOpenClick = (event: React.MouseEvent) => {
        if (event.ctrlKey || event.metaKey) {
            onToggleSelect?.();
            return;
        }
        onOpen();
    };
    const fade = "1.25rem";
    return (
        <button
            type="button"
            onClick={handleOpenClick}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
    <span
        className={cn(
            "grid shrink-0 transition-[grid-template-columns,opacity,margin] duration-200 ease-[var(--ease-out)]",
            selecting ? "mr-1 grid-cols-[14px] opacity-100" : "grid-cols-[0px] opacity-0",
        )}
    >
        <span className="overflow-hidden">
            <Checkmark
                checked={selected}
                onCheckedChange={() => onToggleSelect?.()}
                label={`Select ${title}`}
                tabIndex={selecting ? 0 : -1}
            />
        </span>
    </span>
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
                    {chatRelativeTime(timestamp, Date.now())}
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
    );
};

/** Hover and active classes for an uncoloured row. */
const uncolouredChromeClass = (color: ChatColor | null, active: boolean): string | false =>
    !color && (active ? "bg-panel-hover text-text-primary" : "text-text-primary hover:bg-panel-hover");

/** Row chrome classes: card height, uncoloured squircle/hover states, coloured hover wash. */
const rowChromeClass = (variant: RowVariant, color: ChatColor | null, active: boolean): string =>
    cn(
        "group/chat relative flex w-full items-center gap-1 px-2 text-sm",
        variant === "card" ? "h-[78px] py-2" : "h-10",
        !color && "squircle-2xl",
        "transition-colors duration-[var(--transition-fast)] ease-[var(--ease-out)]",
        uncolouredChromeClass(color, active),
        color && "text-text-primary hover:bg-[color-mix(in_oklch,var(--chat-tint)_12%,transparent)]",
    );

/** Outer tint classes for a coloured row; the active tint stacks stronger. */
const outerTintClass = (color: ChatColor | null, active: boolean): string | null =>
    color && (active
        ? "bg-[color-mix(in_oklch,var(--chat-tint)_30%,transparent)] text-text-primary"
        : "bg-[color-mix(in_oklch,var(--chat-tint)_22%,transparent)] text-text-primary");

/** Expansion state for a row's subagents; opens the first time subagents appear. */
const useSubagentExpansion = (nestedCount: number) => {
    const [expanded, setExpanded] = useState(false);
    // Expand the row the first time its subagents appear. Tracked during render, not in an effect.
    const [seenWorkers, setSeenWorkers] = useState(0);
    if (seenWorkers !== nestedCount) {
        setSeenWorkers(nestedCount);
        if (seenWorkers === 0 && nestedCount > 0) setExpanded(true);
    }
    return { expanded, setExpanded };
};

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
}: ChatShelfRowProps & { id: string }) => {
    const generating = useIsChatGenerating(id);
    const [renaming, setRenaming] = useState(false);
    const [draft, setDraft] = useState(title);
    const nestedCount = subagents.length;
    const { expanded, setExpanded } = useSubagentExpansion(nestedCount);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!renaming) return;
        inputRef.current?.focus();
        inputRef.current?.select();
    }, [renaming]);

    /** Commit the inline rename on blur or Enter; empty or unchanged drafts revert. */
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

    /** Enter commits the rename; Escape cancels back to the current title. */
    const handleRenameKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            commitRename();
        }
        if (e.key === "Escape") {
            e.preventDefault();
            setDraft(title);
            setRenaming(false);
        }
    };

    /** Begin the inline rename with the current title as the draft. */
    const startRename = () => {
        setDraft(title);
        setRenaming(true);
    };

    // The row overrides `startRename` with its own so Rename is guaranteed to
    // target a row that is on screen; everything else is shared with the
    // selection menu in the header.
    const actions = buildChatLifecycleActions(
        [{ id, title, path, pinned }],
        { ...handlers, startRename },
    );
    /** File this chat into a collection through the shared lifecycle handler. */
    const addToCollection = () => handlers.addToCollection([id]);

    /** Apply a colour from either menu; "none" clears the chat tint. */
    const chooseColor = (next: string) => {
        setChatColor(id, next === "none" ? null : (next as ChatColor));
    };


    const meta = cardMeta(path, collection);

    return (
        <div
            data-motion-id={id}
            data-row-variant={variant}
            className={cn(
                "flex flex-col overflow-hidden",
                outerTintClass(color, active),
            )}
            style={color ? { ["--chat-tint" as string]: CHAT_COLOR_HEX[color] } : undefined}
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
                                onKeyDown={handleRenameKeyDown}
                                className="w-full rounded bg-transparent px-0 text-sm text-text-primary outline-none ring-1 ring-border"
                                onClick={(e) => e.stopPropagation()}
                            />
                        ) : (
                            <>
                                <ChatRowOpenButton
                                    title={title}
                                    variant={variant}
                                    timestamp={timestamp}
                                    meta={meta}
                                    selecting={selecting}
                                    selected={selected}
                                    onToggleSelect={onToggleSelect}
                                    onOpen={onOpen}
                                />
<ChatRowTrailingActions
                                    generating={generating}
                                    unread={unread}
                                    pinned={pinned}
                                    nestedCount={nestedCount}
                                    expanded={expanded}
                                    color={color}
                                    actions={actions}
                                    chooseColor={chooseColor}
                                    addToCollection={addToCollection}
                                    onTogglePin={onTogglePin}
                                    setExpanded={setExpanded}
                                />
                            </>
                        )}
                    </div>
                </ContextMenuTrigger>
                <ChatRowContextMenu
                actions={actions}
                color={color}
                chooseColor={chooseColor}
                addToCollection={addToCollection}
            />
            </ContextMenu>
            {expanded && nestedCount > 0 ? (
                <ChatRowSubagents id={id} color={color} subagents={subagents} onOpen={onOpen} />
            ) : null}
        </div>
    );
};

/* ---------------------------------------------------------------- the shelves */

/** Collapsible shelf label row with its chat count. */
const ShelfHeader = ({
    shelf,
    label,
    count,
    open,
    onToggle,
}: {
    shelf: ChatShelfId;
    label: string;
    count: number;
    open: boolean;
    onToggle: (shelf: ChatShelfId) => void;
}) => {
    return (
        <button
            type="button"
            data-shelf-header={shelf}
            aria-expanded={open}
            onClick={() => onToggle(shelf)}
            className="flex h-6 w-full items-center gap-1 rounded-md pr-2 pl-1 text-xs font-medium text-text-muted transition-colors duration-[var(--transition-fast)] ease-[var(--ease-out)] hover:bg-panel-hover hover:text-text-secondary"
        >
            <Icon
                icon={ChevronDown20Regular}
                className={cn(
                    "icon-sm transition-transform duration-200 ease-[var(--ease-out)]",
                    !open && "-rotate-90",
                )}
            />
            <span className="min-w-0 flex-1 truncate text-left">{label}</span>
            <span className="shrink-0 tabular-nums text-text-disabled">{count}</span>
        </button>
    );
}

/** The flat, motion-tracked sequence of shelf headers and chat rows. */
export const ChatShelves = ({
    sections,
    rowProps,
    collapsed,
    onToggleShelf,
}: {
    sections: readonly ChatShelfSection[];
    rowProps: (chat: Conversation) => Omit<ChatShelfRowProps, "variant">;
    collapsed: ReadonlySet<ChatShelfId>;
    onToggleShelf: (shelf: ChatShelfId) => void;
}) => {
    const { containerRef, trackRender } = useFlipMotion<HTMLDivElement>();

    useLayoutEffect(() => {
        trackRender();
    });

    const children = useMemo(() => buildShelfChildren(sections, collapsed), [sections, collapsed]);

    return (
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
                    />
                ) : (
                    <ChatRow
                        key={child.key}
                        id={child.chat.id}
                        variant={child.variant}
                        {...rowProps(child.chat)}
                    />
                ),
            )}
        </div>
    );
};
