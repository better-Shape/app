"use client";

import { useSyncExternalStore } from "react";
import type { PrItem } from "./mapping";

type PrUiState = {
    listOpen: boolean;
    selectedId: string | null;
    selectedItem?: PrItem;
};

let state: PrUiState = { listOpen: false, selectedId: null };
const listeners = new Set<() => void>();

function emit() {
    for (const listener of listeners) listener();
}

export function subscribePrUi(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function getPrUi(): PrUiState {
    return state;
}

export function openPrList() {
    state = { ...state, listOpen: true };
    emit();
}

export function closePrList() {
    state = { ...state, listOpen: false };
    emit();
}

export function selectPr(id: string | null, item?: PrItem) {
    state = { ...state, selectedId: id, selectedItem: item?.id === id ? item : undefined };
    emit();
    if (id) {
        window.dispatchEvent(new CustomEvent("bettershape-set-active-tab", { detail: "prs" }));
    }
}

/** Keep split-pane selections usable even when they came from a later list page. */
export function updateSelectedPr(item: PrItem) {
    if (state.selectedId !== item.id || state.selectedItem?.repo !== item.repo) return;
    state = { ...state, selectedItem: item };
    emit();
}

export function usePrUi(): PrUiState {
    return useSyncExternalStore(subscribePrUi, getPrUi, getPrUi);
}
