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

const chatsCache = new Map<string, TimedEntry<WarmChatSummary[]>>();
const chatsInflight = new Map<string, Promise<WarmChatSummary[]>>();

let mcpCache: TimedEntry<WarmMcpServer[]> | null = null;
let mcpInflight: Promise<WarmMcpServer[]> | null = null;

function isFresh<T>(entry: TimedEntry<T> | undefined | null): entry is TimedEntry<T> {
    return Boolean(entry && entry.expiresAt > Date.now());
}

function scopeKey(projectPath?: string | null): string {
    return projectPath ? projectPath : "__global__";
}

export function peekWarmProjectFiles(projectPath?: string | null): string[] | null {
    if (!projectPath) return null;
    const hit = filesCache.get(projectPath);
    return isFresh(hit) ? hit.value : null;
}

export function fetchWarmProjectFiles(projectPath: string, query = "", limit = 40): Promise<string[]> {
    if (typeof commands.searchProjectFiles !== "function") return Promise.resolve([]);
    const trimmed = query.trim();
    if (!trimmed) {
        const hit = peekWarmProjectFiles(projectPath);
        if (hit) return Promise.resolve(hit);
        const existing = filesInflight.get(projectPath);
        if (existing) return existing;
        const req = commands
            .searchProjectFiles("", limit)
            .then((rows) => {
                const normalized = rows.map((r) => (r.relative_path || r.path).replace(/\\/g, "/"));
                filesCache.set(projectPath, {
                    value: normalized,
                    expiresAt: Date.now() + WARM_TTL_MS,
                });
                filesInflight.delete(projectPath);
                return normalized;
            })
            .catch(() => {
                filesInflight.delete(projectPath);
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

export function peekWarmRecentChats(projectPath?: string | null): WarmChatSummary[] | null {
    const key = scopeKey(projectPath);
    const hit = chatsCache.get(key);
    return isFresh(hit) ? hit.value : null;
}

export function fetchWarmRecentChats(projectPath?: string | null): Promise<WarmChatSummary[]> {
    if (typeof commands.getConversations !== "function") return Promise.resolve([]);
    const key = scopeKey(projectPath);
    const hit = peekWarmRecentChats(projectPath);
    if (hit) return Promise.resolve(hit);
    const existing = chatsInflight.get(key);
    if (existing) return existing;
    const req = commands
        .getConversations(projectPath ?? undefined)
        .then((list) => {
            const mapped = list.slice(0, 20).map((c) => ({
                id: c.id,
                title: c.title || "Chat",
            }));
            chatsCache.set(key, {
                value: mapped,
                expiresAt: Date.now() + WARM_TTL_MS,
            });
            chatsInflight.delete(key);
            return mapped;
        })
        .catch(() => {
            chatsInflight.delete(key);
            return [];
        });
    chatsInflight.set(key, req);
    return req;
}

export function peekWarmMcpServers(): WarmMcpServer[] | null {
    return isFresh(mcpCache) ? mcpCache.value : null;
}

export function fetchWarmMcpServers(): Promise<WarmMcpServer[]> {
    if (typeof commands.getMcpStatus !== "function") return Promise.resolve([]);
    const hit = peekWarmMcpServers();
    if (hit) return Promise.resolve(hit);
    if (mcpInflight) return mcpInflight;
    mcpInflight = commands
        .getMcpStatus()
        .then((statuses) => {
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
            mcpInflight = null;
            return connected;
        })
        .catch(() => {
            mcpInflight = null;
            return [];
        });
    return mcpInflight;
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

export function resetMentionWarmCachesForTests(): void {
    filesCache.clear();
    filesInflight.clear();
    chatsCache.clear();
    chatsInflight.clear();
    mcpCache = null;
    mcpInflight = null;
}

if (typeof window !== "undefined") {
    window.addEventListener("bettershape-files-changed", () => {
        filesCache.clear();
    });
    window.addEventListener("bettershape-chats-changed", () => {
        chatsCache.clear();
    });
}
