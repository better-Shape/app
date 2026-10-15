/**
 * Persist unsaved editor buffers across restarts so dirty markdown/text
 * survives app quit without forcing a save prompt every time.
 *
 * Storage is a JSON array of buffers, not an object keyed by path: a buffer
 * carries its own path, so a path named `__proto__` can never address a
 * property on a shared prototype.
 */

const STORAGE_KEY = "bettershape-dirty-buffers-v1";

export type DirtyBuffer = {
    path: string;
    content: string;
    savedContent: string;
    updatedAt: number;
};

const pendingBuffers = new Map<string, DirtyBuffer | null>();
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

/** Buffers by path. A Map also keeps a path like `__proto__` as plain data. */
function readAll(): Map<string, DirtyBuffer> {
    const map = new Map<string, DirtyBuffer>();
    if (typeof window === "undefined") return map;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        const entries = Array.isArray(parsed)
            ? parsed
            : Object.values((parsed ?? {}) as Record<string, unknown>);
        for (const entry of entries) {
            if (isUsableBuffer(entry)) map.set(entry.path, entry);
        }
    } catch {
        /* Persisted recovery is unavailable; retain session drafts below. */
    }
    for (const [path, buffer] of pendingBuffers) {
        if (buffer) map.set(path, { ...buffer });
        else map.delete(path);
    }
    return map;
}

function writeAll(map: Map<string, DirtyBuffer>): boolean {
    if (typeof window === "undefined") return false;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...map.values()]));
        pendingBuffers.clear();
        return true;
    } catch {
        return false;
    }
}

export function stageDirtyBuffer(path: string, content: string, savedContent: string): void {
    if (typeof window === "undefined" || !path || UNSAFE_KEYS.has(path)) return;
    pendingBuffers.set(path, content === savedContent ? null : { path, content, savedContent, updatedAt: Date.now() });
    if (flushTimer !== undefined) clearTimeout(flushTimer);
    flushTimer = setTimeout(flushDirtyBuffers, 250);
}

export function flushDirtyBuffers(): boolean {
    if (flushTimer !== undefined) clearTimeout(flushTimer);
    flushTimer = undefined;
    return pendingBuffers.size === 0 || writeAll(readAll());
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
    pendingBuffers.set(path, null);
    return flushDirtyBuffers();
}

export function loadDirtyBuffer(path: string): DirtyBuffer | null {
    return readAll().get(path) ?? null;
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
