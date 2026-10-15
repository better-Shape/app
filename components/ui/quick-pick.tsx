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

/** Translate a keypress into a picker action; composing keys belong to the input method. */
function pickAction(event: KeyboardEvent): PickAction | null {
    if (isCompositionKey(event)) return null;
    if (event.key === "ArrowDown") return "next";
    if (event.key === "ArrowUp") return "previous";
    if (event.key === "Enter") return "confirm";
    return null;
}

/** The picker identity a highlight belongs to: reopening, retyping or a new result set. */
type SelectionScope = { open: boolean; query?: string; count: number };

/** Wrap through results, keeping an empty list out of modulo-zero arithmetic. */
const moveSelection = (length: number, delta: number) => (current: number) => {
    if (length === 0) return current;
    return (current + delta + length) % length;
};

/**
 * The highlight follows the picker's identity: it returns to the first row when the dialog
 * reopens, the query changes, or the result count changes, so the row a keypress confirms is
 * always the row the current query produced.
 */
function usePickSelection(scope: SelectionScope) {
    const [selected, setSelected] = React.useState(0);
    const [identity, setIdentity] = React.useState(scope);
    if (identity.open !== scope.open || identity.query !== scope.query || identity.count !== scope.count) {
        setIdentity(scope);
        setSelected(0);
    }
    return [selected, setSelected] as const;
}

/** Focus the filter field while it is shown, cancelling pending frame work when it is not. */
function useFilterFocus(active: boolean, inputRef: React.RefObject<HTMLInputElement | null>) {
    React.useEffect(() => {
        const frame = active ? requestAnimationFrame(() => inputRef.current?.focus()) : undefined;
        return () => {
            if (frame !== undefined) cancelAnimationFrame(frame);
        };
    }, [active, inputRef]);
}

/** Title line and, when the picker is filterable, the filter field itself. */
function PickHeader({
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
    onQueryChange: (value: string) => void;
    inputRef: React.RefObject<HTMLInputElement | null>;
}) {
    if (showInput) {
        return (
            <div className="px-2 pb-1.5 pt-1">
                <input
                    ref={inputRef}
                    value={query}
                    onChange={(event) => onQueryChange(event.target.value)}
                    placeholder={placeholder}
                    className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
                    aria-label={placeholder}
                />
            </div>
        );
    }
    if (!placeholder) return null;
    return (
        <div className={cn("px-2.5 text-sm text-text-muted", title ? "pb-2" : "py-2")}>{placeholder}</div>
    );
}

/** One selectable result row: icon or icon node, label with its description, and a hint. */
function PickRow({
    item,
    selected,
    onHover,
    onSelect,
}: {
    item: QuickPickItem;
    selected: boolean;
    onHover: () => void;
    onSelect: () => void;
}) {
    return (
        <button
            type="button"
            onMouseEnter={onHover}
            onClick={onSelect}
            className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm",
                selected ? "bg-panel-hover text-text-primary" : "text-text-secondary hover:bg-panel-hover/60",
            )}
        >
            {item.iconNode ? (
                <span className="flex size-4 shrink-0 items-center justify-center">{item.iconNode}</span>
            ) : item.icon ? (
                <Icon icon={item.icon} className="shrink-0 text-text-muted" />
            ) : null}
            <span className="min-w-0 flex-1 truncate font-medium text-text-primary">
                {item.label}
                {item.description ? (
                    <span className="ml-2 font-normal text-text-muted">{item.description}</span>
                ) : null}
            </span>
            {item.hint ? <span className="shrink-0 text-xs text-text-muted">{item.hint}</span> : null}
        </button>
    );
}

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
    const [selected, setSelected] = usePickSelection({ open, query, count: items.length });
    const inputRef = React.useRef<HTMLInputElement>(null);
    const showInput = query !== undefined && onQueryChange !== undefined;

    useFilterFocus(open && showInput, inputRef);

    const move = (delta: number) => setSelected(moveSelection(items.length, delta));

    /** Select a result; clicking must not submit the query instead of that result. */
    const confirm = (index = selected) => {
        const item = items[index];
        if (item) onSelect(item);
    };

    /** Enter prefers an explicit nonempty query; otherwise confirm the highlighted result. */
    const submit = () => {
        const value = query?.trim();
        if (onSubmitQuery && value) onSubmitQuery(value);
        else confirm();
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const action = pickAction(event.nativeEvent);
        if (!action) return;
        event.preventDefault();
        if (action === "confirm") submit();
        else move(action === "next" ? 1 : -1);
    };

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
                    onEscapeKeyDown={(event) => {
                        if (isCompositionKey(event)) event.preventDefault();
                    }}
                    onKeyDown={handleKeyDown}
                >
                    <Dialog.Title className="sr-only">{title || placeholder || "Quick pick"}</Dialog.Title>
                    <Dialog.Description className="sr-only">
                        {placeholder || "Select an option"}
                    </Dialog.Description>
                    <div className={cn(BETTERSHAPE_MODAL_PANEL_CLASS, "overflow-hidden p-1.5")}>
                        {title ? (
                            <div className="px-2.5 py-1.5 text-center text-sm text-text-primary">
                                {title}
                            </div>
                        ) : null}
                        <PickHeader
                            title={title}
                            placeholder={placeholder}
                            showInput={showInput}
                            query={query}
                            onQueryChange={onQueryChange ?? (() => {})}
                            inputRef={inputRef}
                        />

                        <div className="max-h-[min(320px,50vh)] overflow-y-auto custom-scrollbar">
                            {items.length === 0 ? (
                                <div className="px-2.5 py-3 text-sm text-text-muted">{emptyText}</div>
                            ) : (
                                items.map((item, index) => (
                                    <PickRow
                                        key={item.id}
                                        item={item}
                                        selected={index === selected}
                                        onHover={() => setSelected(index)}
                                        onSelect={() => confirm(index)}
                                    />
                                ))
                            )}
                        </div>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
