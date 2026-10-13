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

export function embeddingModelOptions(settings: ProvidersSettings): string[] {
  const openAiWire = settings.connections.openai;
  const openRouter = settings.connections.openrouter;
  const presets: string[] = [];
  if (isConnectionUsable("openai", settings.connections)) {
    presets.push("text-embedding-3-small", "text-embedding-3-large");
  }
  if (isConnectionUsable("openrouter", settings.connections)) {
    presets.push("openai/text-embedding-3-small", "openai/text-embedding-3-large");
  }
  if (isConnectionUsable("custom", settings.connections)) {
    presets.push(settings.embeddingModel || "");
  }
  const chosen = settings.embeddingModel.trim();
  if (chosen && !presets.includes(chosen)) presets.unshift(chosen);
  void openAiWire;
  void openRouter;
  return presets.filter(Boolean);
}

/** True when semantic embeddings can run (needs an OpenAI-wire key). */
export function embeddingsAvailable(settings: ProvidersSettings): boolean {
  return (
    isConnectionUsable("openai", settings.connections) ||
    isConnectionUsable("openrouter", settings.connections) ||
    (isConnectionUsable("custom", settings.connections) && Boolean(settings.connections.custom.baseUrl.trim()))
  );
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
  const embeddingsUsable = embeddingsAvailable(settings);
  const embeddingModel =
    settings.embeddingModel.trim() ||
    (isConnectionUsable("openrouter", settings.connections)
      ? "openai/text-embedding-3-small"
      : "text-embedding-3-small");

  return {
    providers,
    defaultModel,
    embeddingModel: embeddingsUsable ? embeddingModel : "",
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
