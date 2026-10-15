"use client";

/** Local shelf intent; conversations remain in the backend until archived/deleted. */
export type ChatDisposition =
    | { state: "active" | "settled" }
    | { state: "snoozed"; until: number };

export const CHAT_SNOOZE_MS = 60 * 60 * 1000;
const KEY = "bettershape-sidebar-dispositions";
const ENTRY_PREFIX = `${KEY}:v2:`;
const EMPTY: Readonly<Record<string, ChatDisposition>> = Object.freeze(Object.create(null));
let snapshot: Readonly<Record<string, ChatDisposition>> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const pending = new Map<string, ChatDisposition | null>();
const listeners = new Set<() => void>();

export function getChatDispositionsServer() { return EMPTY; }

function disposition(value: unknown): ChatDisposition | undefined {
    if (!value || typeof value !== "object" || !("state" in value)) return;
    if (value.state === "active" || value.state === "settled") return { state: value.state };
    if (value.state === "snoozed" && "until" in value && typeof value.until === "number" && Number.isFinite(value.until)) {
        return { state: "snoozed", until: value.until };
    }
}

/** Legacy maps are read-only seeds. Per-chat records (including tombstones) win. */
function readStored(): Record<string, ChatDisposition> | null {
    try {
        const next: Record<string, ChatDisposition> = Object.create(null);
        const legacyText = window.localStorage.getItem(KEY);
        try {
            const legacy: unknown = JSON.parse(legacyText ?? "{}");
            if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) {
                for (const [id, raw] of Object.entries(legacy)) {
                    const value = disposition(raw);
                    if (id && value) next[id] = value;
                }
            }
        } catch { /* Malformed legacy data must not hide valid per-chat entries. */ }
        for (let i = 0; i < window.localStorage.length; i += 1) {
            const key = window.localStorage.key(i);
            if (!key?.startsWith(ENTRY_PREFIX)) continue;
            const text = window.localStorage.getItem(key);
            try {
                const id = decodeURIComponent(key.slice(ENTRY_PREFIX.length));
                if (!id) continue;
                const raw: unknown = JSON.parse(text ?? "null");
                const value = disposition(raw);
                if (value) next[id] = value;
                else if (raw === null) delete next[id];
            } catch { /* Ignore malformed metadata without discarding other chats. */ }
        }
        return next;
    } catch { return null; }
}

function applyPending(next: Record<string, ChatDisposition>) {
    for (const [id, value] of pending) {
        if (value) next[id] = value;
        else delete next[id];
    }
    return next;
}

export function getChatDispositions(): Readonly<Record<string, ChatDisposition>> {
    if (!snapshot) snapshot = applyPending(readStored() ?? Object.create(null));
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

function publish(changes: ReadonlyMap<string, ChatDisposition | null>) {
    for (const [id, value] of changes) pending.set(id, value);
    snapshot = applyPending(Object.assign(Object.create(null), getChatDispositions()));
    // Independent chats never share a read-modify-write record. Same-chat
    // updates are last-writer-wins; a clear is a tombstone over the legacy seed.
    for (const [id, value] of pending) {
        try {
            window.localStorage.setItem(`${ENTRY_PREFIX}${encodeURIComponent(id)}`, JSON.stringify(value));
            pending.delete(id);
        } catch { /* Retain this window's unsaved intent, including clears. */ }
    }
    refreshFromStorage();
    schedule();
    for (const listener of listeners) listener();
}

export function setChatDisposition(id: string, value: ChatDisposition | undefined) {
    if (!id) return;
    publish(new Map([[id, value ? disposition(value) ?? null : null]]));
}

export function wakeSnoozedChats(now = Date.now()) {
    refreshFromStorage();
    const changes = new Map<string, ChatDisposition | null>();
    for (const [id, value] of Object.entries(getChatDispositions())) {
        if (value.state === "snoozed" && value.until <= now) changes.set(id, { state: "active" });
    }
    if (changes.size > 0) publish(changes);
}

function refreshFromStorage() {
    const stored = readStored();
    if (!stored) return; // Preserve session-local state when reads are unavailable.
    const next = applyPending(stored);
    if (JSON.stringify(next) !== JSON.stringify(snapshot)) snapshot = next;
}

function onStorage(event: StorageEvent) {
    if (event.key !== KEY && event.key !== null && !event.key.startsWith(ENTRY_PREFIX)) return;
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
