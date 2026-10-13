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
        if (!raw) return map;
        const parsed = JSON.parse(raw) as unknown;
        const entries = Array.isArray(parsed)
            ? parsed
            : Object.values((parsed ?? {}) as Record<string, unknown>);
        for (const entry of entries) {
            if (isUsableBuffer(entry)) map.set(entry.path, entry);
        }
    } catch {
        /* unreadable / private mode — start clean */
    }
    return map;
}

function writeAll(map: Map<string, DirtyBuffer>) {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...map.values()]));
    } catch {
        /* quota / private mode */
    }
}

export function saveDirtyBuffer(path: string, content: string, savedContent: string) {
    if (!path || UNSAFE_KEYS.has(path)) return;
    const map = readAll();
    if (content === savedContent) {
        map.delete(path);
    } else {
        map.set(path, { path, content, savedContent, updatedAt: Date.now() });
    }
    writeAll(map);
}

export function clearDirtyBuffer(path: string) {
    if (!path || UNSAFE_KEYS.has(path)) return;
    const map = readAll();
    if (!map.delete(path)) return;
    writeAll(map);
}

export function loadDirtyBuffer(path: string): DirtyBuffer | null {
    return readAll().get(path) ?? null;
}

export function listDirtyBuffers(): DirtyBuffer[] {
    return [...readAll().values()].sort((a, b) => b.updatedAt - a.updatedAt);
}
