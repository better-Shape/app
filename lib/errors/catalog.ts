import { REPO_URL } from "@/lib/errors/help-links";

export type BetterShapeErrorEntry = {
    code: number;
    /** Human name for docs / internal reference; not shown as the primary UI label. */
    name: string;
    title: string;
    description: string;
};

/**
 * Stable numeric BetterShape error codes.
 *
 * The app has no server, so the account, billing and build-trust ranges are
 * gone. Four-digit codes below identify the local IDE surface; everything
 * else is 9xxx.
 */
export const BETTERSHAPE_ERRORS = {
    AI_PROVIDER: 2000,
    AI_NETWORK: 2001,
    AI_RATE_LIMITED: 2100,
    AI_KEY_MISSING: 2200,

    WORKSPACE_ACCESS: 4000,
    GIT_FAILED: 4100,
    LANGUAGE_SERVER: 4200,
    INDEX_SEARCH: 4300,
    TERMINAL: 4400,
    UPDATE_FAILED: 4500,
    EMBEDDINGS_FAILED: 4600,
    PLUGINS_FAILED: 4700,

    UNKNOWN: 9000,
} as const;

export type BetterShapeErrorCode = (typeof BETTERSHAPE_ERRORS)[keyof typeof BETTERSHAPE_ERRORS];

const CATALOG: Record<number, BetterShapeErrorEntry> = {
    [BETTERSHAPE_ERRORS.AI_PROVIDER]: {
        code: BETTERSHAPE_ERRORS.AI_PROVIDER,
        name: "AI provider failure",
        title: "AI request failed",
        description:
            "Your model provider returned an error. Check the model id and your account limits, then try again.",
    },
    [BETTERSHAPE_ERRORS.AI_NETWORK]: {
        code: BETTERSHAPE_ERRORS.AI_NETWORK,
        name: "AI network failure",
        title: "Could not reach the model provider",
        description:
            "BetterShape could not reach the provider endpoint. Check your connection (and any local proxy or base URL) and try again.",
    },
    [BETTERSHAPE_ERRORS.AI_RATE_LIMITED]: {
        code: BETTERSHAPE_ERRORS.AI_RATE_LIMITED,
        name: "AI rate limited",
        title: "Provider rate limit reached",
        description:
            "The provider is rate limiting requests for your key. Wait a moment, or pick a different model.",
    },
    [BETTERSHAPE_ERRORS.AI_KEY_MISSING]: {
        code: BETTERSHAPE_ERRORS.AI_KEY_MISSING,
        name: "Provider key missing",
        title: "No API key for this provider",
        description:
            "Add a key for this provider in Settings → Providers, or choose a model from a provider you have configured.",
    },
    [BETTERSHAPE_ERRORS.WORKSPACE_ACCESS]: {
        code: BETTERSHAPE_ERRORS.WORKSPACE_ACCESS,
        name: "Workspace access",
        title: "Workspace is not available",
        description:
            "BetterShape could not read or write the project folder. Check the path and your file permissions.",
    },
    [BETTERSHAPE_ERRORS.GIT_FAILED]: {
        code: BETTERSHAPE_ERRORS.GIT_FAILED,
        name: "Git failure",
        title: "Git command failed",
        description: "The git operation did not complete. See the output for details.",
    },
    [BETTERSHAPE_ERRORS.LANGUAGE_SERVER]: {
        code: BETTERSHAPE_ERRORS.LANGUAGE_SERVER,
        name: "Language server",
        title: "Language server problem",
        description: "A language server crashed or could not start. Diagnostics may be incomplete.",
    },
    [BETTERSHAPE_ERRORS.INDEX_SEARCH]: {
        code: BETTERSHAPE_ERRORS.INDEX_SEARCH,
        name: "Index search",
        title: "Codebase search failed",
        description: "BetterShape could not search the project index. Re-index the project to rebuild it.",
    },
    [BETTERSHAPE_ERRORS.TERMINAL]: {
        code: BETTERSHAPE_ERRORS.TERMINAL,
        name: "Terminal",
        title: "Terminal error",
        description: "The terminal session reported an error. Restart the session if it hangs.",
    },
    [BETTERSHAPE_ERRORS.UPDATE_FAILED]: {
        code: BETTERSHAPE_ERRORS.UPDATE_FAILED,
        name: "Update failed",
        title: "Could not install the update",
        description: "The update did not finish. Download the build again from the releases page.",
    },
    [BETTERSHAPE_ERRORS.EMBEDDINGS_FAILED]: {
        code: BETTERSHAPE_ERRORS.EMBEDDINGS_FAILED,
        name: "Embeddings failure",
        title: "Semantic index unavailable",
        description:
            "Embeddings need an OpenAI-compatible key (OpenAI, OpenRouter or a custom base URL). Keyword search still works.",
    },
    [BETTERSHAPE_ERRORS.PLUGINS_FAILED]: {
        code: BETTERSHAPE_ERRORS.PLUGINS_FAILED,
        name: "Plugins failure",
        title: "Plugin request failed",
        description:
            "Composio rejected the request. Check your Composio API key and connected accounts in Settings → Plugins.",
    },
    [BETTERSHAPE_ERRORS.UNKNOWN]: {
        code: BETTERSHAPE_ERRORS.UNKNOWN,
        name: "Unknown",
        title: "Something went wrong",
        description: "An unexpected error occurred. Try again, or check the app logs.",
    },
};

export function getError(code: number): BetterShapeErrorEntry {
    return CATALOG[code] ?? CATALOG[BETTERSHAPE_ERRORS.UNKNOWN];
}

export function errorDocsUrl(code: number): string {
    const base = REPO_URL.replace(/\/$/, "");
    return `${base}/blob/main/docs/help/errors.md#${code}`;
}

export function listErrorCatalog(): BetterShapeErrorEntry[] {
    return Object.values(CATALOG).sort((a, b) => a.code - b.code);
}

/** Notify using catalog title/description; optional detail overrides the body. */
export function notifyCatalogError(
    code: number,
    detail?: string,
    options?: { title?: string },
): void {
    const entry = getError(code);
    const description = detail?.trim() || entry.description;
    void import("@/features/notifications").then(({ notify }) => {
        notify.error(options?.title ?? entry.title, description, { code: entry.code });
    });
}

/** Map provider/runtime error strings onto a catalog entry. */
export function classifyAiError(raw: string): BetterShapeErrorEntry {
    const lower = raw.trim().toLowerCase();
    if (
        lower.includes("no model provider is configured")
        || lower.includes("has no api key")
        || lower.includes("add one in settings")
        || lower.includes("api key")
    ) {
        return getError(BETTERSHAPE_ERRORS.AI_KEY_MISSING);
    }
    if (
        lower.includes("429")
        || lower.includes("rate limit")
        || lower.includes("too many requests")
        || lower.includes("ratelimit")
        || lower.includes("overloaded")
    ) {
        return getError(BETTERSHAPE_ERRORS.AI_RATE_LIMITED);
    }
    if (
        lower.includes("network")
        || lower.includes("fetch")
        || lower.includes("timeout")
        || lower.includes("dns")
        || lower.includes("connection")
    ) {
        return getError(BETTERSHAPE_ERRORS.AI_NETWORK);
    }
    if (
        lower.includes("api error")
        || lower.includes("401")
        || lower.includes("403")
        || lower.includes("404")
        || lower.includes("model")
        || lower.includes("provider")
    ) {
        return getError(BETTERSHAPE_ERRORS.AI_PROVIDER);
    }
    const unknown = getError(BETTERSHAPE_ERRORS.UNKNOWN);
    const detail = raw.trim();
    return {
        ...unknown,
        description: detail.length > 220 ? `${detail.slice(0, 220)}…` : detail || unknown.description,
    };
}

/** Map common IDE/git/file error strings to a catalog entry. */
export function classifyIdeError(raw: unknown): BetterShapeErrorEntry {
    const text = String(raw ?? "").trim();
    const lower = text.toLowerCase();

    if (
        lower.includes("permission denied")
        || lower.includes("access is denied")
        || lower.includes("os error 5")
        || lower.includes("eacces")
        || lower.includes("eperm")
        || lower.includes("read-only file system")
    ) {
        return getError(BETTERSHAPE_ERRORS.WORKSPACE_ACCESS);
    }
    if (lower.includes("embeddings") || lower.includes("vector")) {
        return getError(BETTERSHAPE_ERRORS.EMBEDDINGS_FAILED);
    }
    if (lower.includes("composio") || lower.includes("plugin")) {
        return getError(BETTERSHAPE_ERRORS.PLUGINS_FAILED);
    }
    if (lower.includes("index") || lower.includes("ripgrep") || lower.includes("codebase search")) {
        return getError(BETTERSHAPE_ERRORS.INDEX_SEARCH);
    }
    if (lower.includes("language server") || lower.includes("lsp")) {
        return getError(BETTERSHAPE_ERRORS.LANGUAGE_SERVER);
    }
    if (lower.includes("terminal") || lower.includes("pty")) {
        return getError(BETTERSHAPE_ERRORS.TERMINAL);
    }
    if (
        lower.includes("git")
        || /\b(push|pull|merge|rebase|commit|checkout|branch|remote|clone|upstream|origin|unstaged|stash|tag)\b/.test(lower)
    ) {
        return getError(BETTERSHAPE_ERRORS.GIT_FAILED);
    }
    if (lower.includes("update")) {
        return getError(BETTERSHAPE_ERRORS.UPDATE_FAILED);
    }
    return classifyAiError(text);
}

export function notifyOfflineOnce(): void {
    /* offline tracking was server-era bookkeeping; nothing to notify about now */
}

export function resetOfflineLaunchNotifiedForTests(): void {
    /* no state */
}
