"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Globe20Regular } from "@fluentui/react-icons/headless/svg/globe";
import { Search20Regular } from "@fluentui/react-icons/headless/svg/search";

import { Favicon } from "@/components/ui/favicon";
import { Icon } from "@/components/ui/icon";
import { commands } from "@/lib/backend";
import type { BrowserHistoryEntry } from "@/lib/backend/types";
import { hostnameOf } from "@/lib/ui/favicon";
import { cn } from "@/lib/utils";
import { buildSuggestions, HISTORY_READ_LIMIT, type Suggestion } from "./browser-suggest";

/** How long the bar waits after a keystroke before it reads history to build the list. */
const SUGGEST_DEBOUNCE_MS = 70;

/** How long the list stays up after a blur, so a click on a row lands before it closes. */
const BLUR_GRACE_MS = 120;

/** The history the suggestions are drawn from, or nothing when the read fails. */
const readHistory = async (): Promise<BrowserHistoryEntry[]> => {
    try {
        return await commands.browserHistory("", HISTORY_READ_LIMIT);
    } catch {
        return [];
    }
};

/**
 * The suggestion list for the field's text, and the row it has selected.
 *
 * The read is debounced because every keystroke would otherwise be a round trip to the
 * backend for a list the user is still typing over. Selection resets with every rebuild: the
 * rows have changed under it, and keeping the index would highlight a different row than the
 * one that was highlighted a moment ago.
 */
const useSuggestions = (value: string, open: boolean) => {
    const [items, setItems] = useState<Suggestion[]>([]);
    const [selected, setSelected] = useState(0);
    const timer = useRef<number | null>(null);

    useEffect(() => {
        if (!open) return;
        const rebuild = async () => {
            setItems(buildSuggestions(value, await readHistory()));
            setSelected(0);
        };
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
            rebuild().catch(() => undefined);
        }, SUGGEST_DEBOUNCE_MS);
        return () => {
            if (timer.current) window.clearTimeout(timer.current);
        };
    }, [value, open]);

    return { items, selected, setSelected };
};

/** The glyph beside a row: the kind of suggestion it is, or the site's own favicon. */
const SuggestionGlyph = ({ item }: { item: Suggestion }) => {
    if (item.kind === "search") {
        return <Icon icon={Search20Regular} className="shrink-0 text-text-muted" />;
    }
    if (item.kind === "go") {
        return <Icon icon={Globe20Regular} className="shrink-0 text-text-muted" />;
    }
    return <Favicon url={item.url} size={14} />;
};

/** The text of a row, which differs by kind: a phrase, a URL, or a name over a URL. */
const SuggestionLabel = ({ item }: { item: Suggestion }) => {
    if (item.kind === "search") {
        return (
            <span className="min-w-0 truncate">
                Search Google for <span className="text-text-primary">{item.query}</span>
            </span>
        );
    }
    if (item.kind === "go") {
        return <span className="min-w-0 truncate text-text-primary">{item.url}</span>;
    }
    return (
        <>
            <span className="min-w-0 shrink truncate text-text-primary">
                {item.title || hostnameOf(item.url)}
            </span>
            <span className="min-w-0 flex-1 truncate text-text-muted">{item.url}</span>
        </>
    );
};

/** One row of the list, which is also what the pointer and the arrow keys move over. */
const SuggestionRow = ({
    item,
    active,
    onHover,
    onChoose,
}: {
    item: Suggestion;
    active: boolean;
    onHover: () => void;
    onChoose: () => void;
}) => (
    <button
        type="button"
        // The blur is what closes the list, and preventing the default press keeps focus in
        // the field so the row is still clickable when the list would have gone first.
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={onHover}
        onClick={onChoose}
        className={cn(
            "flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs",
            "transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]",
            active ? "bg-panel-hover text-text-primary" : "text-text-secondary",
        )}
    >
        <SuggestionGlyph item={item} />
        <SuggestionLabel item={item} />
    </button>
);

/** The list itself, which is only mounted while it has rows to show. */
const SuggestionList = ({
    items,
    selected,
    onSelect,
    onChoose,
}: {
    items: readonly Suggestion[];
    selected: number;
    onSelect: (index: number) => void;
    onChoose: (url: string) => void;
}) => (
    <div
        data-bettershape-float=""
        className="absolute top-full left-0 right-0 z-30 mt-1 flex max-h-64 flex-col gap-0.5 overflow-auto rounded-xl border border-border-subtle bg-surface-3 p-1 shadow-sm"
    >
        {items.map((item, index) => (
            <SuggestionRow
                key={`${item.kind}-${item.url}`}
                item={item}
                active={index === selected}
                onHover={() => onSelect(index)}
                onChoose={() => onChoose(item.url)}
            />
        ))}
    </div>
);

/**
 * The browser's address field: what the window is showing, and where to go next.
 *
 * Enter follows the highlighted row rather than the text, which is what makes the arrow keys
 * work. Escape closes the list and leaves the text alone. The list is drawn over the page
 * rather than in the toolbar, so a long suggestion list cannot push the frame down.
 */
export const UrlBar = ({
    value,
    onChange,
    onSubmit,
    disabled,
}: {
    value: string;
    onChange: (next: string) => void;
    onSubmit: (raw: string) => void;
    disabled?: boolean;
}) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const [open, setOpen] = useState(false);
    const { items, selected, setSelected } = useSuggestions(value, open);
    const showing = open && items.length > 0;

    /** Moves the highlight by one row, wrapping at both ends so a held key cycles. */
    const cycle = (delta: number) =>
        setSelected((index) => (index + delta + items.length) % items.length);

    /** Moves the highlight for an arrow key, and answers whether the key was one of them. */
    const moveHighlight = (key: string) => {
        const delta = key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : 0;
        if (delta === 0) return false;
        cycle(delta);
        return true;
    };

    /** Closes the list, drops focus, and hands the chosen URL to the window. */
    const commit = (raw: string) => {
        setOpen(false);
        inputRef.current?.blur();
        onSubmit(raw);
    };

    /** Enter follows the highlighted row when there is one, and the text when there is not. */
    const submitField = (event: FormEvent) => {
        event.preventDefault();
        const pick = showing ? items[selected] : undefined;
        commit(pick ? pick.url : value);
    };

    /** Escape is the way out of the list; the arrow keys nudge the row under the cursor. */
    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            inputRef.current?.blur();
            return;
        }
        if (!showing) return;
        if (!moveHighlight(event.key)) return;
        event.preventDefault();
    };

    return (
        <div className="relative mx-1 min-w-0 flex-1">
            <form onSubmit={submitField}>
                <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    disabled={disabled}
                    onChange={(event) => {
                        onChange(event.target.value);
                        setOpen(true);
                    }}
                    onFocus={(event) => {
                        event.currentTarget.select();
                        setOpen(true);
                    }}
                    onBlur={() => window.setTimeout(() => setOpen(false), BLUR_GRACE_MS)}
                    onKeyDown={handleKeyDown}
                    placeholder="Search or enter URL"
                    spellCheck={false}
                    autoComplete="off"
                    className={cn(
                        "h-6 w-full rounded-md bg-surface-1 px-2 text-xs text-text-primary",
                        "outline-none placeholder:text-text-muted focus:ring-1 focus:ring-border-focus",
                        "disabled:opacity-50",
                    )}
                />
            </form>
            {showing ? (
                <SuggestionList
                    items={items}
                    selected={selected}
                    onSelect={setSelected}
                    onChoose={commit}
                />
            ) : null}
        </div>
    );
};
