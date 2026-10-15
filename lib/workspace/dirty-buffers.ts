/**
 * Persist unsaved editor buffers across restarts so dirty markdown/text
 * survives app quit without forcing a save prompt every time.
 *
 * Each path has an independent record; concurrent WebViews never replace a
 * shared recovery array. The old array/object is a read-only migration seed.
 * Maps keep paths as data rather than properties on a shared prototype.
 */

const STORAGE_KEY = "bettershape-dirty-buffers-v1";
const ENTRY_PREFIX = "bettershape-dirty-buffers-v2:";

export type DirtyBuffer = {
    path: string;
    content: string;
    savedContent: string;
    updatedAt: number;
};

// Retain this window's unsaved work even if storage later becomes unavailable.
const ownedBuffers = new Map<string, DirtyBuffer>();
const pendingBuffers = new Map<string, DirtyBuffer | null>();
// When this window staged a change for a path. Recovery records are per path
// across renderers, so a record another window persisted afterwards outranks
// this window's staged change instead of being overwritten by it.
const pendingIntents = new Map<string, number>();
// What a staged clear is discarding. A removal only owns a durable record whose content is
// exactly this draft; anything else was written by another renderer.
const clearedContents = new Map<string, string>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isUsableBuffer(value: unknown): value is DirtyBuffer {
    if (!value || typeof value !== "object") return false;
    const buffer = value as Partial<DirtyBuffer>;
    return (
        typeof buffer.path === "string" &&
        buffer.path.length > 0 &&
        !UNSAFE_KEYS.has(buffer.path) &&
        typeof buffer.content === "string" &&
        typeof buffer.savedContent === "string" &&
        typeof buffer.updatedAt === "number"
    );
}

/** Read legacy recovery without rewriting it; storage failures must remain distinguishable from no seed. */
function readLegacyBuffers(): Map<string, DirtyBuffer> {
    const map = new Map<string, DirtyBuffer>();
    const raw = localStorage.getItem(STORAGE_KEY);
    try {
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        const entries = Array.isArray(parsed)
            ? parsed
            : Object.values((parsed ?? {}) as Record<string, unknown>);
        for (const entry of entries) {
            if (isUsableBuffer(entry)) map.set(entry.path, entry);
        }
    } catch { /* Malformed legacy data must not hide valid per-path records. */ }
    return map;
}

/** Read one path record, rejecting malformed keys and payloads that claim another path. */
function applyStoredEntry(map: Map<string, DirtyBuffer>, key: string): void {
    try {
        const path = decodeURIComponent(key.slice(ENTRY_PREFIX.length));
        if (!path || UNSAFE_KEYS.has(path)) return;
        const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
        if (raw === null) map.delete(path);
        else if (isUsableBuffer(raw) && raw.path === path) map.set(path, raw);
    } catch { /* One unavailable or malformed entry must not discard other drafts. */ }
}

/** Read one path's durable record without staging anything from it. */
function storedBuffer(path: string): DirtyBuffer | undefined {
    try {
        const raw: unknown = JSON.parse(localStorage.getItem(`${ENTRY_PREFIX}${encodeURIComponent(path)}`) ?? "null");
        return isUsableBuffer(raw) && raw.path === path ? raw : undefined;
    } catch { /* An unreadable record supplies no ordering authority. */ }
    return undefined;
}

/** Combine durable recovery with this window's unsaved work and pending removals. */
function readAll(): Map<string, DirtyBuffer> {
    let map = new Map<string, DirtyBuffer>();
    if (typeof window === "undefined") return map;
    try { map = readLegacyBuffers(); } catch { /* Session-owned recovery remains available below. */ }
    try {
        for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (key?.startsWith(ENTRY_PREFIX)) applyStoredEntry(map, key);
        }
    } catch { /* Preserve all entries already read and the session-owned drafts below. */ }
    for (const [path, buffer] of ownedBuffers) {
        // This window's memory copy is authoritative only while it is the newest
        // recovery state; a record persisted by another renderer afterwards wins.
        const stored = map.get(path);
        map.set(path, stored && stored.updatedAt > buffer.updatedAt ? stored : { ...buffer });
    }
    for (const [path, buffer] of pendingBuffers) {
        if (buffer) {
            // Same ordering rule the flush applies: a record another renderer persisted
            // after this change outranks the staged copy, so a stale local draft cannot
            // hide newer recovery. Equal stamps stay with the staged change, because the
            // two writes cannot be ordered (see writePending).
            const stored = map.get(path);
            const intentAt = pendingIntents.get(path) ?? buffer.updatedAt;
            map.set(path, stored && stored.updatedAt > intentAt ? stored : { ...buffer });
        } else {
            // A newer record means the discarded content was re-drafted elsewhere.
            const stored = map.get(path);
            if (stored && stored.updatedAt > (pendingIntents.get(path) ?? 0)) map.set(path, stored);
            else map.delete(path);
        }
    }
    return map;
}

/** Flush independent entries, retaining only failed/newer intents for retry. */
function writePending(): boolean {
    if (typeof window === "undefined") return false;
    let legacy: Map<string, DirtyBuffer> | undefined;
    for (const [path, buffer] of pendingBuffers) {
        const intentAt = pendingIntents.get(path) ?? buffer?.updatedAt ?? 0;
        const stored = storedBuffer(path);
        if (stored && stored.updatedAt > intentAt) {
            // Another renderer persisted newer recovery for this path while this
            // change was staged. Its record is the recovery state to keep.
            if (pendingBuffers.get(path) === buffer) {
                pendingBuffers.delete(path);
                pendingIntents.delete(path);
                clearedContents.delete(path);
            }
            continue;
        }
        const cleared = clearedContents.get(path);
        if (
            buffer === null &&
            cleared !== undefined &&
            stored &&
            stored.updatedAt === intentAt &&
            stored.content !== cleared
        ) {
            // A clear stamped in the same millisecond as a durable record it does not hold:
            // that record is another renderer's draft, and removing it would destroy unsaved
            // work no one else can restore. Only a content match proves the record is ours.
            // The clear has nothing unsaved left to protect, so the record wins and the clear
            // settles here instead of staying pending for the rest of the session.
            if (pendingBuffers.get(path) === buffer) {
                pendingBuffers.delete(path);
                pendingIntents.delete(path);
                clearedContents.delete(path);
            }
            continue;
        }
        if (buffer && stored && stored.updatedAt === intentAt && stored.content !== buffer.content) {
            // Two writers stamped the same millisecond, so the wall clock cannot say which
            // one is newer. This staged copy must not replace a committed record on a guess:
            // it stays pending instead, so this window still shows it and the unload guard
            // keeps protecting it, while the durable record stays untouched. The next edit
            // restamps and resolves the tie in the usual way.
            continue;
        }
        try {
            const key = `${ENTRY_PREFIX}${encodeURIComponent(path)}`;
            if (buffer === null) legacy ??= readLegacyBuffers();
            if (buffer === null && !legacy?.has(path)) localStorage.removeItem(key);
            else localStorage.setItem(key, JSON.stringify(buffer));
            if (pendingBuffers.get(path) === buffer) {
                pendingBuffers.delete(path);
                pendingIntents.delete(path);
                clearedContents.delete(path);
            }
        } catch { /* Failed writes and removals stay visible to the unload guard. */ }
    }
    return pendingBuffers.size === 0;
}

export function stageDirtyBuffer(path: string, content: string, savedContent: string): void {
    if (typeof window === "undefined" || !path || UNSAFE_KEYS.has(path)) return;
    const buffer = content === savedContent ? null : { path, content, savedContent, updatedAt: Date.now() };
    // A removal speaks for the draft this window is discarding, not for whatever
    // another renderer persisted afterwards, so it keeps that draft's timestamp.
    const intentAt = buffer?.updatedAt ?? ownedBuffers.get(path)?.updatedAt ?? Date.now();
    if (buffer) {
        ownedBuffers.set(path, buffer);
        clearedContents.delete(path);
    } else {
        const discarded = ownedBuffers.get(path)?.content;
        if (discarded === undefined) clearedContents.delete(path);
        else clearedContents.set(path, discarded);
        ownedBuffers.delete(path);
    }
    pendingBuffers.set(path, buffer);
    pendingIntents.set(path, intentAt);
    if (flushTimer !== undefined) clearTimeout(flushTimer);
    flushTimer = setTimeout(flushDirtyBuffers, 250);
}

export function flushDirtyBuffers(): boolean {
    if (flushTimer !== undefined) clearTimeout(flushTimer);
    flushTimer = undefined;
    return pendingBuffers.size === 0 || writePending();
}

export function preventUnpersistedEditorUnload(event: BeforeUnloadEvent): void {
    if (flushDirtyBuffers()) return;
    event.preventDefault();
    event.returnValue = "";
}

export function saveDirtyBuffer(path: string, content: string, savedContent: string) {
    stageDirtyBuffer(path, content, savedContent);
    flushDirtyBuffers();
}

export function clearDirtyBuffer(path: string): boolean {
    if (!path || UNSAFE_KEYS.has(path)) return false;
    const previous = pendingBuffers.get(path) ?? ownedBuffers.get(path);
    ownedBuffers.delete(path);
    pendingBuffers.set(path, null);
    pendingIntents.set(path, previous?.updatedAt ?? Date.now());
    // The removal owns exactly the draft it is discarding, so a durable record stamped in the
    // same millisecond only goes when its content is this one.
    if (previous) clearedContents.set(path, previous.content);
    else clearedContents.delete(path);
    return flushDirtyBuffers();
}

export function loadDirtyBuffer(path: string): DirtyBuffer | null {
    const buffer = readAll().get(path);
    if (buffer) ownedBuffers.set(path, { ...buffer });
    return buffer ?? null;
}

export function listDirtyBuffers(): DirtyBuffer[] {
    return [...readAll().values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function acknowledgeDirtyBuffer(path: string, savedContent: string): void {
    const buffers = readAll();
    const current = buffers.get(path);
    if (!current) return;
    saveDirtyBuffer(path, current.content, savedContent);
}

export function dirtyOpenFiles<T extends { path: string; is_dirty: boolean }>(files: readonly T[], pending: ReadonlySet<string> = new Set()): T[] {
    const recovery = readAll();
    return files.filter((file) => file.is_dirty || recovery.has(file.path) || pending.has(file.path));
}
