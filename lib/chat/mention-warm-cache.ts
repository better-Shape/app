"use client";

import { commands } from "@/lib/backend";
import { ensureFreshScan } from "@/lib/chat/skill-index";
import { preloadSyntaxHighlighter } from "@/lib/ui/syntax-highlight";
import { fetchPlugins, peekPluginsCache } from "@/lib/plugins/api";

const WARM_TTL_MS = 25_000;

type TimedEntry<T> = {
    value: T;
    expiresAt: number;
};

export type WarmChatSummary = {
    id: string;
    title: string;
};

export type WarmMcpServer = {
    id: string;
    name: string;
};

const filesCache = new Map<string, TimedEntry<string[]>>();
const filesInflight = new Map<string, Promise<string[]>>();
let filesGeneration = 0;

const chatsCache = new Map<string, TimedEntry<WarmChatSummary[]>>();
const chatsInflight = new Map<string, Promise<WarmChatSummary[]>>();
let chatsGeneration = 0;

let mcpCache: TimedEntry<WarmMcpServer[]> | null = null;
let mcpInflight: Promise<WarmMcpServer[]> | null = null;
let mcpGeneration = 0;

function isFresh<T>(entry: TimedEntry<T> | undefined | null): entry is TimedEntry<T> {
    return Boolean(entry && entry.expiresAt > Date.now());
}

function scopeKey(projectPath?: string | null): string {
    return projectPath ? projectPath : "__global__";
}

/** Evicts oldest entries when a cache map grows past `maxEntries`. */
const setBoundedTimedEntry = <T>(
    cache: Map<string, TimedEntry<T>>,
    key: string,
    value: T,
    maxEntries = 32,
): void => {
    cache.delete(key);
    cache.set(key, { value, expiresAt: Date.now() + WARM_TTL_MS });
    if (cache.size <= maxEntries) return;
    const oldest = cache.keys().next().value;
    if (typeof oldest === "string") cache.delete(oldest);
};

/** Synchronously returns cached project file paths when still within TTL. */
export function peekWarmProjectFiles(projectPath?: string | null): string[] | null {
    if (!projectPath) return null;
    const hit = filesCache.get(projectPath);
    if (!hit) return null;
    if (isFresh(hit)) return hit.value;
    filesCache.delete(projectPath);
    return null;
}

/** Normalizes file search rows into forward-slash relative paths. */
const normalizeFileRows = (rows: ReadonlyArray<{ relative_path?: string; path: string }>): string[] =>
    rows.map((r) => (r.relative_path || r.path).replace(/\\/g, "/"));

/** Runs a non-empty file query and retries once if workspace files changed mid-flight. */
const queryProjectFilesFresh = (trimmed: string, limit: number): Promise<string[]> => {
    const gen = filesGeneration;
    return commands
        .searchProjectFiles(trimmed, limit)
        .then((rows) => {
            if (filesGeneration !== gen) {
                return commands.searchProjectFiles(trimmed, limit).then(normalizeFileRows);
            }
            return normalizeFileRows(rows);
        })
        .catch(() => []);
};

/** Loads and caches the root project file list, coalescing concurrent callers. */
const loadRootProjectFiles = (projectPath: string, limit: number): Promise<string[]> => {
    const existing = filesInflight.get(projectPath);
    if (existing) return existing;
    const gen = filesGeneration;
    const req = commands
        .searchProjectFiles("", limit)
        .then((rows) => {
            if (filesInflight.get(projectPath) === req) {
                filesInflight.delete(projectPath);
            }
            if (filesGeneration !== gen) {
                return loadRootProjectFiles(projectPath, limit);
            }
            const normalized = normalizeFileRows(rows);
            setBoundedTimedEntry(filesCache, projectPath, normalized);
            return normalized;
        })
        .catch(() => {
            if (filesInflight.get(projectPath) === req) {
                filesInflight.delete(projectPath);
            }
            return [];
        });
    filesInflight.set(projectPath, req);
    return req;
};

/** Fetches and caches project file paths for `@` mention auto-completion. */
export function fetchWarmProjectFiles(projectPath: string, query?: string, limit?: number): Promise<string[]> {
    if (typeof commands.searchProjectFiles !== "function") return Promise.resolve([]);
    const trimmed = (query ?? "").trim();
    const effectiveLimit = limit ?? 40;
    if (trimmed) return queryProjectFilesFresh(trimmed, effectiveLimit);
    const hit = peekWarmProjectFiles(projectPath);
    return hit ? Promise.resolve(hit) : loadRootProjectFiles(projectPath, effectiveLimit);
}

/** Synchronously returns cached recent conversations when still within TTL. */
export function peekWarmRecentChats(projectPath?: string | null): WarmChatSummary[] | null {
    const key = scopeKey(projectPath);
    const hit = chatsCache.get(key);
    if (!hit) return null;
    if (isFresh(hit)) return hit.value;
    chatsCache.delete(key);
    return null;
}

/** Fetches and caches recent conversations for `@chat` mention auto-completion. */
export function fetchWarmRecentChats(projectPath?: string | null): Promise<WarmChatSummary[]> {
    if (typeof commands.getConversations !== "function") return Promise.resolve([]);
    const key = scopeKey(projectPath);
    const hit = peekWarmRecentChats(projectPath);
    if (hit) return Promise.resolve(hit);
    const existing = chatsInflight.get(key);
    if (existing) return existing;
    const gen = chatsGeneration;
    const req = commands
        .getConversations(projectPath ?? undefined)
        .then((list) => {
            if (chatsInflight.get(key) === req) {
                chatsInflight.delete(key);
            }
            if (chatsGeneration !== gen) {
                return fetchWarmRecentChats(projectPath);
            }
            const mapped = list.slice(0, 20).map((c) => ({
                id: c.id,
                title: c.title || "Chat",
            }));
            setBoundedTimedEntry(chatsCache, key, mapped);
            return mapped;
        })
        .catch(() => {
            if (chatsInflight.get(key) === req) {
                chatsInflight.delete(key);
            }
            return [];
        });
    chatsInflight.set(key, req);
    return req;
}

let mcpListenerBound = false;

/** Invalidates the cached MCP server status list when servers change at runtime. */
export function invalidateWarmMcpCache(): void {
    mcpGeneration += 1;
    mcpCache = null;
    mcpInflight = null;
}

function ensureMcpChangeListener(): void {
    if (mcpListenerBound || typeof window === "undefined") return;
    mcpListenerBound = true;
    window.addEventListener("mcp-servers-changed", invalidateWarmMcpCache);
    import("@tauri-apps/api/event")
        .then(({ listen }) => listen("mcp-servers-changed", () => invalidateWarmMcpCache()))
        .catch(() => {
            /* Browser preview without Tauri IPC */
        });
}

/** Synchronously returns cached connected MCP servers when still within TTL. */
export function peekWarmMcpServers(): WarmMcpServer[] | null {
    ensureMcpChangeListener();
    if (!mcpCache) return null;
    if (isFresh(mcpCache)) return mcpCache.value;
    mcpCache = null;
    return null;
}

/** Fetches and caches connected MCP servers for `@mcp` mention auto-completion. */
export function fetchWarmMcpServers(): Promise<WarmMcpServer[]> {
    ensureMcpChangeListener();
    if (typeof commands.getMcpStatus !== "function") return Promise.resolve([]);
    const hit = peekWarmMcpServers();
    if (hit) return Promise.resolve(hit);
    if (mcpInflight) return mcpInflight;
    const gen = mcpGeneration;
    const req = commands
        .getMcpStatus()
        .then((statuses) => {
            if (mcpInflight === req) {
                mcpInflight = null;
            }
            if (mcpGeneration !== gen) {
                return fetchWarmMcpServers();
            }
            const connected = statuses
                .filter((s) => String(s.status || "").toLowerCase() === "connected")
                .map((s) => ({
                    id: s.id,
                    name: s.name || s.id,
                }));
            mcpCache = {
                value: connected,
                expiresAt: Date.now() + WARM_TTL_MS,
            };
            return connected;
        })
        .catch(() => {
            if (mcpInflight === req) {
                mcpInflight = null;
            }
            return [];
        });
    mcpInflight = req;
    return req;
}

/**
 * Speculatively warm `@` / `/` popover sources + syntax highlighter during
 * idle frames when the user focuses or hovers the composer.
 */
export function warmComposerResources(projectPath?: string | null): () => void {
    if (typeof window === "undefined") return () => {};
    let cancelled = false;
    const run = () => {
        if (cancelled) return;
        try {
            preloadSyntaxHighlighter();
        } catch {
            /* ignore */
        }
        try {
            ensureFreshScan();
        } catch {
            /* ignore */
        }
        if (projectPath) {
            void fetchWarmProjectFiles(projectPath, "", 40);
        }
        void fetchWarmRecentChats(projectPath);
        void fetchWarmMcpServers();
        try {
            if (!peekPluginsCache()) {
                void fetchPlugins().catch(() => {});
            }
        } catch {
            /* ignore */
        }
    };
    const win = window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        cancelIdleCallback?: (id: number) => void;
    };
    if (typeof win.requestIdleCallback === "function") {
        const handle = win.requestIdleCallback(run, { timeout: 300 });
        return () => {
            cancelled = true;
            win.cancelIdleCallback?.(handle);
        };
    }
    const timer = window.setTimeout(run, 32);
    return () => {
        cancelled = true;
        window.clearTimeout(timer);
    };
}

/** Clears warm mention caches and invalidates in-flight generations for tests. */
export function resetMentionWarmCachesForTests(): void {
    filesGeneration += 1;
    chatsGeneration += 1;
    mcpGeneration += 1;
    filesCache.clear();
    filesInflight.clear();
    chatsCache.clear();
    chatsInflight.clear();
    mcpCache = null;
    mcpInflight = null;
}

if (typeof window !== "undefined") {
    window.addEventListener("bettershape-files-changed", () => {
        filesGeneration += 1;
        filesCache.clear();
        filesInflight.clear();
    });
    window.addEventListener("bettershape-chats-changed", () => {
        chatsGeneration += 1;
        chatsCache.clear();
        chatsInflight.clear();
    });
}
