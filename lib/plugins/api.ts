/**
 * Composio client (BYOK).
 *
 * Plugins run against the user's own Composio account: the key is entered in
 * Settings → Plugins and every call goes straight to `backend.composio.dev`.
 * Nothing is proxied through a BetterShape server.
 */

import { getSettings } from "@/lib/settings";

const COMPOSIO_BASE = "https://backend.composio.dev/api/v3";

export class ComposioError extends Error {
    constructor(message: string, readonly status?: number) {
        super(message);
        this.name = "ComposioError";
    }
}

export type PluginRow = {
    id: string;
    name: string;
    description: string;
    category: string;
    toolkit: string;
    connected: boolean;
    /** Connected-account id when connected. */
    accountId?: string | null;
    logo: string | null;
};

export type PluginToolHint = {
    slug: string;
    name: string;
    description: string;
};

function apiKey(): string {
    return getSettings().ai.providers.services.composio.apiKey.trim();
}

export function composioConfigured(): boolean {
    return apiKey().length > 0;
}

export function composioUserId(): string {
    return getSettings().ai.providers.services.composio.userId.trim() || "bettershape-local";
}

function requireKey(): string {
    const key = apiKey();
    if (!key) {
        throw new ComposioError(
            "Add your Composio API key in Settings → Plugins to use plugins.",
            401,
        );
    }
    return key;
}

async function composioFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
    const key = requireKey();
    let res: Response;
    try {
        res = await fetch(`${COMPOSIO_BASE}${path}`, {
            ...init,
            headers: {
                "x-api-key": key,
                "Content-Type": "application/json",
                ...(init.headers ?? {}),
            },
            signal: AbortSignal.timeout(15_000),
        });
    } catch (err) {
        throw new ComposioError(
            err instanceof Error ? `Could not reach Composio: ${err.message}` : "Could not reach Composio",
        );
    }
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        const detail = text.trim().slice(0, 300);
        if (res.status === 401 || res.status === 403) {
            throw new ComposioError(
                "Composio rejected the API key. Check it in Settings → Plugins.",
                res.status,
            );
        }
        throw new ComposioError(
            detail || `Composio error (${res.status})`,
            res.status,
        );
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
}

type ConnectedAccount = {
    id: string;
    status?: string;
    toolkit?: { slug?: string; name?: string };
};

type ToolkitRow = {
    slug: string;
    name?: string;
    meta?: {
        description?: string;
        categories?: { name?: string }[] | string[];
        logo?: string;
    };
};

type ToolRow = {
    slug: string;
    name?: string;
    description?: string;
    human_description?: string;
};

const TTL_MS = 5 * 60 * 1000;
/** How often the plugins page re-reads Composio while it is open. */
export const PLUGINS_PAGE_REFRESH_MS = 5_000;
let connectedCache: { rows: PluginRow[]; at: number } | null = null;
const toolsCache = new Map<string, { tools: PluginToolHint[]; at: number }>();
const listeners = new Set<() => void>();
let catalogWatchStarted = false;
/** Latest catalog request. Older responses must not replace a newer snapshot. */
let fetchSeq = 0;

function emitPlugins() {
    for (const listener of listeners) listener();
}

/** Re-render surfaces that show `connected` after a catalog fetch. */
export function subscribePlugins(listener: () => void): () => void {
    listeners.add(listener);
    watchPluginCatalog();
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Drop the catalog when the window comes back: an account linked in the
 * Composio dashboard otherwise stays stale until the cache TTL expires.
 */
export function watchPluginCatalog() {
    if (catalogWatchStarted || typeof window === "undefined") return;
    catalogWatchStarted = true;
    const drop = () => {
        if (document.visibilityState === "hidden") return;
        if (!composioConfigured()) return;
        invalidatePluginsCache();
        void fetchPlugins({ force: true }).catch(() => {});
    };
    window.addEventListener("focus", drop);
    document.addEventListener("visibilitychange", drop);
}

export function peekPluginsCache(): { plugins: PluginRow[]; configured: boolean } | null {
    if (!connectedCache) return null;
    return { plugins: connectedCache.rows, configured: composioConfigured() };
}

export function invalidatePluginsCache(toolkit?: string) {
    connectedCache = null;
    fetchSeq += 1;
    if (toolkit) toolsCache.delete(toolkit.toLowerCase());
    else toolsCache.clear();
}

function categoryOf(toolkit: ToolkitRow): string {
    const categories = toolkit.meta?.categories;
    if (!categories || categories.length === 0) return "Tools";
    const first = categories[0];
    return typeof first === "string" ? first : first?.name ?? "Tools";
}

function toRow(toolkit: ToolkitRow, connected: boolean, accountId?: string | null): PluginRow {
    return {
        id: toolkit.slug,
        name: toolkit.name?.trim() || toolkit.slug,
        description: toolkit.meta?.description?.trim() || "",
        category: categoryOf(toolkit),
        toolkit: toolkit.slug,
        connected,
        accountId: accountId ?? null,
        logo: toolkit.meta?.logo ?? null,
    };
}

const CURATED: Record<string, string> = {
    github: "Issues, pull requests, and repositories",
    slack: "Messages, channels, and files",
    gmail: "Read, search, and send mail",
    notion: "Pages, databases, and comments",
    linear: "Issues, projects, and cycles",
    figma: "Files, comments, and components",
    jira: "Issues, sprints, and boards",
    googledrive: "Files and folders",
    googlesheets: "Spreadsheets and ranges",
    airtable: "Bases, tables, and records",
    stripe: "Customers, payments, and invoices",
    vercel: "Projects, deployments, and env vars",
};

/** Connected toolkits first, then a curated list of popular ones to connect. */
export async function fetchPlugins(opts?: { force?: boolean }): Promise<{
    plugins: PluginRow[];
    configured: boolean;
}> {
    if (!composioConfigured()) {
        return { plugins: [], configured: false };
    }
    const now = Date.now();
    if (!opts?.force && connectedCache && now - connectedCache.at < TTL_MS) {
        return { plugins: connectedCache.rows, configured: true };
    }
    const seq = ++fetchSeq;

    const [accounts, toolkits] = await Promise.all([
        composioFetch<{ items?: ConnectedAccount[] }>(
            `/connected_accounts?user_ids=${encodeURIComponent(composioUserId())}&statuses=ACTIVE`,
        ).catch(() => ({ items: [] as ConnectedAccount[] })),
        composioFetch<{ items?: ToolkitRow[] }>("/toolkits?limit=200").catch(() => ({
            items: [] as ToolkitRow[],
        })),
    ]);

    const bySlug = new Map((toolkits.items ?? []).map((t) => [t.slug, t]));
    const rows: PluginRow[] = [];
    const connectedSlugs = new Set<string>();

    for (const account of accounts.items ?? []) {
        const slug = account.toolkit?.slug;
        if (!slug) continue;
        connectedSlugs.add(slug);
        const toolkit = bySlug.get(slug) ?? {
            slug,
            name: account.toolkit?.name,
            meta: { description: CURATED[slug] ?? "" },
        };
        rows.push(toRow(toolkit, true, account.id));
    }

    for (const slug of Object.keys(CURATED)) {
        if (connectedSlugs.has(slug)) continue;
        const toolkit = bySlug.get(slug) ?? { slug, meta: { description: CURATED[slug] } };
        rows.push(toRow(toolkit, false));
    }

    rows.sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));
    if (seq !== fetchSeq) {
        return peekPluginsCache() ?? { plugins: rows, configured: true };
    }
    connectedCache = { rows, at: now };
    emitPlugins();
    return { plugins: rows, configured: true };
}

/** Search every Composio toolkit (for the "add a plugin" list). */
export async function searchToolkits(query: string): Promise<PluginRow[]> {
    const trimmed = query.trim();
    if (!trimmed) {
        const { plugins } = await fetchPlugins();
        return plugins;
    }
    const data = await composioFetch<{ items?: ToolkitRow[] }>(
        `/toolkits?search=${encodeURIComponent(trimmed)}&limit=50`,
    ).catch(() => ({ items: [] as ToolkitRow[] }));
    const connected = new Set(
        (connectedCache?.rows ?? []).filter((r) => r.connected).map((r) => r.toolkit),
    );
    return (data.items ?? []).map((toolkit) =>
        toRow(toolkit, connected.has(toolkit.slug), null),
    );
}

export async function fetchPluginTools(
    toolkit: string,
    opts?: { force?: boolean },
): Promise<PluginToolHint[]> {
    const key = toolkit.toLowerCase();
    const now = Date.now();
    const hit = toolsCache.get(key);
    if (!opts?.force && hit && now - hit.at < TTL_MS) return hit.tools;
    const data = await composioFetch<{ items?: ToolRow[] }>(
        `/tools?toolkit_slug=${encodeURIComponent(toolkit)}&limit=200`,
    ).catch(() => ({ items: [] as ToolRow[] }));
    const tools = (data.items ?? []).map((tool) => ({
        slug: tool.slug,
        name: tool.name ?? tool.slug,
        description: tool.human_description ?? tool.description ?? "",
    }));
    toolsCache.set(key, { tools, at: now });
    return tools;
}

/** Default auth config for a toolkit, when Composio has one. */
async function defaultAuthConfig(toolkit: string): Promise<string | undefined> {
    const data = await composioFetch<{
        items?: { id: string; is_composio_managed?: boolean }[];
    }>(`/auth_configs?toolkit_slug=${encodeURIComponent(toolkit)}`).catch(
        () => ({ items: [] as { id: string; is_composio_managed?: boolean }[] }),
    );
    const items = data.items ?? [];
    return items.find((c) => c.is_composio_managed)?.id ?? items[0]?.id;
}

/** Start an OAuth/API-key connection; returns the URL to open in the browser. */
export async function startPluginConnect(toolkit: string): Promise<{ redirectUrl: string }> {
    const authConfigId = await defaultAuthConfig(toolkit);
    const body: Record<string, string> = {
        toolkit_slug: toolkit,
        user_id: composioUserId(),
    };
    if (authConfigId) body.auth_config_id = authConfigId;
    const data = await composioFetch<{ redirect_url?: string; redirectUrl?: string }>(
        "/connected_accounts/link",
        { method: "POST", body: JSON.stringify(body) },
    );
    const redirectUrl = data.redirect_url ?? data.redirectUrl ?? "";
    if (!redirectUrl) {
        throw new ComposioError(
            "Composio did not return a connect link. Create an auth config for this toolkit in Composio first.",
        );
    }
    return { redirectUrl };
}

export async function disconnectPlugin(toolkit: string): Promise<void> {
    const { plugins } = await fetchPlugins({ force: true });
    const accountIds = plugins
        .filter(
            (row): row is typeof row & { accountId: string } =>
                row.toolkit.toLowerCase() === toolkit.toLowerCase() && Boolean(row.accountId),
        )
        .map((row) => row.accountId);
    for (const id of accountIds) {
        await composioFetch<void>(`/connected_accounts/${encodeURIComponent(id)}`, {
            method: "DELETE",
        });
    }
    invalidatePluginsCache(toolkit);
}

/** Short hint used by MCP server cards: what this toolkit can do. */
export async function fetchComposioSkillHint(query: string): Promise<string | undefined> {
    if (!composioConfigured()) return undefined;
    const slug = query.trim().toLowerCase().replace(/\s+/g, "-");
    if (!slug) return undefined;
    try {
        const tools = await fetchPluginTools(slug);
        if (tools.length === 0) return undefined;
        return tools
            .slice(0, 12)
            .map((tool) => `- ${tool.slug}: ${tool.description.split("\n")[0]}`)
            .join("\n")
            .slice(0, 1200);
    } catch {
        return undefined;
    }
}
