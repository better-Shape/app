/**
 * Public model catalog.
 *
 * BetterShape bundles an offline fallback snapshot (`catalog-snapshot.json`) of
 * model ids, context windows, modalities, pricing, and supported parameters in
 * OpenRouter `/api/v1/models` format. The snapshot is loaded on demand (not at
 * module import) to keep the renderer bundle small.
 *
 * At runtime the renderer refreshes the public catalog from OpenRouter's
 * `/api/v1/models` endpoint through the `ai_fetch_model_catalog` Tauri command
 * and caches the freshest copy in `localStorage` so new models appear without
 * an app update. For a user's own API keys, the Rust side hits the provider's
 * live `/models` endpoint during Test/Refresh and returns native slugs; that
 * list is merged with catalog metadata here so users never have to type model
 * ids or look up context windows by hand.
 */

import { commands } from "@/lib/backend/commands";
import { MODEL_PROVIDER_PREFIX_MAP, type ProviderId } from "./provider-ids";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/** Shape of one record in the OpenRouter-compatible `/models` catalog feed. */
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

/**
 * Result of pulling the latest catalog from the network and warming the index.
 *
 * Safe to call repeatedly; concurrent calls are de-duplicated. Resolves to
 * the in-memory index (which may be snapshot-only if all network attempts
 * fail) - never rejects.
 */
export type RefreshResult = {
    models: ModelMetadata[];
    fetchedAt: number;
    fromNetwork: boolean;
};

type IndexedCatalog = {
    byId: Map<string, ModelMetadata>;
    byProvider: Map<ProviderId, ModelMetadata[]>;
    fetchedAt: number;
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
const BINARY_TIERS_KB = [16, 32, 64, 128, 256, 512];

const VENDOR_PREFIX_RE = /^[A-Za-z0-9 .&+-]{1,48}:[ \t]*/u;
const TRAILING_POINT_ZERO_RE = /\.0$/u;
const IMAGE_VIDEO_MODALITY_RE = /image|video/u;
const CHAT_INSTRUCT_SLUG_RE = /chat|instruct|turbo/iu;

// Non-chat heuristics: match on known embedding/audio/moderation slugs AND on
// the output modalities field (when present AND non-empty).
const NON_CHAT_RE =
    /(?:^|[/-])(?:embed|embedding|rerank|whisper|tts|speech|dall-?e|tts-?\d|safety|moderation|promptguard|prompt-guard|jailbreak|nsfw|segmind|stable-diffusion|imagen|pollinations)(?:[/-]|$)/iu;
const VISION_TOKEN_RE =
    /vision|-vl|gemini|gpt-4o|gpt-5|gpt-6|grok|multimodal|qwen-?2-?vl|qwen-?2\.5-?vl|llama-?4/iu;
const LLAMA_32_PREFIX_RE = /llama-?3\.2-/iu;
const REASONING_RE =
    /(?:^|[/-])(?:o[1-9]|o3|o4|r1|reason(?:er|ing)?|think(?:ing)?|opus-[4-9]|deepseek-reasoner|claude-opus)/iu;
const TOOL_TOKEN_RE =
    /gpt-[456]|o[134]|claude|gemini-[234]|grok|llama-?3\.[1-9]|llama-?[4-9]|mistral|glm-5|kimi|command/iu;
const QWEN_OR_DEEPSEEK_RE = /qwen|deepseek/iu;
const EMBED_SUBSTR_RE = /embed/iu;
const STRUCTURED_RE = /o[34]|gpt-[456]|claude|gemini-|deepseek|glm-5|mistral|qwen/iu;
const FLAGSHIP_RE =
    /opus|sonnet|gpt-5|gpt-6|gemini-2\.[56]|gemini-[34]|deepseek-v|llama-4|claude-[4-9]/iu;

/* -------------------------------------------------------------------------- */
/* State & provider registry                                                  */
/* -------------------------------------------------------------------------- */

let providerLabelMap: Record<string, string> = {};
let knownProviderIds: Set<string> = new Set();

let cachedIndex: Map<string, ModelMetadata> | null = null;
let cachedById: Map<ProviderId, ModelMetadata[]> | null = null;
let cachedSource: CatalogModel[] | null = null;
let cachedFetchedAt = 0;
let refreshPromise: Promise<RefreshResult> | null = null;
let snapshotCache: CatalogModel[] | null = null;

/** Resolves the registered human label for `id`, falling back to `id`. */
const providerLabelFor = (id: string): string => providerLabelMap[id] ?? id;

/** Checks whether `id` is a registered BetterShape provider identifier. */
const isKnownProviderId = (id: string): boolean => knownProviderIds.has(id);

/** Lazily loads `catalog-snapshot.json` once without eager top-level bundling. */
const readSnapshotSync = (): CatalogModel[] => {
    if (snapshotCache) return snapshotCache;
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require("./catalog-snapshot.json") as CatalogEnvelope;
        snapshotCache = Array.isArray(mod?.data) ? mod.data : [];
    } catch {
        snapshotCache = [];
    }
    return snapshotCache;
};

/** Checks whether `value` is a positive timestamp within `MAX_CACHE_AGE_MS`. */
const isFreshCacheTimestamp = (value: unknown): value is number =>
    typeof value === "number" && value > 0 && Date.now() - value <= MAX_CACHE_AGE_MS;

/** Validates a parsed `localStorage` catalog envelope and checks its TTL. */
const isValidCachedEnvelope = (
    parsed: unknown,
): parsed is { fetchedAt: number; data: CatalogModel[] } => {
    if (!parsed || typeof parsed !== "object") return false;
    const candidate = parsed as { fetchedAt?: unknown; data?: unknown };
    return Array.isArray(candidate.data) && isFreshCacheTimestamp(candidate.fetchedAt);
};

/** Checks whether browser `localStorage` is accessible in the current runtime. */
const hasBrowserLocalStorage = (): boolean =>
    typeof window !== "undefined" && typeof localStorage !== "undefined";

/** Reads a cached catalog payload from `localStorage` when available and fresh. */
const loadCachedFromStorage = (): { data: CatalogModel[]; fetchedAt: number } | null => {
    if (!hasBrowserLocalStorage()) return null;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        return isValidCachedEnvelope(parsed)
            ? { data: parsed.data, fetchedAt: parsed.fetchedAt }
            : null;
    } catch {
        return null;
    }
};

/** Persists fetched catalog entries to `localStorage` on a best-effort basis. */
const saveToStorage = (data: CatalogModel[]): void => {
    if (!hasBrowserLocalStorage()) return;
    try {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ fetchedAt: Date.now(), data }),
        );
    } catch {
        /* storage full / disabled */
    }
};

/* -------------------------------------------------------------------------- */
/* Normalisation helpers                                                      */
/* -------------------------------------------------------------------------- */

/** Parses finite numbers from string or numeric catalog fields. */
const parseNum = (value: string | number | null | undefined): number | null => {
    if (value === null || value === undefined) return null;
    const num = typeof value === "number" ? value : Number(value);
    return Number.isFinite(num) ? num : null;
};

/** Converts per-token USD strings to rounded USD-per-million-token numbers. */
const pricePerMillion = (
    perToken: string | number | null | undefined,
): number | null => {
    const num = parseNum(perToken);
    if (num === null || num < 0) return null;
    return Math.round(num * 1_000_000 * 10000) / 10000;
};

/** Formats million-scale context windows (e.g. `1_000_000` -> `"1M"`). */
const formatMillionWindow = (tokens: number): string => {
    const millions = tokens / 1_000_000;
    const decimals = tokens % 1_000_000 === 0 ? 0 : 1;
    return `${millions.toFixed(decimals).replace(TRAILING_POINT_ZERO_RE, "")}M`;
};

/** Checks whether `tokens` lies within 3K of `tier` in decimal (`1000`) or binary (`1024`) units. */
const matchesBinaryContextTier = (tokens: number, tier: number): boolean =>
    Math.abs(tokens / 1000 - tier) < 3 || Math.abs(tokens / 1024 - tier) < 3;

/** Formats `>= 10_000` context windows, snapping near binary tiers (`128K`, `256K`, `512K`). */
const formatLargeKilobyteWindow = (tokens: number): string => {
    const matchedTier = BINARY_TIERS_KB.find((tier) =>
        matchesBinaryContextTier(tokens, tier),
    );
    return matchedTier ? `${matchedTier}K` : `${Math.round(tokens / 1000)}K`;
};

/** Human-friendly context-window formatting (`"128K"`, `"400K"`, `"1M"`). */
export const formatContextWindow = (tokens: number): string => {
    if (tokens <= 0) return "";
    if (tokens >= 1_000_000) return formatMillionWindow(tokens);
    if (tokens >= 10_000) return formatLargeKilobyteWindow(tokens);
    return tokens >= 1000 ? `${Math.round(tokens / 1000)}K` : String(tokens);
};

/** Strips `"Vendor: "` prefixes from human model names when present. */
const normalizeName = (
    name: string | null | undefined,
    fallback: string,
): string => {
    if (!name) return fallback;
    const trimmed = name.replace(VENDOR_PREFIX_RE, "").trim();
    return trimmed || fallback;
};

/** Checks whether `prefix` is a mapped or dot-free catalog vendor namespace. */
const isCatalogVendorPrefix = (prefix: string): boolean =>
    Boolean(MODEL_PROVIDER_PREFIX_MAP[prefix]) || !prefix.includes(".");

/** Splits a catalog id into `(catalogPrefix, nativeSlug)`. */
const splitCatalogId = (
    id: string,
): { catalogPrefix: string; nativeSlug: string } => {
    const slash = id.indexOf("/");
    if (slash <= 0) return { catalogPrefix: "custom", nativeSlug: id };
    const prefix = id.slice(0, slash);
    if (isCatalogVendorPrefix(prefix)) {
        return { catalogPrefix: prefix, nativeSlug: id.slice(slash + 1) };
    }
    return { catalogPrefix: "custom", nativeSlug: id };
};

/* -------------------------------------------------------------------------- */
/* Capability inference                                                       */
/* -------------------------------------------------------------------------- */

/** Checks slug-based vision heuristics without unbounded regex backtracking. */
const matchesVisionSlug = (slug: string): boolean => {
    if (VISION_TOKEN_RE.test(slug)) return true;
    const lower = slug.toLowerCase();
    if (lower.includes("claude") && !lower.includes("haiku")) return true;
    return LLAMA_32_PREFIX_RE.test(lower) && lower.includes("vision");
};

/** Checks slug-based tool-use heuristics without lookahead backtracking. */
const matchesToolSlug = (slug: string): boolean => {
    if (TOOL_TOKEN_RE.test(slug)) return true;
    return QWEN_OR_DEEPSEEK_RE.test(slug) && !EMBED_SUBSTR_RE.test(slug);
};

/** Resolves the canonical BetterShape `ProviderId` for a catalog prefix. */
const resolveCatalogProviderId = (catalogPrefix: string): ProviderId => {
    const mapped = MODEL_PROVIDER_PREFIX_MAP[catalogPrefix];
    if (mapped) return mapped;
    return isKnownProviderId(catalogPrefix)
        ? (catalogPrefix as ProviderId)
        : "custom";
};

/** Checks whether `outputModalities` permits text generation. */
const permitsTextOutput = (outputModalities: string[]): boolean =>
    outputModalities.length === 0 || outputModalities.includes("text");

/** Infers vision support from input modalities, modality string, or slug. */
const inferVisionCapability = (
    inputModalities: string[],
    modalityStr: string,
    nativeSlug: string,
): boolean =>
    inputModalities.includes("image") ||
    IMAGE_VIDEO_MODALITY_RE.test(modalityStr) ||
    matchesVisionSlug(nativeSlug);

/** Checks whether modalities + parameters indicate an input-only embedding model. */
const isModalitiesEmbeddingOnly = (
    inputCount: number,
    outputCount: number,
    params: Set<string>,
): boolean => inputCount > 0 && outputCount === 0 && !params.has("max_tokens");

/** Infers whether a model is non-chat (embedding, audio, image-gen, moderation). */
const inferNonChatFlag = (
    hasTextOutput: boolean,
    nativeSlug: string,
    inputCount: number,
    outputCount: number,
    params: Set<string>,
): boolean => {
    if (!hasTextOutput || NON_CHAT_RE.test(nativeSlug)) return true;
    return isModalitiesEmbeddingOnly(inputCount, outputCount, params);
};

/** Checks whether `params` explicitly advertises function/tool calling. */
const hasExplicitToolParams = (params: Set<string>): boolean =>
    params.has("tools") || params.has("tool_choice");

/** Infers tool-calling support for a chat-capable model. */
const inferToolCapability = (
    params: Set<string>,
    isNonChat: boolean,
    nativeSlug: string,
): boolean => {
    if (hasExplicitToolParams(params)) return true;
    if (isNonChat) return false;
    if (matchesToolSlug(nativeSlug)) return true;
    return params.has("max_tokens") && CHAT_INSTRUCT_SLUG_RE.test(nativeSlug);
};

/** Infers reasoning/thinking support from supported parameters or slug. */
const inferReasoningCapability = (
    params: Set<string>,
    nativeSlug: string,
): boolean =>
    params.has("reasoning") ||
    params.has("include_reasoning") ||
    REASONING_RE.test(nativeSlug);

/** Infers structured JSON output support from supported parameters or slug. */
const inferStructuredCapability = (
    params: Set<string>,
    nativeSlug: string,
): boolean =>
    params.has("structured_outputs") ||
    params.has("response_format") ||
    STRUCTURED_RE.test(nativeSlug);

/** Computes normalized prompt, completion, and cache-read prices for `pricing`. */
const extractNormalizedPricing = (pricing: CatalogModel["pricing"]) => {
    const inputCostPerM = pricePerMillion(pricing?.prompt);
    const outputCostPerM = pricePerMillion(pricing?.completion);
    const cacheRead = pricePerMillion(pricing?.input_cache_read);
    return {
        inputCostPerM,
        outputCostPerM,
        cacheReadCostPerM: cacheRead ?? inputCostPerM,
    };
};

/** Extracts normalized architecture arrays and modality string for `model`. */
const extractArchitectureFields = (architecture: CatalogModel["architecture"]) => ({
    inputModalities: architecture?.input_modalities ?? [],
    outputModalities: architecture?.output_modalities ?? [],
    modality: architecture?.modality ?? "",
});

/** Resolves `(context, maxOutputTokens)` from `model`. */
const extractContextLimits = (model: CatalogModel) => ({
    context: model.top_provider?.context_length ?? model.context_length ?? 0,
    maxOutputTokens: parseNum(model.top_provider?.max_completion_tokens ?? null),
});

/** Resolves canonical `providerId/nativeSlug` identifier for a catalog model. */
const formatCanonicalCatalogId = (
    id: string,
    providerId: ProviderId,
    catalogPrefix: string,
    nativeSlug: string,
): string => (providerId === catalogPrefix ? id : `${providerId}/${nativeSlug}`);

/** Converts a raw `CatalogModel` entry into normalized `ModelMetadata`. */
const inferModelMeta = (model: CatalogModel): ModelMetadata => {
    const id = model.id.trim();
    const { catalogPrefix, nativeSlug } = splitCatalogId(id);
    const providerId = resolveCatalogProviderId(catalogPrefix);
    const arch = extractArchitectureFields(model.architecture);
    const params = new Set(model.supported_parameters ?? []);
    const isNonChat = inferNonChatFlag(
        permitsTextOutput(arch.outputModalities),
        nativeSlug,
        arch.inputModalities.length,
        arch.outputModalities.length,
        params,
    );
    const limits = extractContextLimits(model);

    return {
        id: formatCanonicalCatalogId(id, providerId, catalogPrefix, nativeSlug),
        name: normalizeName(model.name, nativeSlug || id),
        providerId,
        slug: nativeSlug,
        providerLabel: providerLabelFor(providerId),
        contextWindow: limits.context,
        contextWindowLabel: formatContextWindow(limits.context),
        maxOutputTokens: limits.maxOutputTokens,
        ...extractNormalizedPricing(model.pricing),
        vision: inferVisionCapability(arch.inputModalities, arch.modality, nativeSlug),
        reasoning: inferReasoningCapability(params, nativeSlug),
        toolUse: inferToolCapability(params, isNonChat, nativeSlug),
        structuredOutput: inferStructuredCapability(params, nativeSlug),
        nonChat: isNonChat,
        deprecated: Boolean(model.expiration_date),
        source: "catalog",
    };
};

/* -------------------------------------------------------------------------- */
/* Sorting & index build                                                      */
/* -------------------------------------------------------------------------- */

/** Computes sort-bucket priority (`0` = active chat flagship .. `7` = deprecated non-chat). */
const computeSortBucketRank = (meta: ModelMetadata): number =>
    (meta.deprecated ? 4 : 0) +
    (meta.nonChat ? 2 : 0) +
    (FLAGSHIP_RE.test(meta.id) ? 0 : 1);

/** Orders chat flagships first, deprecated/non-chat last, then by context window and name. */
const compareModelMetadata = (
    left: ModelMetadata,
    right: ModelMetadata,
): number => {
    const bucketDiff = computeSortBucketRank(left) - computeSortBucketRank(right);
    if (bucketDiff !== 0) return bucketDiff;
    return (
        right.contextWindow - left.contextWindow ||
        left.name.localeCompare(right.name)
    );
};

/** Inserts one catalog entry into `byId` and `byProvider` if unseen. */
const indexSingleCatalogEntry = (
    entry: CatalogModel,
    seenIds: Set<string>,
    byId: Map<string, ModelMetadata>,
    byProvider: Map<ProviderId, ModelMetadata[]>,
): boolean => {
    if (!entry?.id) return false;
    const meta = inferModelMeta(entry);
    if (seenIds.has(meta.id)) return false;
    seenIds.add(meta.id);
    byId.set(meta.id, meta);
    byId.set(entry.id, meta);
    byId.set(`${meta.providerId}/${meta.slug}`, meta);
    const pid = meta.providerId as ProviderId;
    const arr = byProvider.get(pid) ?? [];
    arr.push(meta);
    byProvider.set(pid, arr);
    return true;
};

/** Builds lookup maps from raw catalog entries capped at `MAX_CATALOG_MODELS`. */
const buildIndex = (
    entries: CatalogModel[],
): {
    byId: Map<string, ModelMetadata>;
    byProvider: Map<ProviderId, ModelMetadata[]>;
} => {
    const byId = new Map<string, ModelMetadata>();
    const byProvider = new Map<ProviderId, ModelMetadata[]>();
    const seenIds = new Set<string>();
    let count = 0;
    for (const entry of entries) {
        if (count >= MAX_CATALOG_MODELS) break;
        if (indexSingleCatalogEntry(entry, seenIds, byId, byProvider)) {
            count += 1;
        }
    }
    for (const arr of byProvider.values()) {
        arr.sort(compareModelMetadata);
    }
    return { byId, byProvider };
};

/** Populates module-level index caches from `source` and returns the warm index. */
const populateIndexCache = (
    source: CatalogModel[],
    fetchedAt: number,
): IndexedCatalog => {
    const { byId, byProvider } = buildIndex(source);
    cachedIndex = byId;
    cachedById = byProvider;
    cachedSource = source;
    cachedFetchedAt = fetchedAt;
    return { byId, byProvider, fetchedAt };
};

/** Synchronous accessor falling back to `localStorage` or bundled snapshot. */
const ensureIndexSync = (): IndexedCatalog => {
    if (cachedIndex && cachedById) {
        return {
            byId: cachedIndex,
            byProvider: cachedById,
            fetchedAt: cachedFetchedAt,
        };
    }
    const stored = loadCachedFromStorage();
    return stored
        ? populateIndexCache(stored.data, stored.fetchedAt)
        : populateIndexCache(readSnapshotSync(), 0);
};

/* -------------------------------------------------------------------------- */
/* Metadata lookup & enrichment helpers                                       */
/* -------------------------------------------------------------------------- */

/** Builds an empty fallback `ModelMetadata` record when `id` is blank. */
const createEmptyMetadata = (): ModelMetadata => ({
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
});

/** Looks up a bare slug using `providerHint` when `trimmed` has no `/`. */
const lookupHintedHit = (
    byId: Map<string, ModelMetadata>,
    trimmed: string,
    providerHint?: ProviderId,
): ModelMetadata | undefined =>
    providerHint && !trimmed.includes("/")
        ? byId.get(`${providerHint}/${trimmed}`)
        : undefined;

/** Resolves direct, provider-hinted, or alias-remapped catalog hits. */
const lookupDirectOrMappedHit = (
    byId: Map<string, ModelMetadata>,
    trimmed: string,
    catalogPrefix: string,
    nativeSlug: string,
    providerHint?: ProviderId,
): ModelMetadata | undefined => {
    const direct = byId.get(trimmed) ?? lookupHintedHit(byId, trimmed, providerHint);
    if (direct) return direct;
    const mapped = MODEL_PROVIDER_PREFIX_MAP[catalogPrefix];
    return mapped && mapped !== catalogPrefix
        ? byId.get(`${mapped}/${nativeSlug}`)
        : undefined;
};

/** Resolves the fallback `ProviderId` for an unknown model identifier. */
const resolveInferredProviderId = (
    trimmed: string,
    catalogPrefix: string,
    providerHint?: ProviderId,
): ProviderId => {
    const prefix = trimmed.includes("/") ? catalogPrefix : (providerHint ?? "custom");
    return (isKnownProviderId(prefix) ? prefix : "custom") as ProviderId;
};

/** Builds pure heuristic `ModelMetadata` when an id is absent from the catalog. */
const buildPureInferredMetadata = (
    trimmed: string,
    catalogPrefix: string,
    nativeSlug: string,
    providerHint?: ProviderId,
): ModelMetadata => {
    const resolvedId = resolveInferredProviderId(trimmed, catalogPrefix, providerHint);
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
        vision: matchesVisionSlug(lower),
        reasoning: REASONING_RE.test(lower),
        toolUse: matchesToolSlug(lower) && !nonChat,
        structuredOutput: STRUCTURED_RE.test(lower),
        nonChat,
        deprecated: false,
        source: "inferred",
    };
};

/** Strips a single leading `${providerId}/` prefix when present. */
const stripLeadingProviderId = (value: string, providerId: ProviderId): string =>
    value.startsWith(`${providerId}/`) ? value.slice(providerId.length + 1) : value;

/** Selects catalog-matched metadata over inferred metadata when enriching a model. */
const preferCatalogHit = (
    rawMeta: ModelMetadata,
    prefixedMeta: ModelMetadata,
): ModelMetadata =>
    prefixedMeta.source === "catalog" && rawMeta.source !== "catalog"
        ? prefixedMeta
        : rawMeta;

/* -------------------------------------------------------------------------- */
/* Pricing & network refresh helpers                                          */
/* -------------------------------------------------------------------------- */

/** Formats sub-cent prices (`< $0.01`) without regex backtracking on trailing zeros. */
const formatSubcentPrice = (price: number): string => {
    const fixed = price.toFixed(4);
    let end = fixed.length;
    while (end > 0 && fixed[end - 1] === "0") end -= 1;
    if (end > 0 && fixed[end - 1] === ".") end -= 1;
    return `$${fixed.slice(0, end)}`;
};

/** Formats one prompt or completion price value in USD per million tokens. */
const formatPriceToken = (price: number): string => {
    if (price === 0) return "$0";
    return price < 0.01 ? formatSubcentPrice(price) : `$${price.toFixed(2)}`;
};

/** Flattens all provider model arrays into a single list. */
const flattenProviderMap = (
    byProvider: Map<ProviderId, ModelMetadata[]>,
): ModelMetadata[] => {
    const all: ModelMetadata[] = [];
    for (const arr of byProvider.values()) {
        all.push(...arr);
    }
    return all;
};

/** Checks whether the in-memory catalog was fetched from network within `REFRESH_TTL_MS`. */
const hasFreshInMemoryCatalog = (force: boolean): boolean =>
    Boolean(
        !force &&
            cachedSource &&
            cachedById &&
            cachedFetchedAt &&
            Date.now() - cachedFetchedAt < REFRESH_TTL_MS,
    );

/** Requests and validates the public catalog envelope from the Tauri backend. */
const fetchCatalogEntries = async (): Promise<CatalogModel[] | null> => {
    try {
        const json = (await commands.aiFetchModelCatalog()) as CatalogEnvelope | null;
        return Array.isArray(json?.data) && json.data.length > 200
            ? json.data
            : null;
    } catch {
        return null;
    }
};

/** Refreshes `localStorage` from the Tauri catalog command when a valid payload arrives. */
const refreshStorageFromBackend = async (): Promise<boolean> => {
    const entries = await fetchCatalogEntries();
    if (!entries) return false;
    saveToStorage(entries);
    return true;
};

/** Clears the in-memory index pointers so the next read rebuilds from storage/snapshot. */
const invalidateInMemoryCatalog = (): void => {
    cachedIndex = null;
    cachedById = null;
    cachedSource = null;
};

/** Detects the self-contained mocked Browser Preview runtime (`tauri-mock.ts`). */
const isBrowserPreviewRuntime = (): boolean =>
    process.env.NEXT_PUBLIC_BROWSER_PREVIEW === "1" ||
    (typeof window !== "undefined" && "__BETTERSHAPE_PREVIEW__" in window);

/** Checks whether `catalogPrefix/nativeSlug` wraps a nested `vendor/model` id. */
const hasNestedVendorSlug = (catalogPrefix: string, nativeSlug: string): boolean =>
    isKnownProviderId(catalogPrefix) && nativeSlug.includes("/");

/** Checks whether both input and output cost fields are `null`. */
const hasNoPricingFields = (meta: ModelMetadata): boolean =>
    meta.inputCostPerM === null && meta.outputCostPerM === null;

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Register human labels (and the valid id set) for providers. Safe to call
 * multiple times; later calls overwrite.
 */
export const registerProviderLabels = (labels: Record<string, string>): void => {
    providerLabelMap = { ...labels };
    knownProviderIds = new Set(Object.keys(labels));
};

/**
 * Metadata for a `provider/model` id (or native slug when provider is known).
 *
 * Falls back to heuristic inference when the id is not in the catalog so the
 * UI always has something useful to show, marked with `source: "inferred"`.
 */
export const getModelMetadata = (
    id: string,
    providerHint?: ProviderId,
): ModelMetadata => {
    const { byId } = ensureIndexSync();
    const trimmed = id.trim();
    if (!trimmed) return createEmptyMetadata();

    const { catalogPrefix, nativeSlug } = splitCatalogId(trimmed);
    const hit = lookupDirectOrMappedHit(
        byId,
        trimmed,
        catalogPrefix,
        nativeSlug,
        providerHint,
    );
    if (hit) return hit;

    if (hasNestedVendorSlug(catalogPrefix, nativeSlug)) {
        const inner = getModelMetadata(nativeSlug, providerHint);
        if (inner.source === "catalog") return inner;
    }

    return buildPureInferredMetadata(
        trimmed,
        catalogPrefix,
        nativeSlug,
        providerHint,
    );
};

/** Every catalog model for one provider, chat-capable first. */
export const listCatalogModels = (providerId?: ProviderId): ModelMetadata[] => {
    const { byProvider } = ensureIndexSync();
    if (!providerId) return flattenProviderMap(byProvider);
    return byProvider.get(providerId) ?? [];
};

/**
 * Turn a list of raw model ids (as the provider reported them) into fully
 * enriched {@link ModelMetadata}, pinned to the given BetterShape provider.
 * Result is sorted with chat-capable models first, flagships before niche,
 * deprecated models at the tail.
 */
export const enrichDiscoveredModels = (
    providerId: ProviderId,
    discoveredIds: string[],
): ModelMetadata[] => {
    const out: ModelMetadata[] = [];
    const seen = new Set<string>();
    for (const raw of discoveredIds) {
        const full = raw.trim();
        if (!full) continue;
        const normalizedSlug = stripLeadingProviderId(
            stripLeadingProviderId(full, providerId),
            providerId,
        );
        const id = `${providerId}/${normalizedSlug}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const meta = preferCatalogHit(
            getModelMetadata(full, providerId),
            getModelMetadata(id, providerId),
        );
        out.push({
            ...meta,
            providerId,
            id,
            slug: normalizedSlug,
            providerLabel: providerLabelFor(providerId),
            source: meta.source === "catalog" ? "catalog" : "discovered",
        });
    }
    out.sort(compareModelMetadata);
    return out;
};

/** Formats combined `(input, output)` million-token prices once non-null is verified. */
const formatPricePair = (inputPrice: number, outputPrice: number): string =>
    inputPrice === 0 && outputPrice === 0
        ? "Free"
        : `${formatPriceToken(inputPrice)} / ${formatPriceToken(outputPrice)}`;

/** Format a price-per-million as `"$3.00 / $15.00"` (or `"Free"`, or empty). */
export const formatModelPricing = (meta: ModelMetadata): string => {
    if (hasNoPricingFields(meta)) return "";
    return formatPricePair(meta.inputCostPerM ?? 0, meta.outputCostPerM ?? 0);
};

/**
 * Pull the latest catalog from the network and warm the index.
 *
 * Safe to call repeatedly; concurrent calls are de-duplicated. Resolves to
 * the in-memory index (which may be snapshot-only if all network attempts
 * fail) - never rejects.
 */
export const refreshModelCatalog = (
    force = false,
): Promise<RefreshResult> => {
    if (hasFreshInMemoryCatalog(force) && cachedById) {
        return Promise.resolve({
            models: flattenProviderMap(cachedById),
            fetchedAt: cachedFetchedAt,
            fromNetwork: false,
        });
    }
    if (refreshPromise) return refreshPromise;
    /** Executes the de-duplicated backend catalog request and rebuilds the index. */
    const runRefresh = async (): Promise<RefreshResult> => {
        let fromNetwork = false;
        try {
            fromNetwork = await refreshStorageFromBackend();
        } finally {
            refreshPromise = null;
        }
        invalidateInMemoryCatalog();
        const { byProvider, fetchedAt } = ensureIndexSync();
        return {
            models: flattenProviderMap(byProvider),
            fetchedAt,
            fromNetwork,
        };
    };
    refreshPromise = runRefresh();
    return refreshPromise;
};

/**
 * Kick off a background refresh once per page load.
 *
 * Uses the snapshot/cache synchronously on first render, then upgrades to
 * fresh network data once available. Skips unmocked background network calls
 * inside the self-contained Browser Preview environment (`tauri-mock.ts`).
 */
export const primeModelCatalog = (): void => {
    if (typeof window === "undefined") return;
    ensureIndexSync();
    if (isBrowserPreviewRuntime()) return;
    /** Triggers a background catalog refresh without unhandled rejections. */
    const schedule = (): void => {
        refreshModelCatalog().catch(() => undefined);
    };
    const idleWindow = window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    };
    if (typeof idleWindow.requestIdleCallback === "function") {
        idleWindow.requestIdleCallback(schedule, { timeout: 10_000 });
        return;
    }
    window.setTimeout(schedule, 3000);
};

/** Timestamp (ms) the in-memory index was fetched at, or `0` if it's the snapshot. */
export const catalogFetchedAt = (): number => cachedFetchedAt;

/** Number of catalog entries currently loaded. */
export const catalogSize = (): number => ensureIndexSync().byId.size;
