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

/** What this window's staged change may do to the durable record it just read. */
type RecordDecision =
    /** Write the staged draft over the record. */
    | "write"
    /** Delete the record, because the legacy seed does not need a masking entry. */
    | "remove"
    /** Leave the record alone and keep the change pending for a later flush. */
    | "keep"
    /** The record is authoritative: drop the staged change. */
    | "settle";

/** Drop a staged change once it has been resolved. */
function settlePending(path: string, buffer: DirtyBuffer | null): void {
    if (pendingBuffers.get(path) === buffer) {
        pendingBuffers.delete(path);
        pendingIntents.delete(path);
        clearedContents.delete(path);
    }
}

/**
 * Whether the staged change still owns the durable record it read.
 *
 * Another renderer's newer record always wins. An equal stamp cannot be ordered, so a draft
 * stays pending (it keeps showing here and stays protected by the unload guard) and a clear
 * only removes a record whose content is exactly the draft it is discarding.
 */
function recordDecision(
    path: string,
    buffer: DirtyBuffer | null,
    intentAt: number,
    stored: DirtyBuffer | undefined,
    legacy: Map<string, DirtyBuffer> | undefined,
): RecordDecision {
    if (stored && stored.updatedAt > intentAt) return "settle";
    const cleared = clearedContents.get(path);
    if (buffer === null && cleared !== undefined && stored && stored.updatedAt === intentAt && stored.content !== cleared) {
        return "settle";
    }
    if (buffer && stored && stored.updatedAt === intentAt && stored.content !== buffer.content) return "keep";
    if (buffer === null) return legacy?.has(path) ? "write" : "remove";
    return "write";
}

/** Flush independent entries, retaining only failed/newer intents for retry. */
function writePending(): boolean {
    if (typeof window === "undefined") return false;
    let legacy: Map<string, DirtyBuffer> | undefined;
    for (const [path, buffer] of pendingBuffers) {
        const intentAt = pendingIntents.get(path) ?? buffer?.updatedAt ?? 0;
        const key = `${ENTRY_PREFIX}${encodeURIComponent(path)}`;
        try {
            // A removal needs the legacy seed to know whether deleting the entry would drop a
            // legacy-only draft, so that read happens first; everything else waits.
            if (buffer === null) legacy ??= readLegacyBuffers();
            const seen = recordDecision(path, buffer, intentAt, storedBuffer(path), legacy);
            if (seen === "settle") { settlePending(path, buffer); continue; }
            if (seen === "keep") continue;
            // Re-read immediately before writing. A key has no compare-and-swap, so this read
            // is the ordering the write has to answer to, and every statement between them is
            // time another renderer can use to commit a newer record this write would clobber.
            // The read above is only a pre-filter; this one decides.
            const fresh = recordDecision(path, buffer, intentAt, storedBuffer(path), legacy);
            if (fresh === "settle") { settlePending(path, buffer); continue; }
            if (fresh === "keep") continue;
            if (fresh === "remove") localStorage.removeItem(key);
            else localStorage.setItem(key, JSON.stringify(buffer));
            settlePending(path, buffer);
        } catch { /* Failed writes and removals stay visible to the unload guard. */ }
    }
    return pendingBuffers.size === 0;
}

export function stageDirtyBuffer(path: string, content: string, savedContent: string): void {
    if (typeof window === "undefined" || !path || UNSAFE_KEYS.has(path)) return;
    watchForeignWrites();
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

/** The path a durable record key belongs to, or null for a key this module does not own. */
function entryPath(key: string | null): string | null {
    if (!key?.startsWith(ENTRY_PREFIX)) return null;
    try {
        const path = decodeURIComponent(key.slice(ENTRY_PREFIX.length));
        return path && !UNSAFE_KEYS.has(path) ? path : null;
    } catch { /* A key that cannot be decoded is not this module's record. */ }
    return null;
}

/**
 * Re-commit this window's draft when another renderer replaced its newer durable record.
 *
 * A write with no compare-and-swap can land between the read above and the write it guards, so
 * a newer draft can be clobbered by an older one. That cannot be prevented, but it can be
 * repaired: this window still holds the draft, so when it hears the foreign write it commits
 * the draft again and recovery converges on the newest record. An equal stamp is left alone
 * because the two writes cannot be ordered (see `writePending`).
 *
 * Only a record that exists and is older than this window's draft is repaired. A removed record
 * carries no stamp to order against this draft, and the same event fires for a deliberate clear
 * and for a successful save (`acknowledgeDirtyBuffer` writes the removal when the saved content
 * is the draft's own), so re-adding one could resurrect recovery for a file that is already
 * saved. This window still shows its own copy either way; it just does not persist it again.
 */
export function repairClobberedDraft(path: string): boolean {
    const owned = ownedBuffers.get(path);
    if (!owned) return false;
    const stored = storedBuffer(path);
    if (!stored || stored.updatedAt >= owned.updatedAt) return false;
    stageDirtyBuffer(path, owned.content, owned.savedContent);
    flushDirtyBuffers();
    return true;
}

let watchingForeignWrites = false;

/** Repair a clobber from another renderer, once this window has work that can be clobbered. */
function watchForeignWrites(): void {
    if (watchingForeignWrites || typeof window === "undefined") return;
    if (typeof window.addEventListener !== "function") return;
    watchingForeignWrites = true;
    window.addEventListener("storage", (event) => {
        if (event.storageArea && event.storageArea !== localStorage) return;
        // A removal (`event.key === null` for a cleared area) is not repaired: see
        // `repairClobberedDraft` for why an unanswered removal is left alone.
        const path = entryPath(event.key);
        if (path) repairClobberedDraft(path);
    });
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
