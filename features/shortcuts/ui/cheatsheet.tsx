"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Dismiss20Regular } from "@fluentui/react-icons/headless/svg/dismiss";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { SearchInput } from "@/components/ui/search";
import {
    BETTERSHAPE_MODAL_PANEL_CLASS,
    BETTERSHAPE_OVERLAY_CLASS,
    BETTERSHAPE_OVERLAY_CONTENT_CLASS,
} from "@/lib/ui/modal-overlay";
import { useOverlayRoot } from "@/lib/ui/overlay-root";
import { loadKeybindings, splitKeyChord, type KeyBinding } from "@/lib/ui/shortcuts";
import { countBoundShortcuts, groupShortcuts } from "@/features/shortcuts/lib/group-shortcuts";
import { cn } from "@/lib/utils";

/**
 * Keyboard shortcut reference. Reflects user overrides and presets, because it
 * reads the same `loadKeybindings()` the dispatcher uses.
 */
export function KeyboardShortcutsCheatsheet() {
    const overlayRoot = useOverlayRoot();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [bindings, setBindings] = useState<KeyBinding[]>(() => loadKeybindings());

    const openSheet = useCallback(() => {
        setBindings(loadKeybindings());
        setOpen(true);
    }, []);

    useEffect(() => {
        const onChange = () => setBindings(loadKeybindings());
        window.addEventListener("bettershape-open-shortcuts", openSheet);
        window.addEventListener("bettershape-keybindings-changed", onChange);
        return () => {
            window.removeEventListener("bettershape-open-shortcuts", openSheet);
            window.removeEventListener("bettershape-keybindings-changed", onChange);
        };
    }, [openSheet]);

    const groups = useMemo(() => groupShortcuts(bindings, query), [bindings, query]);
    const total = countBoundShortcuts(bindings);

    return (
        <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Portal container={overlayRoot}>
                <Dialog.Overlay className={BETTERSHAPE_OVERLAY_CLASS} />
                <Dialog.Content
                    className={cn(
                        BETTERSHAPE_OVERLAY_CONTENT_CLASS,
                        BETTERSHAPE_MODAL_PANEL_CLASS,
                        "absolute top-[10%] left-1/2 z-50 flex max-h-[76%] w-[min(760px,calc(100%-2rem))] -translate-x-1/2 flex-col overflow-hidden focus:outline-none",
                    )}
                >
                    <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-3 py-2">
                        <Dialog.Title className="text-sm font-medium text-text-primary">
                            Keyboard Shortcuts
                        </Dialog.Title>
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-text-muted">{total} bound</span>
                            <Dialog.Close asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    aria-label="Close keyboard shortcuts"
                                >
                                    <Icon icon={Dismiss20Regular} />
                                </Button>
                            </Dialog.Close>
                        </div>
                    </div>
                    <Dialog.Description className="sr-only">
                        Every command that has a keyboard shortcut, grouped by category. Shortcuts
                        can be changed in Settings.
                    </Dialog.Description>

                    <div className="px-3 pt-2">
                        <SearchInput
                            autoFocus
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Filter shortcuts…"
                            aria-label="Filter shortcuts"
                            borderless
                            onClear={() => setQuery("")}
                        />
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
                        {groups.length === 0 ? (
                            <p className="py-10 text-center text-sm text-text-muted">
                                No shortcuts match {`"${query}"`}.
                            </p>
                        ) : (
                            groups.map(({ category, list }) => (
                                <section key={category} className="mb-4 last:mb-0">
                                    <h3 className="mb-1 mt-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                                        {category}
                                    </h3>
                                    <div className="grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2">
                                        {list.map((binding) => (
                                            <div
                                                key={`${binding.id}-${binding.key}`}
                                                className="flex min-w-0 items-center justify-between gap-3 rounded px-1 py-1 hover:bg-panel-hover"
                                                title={binding.when}
                                            >
                                                <span className="truncate text-sm text-text-secondary">
                                                    {binding.label}
                                                </span>
                                                <KeyChord chord={binding.key} source={binding.source} />
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            ))
                        )}
                    </div>

                    <div className="flex items-center justify-between gap-3 border-t border-border-subtle px-3 py-2 text-[11px] text-text-muted">
                        <span>Shortcuts can be changed in Settings, under Keyboard Shortcuts.</span>
                        <span className="flex shrink-0 items-center gap-1">
                            <kbd className="rounded-sm bg-input-bg px-1.5 py-0.5">Esc</kbd>
                            to close
                        </span>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function KeyChord({ chord, source }: { chord: string; source: KeyBinding["source"] }) {
    if (!chord.trim()) {
        return <span className="shrink-0 text-[11px] text-text-muted">Unassigned</span>;
    }
    // "Ctrl+K Ctrl+S" is two chords: render each group, separated by a gap.
    const chords = chord.trim().split(/\s+/).map(splitKeyChord);
    return (
        <span
            className={cn("flex shrink-0 items-center gap-1", source === "user" && "text-accent")}
            title={source === "user" ? "Custom shortcut" : undefined}
        >
            {chords.map((tokens, groupIndex) => (
                <React.Fragment key={`${tokens.join("+")}-${groupIndex}`}>
                    {groupIndex > 0 ? <span className="w-1" aria-hidden /> : null}
                    {tokens.map((token, index) => (
                        <kbd
                            key={`${token}-${index}`}
                            className={cn(
                                "min-w-6 rounded-sm border border-border-subtle bg-input-bg px-1.5 py-0.5 text-center font-sans text-[11px] leading-4 text-text-secondary",
                                source === "user" && "border-accent/40",
                            )}
                        >
                            {token}
                        </kbd>
                    ))}
                </React.Fragment>
            ))}
        </span>
    );
}
