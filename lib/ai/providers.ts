/**
 * BYOK provider registry.
 *
 * BetterShape talks to the user's own model accounts. Everything here is local:
 * presets for the supported wires (OpenAI, Anthropic, Google) and the
 * OpenAI-compatible services people commonly bring (OpenRouter, xAI,
 * DeepSeek, Groq, Mistral, local runtimes, or a fully custom base URL).
 *
 * Model ids are `provider/model` — the prefix selects the connection and the
 * remainder is the native slug the provider expects. Nested ids are fine:
 * `openrouter/anthropic/claude-sonnet-4.5` routes through an OpenRouter key.
 */

export type ProviderKind = "openai" | "anthropic" | "google";

export type ProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "openrouter"
  | "xai"
  | "deepseek"
  | "groq"
  | "mistral"
  | "custom";

export type ProviderPreset = {
  id: ProviderId;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  /** Empty base URLs are user supplied (local runtimes, self-hosted gateways). */
  needsBaseUrl: boolean;
  keyHint: string;
  docsUrl: string;
  /**
   * True when this provider serves an OpenAI-compatible `/embeddings` endpoint
   * and the app therefore knows a default embedding model id for it. Providers
   * without it (Groq, xAI, DeepSeek) can still embed if the user types a model
   * id by hand — the indexer only guesses a default for the ones listed here.
   */
  embeddings?: boolean;
  /** Embedding model ids to offer for this provider. */
  embeddingModels?: string[];
  models: { id: string; name: string; contextWindow: string; vision?: boolean }[];
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    needsBaseUrl: false,
    keyHint: "sk-…",
    docsUrl: "https://platform.openai.com/api-keys",
    embeddings: true,
    embeddingModels: ["text-embedding-3-small", "text-embedding-3-large"],
    models: [
      { id: "openai/gpt-5", name: "GPT-5", contextWindow: "400K", vision: true },
      { id: "openai/gpt-5-mini", name: "GPT-5 mini", contextWindow: "400K", vision: true },
      { id: "openai/gpt-5-nano", name: "GPT-5 nano", contextWindow: "400K" },
      { id: "openai/gpt-4.1", name: "GPT-4.1", contextWindow: "1M", vision: true },
      { id: "openai/gpt-4.1-mini", name: "GPT-4.1 mini", contextWindow: "1M", vision: true },
      { id: "openai/o4-mini", name: "o4-mini", contextWindow: "200K" },
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com",
    needsBaseUrl: false,
    keyHint: "sk-ant-…",
    docsUrl: "https://console.anthropic.com/settings/keys",
    models: [
      { id: "anthropic/claude-sonnet-4-5", name: "Claude Sonnet 4.5", contextWindow: "200K", vision: true },
      { id: "anthropic/claude-opus-4-1", name: "Claude Opus 4.1", contextWindow: "200K", vision: true },
      { id: "anthropic/claude-haiku-4-5", name: "Claude Haiku 4.5", contextWindow: "200K", vision: true },
      { id: "anthropic/claude-3-7-sonnet", name: "Claude 3.7 Sonnet", contextWindow: "200K", vision: true },
    ],
  },
  {
    id: "google",
    label: "Google AI",
    kind: "google",
    baseUrl: "https://generativelanguage.googleapis.com",
    needsBaseUrl: false,
    keyHint: "AIza…",
    docsUrl: "https://aistudio.google.com/apikey",
    models: [
      { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro", contextWindow: "1M", vision: true },
      { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", contextWindow: "1M", vision: true },
      { id: "google/gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite", contextWindow: "1M", vision: true },
      { id: "google/gemini-2.0-flash", name: "Gemini 2.0 Flash", contextWindow: "1M", vision: true },
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    needsBaseUrl: false,
    keyHint: "sk-or-…",
    docsUrl: "https://openrouter.ai/keys",
    embeddings: true,
    embeddingModels: ["openai/text-embedding-3-small", "openai/text-embedding-3-large"],
    models: [
      { id: "openrouter/anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5", contextWindow: "200K", vision: true },
      { id: "openrouter/openai/gpt-5", name: "GPT-5", contextWindow: "400K", vision: true },
      { id: "openrouter/google/gemini-2.5-pro", name: "Gemini 2.5 Pro", contextWindow: "1M", vision: true },
      { id: "openrouter/deepseek/deepseek-chat", name: "DeepSeek V3", contextWindow: "128K" },
      { id: "openrouter/x-ai/grok-4", name: "Grok 4", contextWindow: "256K", vision: true },
      { id: "openrouter/qwen/qwen3-coder", name: "Qwen3 Coder", contextWindow: "262K" },
      {
        id: "openrouter/meta-llama/llama-3.3-70b-instruct",
        name: "Llama 3.3 70B",
        contextWindow: "128K",
      },
    ],
  },
  {
    id: "xai",
    label: "xAI",
    kind: "openai",
    baseUrl: "https://api.x.ai/v1",
    needsBaseUrl: false,
    keyHint: "xai-…",
    docsUrl: "https://console.x.ai",
    models: [
      { id: "xai/grok-4", name: "Grok 4", contextWindow: "256K", vision: true },
      { id: "xai/grok-3-mini", name: "Grok 3 mini", contextWindow: "131K" },
    ],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    kind: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    needsBaseUrl: false,
    keyHint: "sk-…",
    docsUrl: "https://platform.deepseek.com/api_keys",
    models: [
      { id: "deepseek/deepseek-chat", name: "DeepSeek V3", contextWindow: "128K" },
      { id: "deepseek/deepseek-reasoner", name: "DeepSeek R1", contextWindow: "128K" },
    ],
  },
  {
    id: "groq",
    label: "Groq",
    kind: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    needsBaseUrl: false,
    keyHint: "gsk_…",
    docsUrl: "https://console.groq.com/keys",
    models: [
      { id: "groq/llama-3.3-70b-versatile", name: "Llama 3.3 70B", contextWindow: "128K" },
      { id: "groq/deepseek-r1-distill-llama-70b", name: "DeepSeek R1 Distill 70B", contextWindow: "128K" },
    ],
  },
  {
    id: "mistral",
    label: "Mistral",
    kind: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    needsBaseUrl: false,
    keyHint: "…",
    docsUrl: "https://console.mistral.ai/api-keys",
    embeddings: true,
    embeddingModels: ["mistral-embed"],
    models: [
      { id: "mistral/mistral-large-latest", name: "Mistral Large", contextWindow: "128K" },
      { id: "mistral/codestral-latest", name: "Codestral", contextWindow: "256K" },
    ],
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    kind: "openai",
    baseUrl: "",
    needsBaseUrl: true,
    keyHint: "local runtimes often need no key",
    docsUrl: "",
    // Self-hosted runtimes decide their own embedding model, so the user picks
    // the id (Ollama's `nomic-embed-text`, vLLM's `BAAI/bge-m3`, …).
    embeddings: true,
    embeddingModels: [],
    models: [],
  },
];

export function providerPreset(id: ProviderId): ProviderPreset {
  return PROVIDER_PRESETS.find((p) => p.id === id) ?? PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1];
}

/** One user-configured connection. */
export type ProviderConnection = {
  apiKey: string;
  /** Empty means "use the preset default". */
  baseUrl: string;
  enabled: boolean;
  /** Model ids the user pinned for this provider (empty = every preset model). */
  models: string[];
  /** Free-form model ids for providers without a preset list (custom). */
  extraModels: string[];
};

export type AiServicesSettings = {
  search: { provider: "none" | "tavily" | "brave"; apiKey: string };
  composio: { apiKey: string; userId: string };
};

export type ProvidersSettings = {
  connections: Record<ProviderId, ProviderConnection>;
  defaultModel: string;
  embeddingModel: string;
  services: AiServicesSettings;
};

export const SEARCH_PROVIDERS = [
  { id: "none", label: "Off", keyHint: "", docsUrl: "" },
  { id: "tavily", label: "Tavily", keyHint: "tvly-…", docsUrl: "https://app.tavily.com/home" },
  { id: "brave", label: "Brave Search", keyHint: "BSA…", docsUrl: "https://api-dashboard.search.brave.com/app/keys" },
] as const;

function emptyConnection(): ProviderConnection {
  return { apiKey: "", baseUrl: "", enabled: true, models: [], extraModels: [] };
}

export function defaultProvidersSettings(): ProvidersSettings {
  const connections = {} as Record<ProviderId, ProviderConnection>;
  for (const preset of PROVIDER_PRESETS) connections[preset.id] = emptyConnection();
  return {
    connections,
    defaultModel: "auto",
    embeddingModel: "",
    services: {
      search: { provider: "none", apiKey: "" },
      composio: { apiKey: "", userId: "" },
    },
  };
}

/** Fill in connections added by newer versions without losing user values. */
export function normalizeProvidersSettings(
  raw: Partial<ProvidersSettings> | undefined,
): ProvidersSettings {
  const base = defaultProvidersSettings();
  if (!raw) return base;
  const connections = {} as Record<ProviderId, ProviderConnection>;
  for (const preset of PROVIDER_PRESETS) {
    const saved = raw.connections?.[preset.id];
    connections[preset.id] = {
      ...emptyConnection(),
      ...(saved ?? {}),
      models: Array.isArray(saved?.models) ? saved!.models.filter(Boolean) : [],
      extraModels: Array.isArray(saved?.extraModels) ? saved!.extraModels.filter(Boolean) : [],
    };
  }
  return {
    connections,
    defaultModel: raw.defaultModel ?? base.defaultModel,
    embeddingModel: raw.embeddingModel ?? "",
    services: {
      search: {
        provider: raw.services?.search?.provider ?? "none",
        apiKey: raw.services?.search?.apiKey ?? "",
      },
      composio: {
        apiKey: raw.services?.composio?.apiKey ?? "",
        userId: raw.services?.composio?.userId ?? "",
      },
    },
  };
}

/** True when this connection can be routed right now. */
export function isConnectionUsable(id: ProviderId, connections: Record<ProviderId, ProviderConnection>): boolean {
  const connection = connections[id];
  if (!connection?.enabled) return false;
  const preset = providerPreset(id);
  if (preset.needsBaseUrl && !connection.baseUrl.trim()) return false;
  // Local runtimes accept requests without a key.
  if (!connection.apiKey.trim()) return providerPreset(id).id === "custom";
  return true;
}

export function hasAnyUsableProvider(settings: ProvidersSettings): boolean {
  return PROVIDER_PRESETS.some((preset) => isConnectionUsable(preset.id, settings.connections));
}

/** Model ids offered by a connection: preset list plus anything the user added. */
export function modelIdsFor(id: ProviderId, connections: Record<ProviderId, ProviderConnection>): string[] {
  const connection = connections[id];
  const preset = providerPreset(id);
  const pinned = connection.models.length > 0 ? connection.models : preset.models.map((m) => m.id);
  const extra = connection.extraModels.map((raw) => (raw.includes("/") ? raw : `${id}/${raw}`));
  return [...new Set([...pinned, ...extra])];
}

export type ModelOption = {
  id: string;
  name: string;
  provider: string;
  providerId: ProviderId;
  contextWindow: string;
  vision: boolean;
};

export function modelOption(id: string): ModelOption {
  const providerId = (id.split("/")[0] ?? "") as ProviderId;
  const preset = PROVIDER_PRESETS.find((p) => p.id === providerId);
  const known = preset?.models.find((m) => m.id === id);
  return {
    id,
    name: known?.name ?? (id.split("/").slice(1).join("/") || id),
    provider: preset?.label ?? "Custom",
    providerId: preset?.id ?? "custom",
    contextWindow: known?.contextWindow ?? "",
    vision: known?.vision ?? /vision|-vl|gemini|gpt-4o|gpt-4\.1|gpt-5|claude|grok/i.test(id),
  };
}

/** Every model the user can pick right now, grouped by provider order. */
export function availableModels(settings: ProvidersSettings): ModelOption[] {
  const out: ModelOption[] = [];
  for (const preset of PROVIDER_PRESETS) {
    if (!isConnectionUsable(preset.id, settings.connections)) continue;
    for (const id of modelIdsFor(preset.id, settings.connections)) {
      const option = modelOption(id);
      if (!option.name) continue;
      out.push(option);
    }
  }
  return out;
}

/** Providers that can embed, in the order the app prefers to route to them. */
export function embeddingProviders(settings: ProvidersSettings): ProviderId[] {
  return PROVIDER_PRESETS.filter(
    (preset) =>
      preset.embeddings === true && isConnectionUsable(preset.id, settings.connections),
  ).map((preset) => preset.id);
}

export function embeddingModelOptions(settings: ProvidersSettings): string[] {
  const presets: string[] = [];
  for (const id of embeddingProviders(settings)) {
    presets.push(...(providerPreset(id).embeddingModels ?? []));
  }
  const chosen = settings.embeddingModel.trim();
  if (chosen && !presets.includes(chosen)) presets.unshift(chosen);
  return [...new Set(presets.filter(Boolean))];
}

/**
 * Provider that will serve the semantic index, plus the model id to send.
 *
 * Mirrors the Rust side: OpenAI and OpenRouter have a known default, every other
 * provider needs the user to name a model — an empty result means the index
 * stays off rather than calling an endpoint that cannot answer.
 */
export function embeddingsTarget(settings: ProvidersSettings): { id: ProviderId; model: string } | null {
  const chosen = settings.embeddingModel.trim();
  const preferredOf = (ids: ProviderId[]): ProviderId | undefined =>
    ids.find((id) => id === "openai") ?? ids.find((id) => id === "openrouter") ?? ids[0];

  if (chosen) {
    // Any OpenAI-wire connection can embed when the user names the model.
    const wire = PROVIDER_PRESETS.filter(
      (preset) => preset.kind === "openai" && isConnectionUsable(preset.id, settings.connections),
    ).map((preset) => preset.id);
    const preferred = preferredOf(wire);
    return preferred ? { id: preferred, model: chosen } : null;
  }

  const known = embeddingProviders(settings);
  const preferred = preferredOf(known);
  if (!preferred) return null;
  const fallback = providerPreset(preferred).embeddingModels?.[0] ?? "";
  return fallback ? { id: preferred, model: fallback } : null;
}

/** True when the semantic index has somewhere to run. */
export function embeddingsAvailable(settings: ProvidersSettings): boolean {
  return embeddingsTarget(settings) !== null;
}

/** Payload for the Rust `set_ai_config` command. */
export type RustAiProviderEntry = {
  id: string;
  kind: ProviderKind;
  label: string;
  apiKey: string;
  baseUrl: string;
  models: string[];
  enabled: boolean;
};

export type RustAiConfig = {
  providers: RustAiProviderEntry[];
  defaultModel: string;
  embeddingModel: string;
  search: { provider: string; apiKey: string };
  composio: { apiKey: string; userId: string };
};

export function toRustAiConfig(settings: ProvidersSettings): RustAiConfig {
  const providers: RustAiProviderEntry[] = [];
  for (const preset of PROVIDER_PRESETS) {
    const connection = settings.connections[preset.id];
    if (!connection) continue;
    const usable = isConnectionUsable(preset.id, settings.connections);
    if (!usable) continue;
    providers.push({
      id: preset.id,
      kind: preset.kind,
      label: preset.label,
      apiKey: connection.apiKey.trim(),
      baseUrl: connection.baseUrl.trim() || preset.baseUrl,
      models: modelIdsFor(preset.id, settings.connections),
      enabled: connection.enabled,
    });
  }

  const defaultModel = resolveDefaultModel(settings, providers);
  // A provider that serves embeddings and a model id we can name — without both,
  // Rust skips the semantic index instead of calling an endpoint it cannot use.
  const embeddingTarget = embeddingsTarget(settings);

  return {
    providers,
    defaultModel,
    embeddingModel: embeddingTarget?.model ?? "",
    search: {
      provider: settings.services.search.provider,
      apiKey: settings.services.search.apiKey.trim(),
    },
    composio: {
      apiKey: settings.services.composio.apiKey.trim(),
      userId: settings.services.composio.userId.trim() || "bettershape-local",
    },
  };
}

/**
 * `auto` needs a concrete model. Prefer the user's pick, else the first pinned
 * model, else anything the first usable provider offers.
 */
function resolveDefaultModel(settings: ProvidersSettings, providers: RustAiProviderEntry[]): string {
  const wanted = settings.defaultModel.trim();
  const usableIds = new Set(providers.flatMap((p) => p.models));
  if (wanted && wanted !== "auto" && usableIds.has(wanted)) return wanted;
  const pinned = providers.find((p) => p.models.length > 0);
  return pinned?.models[0] ?? "";
}

/* -------------------------------------------------------------------------- */
/* Secret handling                                                            */
/* -------------------------------------------------------------------------- */

/** Pseudo-ids for the two non-model secrets, stored beside provider keys. */
export const SEARCH_SECRET_ID = "service:search";
export const COMPOSIO_SECRET_ID = "service:composio";

/** Every secret the provider settings currently hold, keyed by storage id. */
export function providerSecrets(settings: ProvidersSettings): Record<string, string> {
  const out: Record<string, string> = {};
  for (const preset of PROVIDER_PRESETS) {
    const key = settings.connections[preset.id]?.apiKey?.trim();
    if (key) out[preset.id] = key;
  }
  const search = settings.services.search.apiKey.trim();
  if (search) out[SEARCH_SECRET_ID] = search;
  const composio = settings.services.composio.apiKey.trim();
  if (composio) out[COMPOSIO_SECRET_ID] = composio;
  return out;
}

/**
 * A copy safe to write to disk: the OS keychain owns the secrets, so nothing
 * here contains a key. Non-secret fields are copied verbatim.
 */
export function redactProviderSecrets<T extends { ai: { providers: ProvidersSettings } }>(settings: T): T {
  const connections = {} as Record<ProviderId, ProviderConnection>;
  for (const preset of PROVIDER_PRESETS) {
    const connection = settings.ai.providers.connections[preset.id];
    connections[preset.id] = connection
      ? { ...connection, apiKey: "" }
      : { apiKey: "", baseUrl: "", enabled: true, models: [], extraModels: [] };
  }
  return {
    ...settings,
    ai: {
      ...settings.ai,
      providers: {
        ...settings.ai.providers,
        connections,
        services: {
          ...settings.ai.providers.services,
          search: { ...settings.ai.providers.services.search, apiKey: "" },
          composio: { ...settings.ai.providers.services.composio, apiKey: "" },
        },
      },
    },
  };
}

/**
 * Fill secrets that only exist in memory back into a freshly loaded copy.
 *
 * Storage never holds keys once the keychain is in use, so a plain merge would
 * wipe the session's keys the first time a settings payload arrived from disk or
 * from the other window. Existing values always win for non-secret fields.
 */
export function mergeProviderSecrets(live: ProvidersSettings, loaded: ProvidersSettings): ProvidersSettings {
  const connections = {} as Record<ProviderId, ProviderConnection>;
  for (const preset of PROVIDER_PRESETS) {
    const current = live.connections[preset.id];
    const incoming = loaded.connections[preset.id] ?? emptyConnection();
    connections[preset.id] = {
      ...incoming,
      apiKey: incoming.apiKey.trim() ? incoming.apiKey : (current?.apiKey ?? ""),
    };
  }
  return {
    ...loaded,
    connections,
    services: {
      search: {
        ...loaded.services.search,
        apiKey: loaded.services.search.apiKey.trim()
          ? loaded.services.search.apiKey
          : live.services.search.apiKey,
      },
      composio: {
        ...loaded.services.composio,
        apiKey: loaded.services.composio.apiKey.trim()
          ? loaded.services.composio.apiKey
          : live.services.composio.apiKey,
      },
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Key sanity checks                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Prefixes that identify a provider's keys. Only formats we are confident about
 * are listed: `sk-` alone is shared by OpenAI, DeepSeek and gateways, so a plain
 * `sk-…` value never triggers advice.
 */
const KEY_PREFIXES: { id: ProviderId; prefix: string }[] = [
  { id: "anthropic", prefix: "sk-ant-" },
  { id: "openrouter", prefix: "sk-or-" },
  { id: "groq", prefix: "gsk_" },
  { id: "xai", prefix: "xai-" },
  { id: "google", prefix: "AIza" },
];

/** Which provider a pasted key *looks* like it belongs to. Advisory only. */
export function keyOwnerHint(apiKey: string): { id: ProviderId; label: string } | null {
  const key = apiKey.trim();
  if (key.length < 12) return null;
  for (const { id, prefix } of KEY_PREFIXES) {
    if (key.startsWith(prefix)) return { id, label: providerPreset(id).label };
  }
  return null;
}

/**
 * One-line warning for the field the user is typing in, or null when the key
 * looks plausible. Never blocks a save: gateways hand out their own formats, so
 * this only ever suggests.
 */
export function keyFormatWarning(id: ProviderId, apiKey: string): string | null {
  const key = apiKey.trim();
  if (!key) return null;
  const owner = keyOwnerHint(key);
  if (owner && owner.id !== id) {
    return `This looks like a ${owner.label} key — paste it into the ${owner.label} card instead.`;
  }
  const expected = KEY_PREFIXES.find((entry) => entry.id === id);
  if (expected && !key.startsWith(expected.prefix)) {
    return `${providerPreset(id).label} keys start with ${expected.prefix} — double-check the value.`;
  }
  return null;
}

/** Same idea for the web-search keys, whose formats are also fixed. */
export function searchKeyWarning(
  provider: (typeof SEARCH_PROVIDERS)[number]["id"],
  apiKey: string,
): string | null {
  const key = apiKey.trim();
  if (!key) return null;
  if (provider === "tavily" && !key.startsWith("tvly-")) {
    return "Tavily keys start with tvly-.";
  }
  if (provider === "brave" && !key.startsWith("BSA")) {
    return "Brave Search keys start with BSA.";
  }
  return null;
}

/** `sk-abc…1234` — enough to recognise a key without showing it in full. */
export function maskApiKey(apiKey: string): string {
  const key = apiKey.trim();
  if (key.length <= 10) return key ? `${key.slice(0, 2)}…` : "";
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

/* -------------------------------------------------------------------------- */
/* Model discovery                                                            */
/* -------------------------------------------------------------------------- */

/** Turn discovered native slugs into the `provider/model` ids the app stores. */
export function modelsWithProviderPrefix(id: ProviderId, discovered: string[]): string[] {
  const out: string[] = [];
  for (const raw of discovered) {
    const slug = raw.trim();
    if (!slug) continue;
    out.push(slug.startsWith(`${id}/`) ? slug : `${id}/${slug}`);
  }
  return [...new Set(out)];
}

/** `provider/model` ids → the raw slugs `extraModels` expects. */
export function stripProviderPrefix(id: ProviderId, ids: string[]): string[] {
  return ids
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => (raw.startsWith(`${id}/`) ? raw.slice(id.length + 1) : raw))
    .filter((raw, index, all) => all.indexOf(raw) === index);
}
