"use client";

import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { runPrAction } from "./actions";
import type { PrItem } from "./mapping";

const EMPTY = new Set<string>();

/** A close sweep needs an idle open PR and a primary, non-touch left-button gesture. */
function canStartSweep(item: PrItem, event: PointerEvent, busy: boolean): boolean {
    const primaryPointer = event.button === 0 && event.isPrimary && event.pointerType !== "touch";
    return primaryPointer && !busy && item.status === "open";
}

/** Stage rows while dragging; no network mutation before a release inside the list. */
export function usePrCloseSweep(list: RefObject<HTMLDivElement | null>, repo: string) {
    const [selected, setSelected] = useState<ReadonlySet<string>>(EMPTY);
    const [closeState, setCloseState] = useState({ repo, closing: false });
    // Reset repository-owned UI state during render, not in a cascading layout effect.
    if (closeState.repo !== repo) setCloseState({ repo, closing: false });
    const closing = closeState.repo === repo && closeState.closing;
    const cancel = useRef<(() => void) | null>(null);
    const suppressUntil = useRef(0);
    const running = useRef(false);
    const generation = useRef(0);

    useLayoutEffect(() => {
        generation.current += 1;
        return () => { generation.current += 1; cancel.current?.(); };
    }, [repo]);

    const start = useCallback((item: PrItem, rows: PrItem[], event: PointerEvent) => {
        if (!canStartSweep(item, event, running.current)) return;
        cancel.current?.();
        suppressUntil.current = 0;
        const currentGeneration = generation.current;
        const candidates = new Map(rows.filter((row) => row.status === "open" && row.repo === repo).map((row) => [row.id, row]));
        if (!candidates.has(item.id)) return;
        const picked = new Set([item.id]);
        let dragging = false;
        /** Treat blank list space as inside while rejecting missing or foreign hit targets. */
        const insideList = (element: Element | null) => Boolean(list.current?.contains(element));
        /** Add only eligible rows from the captured repository snapshot. */
        const pickRow = (id: string | undefined) => {
            if (id && candidates.has(id)) picked.add(id);
        };
        /** Resolve a pointer to a PR row only when the hit belongs to this list. */
        const rowAt = (e: PointerEvent) => {
            const element = document.elementFromPoint(e.clientX, e.clientY);
            return insideList(element) ? element?.closest<HTMLElement>("[data-pr-id]")?.dataset.prId : undefined;
        };
        /** Remove this gesture's listeners and staged selection without performing any network mutation. */
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
        /** Cancel the staged gesture and briefly suppress its follow-up click. */
        const abort = () => {
            suppressUntil.current = Date.now() + 500;
            cleanup();
        };
        /** Ignore cancellation from other pointers; only the owning pointer can abort this gesture. */
        const abortPointer = (e: PointerEvent) => { if (e.pointerId === event.pointerId) abort(); };
        /** Consume Escape to cancel a pending sweep without closing any PR. */
        const keydown = (e: KeyboardEvent) => {
            if (e.key === "Escape") { e.preventDefault(); abort(); }
        };
        /** Accumulate eligible rows after the drag threshold while the owning primary button stays pressed. */
        const move = (e: PointerEvent) => {
            if (e.pointerId !== event.pointerId) return;
            if ((e.buttons & 1) === 0) { abort(); return; }
            if (!dragging && Math.hypot(e.clientX - event.clientX, e.clientY - event.clientY) < 5) return;
            dragging = true;
            const id = rowAt(e);
            pickRow(id);
            setSelected(new Set(picked));
            e.preventDefault();
        };
        /** Commit a genuine drag released inside the list, closing selected PRs serially within the captured repository generation. */
        const finish = (e: PointerEvent) => {
            if (e.pointerId !== event.pointerId) return;
            const releasedOnRow = rowAt(e);
            const releasedInside = insideList(document.elementFromPoint(e.clientX, e.clientY));
            cleanup();
            if (!dragging) return; // The regular click and keyboard action are unchanged.
            suppressUntil.current = releasedInside ? Date.now() + 500 : 0;
            if (!releasedInside) return;
            pickRow(releasedOnRow);
            running.current = true;
            setCloseState({ repo, closing: true });
            void (async () => {
                try {
                    // Serial execution bounds gh processes and makes per-row failures independent.
                    for (const id of picked) {
                        if (currentGeneration !== generation.current) break;
                        await runPrAction(candidates.get(id)!, "close", repo);
                    }
                } finally {
                    running.current = false;
                    if (currentGeneration === generation.current) setCloseState({ repo, closing: false });
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
    }, [list, repo]);

    const resetClickSuppression = useCallback(() => { suppressUntil.current = 0; }, []);
    const suppressClick = useCallback(() => {
        const suppress = Date.now() < suppressUntil.current;
        suppressUntil.current = 0;
        return suppress;
    }, []);
    // A drag that ends outside the staged rows still fires a click on the row under the
    // pointer. Swallow exactly that click in the capture phase. The listener is attached
    // natively rather than through JSX because the scroll container is not an interactive
    // control and an `onClickCapture` prop makes assistive tooling treat it as one.
    useLayoutEffect(() => {
        const element = list.current;
        if (!element) return;
        const onClickCapture = (event: MouseEvent) => {
            if (event.detail > 0 && suppressClick()) {
                event.preventDefault();
                event.stopPropagation();
            }
        };
        element.addEventListener("click", onClickCapture, true);
        return () => element.removeEventListener("click", onClickCapture, true);
    }, [list, suppressClick]);
    return { selected, closing, start, suppressClick, resetClickSuppression };
}
