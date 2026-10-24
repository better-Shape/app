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

/** Synchronously returns cached project file paths when still within TTL. */
export function peekWarmProjectFiles(projectPath?: string | null): string[] | null {
    if (!projectPath) return null;
    const hit = filesCache.get(projectPath);
    return isFresh(hit) ? hit.value : null;
}

/** Fetches and caches project file paths for `@` mention auto-completion. */
export function fetchWarmProjectFiles(projectPath: string, query = "", limit = 40): Promise<string[]> {
    if (typeof commands.searchProjectFiles !== "function") return Promise.resolve([]);
    const trimmed = query.trim();
    if (!trimmed) {
        const hit = peekWarmProjectFiles(projectPath);
        if (hit) return Promise.resolve(hit);
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
                    return fetchWarmProjectFiles(projectPath, query, limit);
                }
                const normalized = rows.map((r) => (r.relative_path || r.path).replace(/\\/g, "/"));
                filesCache.set(projectPath, {
                    value: normalized,
                    expiresAt: Date.now() + WARM_TTL_MS,
                });
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
    }

    return commands
        .searchProjectFiles(trimmed, limit)
        .then((rows) => rows.map((r) => (r.relative_path || r.path).replace(/\\/g, "/")))
        .catch(() => []);
}

/** Synchronously returns cached recent conversations when still within TTL. */
export function peekWarmRecentChats(projectPath?: string | null): WarmChatSummary[] | null {
    const key = scopeKey(projectPath);
    const hit = chatsCache.get(key);
    return isFresh(hit) ? hit.value : null;
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
            const mapped = list.slice(0, 20).map((c) => ({
                id: c.id,
                title: c.title || "Chat",
            }));
            if (chatsGeneration === gen) {
                chatsCache.set(key, {
                    value: mapped,
                    expiresAt: Date.now() + WARM_TTL_MS,
                });
            }
            if (chatsInflight.get(key) === req) {
                chatsInflight.delete(key);
            }
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

/** Synchronously returns cached connected MCP servers when still within TTL. */
export function peekWarmMcpServers(): WarmMcpServer[] | null {
    return isFresh(mcpCache) ? mcpCache.value : null;
}

/** Fetches and caches connected MCP servers for `@mcp` mention auto-completion. */
export function fetchWarmMcpServers(): Promise<WarmMcpServer[]> {
    if (typeof commands.getMcpStatus !== "function") return Promise.resolve([]);
    const hit = peekWarmMcpServers();
    if (hit) return Promise.resolve(hit);
    if (mcpInflight) return mcpInflight;
    const gen = mcpGeneration;
    const req = commands
        .getMcpStatus()
        .then((statuses) => {
            const connected = statuses
                .filter((s) => String(s.status || "").toLowerCase() === "connected")
                .map((s) => ({
                    id: s.id,
                    name: s.name || s.id,
                }));
            if (mcpGeneration === gen) {
                mcpCache = {
                    value: connected,
                    expiresAt: Date.now() + WARM_TTL_MS,
                };
            }
            if (mcpInflight === req) {
                mcpInflight = null;
            }
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
