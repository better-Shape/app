"use client";


import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { type IconGlyph, Icon } from "@/components/ui/icon";

import { cn } from "@/lib/utils";
import {
    BETTERSHAPE_MODAL_PANEL_CLASS,
    BETTERSHAPE_OVERLAY_CLASS,
    BETTERSHAPE_OVERLAY_CONTENT_CLASS,
} from "@/lib/ui/modal-overlay";
import { useOverlayRoot } from "@/lib/ui/overlay-root";

export type QuickPickItem = {
    id: string;
    label: string;
    description?: string;
    icon?: IconGlyph;
    iconNode?: React.ReactNode;
    /** Right-side muted hint */
    hint?: string;
};

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title?: string;
    placeholder?: string;
    /** When set, shows a filterable text field (command-palette style). */
    query?: string;
    onQueryChange?: (value: string) => void;
    items: QuickPickItem[];
    onSelect: (item: QuickPickItem) => void;
    /** Enter submits a nonempty query when provided; item clicks still select. */
    onSubmitQuery?: (query: string) => void;
    emptyText?: string;
};

/** Include IME boundary keydowns that can arrive after composition has ended. */
const isCompositionKey = (event: KeyboardEvent): boolean => event.isComposing || event.keyCode === 229;

/** What a keypress asks the picker to do. */
type PickAction = "next" | "previous" | "confirm";

/** The keys the picker routes, and the action each one asks for. */
const PICK_ACTIONS: Record<string, PickAction | undefined> = {
    ArrowDown: "next",
    ArrowUp: "previous",
    Enter: "confirm",
};

/** Translate a keypress into a picker action; composing keys belong to the input method. */
const pickAction = (event: KeyboardEvent): PickAction | null =>
    isCompositionKey(event) ? null : PICK_ACTIONS[event.key] ?? null;

/** What the picker can do in response to a key: wrapped moves and row confirmation. */
type PickKeyEffects = { move: (delta: number) => void; submit: () => void };

/** The effect of each action: Enter confirms the highlight, the arrows step through the list. */
const PICK_KEY_EFFECTS: Record<PickAction, (keys: PickKeyEffects) => void> = {
    next: ({ move }) => move(1),
    previous: ({ move }) => move(-1),
    confirm: ({ submit }) => submit(),
};

/**
 * A focused row button owns its own Enter activation. Confirming here instead would select the
 * *highlighted* row and swallow the click the focused button produces, so a keyboard user could
 * not activate the row they tabbed to.
 */
const rowOwnsKey = (action: PickAction, target: EventTarget | null) =>
    action === "confirm" && target instanceof Element && target.closest("button") !== null;

/** The picker identity a highlight belongs to: reopening, retyping or a new result set. */
type SelectionScope = { open: boolean; query?: string; ids: readonly string[] };

/** Wrap through results, keeping an empty list out of modulo-zero arithmetic. */
const moveSelection = (length: number, delta: number) => (current: number) => {
    if (length === 0) return current;
    return (current + delta + length) % length;
};

/**
 * Whether a highlight still belongs to the same picker identity.
 *
 * The result set is identified by its item ids, not by its length. An
 * asynchronous list that replaces or reorders results while the count stays the
 * same produced the same scope, so the highlight stayed on index 2 while the row
 * under it changed, and Enter confirmed the wrong item.
 */
const sameScope = (a: SelectionScope, b: SelectionScope) =>
    a.open === b.open &&
    a.query === b.query &&
    a.ids.length === b.ids.length &&
    a.ids.every((id, index) => id === b.ids[index]);

/**
 * The highlight follows the picker's identity: it returns to the first row when the dialog
 * reopens, the query changes, or the result set changes, so the row a keypress confirms is
 * always the row the current query produced.
 */
const usePickSelection = (scope: SelectionScope) => {
    const [selected, setSelected] = React.useState(0);
    const [identity, setIdentity] = React.useState(scope);
    if (!sameScope(identity, scope)) {
        setIdentity(scope);
        setSelected(0);
    }
    return [selected, setSelected] as const;
};

/** Focus the filter field while it is shown, cancelling pending frame work when it is not. */
const useFilterFocus = (
    open: boolean,
    showInput: boolean,
    inputRef: React.RefObject<HTMLInputElement | null>,
) => {
    React.useEffect(() => {
        const frame = open && showInput ? requestAnimationFrame(() => inputRef.current?.focus()) : undefined;
        return () => {
            if (frame !== undefined) cancelAnimationFrame(frame);
        };
    }, [open, showInput, inputRef]);
};

/** Non-filterable picker: the placeholder is the only line under the title. */
const PlaceholderLine = ({ placeholder, title }: { placeholder: string; title?: string }) =>
    placeholder ? (
        <div className={cn("px-2.5 text-sm text-text-muted", title ? "pb-2" : "py-2")}>{placeholder}</div>
    ) : null;

/** The filter field, shown only when the picker owns a query. */
const FilterField = ({
    placeholder,
    query,
    onQueryChange,
    inputRef,
}: {
    placeholder: string;
    query?: string;
    /** Absent only in the impossible case of a field rendered without a query owner. */
    onQueryChange?: (value: string) => void;
    inputRef: React.RefObject<HTMLInputElement | null>;
}) => (
    <div className="px-2 pb-1.5 pt-1">
        <input
            ref={inputRef}
            value={query}
            onChange={(event) => onQueryChange?.(event.target.value)}
            placeholder={placeholder}
            className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
            aria-label={placeholder}
        />
    </div>
);

/** Title line and, when the picker is filterable, the filter field itself. */
const PickHeader = ({
    title,
    placeholder,
    showInput,
    query,
    onQueryChange,
    inputRef,
}: {
    title?: string;
    placeholder: string;
    showInput: boolean;
    query?: string;
    onQueryChange?: (value: string) => void;
    inputRef: React.RefObject<HTMLInputElement | null>;
}) => (
    <>
        {title ? <div className="px-2.5 py-1.5 text-center text-sm text-text-primary">{title}</div> : null}
        {showInput ? (
            <FilterField
                placeholder={placeholder}
                query={query}
                onQueryChange={onQueryChange}
                inputRef={inputRef}
            />
        ) : (
            <PlaceholderLine placeholder={placeholder} title={title} />
        )}
    </>
);

/** Icon slot: a caller-provided node wins over a catalog glyph, and neither renders nothing. */
const PickRowIcon = ({ iconNode, icon }: Pick<QuickPickItem, "iconNode" | "icon">) => {
    if (iconNode) {
        return <span className="flex size-4 shrink-0 items-center justify-center">{iconNode}</span>;
    }
    if (!icon) return null;
    return <Icon icon={icon} className="shrink-0 text-text-muted" />;
};

/** Row label with its muted description, kept to one truncating line. */
const PickRowLabel = ({ label, description }: Pick<QuickPickItem, "label" | "description">) => (
    <span className="min-w-0 flex-1 truncate font-medium text-text-primary">
        {label}
        {description ? <span className="ml-2 font-normal text-text-muted">{description}</span> : null}
    </span>
);

/** Optional trailing hint, kept outside the label's truncation. */
const PickRowHint = ({ hint }: Pick<QuickPickItem, "hint">) =>
    hint ? <span className="shrink-0 text-xs text-text-muted">{hint}</span> : null;

/** One selectable result row: icon, label with its description, and a hint. */
const PickRow = ({
    item,
    selected,
    onHover,
    onSelect,
}: {
    item: QuickPickItem;
    selected: boolean;
    onHover: () => void;
    onSelect: () => void;
}) => (
    <button
        type="button"
        onMouseEnter={onHover}
        onClick={onSelect}
        className={cn(
            "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm",
            selected ? "bg-panel-hover text-text-primary" : "text-text-secondary hover:bg-panel-hover/60",
        )}
    >
        <PickRowIcon iconNode={item.iconNode} icon={item.icon} />
        <PickRowLabel label={item.label} description={item.description} />
        <PickRowHint hint={item.hint} />
    </button>
);

/** First nonempty candidate, so a caller that passes "" gets the documented default. */
const firstNonEmpty = (...values: (string | undefined)[]) => values.find(value => value) ?? "";

/** Accessible names for the dialog: the caller's title first, then the placeholder. */
const pickerLabels = (title?: string, placeholder?: string) => ({
    title: firstNonEmpty(title, placeholder, "Quick pick"),
    description: firstNonEmpty(placeholder, "Select an option"),
});

/** The field is filterable only when the caller owns both the query value and its updates. */
const ownsFilterField = (query?: string, onQueryChange?: (value: string) => void) =>
    query !== undefined && onQueryChange !== undefined;

/** Keyboard ownership for the picker: wrapping moves, row confirmation and query submission. */
const usePickKeys = ({
    items,
    selected,
    setSelected,
    onSelect,
    query,
    onSubmitQuery,
}: {
    items: QuickPickItem[];
    selected: number;
    setSelected: React.Dispatch<React.SetStateAction<number>>;
    onSelect: (item: QuickPickItem) => void;
    query?: string;
    onSubmitQuery?: (query: string) => void;
}) => {
    /** Move the highlight, wrapping at both ends. */
    const move = (delta: number) => setSelected(moveSelection(items.length, delta));

    /** Select a result; clicking must not submit the query instead of that result. */
    const confirm = (index = selected) => {
        const item = items[index];
        if (item) onSelect(item);
    };

    /** Enter prefers an explicit nonempty query; otherwise confirm the highlighted result. */
    const submit = () => {
        const typed = query?.trim();
        if (onSubmitQuery && typed) onSubmitQuery(typed);
        else confirm();
    };

    /** Route a keypress: moves and confirmation only, so the field keeps the typing keys. */
    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const action = pickAction(event.nativeEvent);
        if (!action || rowOwnsKey(action, event.target)) return;
        event.preventDefault();
        PICK_KEY_EFFECTS[action]({ move, submit });
    };

    return { confirm, handleKeyDown };
};

/** The result list, or the empty state when the query matched nothing. */
const PickList = ({
    items,
    selected,
    emptyText,
    onHover,
    onSelect,
}: {
    items: QuickPickItem[];
    selected: number;
    emptyText: string;
    onHover: (index: number) => void;
    onSelect: (index: number) => void;
}) => {
    if (items.length === 0) {
        return <div className="px-2.5 py-3 text-sm text-text-muted">{emptyText}</div>;
    }
    return (
        <>
            {items.map((item, index) => (
                <PickRow
                    key={item.id}
                    item={item}
                    selected={index === selected}
                    onHover={() => onHover(index)}
                    onSelect={() => onSelect(index)}
                />
            ))}
        </>
    );
};

/** Escape must not dismiss the dialog while an IME composition is ending. */
const blockCompositionEscape = (event: KeyboardEvent) => {
    if (isCompositionKey(event)) event.preventDefault();
};

/** Picker with wrapped keyboard selection, optional search, and explicit query submission. */
export function QuickPick({
    open,
    onOpenChange,
    title,
    placeholder = "Type to filter…",
    query,
    onQueryChange,
    items,
    onSelect,
    onSubmitQuery,
    emptyText = "No results",
}: Props) {
    const overlayRoot = useOverlayRoot();
    const itemIds = React.useMemo(() => items.map((item) => item.id), [items]);
    const [selected, setSelected] = usePickSelection({ open, query, ids: itemIds });
    const inputRef = React.useRef<HTMLInputElement>(null);
    const labels = pickerLabels(title, placeholder);
    const showInput = ownsFilterField(query, onQueryChange);

    useFilterFocus(open, showInput, inputRef);
    const { confirm, handleKeyDown } = usePickKeys({
        items,
        selected,
        setSelected,
        onSelect,
        query,
        onSubmitQuery,
    });

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal container={overlayRoot}>
                <Dialog.Overlay className={cn(BETTERSHAPE_OVERLAY_CLASS, "z-[200]")} />
                <Dialog.Content
                    className={cn(
                        BETTERSHAPE_OVERLAY_CONTENT_CLASS,
                        "absolute left-1/2 top-[14%] z-[201] w-[min(520px,calc(100%-2rem))] -translate-x-1/2 outline-none",
                    )}
                    aria-describedby={undefined}
                    onEscapeKeyDown={blockCompositionEscape}
                    onKeyDown={handleKeyDown}
                >
                    <Dialog.Title className="sr-only">{labels.title}</Dialog.Title>
                    <Dialog.Description className="sr-only">{labels.description}</Dialog.Description>
                    <div className={cn(BETTERSHAPE_MODAL_PANEL_CLASS, "overflow-hidden p-1.5")}>
                        <PickHeader
                            title={title}
                            placeholder={placeholder}
                            showInput={showInput}
                            query={query}
                            onQueryChange={onQueryChange}
                            inputRef={inputRef}
                        />

                        <div className="max-h-[min(320px,50vh)] overflow-y-auto custom-scrollbar">
                            <PickList
                                items={items}
                                selected={selected}
                                emptyText={emptyText}
                                onHover={setSelected}
                                onSelect={confirm}
                            />
                        </div>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
