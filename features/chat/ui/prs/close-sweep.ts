"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { runPrAction } from "./actions";
import type { PrItem } from "./mapping";

const EMPTY = new Set<string>();

/** Stage rows while dragging; no network mutation before a release inside the list. */
export function usePrCloseSweep(list: RefObject<HTMLDivElement | null>, repo: string) {
    const [selected, setSelected] = useState<ReadonlySet<string>>(EMPTY);
    const [closing, setClosing] = useState(false);
    const cancel = useRef<(() => void) | null>(null);
    const suppressUntil = useRef(0);
    const running = useRef(false);
    const generation = useRef(0);

    useEffect(() => {
        generation.current += 1;
        setClosing(false);
        return () => { generation.current += 1; cancel.current?.(); };
    }, [repo]);

    const start = (item: PrItem, rows: PrItem[], event: PointerEvent) => {
        if (event.button !== 0 || !event.isPrimary || event.pointerType === "touch" || running.current || item.status !== "open") return;
        cancel.current?.();
        const currentGeneration = generation.current;
        const candidates = new Map(rows.filter((row) => row.status === "open" && row.repo === repo).map((row) => [row.id, row]));
        if (!candidates.has(item.id)) return;
        const picked = new Set([item.id]);
        let dragging = false;
        const rowAt = (e: PointerEvent) => {
            const element = document.elementFromPoint(e.clientX, e.clientY);
            return element && list.current?.contains(element) ? element.closest<HTMLElement>("[data-pr-id]")?.dataset.prId : undefined;
        };
        const cleanup = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", finish);
            window.removeEventListener("pointercancel", abortPointer);
            window.removeEventListener("keydown", keydown);
            window.removeEventListener("blur", abort);
            document.removeEventListener("visibilitychange", abort);
            cancel.current = null;
            setSelected(EMPTY);
        };
        const abort = () => {
            suppressUntil.current = Date.now() + 500;
            cleanup();
        };
        const abortPointer = (e: PointerEvent) => { if (e.pointerId === event.pointerId) abort(); };
        const keydown = (e: KeyboardEvent) => {
            if (e.key === "Escape") { e.preventDefault(); abort(); }
        };
        const move = (e: PointerEvent) => {
            if (e.pointerId !== event.pointerId) return;
            if ((e.buttons & 1) === 0) { abort(); return; }
            if (!dragging && Math.hypot(e.clientX - event.clientX, e.clientY - event.clientY) < 5) return;
            dragging = true;
            const id = rowAt(e);
            if (id && candidates.has(id)) picked.add(id);
            setSelected(new Set(picked));
            e.preventDefault();
        };
        const finish = (e: PointerEvent) => {
            if (e.pointerId !== event.pointerId) return;
            const releasedOnRow = rowAt(e);
            cleanup();
            if (!dragging) return; // The regular click and keyboard action are unchanged.
            suppressUntil.current = Date.now() + 500;
            if (!releasedOnRow || !candidates.has(releasedOnRow)) return;
            picked.add(releasedOnRow);
            running.current = true;
            setClosing(true);
            void (async () => {
                try {
                    // Serial execution bounds gh processes and makes per-row failures independent.
                    for (const id of picked) {
                        if (currentGeneration !== generation.current) break;
                        await runPrAction(candidates.get(id)!, "close", repo);
                    }
                } finally {
                    running.current = false;
                    if (currentGeneration === generation.current) setClosing(false);
                }
            })();
        };
        cancel.current = abort;
        window.addEventListener("pointermove", move, { passive: false });
        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", abortPointer);
        window.addEventListener("keydown", keydown);
        window.addEventListener("blur", abort);
        document.addEventListener("visibilitychange", abort);
    };

    return { selected, closing, start, suppressClick: () => Date.now() < suppressUntil.current };
}
