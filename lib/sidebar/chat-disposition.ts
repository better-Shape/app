"use client";

/** Local shelf intent; conversations remain in the backend until archived/deleted. */
export type ChatDisposition =
    | { state: "active" | "settled" }
    | { state: "snoozed"; until: number };

export const CHAT_SNOOZE_MS = 60 * 60 * 1000;
const KEY = "bettershape-sidebar-dispositions";
const EMPTY: Readonly<Record<string, ChatDisposition>> = {};
let snapshot: Readonly<Record<string, ChatDisposition>> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastStorageValue: string | null | undefined;
const listeners = new Set<() => void>();

export function getChatDispositionsServer() { return EMPTY; }

export function getChatDispositions(): Readonly<Record<string, ChatDisposition>> {
    if (snapshot) return snapshot;
    try {
        lastStorageValue = window.localStorage.getItem(KEY);
        const raw: unknown = JSON.parse(lastStorageValue ?? "{}");
        const next: Record<string, ChatDisposition> = Object.create(null);
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
            for (const [id, value] of Object.entries(raw)) {
                if (!id || !value || typeof value !== "object") continue;
                if (value.state === "active" || value.state === "settled") next[id] = { state: value.state };
                else if (value.state === "snoozed" && Number.isFinite(value.until)) {
                    next[id] = { state: "snoozed", until: value.until };
                }
            }
        }
        snapshot = next;
    } catch { snapshot = EMPTY; }
    return snapshot;
}

function schedule() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (listeners.size === 0) return;
    const deadlines = Object.values(getChatDispositions()).flatMap((value) => value.state === "snoozed" ? [value.until] : []);
    if (deadlines.length === 0) return;
    timer = setTimeout(() => {
        timer = null;
        wakeSnoozedChats();
        schedule();
    }, Math.min(2_147_483_647, Math.max(0, Math.min(...deadlines) - Date.now())));
}

function publish(next: Readonly<Record<string, ChatDisposition>>) {
    snapshot = next;
    try {
        const serialized = JSON.stringify(next);
        window.localStorage.setItem(KEY, serialized);
        lastStorageValue = serialized;
    } catch { /* Keep session-local intent when storage is unavailable. */ }
    schedule();
    for (const listener of listeners) listener();
}

export function setChatDisposition(id: string, value: ChatDisposition | undefined) {
    if (!id) return;
    const next = { ...getChatDispositions() };
    if (value) next[id] = value;
    else delete next[id];
    publish(next);
}

export function wakeSnoozedChats(now = Date.now()) {
    const next = { ...getChatDispositions() };
    let changed = false;
    for (const [id, value] of Object.entries(next)) {
        if (value.state === "snoozed" && value.until <= now) {
            next[id] = { state: "active" };
            changed = true;
        }
    }
    if (changed) publish(next);
}

function refreshFromStorage() {
    try {
        if (window.localStorage.getItem(KEY) !== lastStorageValue) {
            snapshot = null;
            getChatDispositions();
        }
    } catch { /* Preserve session-local intent when storage is unavailable. */ }
}

function onStorage(event: StorageEvent) {
    if (event.key !== KEY && event.key !== null) return;
    if (event.storageArea && event.storageArea !== window.localStorage) return;
    refreshFromStorage();
    wakeSnoozedChats();
    schedule();
    for (const listener of listeners) listener();
}

export function subscribeChatDispositions(listener: () => void) {
    listeners.add(listener);
    if (listeners.size === 1) {
        // No storage listener exists between mounts. Reconcile before waking
        // snoozes so stale cached state cannot overwrite another window's edits.
        refreshFromStorage();
        window.addEventListener("focus", onWake);
        document.addEventListener("visibilitychange", onWake);
        window.addEventListener("storage", onStorage);
    }
    wakeSnoozedChats();
    schedule();
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
            window.removeEventListener("focus", onWake);
            document.removeEventListener("visibilitychange", onWake);
            window.removeEventListener("storage", onStorage);
        }
        schedule();
    };
}

function onWake() { wakeSnoozedChats(); }
