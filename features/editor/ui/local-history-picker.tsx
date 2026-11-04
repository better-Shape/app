"use client";

import { useEffect, useMemo, useState } from "react";
import { QuickPick } from "@/components/ui/quick-pick";
import { commands } from "@/lib/backend";
import type { HistoryEntry } from "@/lib/backend/types";
import {
    filterHistoryItems,
    historyPickItems,
    LOCAL_HISTORY_EVENT,
    restoredVersionMessage,
    type LocalHistoryRequest,
} from "@/lib/editor/local-history";
import { notify } from "@/features/notifications";

/**
 * Local history for the file in the editor: the Rust pipeline keeps the last 50
 * saved versions and can hand one back, but nothing in the app offered them.
 *
 * Restoring only fills the buffer, exactly as the command returns it, so the
 * file on disk keeps its current content until the user saves.
 */

/** One finished read, keyed by the path it belongs to. */
type HistoryLoad = {
    path: string;
    status: "ready" | "failed";
    entries: readonly HistoryEntry[];
};

export function LocalHistoryPicker({
    path,
    onRestore,
}: {
    path: string;
    onRestore: (content: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [load, setLoad] = useState<HistoryLoad | null>(null);
    const [query, setQuery] = useState("");

    // The picker owns its open state so any surface can ask for it by event,
    // and a path that matches more than one mounted surface still opens once.
    useEffect(() => {
        const onRequest = (event: Event) => {
            const detail = (event as CustomEvent<LocalHistoryRequest>).detail;
            if (!detail || detail.claimed || detail.path !== path) return;
            detail.claimed = true;
            setOpen(true);
        };
        window.addEventListener(LOCAL_HISTORY_EVENT, onRequest as EventListener);
        return () => window.removeEventListener(LOCAL_HISTORY_EVENT, onRequest as EventListener);
    }, [path]);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        commands
            .getFileHistory(path)
            .then((found) => {
                if (cancelled) return;
                // The command is typed as a list; a backend that answers nothing
                // must not put a non-list into the row builder.
                setLoad({ path, status: "ready", entries: Array.isArray(found) ? found : [] });
            })
            .catch(() => {
                if (cancelled) return;
                setLoad({ path, status: "failed", entries: [] });
            });
        return () => {
            cancelled = true;
        };
    }, [open, path]);

    const current = load?.path === path ? load : null;
    const loading = open && current === null;
    const entries = useMemo<readonly HistoryEntry[]>(() => current?.entries ?? [], [current]);
    const items = useMemo(() => filterHistoryItems(historyPickItems(entries), query), [entries, query]);
    const emptyText = loading
        ? "Loading versions..."
        : current?.status === "failed"
          ? "Could not read the history for this file."
          : "No saved versions yet.";

    const close = (next: boolean) => {
        if (!next) setQuery("");
        setOpen(next);
    };

    const restore = async (id: string) => {
        const entry = entries.find((candidate) => candidate.id === id);
        if (!entry) return;
        try {
            const content = await commands.restoreHistoryVersion(path, entry.id);
            onRestore(content);
            close(false);
            notify.success("Local history", restoredVersionMessage(entry.timestamp));
        } catch (error) {
            notify.error("Local history", error instanceof Error ? error.message : "Could not restore that version.");
        }
    };

    return (
        <QuickPick
            open={open}
            onOpenChange={close}
            title="Local history"
            placeholder="Filter versions..."
            query={query}
            onQueryChange={setQuery}
            items={items}
            onSelect={(item) => {
                void restore(item.id);
            }}
            emptyText={emptyText}
        />
    );
}
