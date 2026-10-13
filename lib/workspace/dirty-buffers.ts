/**
 * Persist unsaved editor buffers across restarts so dirty markdown/text
 * survives app quit without forcing a save prompt every time.
 */

const STORAGE_KEY = "bettershape-dirty-buffers-v1";

export type DirtyBuffer = {
    path: string;
    content: string;
    savedContent: string;
    updatedAt: number;
};

/** Property names that would walk the prototype chain if written to a plain object. */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function emptyMap(): Record<string, DirtyBuffer> {
    // Null prototype: a stored path like `__proto__` is a key, never a mutation.
    return Object.create(null) as Record<string, DirtyBuffer>;
}

function isSafeKey(key: string): boolean {
    return key.length > 0 && !UNSAFE_KEYS.has(key);
}

function readAll(): Record<string, DirtyBuffer> {
    if (typeof window === "undefined") return emptyMap();
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return emptyMap();
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object") return emptyMap();
        const map = emptyMap();
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (!isSafeKey(key) || !value || typeof value !== "object") continue;
            map[key] = value as DirtyBuffer;
        }
        return map;
    } catch {
        return emptyMap();
    }
}

function writeAll(map: Record<string, DirtyBuffer>) {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch {
        /* quota / private mode */
    }
}

export function saveDirtyBuffer(path: string, content: string, savedContent: string) {
    if (!isSafeKey(path)) return;
    const map = readAll();
    if (content === savedContent) {
        delete map[path];
    } else {
        map[path] = { path, content, savedContent, updatedAt: Date.now() };
    }
    writeAll(map);
}

export function clearDirtyBuffer(path: string) {
    if (!isSafeKey(path)) return;
    const map = readAll();
    if (!(path in map)) return;
    delete map[path];
    writeAll(map);
}

export function loadDirtyBuffer(path: string): DirtyBuffer | null {
    return readAll()[path] ?? null;
}

export function listDirtyBuffers(): DirtyBuffer[] {
    return Object.values(readAll()).sort((a, b) => b.updatedAt - a.updatedAt);
}
