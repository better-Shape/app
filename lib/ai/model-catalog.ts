/**
 * Public model catalog.
 *
 * BetterShape ships with a frozen snapshot of the [models.dev](https://models.dev)
 * community catalog — an MIT-licensed, SST-maintained database of model ids,
 * context windows, modalities, pricing, and supported parameters served in an
 * OpenRouter-compatible shape. The snapshot is loaded on demand (not at module
 * import) to keep the renderer bundle small.
 *
 * At runtime the renderer refreshes the catalog from the network in the
 * background and caches the freshest copy in localStorage so new models appear
 * without an app update. For a user's own API keys, the Rust side hits the
 * provider's live `/models` endpoint during Test/Refresh and returns native
 * slugs; that list is merged with catalog metadata here so users never have
 * to type model ids or look up context windows by hand.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/** Shape of one record in the catalog (sourced from models.dev). */
export type CatalogModel = {
    id: string;
    name: string;
    context_length: number;
    description?: string | null;
    created?: number | null;
    architecture?: {
        modality?: string | null;
        input_modalities?: string[] | null;
        output_modalities?: string[] | null;
        tokenizer?: string | null;
        instruct_type?: string | null;
    } | null;
    pricing?: {
        prompt?: string | null;
        completion?: string | null;
        input_cache_read?: string | null;
        input_cache_write?: string | null;
        image?: string | null;
        request?: string | null;
    } | null;
    top_provider?: {
        context_length?: number | null;
        max_completion_tokens?: number | null;
        is_moderated?: boolean | null;
    } | null;
    supported_parameters?: string[] | null;
    expiration_date?: string | null;
};

type CatalogEnvelope = { data: CatalogModel[] };

/** Normalised, app-side metadata we compute for every model id. */
export type ModelMetadata = {
    id: string;
    /** Human-readable display name (with "Provider: " prefix stripped). */
    name: string;
    /** Canonical provider id used inside BetterShape (e.g. "openai"). */
    providerId: string;
    /**
     * Native slug the provider expects, WITHOUT the BetterShape provider
     * prefix. e.g. for "openai/gpt-4o-mini" slug is "gpt-4o-mini"; for
     * "openrouter/anthropic/claude-sonnet-4" slug is "anthropic/claude-sonnet-4".
     */
    slug: string;
    /** Human provider label. */
    providerLabel: string;
    contextWindow: number;
    /** Context window formatted for display, e.g. "128K", "1M". */
    contextWindowLabel: string;
    maxOutputTokens: number | null;
    inputCostPerM: number | null;
    outputCostPerM: number | null;
    cacheReadCostPerM: number | null;
    vision: boolean;
    reasoning: boolean;
    toolUse: boolean;
    structuredOutput: boolean;
    /** Embedding / audio / moderation / other non-chat model. */
    nonChat: boolean;
    /** Deprecated by the provider (sorted to the bottom, labelled). */
    deprecated: boolean;
    /** Where this record came from, for UI badges. */
    source: "catalog" | "discovered" | "inferred";
};

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const STORAGE_KEY = "bettershape.model-catalog.v2";
/** Refetch if the cached copy is older than this. */
const REFRESH_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours
/** Reject entries older than this even if they're still in localStorage. */
const MAX_CACHE_AGE_MS = 1000 * 60 * 60 * 24 * 14; // 2 weeks
const MAX_CATALOG_MODELS = 3000;

/** Catalog URLs to try in order. models.dev is canonical; GitHub raw is a
 *  fallback for environments where models.dev is blocked. */
const CATALOG_URLS = [
    "https://models.dev/models.json",
    "https://raw.githubusercontent.com/sst/models.dev/main/models.json",
];

import { MODEL_PROVIDER_PREFIX_MAP, type ProviderId } from "./provider-ids";

/* -------------------------------------------------------------------------- */
/* Provider label registry (set once by providers.ts at module load)          */
/* -------------------------------------------------------------------------- */

let providerLabelMap: Record<string, string> = {};
let knownProviderIds: Set<string> = new Set();

/** Register human labels (and the valid id set) for providers. Safe to call
 *  multiple times; later calls overwrite. */
export function registerProviderLabels(labels: Record<string, string>): void {
    providerLabelMap = { ...labels };
    knownProviderIds = new Set(Object.keys(labels));
}

function providerLabelFor(id: string): string {
    return providerLabelMap[id] ?? id;
}

function isKnownProviderId(id: string): boolean {
    return knownProviderIds.has(id);
}

/* -------------------------------------------------------------------------- */
/* State                                                                      */
/* -------------------------------------------------------------------------- */

let cachedIndex: Map<string, ModelMetadata> | null = null;
let cachedById: Map<ProviderId, ModelMetadata[]> | null = null;
let cachedSource: CatalogModel[] | null = null;
let cachedFetchedAt = 0;
let refreshPromise: Promise<{ models: ModelMetadata[]; fetchedAt: number; fromNetwork: boolean }> | null = null;

let snapshotCache: CatalogModel[] | null = null;
function readSnapshotSync(): CatalogModel[] {
    if (snapshotCache) return snapshotCache;
    // Use a require so the snapshot is bundled as a separate async chunk in
    // the browser but loads synchronously in tests/SSR. Webpack/turbopack
    // treat `require` inside a try/catch as non-blocking for the initial
    // chunk, giving us the lazy-bundle behaviour we want without forcing
    // every caller to be async.
    try {
        // We use require() for a lazy-loaded JSON snapshot (not an ESM import)
        // because it gives us synchronous access that still code-splits in
        // webpack/turbopack; an async `import()` would force every caller to
        // be async during the first paint, which is not acceptable for the
        // model picker hot path.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require("./catalog-snapshot.json") as CatalogEnvelope;
        snapshotCache = Array.isArray(mod?.data) ? mod.data : [];
    } catch {
        snapshotCache = [];
    }
    return snapshotCache;
}

function loadCachedFromStorage(): { data: CatalogModel[]; fetchedAt: number } | null {
    if (typeof window === "undefined" || typeof localStorage === "undefined") return null;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { fetchedAt: number; data: CatalogModel[] };
        if (!parsed.data || !Array.isArray(parsed.data)) return null;
        if (!parsed.fetchedAt || Date.now() - parsed.fetchedAt > MAX_CACHE_AGE_MS) return null;
        return { data: parsed.data, fetchedAt: parsed.fetchedAt };
    } catch {
        return null;
    }
}

function saveToStorage(data: CatalogModel[]) {
    if (typeof window === "undefined" || typeof localStorage === "undefined") return;
    try {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ fetchedAt: Date.now(), data }),
        );
    } catch {
        /* storage full / disabled — ignore */
    }
}

/* -------------------------------------------------------------------------- */
/* Normalisation helpers                                                      */
/* -------------------------------------------------------------------------- */

function parseNum(value: string | number | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return null;
    return n;
}

function pricePerMillion(perToken: string | number | null | undefined): number | null {
    const n = parseNum(perToken);
    if (n === null) return null;
    // Catalog prices are USD per token. Convert to per million and round to
    // 4dp (sub-cent precision) to avoid 0.14999999 noise.
    return Math.round(n * 1_000_000 * 10000) / 10000;
}

/**
 * Human-friendly context-window formatting. Uses precise K/M values rather
 * than rounding up to tiers (so "400,000" → "400K" not "500K", matching how
 * providers advertise their windows), but still trims ".0" for clean output.
 */
function formatContextWindow(tokens: number): string {
    if (!tokens || tokens <= 0) return "";
    if (tokens >= 1_000_000) {
        const m = tokens / 1_000_000;
        // Show one decimal only when needed (e.g. 1.05M → "1M" rounds fine
        // but 1.048.576 → "1M"). One decimal for values like 1.2M.
        return `${m.toFixed(m % 1_000_000 === 0 ? 0 : 1).replace(/\.0$/, "")}M`;
    }
    if (tokens >= 10_000) {
        const k = tokens / 1000;
        // Round to nearest 1K for clean labels — but snap 131/129 → 128,
        // 262 → 256 etc. only when very close to those binary tiers.
        const rounded = Math.round(k);
        const binaryTiers = [16, 32, 64, 128, 256, 512];
        for (const t of binaryTiers) {
            if (Math.abs(k - t) < 3) return `${t}K`;
        }
        return `${rounded}K`;
    }
    if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
    return String(tokens);
}

function normalizeName(name: string | null | undefined, fallback: string): string {
    if (!name) return fallback;
    // Strip "Vendor: " prefix (e.g. "Anthropic: Claude Sonnet 4", "OpenAI: GPT-4o").
    const trimmed = name.replace(/^[A-Za-z0-9 .&+-]+:\s*/, "").trim();
    return trimmed || fallback;
}

/**
 * Split a model id into (catalog prefix, native slug). The catalog uses
 * author/model (e.g. "meta-llama/llama-3.3-70b", "fireworks/accounts/..."),
 * but native provider APIs return just the last path segment OR a fully
 * qualified vendor/model — we only split on the FIRST slash when the prefix
 * is a known catalog author (i.e. it looks like "vendor/slug") and fall back
 * to treating the whole thing as the slug otherwise.
 */
function splitCatalogId(id: string): { catalogPrefix: string; nativeSlug: string } {
    const slash = id.indexOf("/");
    if (slash <= 0) return { catalogPrefix: "custom", nativeSlug: id };
    const prefix = id.slice(0, slash);
    // If the prefix is a known catalog namespace (author or mapped provider),
    // treat the first segment as the author and the rest as slug.
    if (MODEL_PROVIDER_PREFIX_MAP[prefix] || prefix.includes(".") === false) {
        return { catalogPrefix: prefix, nativeSlug: id.slice(slash + 1) };
    }
    return { catalogPrefix: "custom", nativeSlug: id };
}

/* -------------------------------------------------------------------------- */
/* Capability inference                                                       */
/* -------------------------------------------------------------------------- */

// Non-chat heuristics: match on known embedding/audio/moderation slugs AND on
// the output modalities field (when present AND non-empty).
const NON_CHAT_RE = /(^|[/\-])(embed|embedding|rerank|whisper|tts|speech|dall-?e|tts-?\d|safety|moderation|promptguard|prompt-guard|jailbreak|nsfw|segmind|stable-diffusion|imagen|pollinations)([/\-]|$)/i;
const VISION_RE = /(vision|-vl|gemini|gpt-4o|gpt-5|gpt-6|claude(?!.*haiku)|grok|multimodal|qwen-?2-?vl|qwen-?2\.5-?vl|llama-?3\.2-.*vision|llama-?4)/i;
const REASONING_RE = /(^|[/\-])(o[1-9]|o3|o4|r1|reason(er|ing)?|think(ing)?|opus-[4-9]|deepseek-reasoner|claude-opus)/i;
const TOOL_RE = /(gpt-[456]|o[134]|claude|gemini-2|gemini-3|gemini-4|grok|qwen(?!.*embed)|llama-?3\.[1-9]|llama-?[4-9]|mistral|deepseek(?!.*embed)|glm-5|kimi|command)/i;
const STRUCTURED_RE = /(o[34]|gpt-[456]|claude|gemini-|deepseek|glm-5|mistral|qwen)/i;
const FLAGSHIP_RE = /(opus|sonnet|gpt-5|gpt-6|gemini-2\.(5|6)|gemini-3|gemini-4|deepseek-v|llama-4|claude-[4-9])/i;

function inferModelMeta(model: CatalogModel): ModelMetadata {
    const id = model.id.trim();
    const { catalogPrefix, nativeSlug } = splitCatalogId(id);
    const providerId = (MODEL_PROVIDER_PREFIX_MAP[catalogPrefix] ??
        (isKnownProviderId(catalogPrefix) ? (catalogPrefix as ProviderId) : "custom")) as ProviderId;

    const inputModalities = model.architecture?.input_modalities ?? [];
    const outputModalities = model.architecture?.output_modalities ?? [];
    const params = new Set(model.supported_parameters ?? []);
    const modalityStr = model.architecture?.modality ?? "";

    const hasTextOutput = outputModalities.length === 0 || outputModalities.some((m) => m === "text");
    const hasVision =
        inputModalities.some((m) => m === "image") ||
        /image|video/.test(modalityStr) ||
        VISION_RE.test(nativeSlug);
    const isEmbedding =
        NON_CHAT_RE.test(nativeSlug) ||
        inputModalities.length > 0 && outputModalities.length === 0 && !params.has("max_tokens");
    const isNonChat = !hasTextOutput || isEmbedding;

    const supportsTools =
        params.has("tools") || params.has("tool_choice") ||
        (!isNonChat && (TOOL_RE.test(nativeSlug) || params.has("max_tokens") && /chat|instruct|turbo/i.test(nativeSlug)));
    const supportsReasoning =
        params.has("reasoning") || params.has("include_reasoning") || REASONING_RE.test(nativeSlug);
    const supportsStructured =
        params.has("structured_outputs") || params.has("response_format") ||
        STRUCTURED_RE.test(nativeSlug);
    const isDeprecated = !!model.expiration_date;

    const context = model.top_provider?.context_length ?? model.context_length ?? 0;
    const maxOut = parseNum(model.top_provider?.max_completion_tokens ?? null);
    const promptPrice = pricePerMillion(model.pricing?.prompt);
    const completionPrice = pricePerMillion(model.pricing?.completion);
    const cacheRead = pricePerMillion(model.pricing?.input_cache_read);

    return {
        id: providerId === catalogPrefix ? id : `${providerId}/${nativeSlug}`,
        name: normalizeName(model.name, nativeSlug || id),
        providerId,
        slug: nativeSlug,
        providerLabel: providerLabelFor(providerId),
        contextWindow: context,
        contextWindowLabel: formatContextWindow(context),
        maxOutputTokens: maxOut,
        inputCostPerM: promptPrice,
        outputCostPerM: completionPrice,
        cacheReadCostPerM: cacheRead ?? promptPrice,
        vision: hasVision,
        reasoning: supportsReasoning,
        toolUse: supportsTools,
        structuredOutput: supportsStructured,
        nonChat: isNonChat,
        deprecated: isDeprecated,
        source: "catalog",
    };
}

/* -------------------------------------------------------------------------- */
/* Index build                                                                */
/* -------------------------------------------------------------------------- */

function buildIndex(entries: CatalogModel[]): {
    byId: Map<string, ModelMetadata>;
    byProvider: Map<ProviderId, ModelMetadata[]>;
} {
    const byId = new Map<string, ModelMetadata>();
    const byProvider = new Map<ProviderId, ModelMetadata[]>();
    // Use a Set keyed on normalized id to avoid duplicate entries from
    // snapshot + cache overwriting each other with worse metadata.
    const seenIds = new Set<string>();
    let count = 0;
    for (const entry of entries) {
        if (!entry?.id || count >= MAX_CATALOG_MODELS) break;
        const meta = inferModelMeta(entry);
        if (seenIds.has(meta.id)) continue;
        seenIds.add(meta.id);
        byId.set(meta.id, meta);
        // Also index under the raw catalog id so lookups by raw vendor/slug work.
        byId.set(entry.id, meta);
        // Index bare slug for provider-hinted lookups (e.g. "gpt-4o" with
        // providerHint="openai" should resolve).
        byId.set(`${meta.providerId}/${meta.slug}`, meta);
        const pid = meta.providerId as ProviderId;
        const arr = byProvider.get(pid) ?? [];
        arr.push(meta);
        byProvider.set(pid, arr);
        count++;
    }
    for (const arr of byProvider.values()) {
        // Sort: chat models first, deprecated last; within each bucket prefer
        // flagship / large-context / recent models, then alphabetical.
        arr.sort((a, b) => {
            if (a.deprecated !== b.deprecated) return a.deprecated ? 1 : -1;
            const ca = a.nonChat ? 1 : 0;
            const cb = b.nonChat ? 1 : 0;
            if (ca !== cb) return ca - cb;
            const aFlag = FLAGSHIP_RE.test(a.id) ? 1 : 0;
            const bFlag = FLAGSHIP_RE.test(b.id) ? 1 : 0;
            if (aFlag !== bFlag) return bFlag - aFlag;
            return b.contextWindow - a.contextWindow || a.name.localeCompare(b.name);
        });
    }
    return { byId, byProvider };
}

function ensureIndexFromSource(source: CatalogModel[], fetchedAt: number) {
    const { byId, byProvider } = buildIndex(source);
    cachedIndex = byId;
    cachedById = byProvider;
    cachedSource = source;
    cachedFetchedAt = fetchedAt;
}

async function ensureIndexAsync(): Promise<{
    byId: Map<string, ModelMetadata>;
    byProvider: Map<ProviderId, ModelMetadata[]>;
    fetchedAt: number;
}> {
    if (cachedIndex && cachedById && cachedSource) {
        return { byId: cachedIndex, byProvider: cachedById, fetchedAt: cachedFetchedAt };
    }
    const stored = loadCachedFromStorage();
    if (stored) {
        ensureIndexFromSource(stored.data, stored.fetchedAt);
    } else {
        ensureIndexFromSource(readSnapshotSync(), 0);
    }
    return { byId: cachedIndex!, byProvider: cachedById!, fetchedAt: cachedFetchedAt };
}

/**
 * Synchronous accessor for UI code that runs after {@link primeModelCatalog}
 * or an explicit {@link refreshModelCatalog} has resolved. If the index is
 * not warm yet it falls back to the snapshot synchronously.
 */
function ensureIndexSync(): { byId: Map<string, ModelMetadata>; byProvider: Map<ProviderId, ModelMetadata[]>; fetchedAt: number } {
    if (cachedIndex && cachedById) return { byId: cachedIndex, byProvider: cachedById, fetchedAt: cachedFetchedAt };
    const stored = loadCachedFromStorage();
    if (stored) {
        ensureIndexFromSource(stored.data, stored.fetchedAt);
    } else {
        ensureIndexFromSource(readSnapshotSync(), 0);
    }
    return { byId: cachedIndex!, byProvider: cachedById!, fetchedAt: cachedFetchedAt };
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Metadata for a `provider/model` id (or native slug when provider is known).
 *
 * Falls back to heuristic inference when the id is not in the catalog so the
 * UI always has something useful to show, marked with `source: "inferred"`.
 */
export function getModelMetadata(id: string, providerHint?: ProviderId): ModelMetadata {
    const { byId } = ensureIndexSync();
    const trimmed = id.trim();
    if (!trimmed) {
        return {
            id: "",
            name: "",
            providerId: "custom",
            slug: "",
            providerLabel: providerLabelFor("custom"),
            contextWindow: 0,
            contextWindowLabel: "",
            maxOutputTokens: null,
            inputCostPerM: null,
            outputCostPerM: null,
            cacheReadCostPerM: null,
            vision: false,
            reasoning: false,
            toolUse: false,
            structuredOutput: false,
            nonChat: false,
            deprecated: false,
            source: "inferred",
        };
    }
    // Direct hit.
    const hit = byId.get(trimmed);
    if (hit) return hit;
    // Bare slug with a provider hint → try "<hint>/<slug>".
    if (providerHint && !trimmed.includes("/")) {
        const prefixed = byId.get(`${providerHint}/${trimmed}`);
        if (prefixed) return prefixed;
    }
    // If the id already contains a "/" but we still missed, the prefix may be
    // the raw catalog author (e.g. x-ai/grok-3) — canonicalize and retry.
    const { catalogPrefix, nativeSlug } = splitCatalogId(trimmed);
    const mapped = MODEL_PROVIDER_PREFIX_MAP[catalogPrefix];
    if (mapped && mapped !== catalogPrefix) {
        const remapped = byId.get(`${mapped}/${nativeSlug}`);
        if (remapped) return remapped;
    }
    // When the id uses a BetterShape routing prefix but the catalog stores
    // models under the inner vendor id (e.g. "openrouter/anthropic/claude-…"
    // is cataloged as "anthropic/claude-…"), strip the routing prefix and
    // recurse once.
    if (isKnownProviderId(catalogPrefix) && nativeSlug.includes("/")) {
        const inner = getModelMetadata(nativeSlug, providerHint);
        if (inner.source === "catalog") return inner;
    }
    // Pure inference.
    const prefix = trimmed.includes("/") ? catalogPrefix : (providerHint ?? "custom");
    const resolvedId = (isKnownProviderId(prefix) ? prefix : "custom") as ProviderId;
    const lower = nativeSlug.toLowerCase();
    const nonChat = NON_CHAT_RE.test(lower);
    return {
        id: `${resolvedId}/${nativeSlug}`,
        name: nativeSlug || trimmed,
        providerId: resolvedId,
        slug: nativeSlug,
        providerLabel: providerLabelFor(resolvedId),
        contextWindow: 0,
        contextWindowLabel: "",
        maxOutputTokens: null,
        inputCostPerM: null,
        outputCostPerM: null,
        cacheReadCostPerM: null,
        vision: VISION_RE.test(lower),
        reasoning: REASONING_RE.test(lower),
        toolUse: TOOL_RE.test(lower) && !nonChat,
        structuredOutput: STRUCTURED_RE.test(lower),
        nonChat,
        deprecated: false,
        source: "inferred",
    };
}

/** Every catalog model for one provider, chat-capable first. */
export function listCatalogModels(providerId?: ProviderId): ModelMetadata[] {
    const { byProvider } = ensureIndexSync();
    if (!providerId) {
        const all: ModelMetadata[] = [];
        for (const arr of byProvider.values()) all.push(...arr);
        return all;
    }
    return byProvider.get(providerId) ?? [];
}

/**
 * Turn a list of raw model ids (as the provider reported them) into fully
 * enriched {@link ModelMetadata}, pinned to the given BetterShape provider.
 * Result is sorted with chat-capable models first, flagships before niche,
 * deprecated models at the tail.
 */
export function enrichDiscoveredModels(
    providerId: ProviderId,
    discoveredIds: string[],
): ModelMetadata[] {
    const out: ModelMetadata[] = [];
    const seen = new Set<string>();
    for (const raw of discoveredIds) {
        const full = raw.trim();
        if (!full) continue;
        // If the provider reports ids already prefixed (e.g. OpenRouter returns
        // "openai/gpt-4o" rather than just "gpt-4o"), accept it but still pin
        // it to the connection's provider id so local gateways that lie about
        // their own prefix still surface correctly.
        const slug = full.startsWith(`${providerId}/`) ? full.slice(providerId.length + 1) : full;
        const id = `${providerId}/${slug.startsWith(`${providerId}/`) ? slug.slice(providerId.length + 1) : slug}`;
        if (seen.has(id)) continue;
        seen.add(id);
        // Look up metadata by the raw reported id first (gateway vendors
        // return "anthropic/claude-…" which is the catalog key), then try
        // the BetterShape-prefixed form for local gateways that stamp their
        // own prefix. getModelMetadata never returns null (it falls back to
        // an inferred record), so pick whichever call actually hit the
        // catalog; otherwise use the raw lookup.
        const rawMeta = getModelMetadata(full, providerId);
        const prefixedMeta = getModelMetadata(id, providerId);
        const meta = prefixedMeta.source === "catalog" && rawMeta.source !== "catalog"
            ? prefixedMeta
            : rawMeta;
        out.push({
            ...meta,
            providerId,
            id,
            slug: slug.startsWith(`${providerId}/`) ? slug.slice(providerId.length + 1) : slug,
            providerLabel: providerLabelFor(providerId),
            // Keep "catalog" when the catalog matched; otherwise mark as
            // "discovered" (the provider reported it but we have no metadata).
            source: meta.source === "catalog" ? "catalog" : "discovered",
        });
    }
    out.sort((a, b) => {
        if (a.deprecated !== b.deprecated) return a.deprecated ? 1 : -1;
        const ca = a.nonChat ? 1 : 0;
        const cb = b.nonChat ? 1 : 0;
        if (ca !== cb) return ca - cb;
        const aFlag = FLAGSHIP_RE.test(a.id) ? 1 : 0;
        const bFlag = FLAGSHIP_RE.test(b.id) ? 1 : 0;
        if (aFlag !== bFlag) return bFlag - aFlag;
        return b.contextWindow - a.contextWindow || a.name.localeCompare(b.name);
    });
    return out;
}

/** Format a price-per-million as "$3.00 / $15.00" (or "Free", or empty). */
export function formatModelPricing(meta: ModelMetadata): string {
    if (meta.inputCostPerM === null && meta.outputCostPerM === null) return "";
    const i = meta.inputCostPerM ?? 0;
    const o = meta.outputCostPerM ?? 0;
    if (i === 0 && o === 0) return "Free";
    const fmt = (n: number) => {
        if (n === 0) return "$0";
        if (n < 0.01) {
            // Trim trailing zeros (and a leftover trailing dot) from the
            // 4-decimal sub-cent price. Linear scan avoids the chained
            // regexes Sonar flags as quadratic backtracking.
            const s = n.toFixed(4);
            let end = s.length;
            while (end > 0 && s[end - 1] === "0") end--;
            if (end > 0 && s[end - 1] === ".") end--;
            return `$${s.slice(0, end)}`;
        }
        if (n < 1) return `$${n.toFixed(2)}`;
        return `$${n.toFixed(2)}`;
    };
    return `${fmt(i)} / ${fmt(o)}`;
}

/**
 * Pull the latest catalog from the network and warm the index.
 *
 * Safe to call repeatedly; concurrent calls are de-duplicated. Resolves to
 * the in-memory index (which may be snapshot-only if all network attempts
 * fail) — never rejects.
 */
export type RefreshResult = {
    models: ModelMetadata[];
    fetchedAt: number;
    fromNetwork: boolean;
};

export async function refreshModelCatalog(force = false): Promise<RefreshResult> {
    // If the in-memory cache is fresh enough, skip the network unless forced.
    if (!force && cachedSource && cachedFetchedAt && Date.now() - cachedFetchedAt < REFRESH_TTL_MS) {
        const all: ModelMetadata[] = [];
        for (const arr of (cachedById!).values()) all.push(...arr);
        return { models: all, fetchedAt: cachedFetchedAt, fromNetwork: false };
    }
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async (): Promise<RefreshResult> => {
        let fromNetwork = false;
        try {
            for (const url of CATALOG_URLS) {
                try {
                    const res = await fetch(url, { cache: "no-cache" });
                    if (!res.ok) continue;
                    const json = (await res.json()) as CatalogEnvelope;
                    if (Array.isArray(json?.data) && json.data.length > 200) {
                        saveToStorage(json.data);
                        cachedIndex = null;
                        cachedById = null;
                        cachedSource = null;
                        fromNetwork = true;
                        break;
                    }
                } catch {
                    /* try next url */
                }
            }
        } finally {
            refreshPromise = null;
        }
        cachedIndex = null;
        cachedById = null;
        cachedSource = null;
        const { byProvider, fetchedAt } = await ensureIndexAsync();
        const all: ModelMetadata[] = [];
        for (const arr of byProvider.values()) all.push(...arr);
        return { models: all, fetchedAt, fromNetwork };
    })();
    return refreshPromise;
}

/**
 * Kick off a background refresh once per page load.
 *
 * Uses the snapshot/cache synchronously on first render, then upgrades to
 * fresh network data once available. Callers that need to know when the
 * refresh finished can await {@link refreshModelCatalog} themselves.
 */
export function primeModelCatalog(): void {
    if (typeof window === "undefined") return;
    // Warm the index synchronously from localStorage/snapshot so first paint
    // has metadata; defer the network refresh past first idle.
    ensureIndexSync();
    const schedule = () => {
        void refreshModelCatalog().catch(() => {});
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
    if (typeof w.requestIdleCallback === "function") {
        w.requestIdleCallback(schedule, { timeout: 10_000 });
    } else {
        window.setTimeout(schedule, 3000);
    }
}

/** Timestamp (ms) the in-memory index was fetched at, or 0 if it's the snapshot. */
export function catalogFetchedAt(): number {
    return cachedFetchedAt;
}

/** Number of catalog entries currently loaded. */
export function catalogSize(): number {
    const { byId } = ensureIndexSync();
    return byId.size;
}
