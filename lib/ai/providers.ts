/**
 * BYOK provider registry.
 *
 * BetterShape talks to the user's own model accounts. Everything here is local:
 * presets for the supported wires (OpenAI, Anthropic, Google) and the
 * OpenAI-compatible services people commonly bring (OpenRouter, xAI,
 * DeepSeek, Groq, Mistral, local runtimes, or a fully custom base URL).
 *
 * Model ids are `provider/model`: the prefix selects the connection and the
 * remainder is the native slug the provider expects. Nested ids are fine:
 * `openrouter/anthropic/claude-sonnet-4.5` routes through an OpenRouter key.
 */

import publicDefaultHeaders from "./provider-default-headers.json";
import {
  enrichDiscoveredModels,
  getModelMetadata as catalogGetModelMetadata,
  registerProviderLabels,
} from "./model-catalog";
import type { ProviderId as ProviderIdType } from "./provider-ids";

export type ProviderId = ProviderIdType;

export type ProviderKind = "openai" | "anthropic" | "google";

/** Header the provider expects the API key in. */
export type AuthStyle =
  | "bearer"
  | "api-key"
  | "x-api-key"
  | "x-goog-api-key"
  | "none";

/** Capability flags for a model. */
export type ModelCapabilities = {
  /** The model accepts image inputs in addition to text. */
  vision: boolean;
  /** The model supports native tool/function calling. */
  toolUse: boolean;
  /** The model exposes a reasoning/thinking effort or budget. */
  reasoning: boolean;
};

export type ModelMeta = {
  id: string;
  name: string;
  /** Display-formatted context window (e.g. "128K", "1M"). */
  contextWindow: string;
  vision?: boolean;
  /** Supports tool/function calling. */
  toolUse?: boolean;
  /** Has a reasoning/thinking mode (OpenAI o-series, DeepSeek R1, Claude Opus…). */
  reasoning?: boolean;
  /** Raw token count for the context window, when known (0 = unknown). */
  contextTokens?: number;
  /** Maximum output tokens the model can produce in one turn, when known. */
  maxOutputTokens?: number;
  /** Input price in USD per 1M tokens, when known. */
  inputCostPerM?: number;
  /** Output price in USD per 1M tokens, when known. */
  outputCostPerM?: number;
  /** True for known embedding/audio/moderation models (filtered from chat pickers). */
  nonChat?: boolean;
};

export type ProviderPreset = {
  id: ProviderId;
  label: string;
  /** Short group heading in Settings -> Providers. */
  group: string;
  kind: ProviderKind;
  baseUrl: string;
  /** Empty base URLs are user supplied (local runtimes, self-hosted gateways). */
  needsBaseUrl: boolean;
  keyHint: string;
  docsUrl: string;
  /** One line under the wire name: what this provider needs, or what it includes. */
  note?: string;
  /** True when the endpoint answers without an API key. */
  keyless?: boolean;
  /** Start disabled. Defaults to `!keyless`. */
  defaultEnabled?: boolean;
  /** How the key travels. Defaults to `bearer` on the OpenAI wire. */
  authStyle?: AuthStyle;
  /** Headers the gateway expects on every request. */
  headers?: Record<string, string>;
  /** True when this provider serves an OpenAI-compatible `/embeddings` endpoint. */
  embeddings?: boolean;
  /** Embedding model ids to offer for this provider. */
  embeddingModels?: string[];
  models: ModelMeta[];
};

/** One id the provider itself listed, enriched with catalog metadata. */
export type DiscoveredModelEntry = {
  id: string;
  name?: string;
  contextWindow?: string;
  contextTokens?: number;
  maxOutputTokens?: number;
  inputCostPerM?: number;
  outputCostPerM?: number;
  vision?: boolean;
  reasoning?: boolean;
  toolUse?: boolean;
  nonChat?: boolean;
  /** "catalog" when models.dev had a match, "discovered" when only the raw id is known. */
  source?: "catalog" | "discovered" | "inferred";
  /** Unix ms of when the discovery ran. */
  discoveredAt?: number;
};

/** One user-configured connection. */
export type ProviderConnection = {
  /** Stored in the OS keychain, never in the settings file. */
  apiKey: string;
  /** Empty means "use the preset default". */
  baseUrl: string;
  enabled: boolean;
  /** Model ids the user pinned for this provider (empty = every preset model). */
  models: string[];
  /** Model ids the user has hidden from pickers. */
  hiddenModels: string[];
  /** Free-form model ids for providers without a preset list (custom). */
  extraModels: string[];
  /** Model ids the provider reported on the most recent Test/Refresh. */
  discoveredModels: DiscoveredModelEntry[];
  /** Extra request headers, on top of the preset's own. */
  headers: Record<string, string>;
  /** Override how the key travels. Empty means "use the preset default". */
  authStyle: AuthStyle | "";
};

/** How Auto picks a model for a new chat. */
export type ChatMode = "auto" | "ask" | (string & {});

/** Named slots that each route to their own model. */
export type FeatureModel = "chat" | "agent" | "commits" | "embeddings";

/** One feature-to-model override. Empty id means "use the chat default". */
export type FeatureModelAssignment = {
  feature: FeatureModel;
  /** Provider/model id. Empty string inherits from chat default. */
  modelId: string;
};

export type AiServicesSettings = {
  search: { provider: "none" | "tavily" | "brave"; apiKey: string };
  composio: { apiKey: string; userId: string };
};

export type ProvidersSettings = {
  connections: Record<ProviderId, ProviderConnection>;
  /** How new chats pick their starting model. */
  chatMode: ChatMode;
  /** Per-feature model overrides. */
  featureModels: FeatureModelAssignment[];
  services: AiServicesSettings;
};

export type ModelOption = {
  id: string;
  name: string;
  provider: string;
  providerId: ProviderId;
  contextWindow: string;
  capabilities: ModelCapabilities;
};

/** Payload for the Rust `set_ai_config` command. */
export type RustAiProviderEntry = {
  id: string;
  kind: ProviderKind;
  label: string;
  apiKey: string;
  baseUrl: string;
  models: string[];
  enabled: boolean;
  /** Endpoint answers without a key (local runtimes, free tiers). */
  keyless: boolean;
  /** Extra headers, preset defaults already merged in. */
  headers: Record<string, string>;
  /** `bearer` | `api-key` | `x-api-key` | `none`. */
  authStyle: AuthStyle;
};

export type RustAiConfig = {
  providers: RustAiProviderEntry[];
  defaultModel: string;
  embeddingModel: string;
  /** Provider that serves `embeddingModel`; Rust routes to it, not to a guess. */
  embeddingProvider: string;
  search: { provider: string; apiKey: string };
  composio: { apiKey: string; userId: string };
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  /* -------------------------------------------------------------------- */
  /* Native wires                                                          */
  /* -------------------------------------------------------------------- */
  {
    id: "openai",
    label: "OpenAI",
    group: "Native APIs",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    needsBaseUrl: false,
    keyHint: "sk-…",
    docsUrl: "https://platform.openai.com/api-keys",
    embeddings: true,
    embeddingModels: ["text-embedding-3-small", "text-embedding-3-large"],
    models: [
      { id: "openai/gpt-5", name: "GPT-5", contextWindow: "400K", vision: true, toolUse: true },
      { id: "openai/gpt-5-mini", name: "GPT-5 mini", contextWindow: "400K", vision: true, toolUse: true },
      { id: "openai/gpt-5-nano", name: "GPT-5 nano", contextWindow: "400K", toolUse: true },
      { id: "openai/gpt-4.1", name: "GPT-4.1", contextWindow: "1M", vision: true, toolUse: true },
      { id: "openai/gpt-4.1-mini", name: "GPT-4.1 mini", contextWindow: "1M", vision: true, toolUse: true },
      { id: "openai/o4-mini", name: "o4-mini", contextWindow: "200K", reasoning: true, toolUse: true },
      { id: "openai/o3", name: "o3", contextWindow: "200K", reasoning: true, toolUse: true },
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    group: "Native APIs",
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
    group: "Native APIs",
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
    id: "azure",
    label: "Azure OpenAI",
    group: "Native APIs",
    kind: "openai",
    // Azure's v1 API is OpenAI-compatible and takes the key in `api-key`.
    baseUrl: "https://YOUR-RESOURCE.openai.azure.com/openai/v1",
    needsBaseUrl: true,
    keyHint: "Azure resource key",
    docsUrl: "https://learn.microsoft.com/azure/ai-services/openai/",
    authStyle: "api-key",
    models: [
      { id: "azure/gpt-5", name: "GPT-5 (deployment)", contextWindow: "400K", vision: true },
      { id: "azure/gpt-4.1", name: "GPT-4.1 (deployment)", contextWindow: "1M", vision: true },
    ],
  },

  /* -------------------------------------------------------------------- */
  /* Gateways and hosted routers                                           */
  /* -------------------------------------------------------------------- */
  {
    id: "openrouter",
    label: "OpenRouter",
    group: "Gateways",
    kind: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    needsBaseUrl: false,
    keyHint: "sk-or-…",
    docsUrl: "https://openrouter.ai/keys",
    // Attribution headers OpenRouter uses for app rankings. Optional to them,
    // present in every official client, and harmless if the account ignores it.
    headers: publicDefaultHeaders.openrouter,
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
    id: "zen",
    label: "OpenCode Zen",
    group: "Gateways",
    kind: "openai",
    baseUrl: "https://opencode.ai/inference/v1",
    needsBaseUrl: false,
    keyHint: "oc_sk_… from opencode.ai/console",
    docsUrl: "https://opencode.ai/v2/docs/console/models/",
    note: "Free ids come with a Console account key and rotate — Test connection imports the live list.",
    // Free models are free for OpenCode accounts but the gateway only serves
    // them to attributable traffic, so this needs the user's own Console key.
    defaultEnabled: false,
    models: [
      // Free with an OpenCode account, while the free list lasts.
      { id: "zen/ling-3.1-flash-free", name: "Ling 3.1 Flash · free", contextWindow: "128K" },
      { id: "zen/ling-3.0-flash-fin-free", name: "Ling 3.0 Flash Fin · free", contextWindow: "128K" },
      { id: "zen/nemotron-3.5-lightning-free", name: "Nemotron 3.5 Lightning · free", contextWindow: "128K" },
      { id: "zen/nemotron-3-ultra-free", name: "Nemotron 3 Ultra · free", contextWindow: "128K" },
      { id: "zen/mimo-v2.6-flash-free", name: "MiMo V2.6 Flash · free", contextWindow: "128K" },
      { id: "zen/mimo-v2.5-free", name: "MiMo V2.5 · free", contextWindow: "128K" },
      { id: "zen/exo-free", name: "Exo · free", contextWindow: "128K" },
      { id: "zen/space-bunny-free", name: "Space Bunny · free", contextWindow: "256K" },
      { id: "zen/cat-jam-free", name: "Cat Jam · free", contextWindow: "256K" },
      { id: "zen/longcat-2.5-preview-free", name: "LongCat 2.5 Preview · free", contextWindow: "256K" },
      { id: "zen/step-5-preview-free", name: "Step 5 Preview · free", contextWindow: "256K" },
      { id: "zen/big-pickle", name: "Big Pickle · free", contextWindow: "256K" },
      // Pay-as-you-go models, charged against Console credits.
      { id: "zen/deepseek-v4-flash", name: "DeepSeek V4 Flash", contextWindow: "128K" },
      { id: "zen/deepseek-v4-pro", name: "DeepSeek V4 Pro", contextWindow: "128K" },
      { id: "zen/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", contextWindow: "128K" },
      { id: "zen/glm-5.3-flash", name: "GLM 5.3 Flash", contextWindow: "200K" },
      { id: "zen/glm-5.2", name: "GLM 5.2", contextWindow: "200K" },
      { id: "zen/kimi-k2.6", name: "Kimi K2.6", contextWindow: "256K" },
      { id: "zen/kimi-k2.7-code", name: "Kimi K2.7 Code", contextWindow: "256K" },
      { id: "zen/minimax-m2.7", name: "MiniMax M2.7", contextWindow: "200K" },
      { id: "zen/minimax-m3", name: "MiniMax M3", contextWindow: "200K" },
      { id: "zen/mistral-large-4", name: "Mistral Large 4", contextWindow: "256K" },
      { id: "zen/qwen3.8-max", name: "Qwen3.8 Max", contextWindow: "256K" },
    ],
  },
  {
    id: "zen-messages",
    label: "OpenCode Zen (Claude & Qwen)",
    group: "Gateways",
    kind: "anthropic",
    // The Messages wire appends `/v1/messages`, so this base stops before `/v1`.
    baseUrl: "https://opencode.ai/inference",
    needsBaseUrl: false,
    keyHint: "oc_sk_… from opencode.ai/console",
    docsUrl: "https://opencode.ai/v2/docs/console/models/",
    note: "Claude and Qwen over the Messages wire, with the same Console key.",
    defaultEnabled: false,
    models: [
      { id: "zen-messages/claude-opus-5-5", name: "Claude Opus 5.5", contextWindow: "200K", vision: true },
      { id: "zen-messages/claude-sonnet-5-5", name: "Claude Sonnet 5.5", contextWindow: "200K", vision: true },
      { id: "zen-messages/claude-sonnet-5", name: "Claude Sonnet 5", contextWindow: "200K", vision: true },
      { id: "zen-messages/claude-haiku-5-5", name: "Claude Haiku 5.5", contextWindow: "200K", vision: true },
      { id: "zen-messages/claude-haiku-4-5", name: "Claude Haiku 4.5", contextWindow: "200K", vision: true },
      { id: "zen-messages/claude-sonnet-4-6", name: "Claude Sonnet 4.6", contextWindow: "200K", vision: true },
      { id: "zen-messages/qwen3.8-flash", name: "Qwen3.8 Flash", contextWindow: "256K" },
      { id: "zen-messages/qwen3.7-plus", name: "Qwen3.7 Plus", contextWindow: "256K" },
      { id: "zen-messages/qwen3.6-plus", name: "Qwen3.6 Plus", contextWindow: "256K" },
    ],
  },
  {
    id: "zen-go",
    label: "OpenCode Go",
    group: "Gateways",
    kind: "openai",
    baseUrl: "https://opencode.ai/zen/go/v1",
    needsBaseUrl: false,
    keyHint: "oc_sk_… from opencode.ai/console (Go plan)",
    docsUrl: "https://opencode.ai/v2/docs/console/go",
    note: "Go / Go Plus subscription. Each conversation carries the session header Go asks for.",
    // A monthly subscription (Go / Go Plus). Go's docs validate third-party
    // coding agents that send their own user agent and a per-conversation
    // `x-opencode-session`; the app sends both.
    defaultEnabled: false,
    models: [
      { id: "zen-go/longcat-2.5-preview-free", name: "LongCat 2.5 Preview · free", contextWindow: "256K" },
      { id: "zen-go/step-5-preview-free", name: "Step 5 Preview · free", contextWindow: "256K" },
      { id: "zen-go/cat-jam-free", name: "Cat Jam · free", contextWindow: "256K" },
      { id: "zen-go/deepseek-v4-flash", name: "DeepSeek V4 Flash", contextWindow: "128K" },
      { id: "zen-go/deepseek-v4-pro", name: "DeepSeek V4 Pro", contextWindow: "128K" },
      { id: "zen-go/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", contextWindow: "128K" },
      { id: "zen-go/glm-5.3-flash", name: "GLM-5.3-Flash", contextWindow: "200K" },
      { id: "zen-go/glm-5.3", name: "GLM-5.3", contextWindow: "200K" },
      { id: "zen-go/glm-5.2", name: "GLM-5.2", contextWindow: "200K" },
      { id: "zen-go/kimi-k3", name: "Kimi K3", contextWindow: "256K" },
      { id: "zen-go/kimi-k2.7-code", name: "Kimi K2.7 Code", contextWindow: "256K" },
      { id: "zen-go/kimi-k2.6", name: "Kimi K2.6", contextWindow: "256K" },
      { id: "zen-go/mimo-v2.6-pro", name: "MiMo-V2.6-Pro", contextWindow: "128K" },
      { id: "zen-go/mimo-v2.6-flash", name: "MiMo-V2.6-Flash", contextWindow: "128K" },
      { id: "zen-go/mimo-v2.5-pro", name: "MiMo-V2.5-Pro", contextWindow: "128K" },
      { id: "zen-go/mimo-v2.5", name: "MiMo-V2.5", contextWindow: "128K" },
      { id: "zen-go/minimax-m3", name: "MiniMax M3", contextWindow: "200K" },
      { id: "zen-go/minimax-m2.7", name: "MiniMax M2.7", contextWindow: "200K" },
      { id: "zen-go/longcat-2.0", name: "LongCat-2.0", contextWindow: "256K" },
      { id: "zen-go/space-bunny", name: "Space Bunny", contextWindow: "256K" },
      { id: "zen-go/hy4-preview", name: "Hy4 preview", contextWindow: "256K" },
      { id: "zen-go/hy3", name: "Hy3", contextWindow: "256K" },
      { id: "zen-go/qwen3.8-max", name: "Qwen3.8 Max", contextWindow: "256K" },
    ],
  },
  {
    id: "nvidia",
    label: "NVIDIA NIM",
    group: "Gateways",
    kind: "openai",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    needsBaseUrl: false,
    keyHint: "nvapi-…",
    docsUrl: "https://build.nvidia.com/settings/api-keys",
    // NVIDIA's hosted gateway tracks which client a request came from. The
    // official opencode NIM plugin sends these three; a personal `nvapi-` key
    // bills to the user either way, so the value names this app.
    headers: publicDefaultHeaders.nvidia,
    embeddings: true,
    embeddingModels: ["nvidia/nv-embedqa-e5-v5", "nvidia/llama-3.2-nv-embedqa-1b-v2"],
    models: [
      { id: "nvidia/deepseek-ai/deepseek-r1", name: "DeepSeek R1", contextWindow: "128K" },
      { id: "nvidia/qwen/qwen3-coder-480b-a35b-instruct", name: "Qwen3 Coder 480B", contextWindow: "262K" },
      { id: "nvidia/meta/llama-3.3-70b-instruct", name: "Llama 3.3 70B", contextWindow: "128K" },
      { id: "nvidia/mistralai/mistral-large-2-instruct", name: "Mistral Large 2", contextWindow: "128K" },
      { id: "nvidia/moonshotai/kimi-k2-instruct", name: "Kimi K2", contextWindow: "200K" },
    ],
  },
  {
    id: "vercel",
    label: "Vercel AI Gateway",
    group: "Gateways",
    kind: "openai",
    baseUrl: "https://ai-gateway.vercel.sh/v1",
    needsBaseUrl: false,
    keyHint: "vck_…",
    docsUrl: "https://vercel.com/docs/ai-gateway",
    models: [
      { id: "vercel/openai/gpt-5", name: "GPT-5", contextWindow: "400K", vision: true },
      { id: "vercel/anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5", contextWindow: "200K", vision: true },
      { id: "vercel/google/gemini-2.5-pro", name: "Gemini 2.5 Pro", contextWindow: "1M", vision: true },
    ],
  },
  {
    id: "llmgateway",
    label: "LLM Gateway",
    group: "Gateways",
    kind: "openai",
    baseUrl: "https://api.llmgateway.io/v1",
    needsBaseUrl: false,
    keyHint: "llmgtwy_…",
    docsUrl: "https://llmgateway.io",
    headers: publicDefaultHeaders.llmgateway,
    models: [
      { id: "llmgateway/openai/gpt-5", name: "GPT-5", contextWindow: "400K", vision: true },
      { id: "llmgateway/anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5", contextWindow: "200K", vision: true },
      { id: "llmgateway/google/gemini-2.5-pro", name: "Gemini 2.5 Pro", contextWindow: "1M", vision: true },
    ],
  },
  {
    id: "zenmux",
    label: "ZenMux",
    group: "Gateways",
    kind: "openai",
    baseUrl: "https://zenmux.ai/api/v1",
    needsBaseUrl: false,
    keyHint: "sk-ai-v1-…",
    docsUrl: "https://zenmux.ai",
    headers: publicDefaultHeaders.zenmux,
    models: [
      { id: "zenmux/anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5", contextWindow: "200K", vision: true },
      { id: "zenmux/openai/gpt-5", name: "GPT-5", contextWindow: "400K", vision: true },
      { id: "zenmux/google/gemini-2.5-pro", name: "Gemini 2.5 Pro", contextWindow: "1M", vision: true },
    ],
  },
  {
    id: "kilo",
    label: "Kilo Code",
    group: "Gateways",
    kind: "openai",
    baseUrl: "https://api.kilo.ai/api/gateway",
    needsBaseUrl: false,
    keyHint: "kilo_…",
    docsUrl: "https://kilo.ai",
    headers: publicDefaultHeaders.kilo,
    models: [
      { id: "kilo/anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5", contextWindow: "200K", vision: true },
      { id: "kilo/openai/gpt-5", name: "GPT-5", contextWindow: "400K", vision: true },
    ],
  },
  {
    id: "cloudflare-gateway",
    label: "Cloudflare AI Gateway",
    group: "Gateways",
    kind: "openai",
    baseUrl: "https://gateway.ai.cloudflare.com/v1/YOUR-ACCOUNT/YOUR-GATEWAY/compat",
    needsBaseUrl: true,
    keyHint: "cf-aig-authorization header (optional)",
    docsUrl: "https://developers.cloudflare.com/ai-gateway/",
    // Gateway-level auth travels in its own header; the provider key stays in
    // the key field. Add `cf-aig-authorization: Bearer <token>` under headers
    // when the gateway requires it.
    models: [
      { id: "cloudflare-gateway/openai/gpt-5", name: "GPT-5", contextWindow: "400K", vision: true },
      { id: "cloudflare-gateway/anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5", contextWindow: "200K", vision: true },
    ],
  },

  /* -------------------------------------------------------------------- */
  /* OpenAI-compatible labs and clouds                                     */
  /* -------------------------------------------------------------------- */
  {
    id: "xai",
    label: "xAI",
    group: "Providers",
    kind: "openai",
    baseUrl: "https://api.x.ai/v1",
    needsBaseUrl: false,
    keyHint: "xai-…",
    docsUrl: "https://console.x.ai",
    models: [
      { id: "xai/grok-4", name: "Grok 4", contextWindow: "256K", vision: true },
      { id: "xai/grok-3-mini", name: "Grok 3 mini", contextWindow: "131K" },
      { id: "xai/grok-code-fast-1", name: "Grok Code Fast", contextWindow: "256K" },
    ],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    group: "Providers",
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
    group: "Providers",
    kind: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    needsBaseUrl: false,
    keyHint: "gsk_…",
    docsUrl: "https://console.groq.com/keys",
    models: [
      { id: "groq/llama-3.3-70b-versatile", name: "Llama 3.3 70B", contextWindow: "128K" },
      { id: "groq/deepseek-r1-distill-llama-70b", name: "DeepSeek R1 Distill 70B", contextWindow: "128K" },
      { id: "groq/qwen-2.5-coder-32b", name: "Qwen2.5 Coder 32B", contextWindow: "128K" },
    ],
  },
  {
    id: "mistral",
    label: "Mistral",
    group: "Providers",
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
      { id: "mistral/devstral-medium-latest", name: "Devstral Medium", contextWindow: "128K" },
    ],
  },
  {
    id: "cerebras",
    label: "Cerebras",
    group: "Providers",
    kind: "openai",
    baseUrl: "https://api.cerebras.ai/v1",
    needsBaseUrl: false,
    keyHint: "csk-…",
    docsUrl: "https://cloud.cerebras.ai",
    models: [
      { id: "cerebras/qwen-3-coder-480b", name: "Qwen3 Coder 480B", contextWindow: "131K" },
      { id: "cerebras/llama-3.3-70b", name: "Llama 3.3 70B", contextWindow: "128K" },
      { id: "cerebras/gpt-oss-120b", name: "GPT-OSS 120B", contextWindow: "131K" },
    ],
  },
  {
    id: "together",
    label: "Together AI",
    group: "Providers",
    kind: "openai",
    baseUrl: "https://api.together.xyz/v1",
    needsBaseUrl: false,
    keyHint: "tgp_v1_…",
    docsUrl: "https://api.together.ai/settings/api-keys",
    embeddings: true,
    embeddingModels: ["BAAI/bge-large-en-v1.5", "togethercomputer/m2-bert-80M-32k-retrieval"],
    models: [
      { id: "together/Qwen/Qwen3-Coder-480B-A35B-Instruct", name: "Qwen3 Coder 480B", contextWindow: "262K" },
      { id: "together/deepseek-ai/DeepSeek-R1", name: "DeepSeek R1", contextWindow: "128K" },
      { id: "together/meta-llama/Llama-3.3-70B-Instruct-Turbo", name: "Llama 3.3 70B Turbo", contextWindow: "128K" },
    ],
  },
  {
    id: "fireworks",
    label: "Fireworks AI",
    group: "Providers",
    kind: "openai",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    needsBaseUrl: false,
    keyHint: "fw_…",
    docsUrl: "https://fireworks.ai/account/api-keys",
    models: [
      { id: "fireworks/accounts/fireworks/models/deepseek-r1", name: "DeepSeek R1", contextWindow: "128K" },
      { id: "fireworks/accounts/fireworks/models/qwen3-coder-480b-a35b-instruct", name: "Qwen3 Coder 480B", contextWindow: "262K" },
      { id: "fireworks/accounts/fireworks/models/llama-v3p3-70b-instruct", name: "Llama 3.3 70B", contextWindow: "128K" },
    ],
  },
  {
    id: "moonshot",
    label: "Moonshot (Kimi)",
    group: "Providers",
    kind: "openai",
    baseUrl: "https://api.moonshot.ai/v1",
    needsBaseUrl: false,
    keyHint: "sk-…",
    docsUrl: "https://platform.moonshot.ai/console/api-keys",
    models: [
      { id: "moonshot/kimi-k2-0905-preview", name: "Kimi K2", contextWindow: "256K" },
      { id: "moonshot/kimi-k2-turbo-preview", name: "Kimi K2 Turbo", contextWindow: "256K" },
      { id: "moonshot/moonshot-v1-128k", name: "Moonshot 128K", contextWindow: "128K" },
    ],
  },
  {
    id: "zai",
    label: "Z.ai (GLM)",
    group: "Providers",
    kind: "openai",
    baseUrl: "https://api.z.ai/api/paas/v4",
    needsBaseUrl: false,
    keyHint: "…",
    docsUrl: "https://z.ai/manage-apikey/apikey-list",
    models: [
      { id: "zai/glm-5", name: "GLM 5", contextWindow: "200K" },
      { id: "zai/glm-4.6", name: "GLM 4.6", contextWindow: "200K" },
      { id: "zai/glm-4.5-air", name: "GLM 4.5 Air", contextWindow: "128K" },
    ],
  },
  {
    id: "zai-coding",
    label: "Z.ai Coding Plan",
    group: "Providers",
    kind: "openai",
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    needsBaseUrl: false,
    keyHint: "…",
    docsUrl: "https://z.ai/subscribe",
    models: [
      { id: "zai-coding/glm-5", name: "GLM 5", contextWindow: "200K" },
      { id: "zai-coding/glm-4.6", name: "GLM 4.6", contextWindow: "200K" },
    ],
  },
  {
    id: "qwen",
    label: "Alibaba Qwen (DashScope)",
    group: "Providers",
    kind: "openai",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    needsBaseUrl: false,
    keyHint: "sk-…",
    docsUrl: "https://bailian.console.alibabacloud.com/",
    embeddings: true,
    embeddingModels: ["text-embedding-v3"],
    models: [
      { id: "qwen/qwen3-coder-plus", name: "Qwen3 Coder Plus", contextWindow: "1M" },
      { id: "qwen/qwen3-max", name: "Qwen3 Max", contextWindow: "256K" },
      { id: "qwen/qwen-plus", name: "Qwen Plus", contextWindow: "128K" },
    ],
  },
  {
    id: "deepinfra",
    label: "DeepInfra",
    group: "Providers",
    kind: "openai",
    baseUrl: "https://api.deepinfra.com/v1/openai",
    needsBaseUrl: false,
    keyHint: "…",
    docsUrl: "https://deepinfra.com/dash/api_keys",
    embeddings: true,
    embeddingModels: ["BAAI/bge-m3", "BAAI/bge-large-en-v1.5"],
    models: [
      { id: "deepinfra/deepseek-ai/DeepSeek-R1", name: "DeepSeek R1", contextWindow: "128K" },
      { id: "deepinfra/Qwen/Qwen3-Coder-480B-A35B-Instruct", name: "Qwen3 Coder 480B", contextWindow: "262K" },
      { id: "deepinfra/meta-llama/Llama-3.3-70B-Instruct", name: "Llama 3.3 70B", contextWindow: "128K" },
    ],
  },
  {
    id: "venice",
    label: "Venice AI",
    group: "Providers",
    kind: "openai",
    baseUrl: "https://api.venice.ai/api/v1",
    needsBaseUrl: false,
    keyHint: "VENICE_INFERENCE_KEY_…",
    docsUrl: "https://venice.ai/settings/api",
    models: [
      { id: "venice/qwen3-coder-480b-a35b-instruct-turbo", name: "Qwen3 Coder 480B Turbo", contextWindow: "262K" },
      { id: "venice/llama-3.3-70b", name: "Llama 3.3 70B", contextWindow: "128K" },
      { id: "venice/deepseek-r1-671b", name: "DeepSeek R1 671B", contextWindow: "128K" },
    ],
  },
  {
    id: "minimax",
    label: "MiniMax",
    group: "Providers",
    kind: "openai",
    baseUrl: "https://api.minimax.io/v1",
    needsBaseUrl: false,
    keyHint: "…",
    docsUrl: "https://platform.minimax.io/user-center/basic-information/interface-key",
    models: [
      { id: "minimax/MiniMax-M2", name: "MiniMax M2", contextWindow: "200K" },
      { id: "minimax/MiniMax-Text-01", name: "MiniMax Text 01", contextWindow: "1M" },
    ],
  },
  {
    id: "baseten",
    label: "Baseten",
    group: "Providers",
    kind: "openai",
    baseUrl: "https://inference.baseten.co/v1",
    needsBaseUrl: false,
    keyHint: "…",
    docsUrl: "https://app.baseten.co/settings/api_keys",
    models: [
      { id: "baseten/deepseek-ai/DeepSeek-V3-0324", name: "DeepSeek V3", contextWindow: "128K" },
      { id: "baseten/moonshotai/Kimi-K2-Instruct", name: "Kimi K2", contextWindow: "200K" },
    ],
  },
  {
    id: "digitalocean",
    label: "DigitalOcean Gradient",
    group: "Providers",
    kind: "openai",
    baseUrl: "https://inference.do-ai.run/v1",
    needsBaseUrl: false,
    keyHint: "doo_v1_…",
    docsUrl: "https://cloud.digitalocean.com/gen-ai",
    models: [
      { id: "digitalocean/llama3.3-70b-instruct", name: "Llama 3.3 70B", contextWindow: "128K" },
      { id: "digitalocean/deepseek-r1-distill-llama-70b", name: "DeepSeek R1 Distill 70B", contextWindow: "128K" },
    ],
  },
  {
    id: "cohere",
    label: "Cohere",
    group: "Providers",
    kind: "openai",
    baseUrl: "https://api.cohere.ai/compatibility/v1",
    needsBaseUrl: false,
    keyHint: "…",
    docsUrl: "https://dashboard.cohere.com/api-keys",
    models: [
      { id: "cohere/command-a-03-2025", name: "Command A", contextWindow: "256K" },
      { id: "cohere/command-r-plus-08-2024", name: "Command R+", contextWindow: "128K" },
    ],
  },
  {
    id: "perplexity",
    label: "Perplexity",
    group: "Providers",
    kind: "openai",
    baseUrl: "https://api.perplexity.ai",
    needsBaseUrl: false,
    keyHint: "pplx-…",
    docsUrl: "https://www.perplexity.ai/settings/api",
    models: [
      { id: "perplexity/sonar-pro", name: "Sonar Pro", contextWindow: "200K" },
      { id: "perplexity/sonar-reasoning-pro", name: "Sonar Reasoning Pro", contextWindow: "128K" },
    ],
  },
  {
    id: "cloudflare",
    label: "Cloudflare Workers AI",
    group: "Providers",
    kind: "openai",
    baseUrl: "https://api.cloudflare.com/client/v4/accounts/YOUR-ACCOUNT-ID/ai/v1",
    needsBaseUrl: true,
    keyHint: "Cloudflare API token",
    docsUrl: "https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/",
    models: [
      { id: "cloudflare/@cf/meta/llama-3.3-70b-instruct-fp8-fast", name: "Llama 3.3 70B", contextWindow: "128K" },
      { id: "cloudflare/@cf/qwen/qwen2.5-coder-32b-instruct", name: "Qwen2.5 Coder 32B", contextWindow: "128K" },
    ],
  },
  {
    id: "databricks",
    label: "Databricks",
    group: "Providers",
    kind: "openai",
    baseUrl: "https://YOUR-WORKSPACE.cloud.databricks.com/serving-endpoints",
    needsBaseUrl: true,
    keyHint: "dapi…",
    docsUrl: "https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/",
    models: [
      { id: "databricks/databricks-claude-sonnet-4", name: "Claude Sonnet 4", contextWindow: "200K" },
      { id: "databricks/databricks-gpt-oss-120b", name: "GPT-OSS 120B", contextWindow: "131K" },
    ],
  },

  /* -------------------------------------------------------------------- */
  /* Local runtimes                                                        */
  /* -------------------------------------------------------------------- */
  {
    id: "ollama",
    label: "Ollama",
    group: "Local",
    kind: "openai",
    baseUrl: "http://127.0.0.1:11434/v1",
    needsBaseUrl: false,
    keyHint: "not needed",
    docsUrl: "https://ollama.com",
    keyless: true,
    defaultEnabled: false,
    embeddings: true,
    embeddingModels: [
      "nomic-embed-text",
      "mxbai-embed-large",
      "snowflake-arctic-embed",
      "all-minilm",
    ],
    models: [
      { id: "ollama/qwen2.5-coder:7b", name: "Qwen2.5 Coder 7B", contextWindow: "32K" },
      { id: "ollama/qwen3:8b", name: "Qwen3 8B", contextWindow: "40K" },
      { id: "ollama/llama3.2:3b", name: "Llama 3.2 3B", contextWindow: "128K" },
      { id: "ollama/deepseek-r1:8b", name: "DeepSeek R1 8B", contextWindow: "128K" },
    ],
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    group: "Local",
    kind: "openai",
    baseUrl: "http://127.0.0.1:1234/v1",
    needsBaseUrl: false,
    keyHint: "not needed",
    docsUrl: "https://lmstudio.ai/docs/app/api",
    keyless: true,
    defaultEnabled: false,
    embeddings: true,
    embeddingModels: ["text-embedding-nomic-embed-text-v1.5"],
    models: [],
  },
  {
    id: "vllm",
    label: "vLLM",
    group: "Local",
    kind: "openai",
    baseUrl: "http://127.0.0.1:8000/v1",
    needsBaseUrl: false,
    keyHint: "--api-key flag, if you set one",
    docsUrl: "https://docs.vllm.ai",
    keyless: true,
    defaultEnabled: false,
    embeddings: true,
    embeddingModels: [],
    models: [],
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    group: "Local",
    kind: "openai",
    baseUrl: "",
    needsBaseUrl: true,
    keyHint: "local runtimes often need no key",
    docsUrl: "",
    keyless: true,
    defaultEnabled: false,
    // Self-hosted runtimes decide their own embedding model, so the user picks
    // the id (Ollama's `nomic-embed-text`, vLLM's `BAAI/bge-m3`, …).
    embeddings: true,
    embeddingModels: [],
    models: [],
  },
];

// Register provider labels with the catalog module so it can render friendly
// names without creating a circular import back into this file.
registerProviderLabels(
  Object.fromEntries(
    PROVIDER_PRESETS.map((preset) => [preset.id, preset.label]),
  ),
);

export const SEARCH_PROVIDERS = [
  { id: "none", label: "Off", keyHint: "", docsUrl: "" },
  {
    id: "tavily",
    label: "Tavily",
    keyHint: "tvly-…",
    docsUrl: "https://app.tavily.com/home",
  },
  {
    id: "brave",
    label: "Brave Search",
    keyHint: "BSA…",
    docsUrl: "https://api-dashboard.search.brave.com/app/keys",
  },
] as const;

/** Pseudo-ids for the two non-model secrets, stored beside provider keys. */
export const SEARCH_SECRET_ID = "service:search";
export const COMPOSIO_SECRET_ID = "service:composio";

/** Prefixes other clients use for the same providers. */
export const PROVIDER_ALIASES: Record<string, ProviderId> = {
  "google-ai": "google",
  googleai: "google",
  gemini: "google",
  "x-ai": "xai",
  azureopenai: "azure",
  "azure-openai": "azure",
  togetherai: "together",
  "together-ai": "together",
  fireworksai: "fireworks",
  "fireworks-ai": "fireworks",
  moonshotai: "moonshot",
  kimi: "moonshot",
  "z-ai": "zai",
  zhipu: "zai",
  zhipuai: "zai",
  glm: "zai",
  dashscope: "qwen",
  alibaba: "qwen",
  opencode: "zen",
  "opencode-zen": "zen",
  "opencode-zen-messages": "zen-messages",
  "opencode-go": "zen-go",
  "nvidia-nim": "nvidia",
  nim: "nvidia",
  "llm-gateway": "llmgateway",
  llmgtwy: "llmgateway",
  "cf-workers-ai": "cloudflare",
  "cloudflare-workers-ai": "cloudflare",
  "cf-gateway": "cloudflare-gateway",
  "cloudflare-ai-gateway": "cloudflare-gateway",
  "vercel-ai-gateway": "vercel",
  aigateway: "vercel",
  kilocode: "kilo",
  "kilo-code": "kilo",
  "digital-ocean": "digitalocean",
  do: "digitalocean",
  "gradient-ai": "digitalocean",
  "lm-studio": "lmstudio",
  local: "custom",
  localhost: "custom",
  veniceai: "venice",
  minimaxi: "minimax",
  cohereai: "cohere",
  "perplexity-ai": "perplexity",
};

const VALID_AUTH_STYLES = new Set([
  "",
  "bearer",
  "api-key",
  "x-api-key",
  "x-goog-api-key",
  "none",
]);

const KIND_DEFAULT_AUTH_STYLES: Partial<Record<ProviderKind, AuthStyle>> = {
  anthropic: "x-api-key",
  google: "x-goog-api-key",
};

const VALID_SEARCH_PROVIDERS = new Set(["tavily", "brave"]);

const FEATURE_MODEL_NAMES: ReadonlySet<string> = new Set([
  "chat",
  "agent",
  "commits",
  "embeddings",
]);

const KEY_PREFIXES: { id: ProviderId; prefix: string }[] = [
  { id: "anthropic", prefix: "sk-ant-" },
  { id: "openrouter", prefix: "sk-or-" },
  { id: "groq", prefix: "gsk_" },
  { id: "xai", prefix: "xai-" },
  { id: "google", prefix: "AIza" },
  { id: "cerebras", prefix: "csk-" },
  { id: "together", prefix: "tgp_v1_" },
  { id: "fireworks", prefix: "fw_" },
  { id: "perplexity", prefix: "pplx-" },
  { id: "nvidia", prefix: "nvapi-" },
  { id: "zen", prefix: "oc_sk_" },
  { id: "digitalocean", prefix: "doo_v1_" },
  { id: "vercel", prefix: "vck_" },
];

const SIBLING_PROVIDERS: Partial<Record<ProviderId, ProviderId[]>> = {
  zen: ["zen-messages", "zen-go"],
  "zen-messages": ["zen", "zen-go"],
  "zen-go": ["zen", "zen-messages"],
};

const SEARCH_KEY_PREFIX_REQUIREMENTS: Partial<
  Record<
    (typeof SEARCH_PROVIDERS)[number]["id"],
    { prefix: string; message: string }
  >
> = {
  tavily: { prefix: "tvly-", message: "Tavily keys start with tvly-." },
  brave: { prefix: "BSA", message: "Brave Search keys start with BSA." },
};

const REASONING_MODEL_RE =
  /(^|[/\-\s])(o[1-9]|o3|o4|r1|reasoning|reasoner|deepseek-reasoner|think(ing)?|opus-?[4-9])([/\-\s]|$)/i;
const VISION_MODEL_RE =
  /vision|-vl|gemini|gpt-4o|gpt-4\.1|gpt-5|claude|grok|multimodal/i;
const TOOL_USE_MODEL_RE =
  /(gpt-[45]|o[34]|claude|gemini-2|grok|qwen|llama-?3\.[1-9]|mistral|deepseek|glm-5)/i;
const NON_TOOL_MODEL_RE = /(^|[/\-\s])(embed|embedding|rerank|whisper|tts)/i;
const EMBEDDING_ID_RE = /embed|embedding/i;

/** Presets in display order, bucketed by their `group` heading. */
export const providerGroups = (): {
  group: string;
  presets: ProviderPreset[];
}[] => {
  const out: { group: string; presets: ProviderPreset[] }[] = [];
  for (const preset of PROVIDER_PRESETS) {
    let bucket = out.find((entry) => entry.group === preset.group);
    if (!bucket) {
      bucket = { group: preset.group, presets: [] };
      out.push(bucket);
    }
    bucket.presets.push(preset);
  }
  return out;
};

/** Checks whether `preset` label, id, or group matches `needle` case-insensitively. */
const matchesPresetHeaderQuery = (
  preset: ProviderPreset,
  needle: string,
): boolean =>
  preset.label.toLowerCase().includes(needle) ||
  preset.id.includes(needle) ||
  preset.group.toLowerCase().includes(needle);

/** Free-text match over a preset's name, id, group and models. */
export const matchesProviderQuery = (
  preset: ProviderPreset,
  query: string,
): boolean => {
  const needle = query.trim().toLowerCase();
  if (!needle || matchesPresetHeaderQuery(preset, needle)) return true;
  return preset.models.some(
    (model) =>
      model.id.toLowerCase().includes(needle) ||
      model.name.toLowerCase().includes(needle),
  );
};

/** Returns the built-in preset metadata for a known AI provider identifier. */
export const providerPreset = (id: ProviderId): ProviderPreset =>
  PROVIDER_PRESETS.find((preset) => preset.id === id) ??
  PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1];

/** Provider a model id's prefix really means, or null when it names nothing. */
export const canonicalProviderId = (prefix: string): ProviderId | null => {
  const trimmed = prefix.trim();
  if (!trimmed) return null;
  if (PROVIDER_PRESETS.some((preset) => preset.id === trimmed)) {
    return trimmed as ProviderId;
  }
  return PROVIDER_ALIASES[trimmed.toLowerCase()] ?? null;
};

/** Model id rewritten onto the canonical provider prefix this app stores. */
export const translateModelId = (model: string): string => {
  const trimmed = model.trim();
  const separator = trimmed.indexOf("/");
  if (separator <= 0) return trimmed;
  const currentPrefix = trimmed.slice(0, separator);
  const canonical = canonicalProviderId(currentPrefix);
  if (!canonical || canonical === currentPrefix) return trimmed;
  return `${canonical}/${trimmed.slice(separator + 1)}`;
};

/** Type-guards whether an unknown value is a supported HTTP auth header style. */
const isAuthStyle = (value: unknown): value is AuthStyle | "" =>
  typeof value === "string" && VALID_AUTH_STYLES.has(value);

/** Checks whether `raw` is a non-null object record. */
const isObjectRecord = (raw: unknown): raw is Record<string, unknown> =>
  Boolean(raw) && typeof raw === "object";

/** Applies `entries` onto `byLower`, replacing prior entries with the same lowercased header name. */
const applyCaseInsensitiveHeaders = (
  byLower: Map<string, [string, string]>,
  entries: Iterable<readonly [string, string]>,
): void => {
  for (const [name, value] of entries) {
    byLower.set(name.toLowerCase(), [name, value]);
  }
};

/** Drop junk header names, keep the last value for case-insensitive duplicates. */
export const normalizeHeaders = (raw: unknown): Record<string, string> => {
  if (!isObjectRecord(raw)) return {};
  const byLower = new Map<string, [string, string]>();
  for (const [name, value] of Object.entries(raw)) {
    const header = name.trim();
    if (header && typeof value === "string") {
      byLower.set(header.toLowerCase(), [header, value.trim()]);
    }
  }
  return Object.fromEntries(byLower.values());
};

/** How the key travels for this connection. */
export const providerAuthStyle = (
  id: ProviderId,
  connection: ProviderConnection | undefined,
): AuthStyle => {
  const override = connection?.authStyle;
  if (override && isAuthStyle(override)) return override;
  const preset = providerPreset(id);
  return (
    preset.authStyle ?? KIND_DEFAULT_AUTH_STYLES[preset.kind] ?? "bearer"
  );
};

/** Creates a blank `ProviderConnection` initialized from optional preset defaults. */
const emptyConnection = (preset?: ProviderPreset): ProviderConnection => ({
  apiKey: "",
  baseUrl: "",
  enabled: preset ? (preset.defaultEnabled ?? !preset.keyless) : true,
  models: [],
  hiddenModels: [],
  extraModels: [],
  discoveredModels: [],
  headers: {},
  authStyle: "",
});

/** Baseline per-feature assignment used by a fresh settings object. */
const emptyFeatureModels = (): FeatureModelAssignment[] => [
  { feature: "chat", modelId: "auto" },
  { feature: "agent", modelId: "" },
  { feature: "commits", modelId: "" },
  { feature: "embeddings", modelId: "" },
];

/** Creates the default multi-provider BYOK settings structure. */
export const defaultProvidersSettings = (): ProvidersSettings => {
  const connections = {} as Record<ProviderId, ProviderConnection>;
  for (const preset of PROVIDER_PRESETS) {
    connections[preset.id] = emptyConnection(preset);
  }
  return {
    connections,
    chatMode: "auto",
    featureModels: emptyFeatureModels(),
    services: {
      search: { provider: "none", apiKey: "" },
      composio: { apiKey: "", userId: "" },
    },
  };
};

/** Resolves the `chat` feature model string from `settings.chatMode`. */
const resolveChatFeatureModel = (settings: ProvidersSettings): string =>
  settings.chatMode === "ask" ? "" : settings.chatMode || "auto";

/** Resolve the model id currently assigned to a given feature, inheriting from chat default when empty. */
export const modelForFeature = (
  settings: ProvidersSettings,
  feature: FeatureModel,
): string => {
  if (feature === "chat") return resolveChatFeatureModel(settings);
  const assignment = settings.featureModels.find((a) => a.feature === feature);
  const id =
    typeof assignment?.modelId === "string" ? assignment.modelId.trim() : "";
  if (id) return id;
  return feature === "embeddings" ? "" : resolveChatFeatureModel(settings);
};

/** Update one feature's assigned model id. */
export const withFeatureModel = (
  settings: ProvidersSettings,
  feature: FeatureModel,
  modelId: string,
): ProvidersSettings => {
  const others = settings.featureModels.filter((a) => a.feature !== feature);
  return { ...settings, featureModels: [...others, { feature, modelId }] };
};

/** Update the active chat mode selector (`"auto"`, `"ask"`, or a concrete model id). */
export const setChatMode = (
  settings: ProvidersSettings,
  mode: ChatMode,
): ProvidersSettings => ({
  ...settings,
  chatMode: mode,
});

/** Filters an unknown list of model IDs into trimmed non-empty strings. */
const normalizeStringList = (raw: unknown): string[] =>
  Array.isArray(raw)
    ? raw
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];

/** Coerces an unknown persisted field to a string, falling back when malformed. */
const normalizeStringField = (raw: unknown, fallback = ""): string =>
  typeof raw === "string" ? raw : fallback;

const VALID_DISCOVERED_SOURCES = new Set<
  NonNullable<DiscoveredModelEntry["source"]>
>(["catalog", "discovered", "inferred"]);

/** Coerces an optional boolean field, returning `undefined` when non-boolean. */
const normalizeOptionalBoolean = (raw: unknown): boolean | undefined =>
  typeof raw === "boolean" ? raw : undefined;

/** Coerces an optional trimmed string field, returning `undefined` when empty or non-string. */
const normalizeOptionalString = (raw: unknown): string | undefined => {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed || undefined;
};

/** Coerces an optional non-negative finite number, returning `undefined` otherwise. */
const normalizeOptionalNumber = (raw: unknown): number | undefined =>
  typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : undefined;

/** Coerces an optional `DiscoveredModelEntry["source"]` tag, returning `undefined` when invalid. */
const normalizeDiscoveredSource = (
  raw: unknown,
): DiscoveredModelEntry["source"] =>
  typeof raw === "string" &&
  VALID_DISCOVERED_SOURCES.has(
    raw as NonNullable<DiscoveredModelEntry["source"]>,
  )
    ? (raw as DiscoveredModelEntry["source"])
    : undefined;

/** Type-guards a persisted `DiscoveredModelEntry` record. */
const isDiscoveredModelEntry = (
  entry: unknown,
): entry is DiscoveredModelEntry =>
  isObjectRecord(entry) &&
  typeof entry.id === "string" &&
  Boolean(entry.id.trim());

/** Normalizes optional metadata fields on a validated `DiscoveredModelEntry` record. */
const normalizeDiscoveredEntry = (
  entry: DiscoveredModelEntry,
): DiscoveredModelEntry => ({
  id: entry.id.trim(),
  name: normalizeOptionalString(entry.name),
  contextWindow: normalizeOptionalString(entry.contextWindow),
  contextTokens: normalizeOptionalNumber(entry.contextTokens),
  maxOutputTokens: normalizeOptionalNumber(entry.maxOutputTokens),
  inputCostPerM: normalizeOptionalNumber(entry.inputCostPerM),
  outputCostPerM: normalizeOptionalNumber(entry.outputCostPerM),
  vision: normalizeOptionalBoolean(entry.vision),
  reasoning: normalizeOptionalBoolean(entry.reasoning),
  toolUse: normalizeOptionalBoolean(entry.toolUse),
  nonChat: normalizeOptionalBoolean(entry.nonChat),
  source: normalizeDiscoveredSource(entry.source),
  discoveredAt: normalizeOptionalNumber(entry.discoveredAt),
});

/** Filters and normalizes an unknown discovered-model array into valid `DiscoveredModelEntry` records. */
const normalizeDiscoveredList = (raw: unknown): DiscoveredModelEntry[] =>
  Array.isArray(raw)
    ? raw.filter(isDiscoveredModelEntry).map(normalizeDiscoveredEntry)
    : [];

/** Coerces an unknown search provider value to a valid `AiServicesSettings["search"]["provider"]`. */
const normalizeSearchProvider = (
  raw: unknown,
): AiServicesSettings["search"]["provider"] =>
  typeof raw === "string" && VALID_SEARCH_PROVIDERS.has(raw)
    ? (raw as AiServicesSettings["search"]["provider"])
    : "none";

/** Normalizes a single saved `ProviderConnection` against its preset defaults. */
const normalizeSingleConnection = (
  preset: ProviderPreset,
  saved: Partial<ProviderConnection> | undefined,
): ProviderConnection => {
  const defaults = emptyConnection(preset);
  return {
    ...(isObjectRecord(saved) ? saved : {}),
    apiKey: normalizeStringField(saved?.apiKey, defaults.apiKey),
    baseUrl: normalizeStringField(saved?.baseUrl, defaults.baseUrl),
    enabled:
      typeof saved?.enabled === "boolean" ? saved.enabled : defaults.enabled,
    models: normalizeStringList(saved?.models),
    hiddenModels: normalizeStringList(saved?.hiddenModels),
    extraModels: normalizeStringList(saved?.extraModels),
    discoveredModels: normalizeDiscoveredList(saved?.discoveredModels),
    headers: normalizeHeaders(saved?.headers),
    authStyle: isAuthStyle(saved?.authStyle) ? saved.authStyle : "",
  };
};

/** Normalizes `services` settings with `"none"` and empty-key defaults. */
const normalizeServicesSettings = (
  rawServices: Partial<AiServicesSettings> | undefined,
): AiServicesSettings => ({
  search: {
    provider: normalizeSearchProvider(rawServices?.search?.provider),
    apiKey: normalizeStringField(rawServices?.search?.apiKey),
  },
  composio: {
    apiKey: normalizeStringField(rawServices?.composio?.apiKey),
    userId: normalizeStringField(rawServices?.composio?.userId),
  },
});

/** Converts a legacy `defaultModel` string into a normalized `ChatMode`. */
const legacyDefaultToChatMode = (legacyDefault: string): ChatMode => {
  if (legacyDefault === "__ask__") return "ask";
  return legacyDefault && legacyDefault !== "auto" ? legacyDefault : "auto";
};

/** Resolves `chatMode` from saved `chatMode` or legacy `defaultModel`. */
const resolveMigratedChatMode = (
  rawChatMode: unknown,
  legacyDefault: string,
): ChatMode => {
  const saved = normalizeStringField(rawChatMode).trim();
  return saved ? saved : legacyDefaultToChatMode(legacyDefault);
};

/** Type-guards a persisted `FeatureModelAssignment` entry. */
const isValidFeatureAssignment = (
  entry: unknown,
): entry is FeatureModelAssignment =>
  isObjectRecord(entry) &&
  typeof entry.feature === "string" &&
  FEATURE_MODEL_NAMES.has(entry.feature) &&
  typeof entry.modelId === "string";

/** Backfills `legacyEmbedding` onto an empty `embeddings` slot when migrating old settings. */
const applyLegacyEmbeddingFallback = (
  list: FeatureModelAssignment[],
  legacyEmbedding: string,
): void => {
  if (!legacyEmbedding) return;
  const embeddingsSlot = list.find((a) => a.feature === "embeddings");
  if (embeddingsSlot && !embeddingsSlot.modelId) {
    embeddingsSlot.modelId = legacyEmbedding;
  }
};

/** Normalizes `featureModels` and migrates legacy `embeddingModel` when needed. */
const normalizeFeatureAssignments = (
  rawList: unknown,
  legacyEmbedding: string,
): FeatureModelAssignment[] => {
  const list: FeatureModelAssignment[] = Array.isArray(rawList)
    ? rawList
        .filter(isValidFeatureAssignment)
        .map((a) => ({ feature: a.feature, modelId: a.modelId }))
    : emptyFeatureModels();
  const known = new Set(list.map((a) => a.feature));
  for (const slot of emptyFeatureModels()) {
    if (!known.has(slot.feature)) list.push({ ...slot });
  }
  applyLegacyEmbeddingFallback(list, legacyEmbedding);
  return list;
};

/** Fill in connections added by newer versions without losing user values. */
export const normalizeProvidersSettings = (
  raw: Partial<ProvidersSettings> | undefined,
): ProvidersSettings => {
  const base = defaultProvidersSettings();
  if (!raw) return base;
  const connections = {} as Record<ProviderId, ProviderConnection>;
  for (const preset of PROVIDER_PRESETS) {
    connections[preset.id] = normalizeSingleConnection(
      preset,
      raw.connections?.[preset.id],
    );
  }
  const legacy = raw as Partial<ProvidersSettings> & {
    defaultModel?: unknown;
    embeddingModel?: unknown;
  };
  const legacyDefault = normalizeStringField(legacy.defaultModel).trim();
  const legacyEmbedding = normalizeStringField(legacy.embeddingModel).trim();
  return {
    connections,
    chatMode: resolveMigratedChatMode(raw.chatMode, legacyDefault),
    featureModels: normalizeFeatureAssignments(
      raw.featureModels,
      legacyEmbedding,
    ),
    services: normalizeServicesSettings(raw.services),
  };
};

/** Checks whether `connection` accepts unauthenticated / keyless HTTP requests. */
const connectionAllowsKeylessAuth = (
  id: ProviderId,
  preset: ProviderPreset,
  connection: ProviderConnection,
): boolean =>
  preset.keyless === true || providerAuthStyle(id, connection) === "none";

/** True when this connection can be routed right now. */
export const isConnectionUsable = (
  id: ProviderId,
  connections: Record<ProviderId, ProviderConnection>,
): boolean => {
  const connection = connections[id];
  if (!connection?.enabled) return false;
  const preset = providerPreset(id);
  if (preset.needsBaseUrl && !connection.baseUrl.trim()) return false;
  if (!connection.apiKey.trim()) {
    return connectionAllowsKeylessAuth(id, preset, connection);
  }
  return true;
};

/** Request headers for a connection: preset defaults, then case-insensitive user overrides. */
export const providerHeaders = (
  id: ProviderId,
  connection: ProviderConnection | undefined,
): Record<string, string> => {
  const preset = providerPreset(id);
  const byLower = new Map<string, [string, string]>();
  applyCaseInsensitiveHeaders(byLower, Object.entries(preset.headers ?? {}));
  applyCaseInsensitiveHeaders(
    byLower,
    Object.entries(normalizeHeaders(connection?.headers)),
  );
  return Object.fromEntries(
    Array.from(byLower.values()).filter(([, value]) => Boolean(value.trim())),
  );
};

/** Parses a single `Name: Value` header line when non-comment and colon-delimited. */
const parseSingleHeaderLine = (line: string): [string, string] | null => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const separator = trimmed.indexOf(":");
  if (separator <= 0) return null;
  const name = trimmed.slice(0, separator).trim();
  return name ? [name, trimmed.slice(separator + 1).trim()] : null;
};

/** `Name: value` lines <-> the header map shown next to a provider. */
export const parseHeaderLines = (text: string): Record<string, string> => {
  const byLower = new Map<string, [string, string]>();
  for (const line of text.split("\n")) {
    const entry = parseSingleHeaderLine(line);
    if (entry) {
      byLower.set(entry[0].toLowerCase(), entry);
    }
  }
  return Object.fromEntries(byLower.values());
};

/** Serializes custom HTTP header key-value pairs into newline-delimited `Key: Value` text. */
export const formatHeaderLines = (
  headers: Record<string, string> | undefined,
): string =>
  Object.entries(headers ?? {})
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n");

/** Checks whether `head` is an alias prefix that resolves onto non-custom provider `id`. */
const isAliasedPrefixForProvider = (id: ProviderId, head: string): boolean =>
  id !== "custom" && Boolean(head) && canonicalProviderId(head) === id;

/** Normalizes one `extraModels` entry onto its owning `id/...` provider prefix. */
const normalizeExtraModelEntry = (id: ProviderId, raw: string): string => {
  if (raw.startsWith(`${id}/`)) return raw;
  const slashIdx = raw.indexOf("/");
  const head = slashIdx > 0 ? raw.slice(0, slashIdx) : "";
  if (isAliasedPrefixForProvider(id, head)) {
    return `${id}/${raw.slice(head.length + 1)}`;
  }
  return `${id}/${raw}`;
};

/** Selects base model ids with precedence: user-pinned -> discovered -> preset. */
const resolveBaseConnectionModelIds = (
  preset: ProviderPreset,
  connection: ProviderConnection,
  discoveredAll: string[],
): string[] => {
  if (connection.models.length > 0) return connection.models;
  if (discoveredAll.length > 0) return discoveredAll;
  return preset.models.map((model) => model.id);
};

/** Full list of model ids the connection can serve (chat + non-chat). */
export const modelIdsFor = (
  id: ProviderId,
  connections: Record<ProviderId, ProviderConnection>,
): string[] => {
  const connection = connections[id];
  const preset = providerPreset(id);
  const discoveredAll = connection.discoveredModels.map((model) => model.id);
  const base = resolveBaseConnectionModelIds(preset, connection, discoveredAll);
  const extra = connection.extraModels
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => normalizeExtraModelEntry(id, raw));
  return [...new Set([...base, ...extra])];
};

/** Evaluates whether a single model id belongs in `chatModelIdsFor`. */
const shouldIncludeInChatModels = (
  id: ProviderId,
  discoveredChat: Set<string>,
  discoveredNonChat: Set<string>,
  modelId: string,
): boolean => {
  if (discoveredChat.has(modelId)) return true;
  if (discoveredNonChat.has(modelId)) return false;
  return !catalogGetModelMetadata(modelId, id).nonChat;
};

/** Chat-capable subset of {@link modelIdsFor} (embeddings/audio filtered out). */
export const chatModelIdsFor = (
  id: ProviderId,
  connections: Record<ProviderId, ProviderConnection>,
): string[] => {
  const connection = connections[id];
  const all = modelIdsFor(id, connections);
  const discoveredChat = new Set(
    connection.discoveredModels
      .filter((model) => !model.nonChat)
      .map((model) => model.id),
  );
  const discoveredNonChat = new Set(
    connection.discoveredModels
      .filter((model) => model.nonChat)
      .map((model) => model.id),
  );
  return all.filter((modelId) =>
    shouldIncludeInChatModels(
      id,
      discoveredChat,
      discoveredNonChat,
      modelId,
    ),
  );
};

/** Subset of chat-capable models the user has not hidden from pickers. */
export const visibleModelIdsFor = (
  id: ProviderId,
  connections: Record<ProviderId, ProviderConnection>,
): string[] => {
  const hidden = new Set(connections[id]?.hiddenModels ?? []);
  return chatModelIdsFor(id, connections).filter(
    (modelId) => !hidden.has(modelId),
  );
};

/** Toggle a single model's visibility in pickers. */
export const withModelVisibility = (
  connection: ProviderConnection,
  modelId: string,
  visible: boolean,
): ProviderConnection => {
  const hidden = new Set(connection.hiddenModels);
  if (visible) hidden.delete(modelId);
  else hidden.add(modelId);
  return { ...connection, hiddenModels: [...hidden] };
};

/** Infers default `toolUse` capability for a known preset model entry. */
const inferKnownToolUse = (id: string, known: ModelMeta): boolean =>
  known.toolUse ?? (!known.reasoning || /o3|o4/i.test(id));

/** Infers capability flags when the catalog has no exact record for `id`. */
const inferCapabilities = (
  id: string,
  known?: ModelMeta,
): ModelCapabilities => {
  if (known) {
    return {
      vision: known.vision ?? VISION_MODEL_RE.test(id),
      toolUse: inferKnownToolUse(id, known),
      reasoning: known.reasoning ?? REASONING_MODEL_RE.test(id),
    };
  }
  return {
    vision: VISION_MODEL_RE.test(id),
    toolUse: TOOL_USE_MODEL_RE.test(id) && !NON_TOOL_MODEL_RE.test(id),
    reasoning: REASONING_MODEL_RE.test(id),
  };
};

/** Resolves the display name for a model identifier when absent from built-in presets. */
const fallbackModelDisplayName = (id: string): string => {
  const tail = id.split("/").slice(1).join("/");
  return tail ? tail : id;
};

/** Resolves the best display name across catalog metadata, preset metadata, and raw slug. */
const resolveModelDisplayName = (
  slug: string,
  known: ModelMeta | undefined,
  catMeta: ReturnType<typeof catalogGetModelMetadata>,
): string => {
  const catName = catMeta.source !== "inferred" ? catMeta.name : "";
  if (catName && catName.toLowerCase() !== slug.toLowerCase()) return catName;
  return known?.name ?? slug;
};

/** Resolves the context window label across catalog metadata and preset metadata. */
const resolveModelContextLabel = (
  known: ModelMeta | undefined,
  catMeta: ReturnType<typeof catalogGetModelMetadata>,
): string => {
  if (catMeta.source !== "inferred" && catMeta.contextWindowLabel) {
    return catMeta.contextWindowLabel;
  }
  return known?.contextWindow ?? "";
};

/** Resolves `ModelCapabilities` from catalog metadata or heuristic inference. */
const resolveModelCapabilities = (
  id: string,
  known: ModelMeta | undefined,
  catMeta: ReturnType<typeof catalogGetModelMetadata>,
): ModelCapabilities =>
  catMeta.source !== "inferred"
    ? {
        vision: catMeta.vision,
        toolUse: catMeta.toolUse,
        reasoning: catMeta.reasoning,
      }
    : inferCapabilities(id, known);

/** Builds a normalized `ModelOption` descriptor from a raw model identifier. */
export const modelOption = (id: string): ModelOption => {
  const prefix = id.split("/")[0] ?? "";
  const providerId = canonicalProviderId(prefix) ?? ("custom" as ProviderId);
  const preset = PROVIDER_PRESETS.find((entry) => entry.id === providerId);
  const known = preset?.models.find((entry) => entry.id === id);
  const catMeta = catalogGetModelMetadata(id, providerId);
  const slug = fallbackModelDisplayName(id);
  return {
    id,
    name: resolveModelDisplayName(slug, known, catMeta),
    provider: preset?.label ?? "Custom",
    providerId: preset?.id ?? "custom",
    contextWindow: resolveModelContextLabel(known, catMeta),
    capabilities: resolveModelCapabilities(id, known, catMeta),
  };
};

/** Appends visible chat `ModelOption` entries for `presetId` into `out`. */
const appendModelsForPreset = (
  presetId: ProviderId,
  connections: Record<ProviderId, ProviderConnection>,
  out: ModelOption[],
): void => {
  for (const id of visibleModelIdsFor(presetId, connections)) {
    const option = modelOption(id);
    if (option.name) out.push(option);
  }
};

/** Every model the user can pick right now, respecting per-model visibility. */
export const availableModels = (settings: ProvidersSettings): ModelOption[] => {
  const out: ModelOption[] = [];
  for (const preset of PROVIDER_PRESETS) {
    if (isConnectionUsable(preset.id, settings.connections)) {
      appendModelsForPreset(preset.id, settings.connections, out);
    }
  }
  return out;
};

/** Every chat-capable model ID across usable connections regardless of picker `hiddenModels`. */
const routableChatModelIds = (settings: ProvidersSettings): string[] => {
  const out: string[] = [];
  for (const preset of PROVIDER_PRESETS) {
    if (isConnectionUsable(preset.id, settings.connections)) {
      out.push(...chatModelIdsFor(preset.id, settings.connections));
    }
  }
  return out;
};

/** Has any usable provider with at least one chat-capable model ID (even if hidden in pickers). */
export const hasAnyUsableProvider = (settings: ProvidersSettings): boolean =>
  routableChatModelIds(settings).length > 0;

/** True when at least one connection is enabled and usable (with credentials or keyless auth). */
export const hasAnyConfiguredConnection = (
  settings: ProvidersSettings,
): boolean =>
  PROVIDER_PRESETS.some((preset) =>
    isConnectionUsable(preset.id, settings.connections),
  );

/** Checks whether `conn` has any configured, discovered, or preset model IDs. */
const connectionHasAnyModelId = (
  preset: ProviderPreset,
  conn: ProviderConnection,
): boolean =>
  Boolean(
    preset.models.length ||
      conn.models.length ||
      conn.extraModels.length ||
      conn.discoveredModels.length,
  );

/** Checks whether an enabled connection already has credentials or keyless auth and lacks only `baseUrl`. */
const isAuthenticatedMissingBaseUrl = (
  preset: ProviderPreset,
  conn: ProviderConnection | undefined,
): conn is ProviderConnection => {
  if (!conn?.enabled || !preset.needsBaseUrl || Boolean(conn.baseUrl.trim())) {
    return false;
  }
  return (
    Boolean(conn.apiKey.trim()) ||
    connectionAllowsKeylessAuth(preset.id, preset, conn)
  );
};

/** Resolves missing-base-URL setup guidance when an authenticated connection still needs an endpoint. */
const findMissingBaseUrlSetupGap = (
  settings: ProvidersSettings,
): string | null => {
  for (const preset of PROVIDER_PRESETS) {
    const conn = settings.connections[preset.id];
    if (isAuthenticatedMissingBaseUrl(preset, conn)) {
      return connectionHasAnyModelId(preset, conn)
        ? "Set a base URL in Settings -> Providers"
        : "Set a base URL and model ID in Settings -> Providers";
    }
  }
  return null;
};

/** Checks whether a keyless connection holds user-saved or discovered model entries. */
const hasSavedKeylessModels = (conn: ProviderConnection): boolean =>
  [conn.models, conn.extraModels, conn.discoveredModels].some(
    (list) => (list?.length ?? 0) > 0,
  );

/** Checks whether a keyless connection holds user-saved endpoint or model configuration. */
const hasSavedKeylessProviderConfig = (
  preset: ProviderPreset,
  conn: ProviderConnection,
): boolean => {
  if (!connectionAllowsKeylessAuth(preset.id, preset, conn)) return false;
  return preset.needsBaseUrl
    ? Boolean(conn.baseUrl.trim())
    : hasSavedKeylessModels(conn);
};

/** Checks whether a disabled connection already holds a saved API key or user-configured keyless setup. */
const hasDisabledSavedProvider = (
  preset: ProviderPreset,
  conn: ProviderConnection | undefined,
): boolean => {
  if (!conn || conn.enabled) return false;
  return (
    Boolean(conn.apiKey.trim()) || hasSavedKeylessProviderConfig(preset, conn)
  );
};

/** Resolves enable-provider guidance when credentials are already saved on a disabled provider. */
const findDisabledSavedProviderGap = (
  settings: ProvidersSettings,
): string | null =>
  PROVIDER_PRESETS.some((preset) =>
    hasDisabledSavedProvider(preset, settings.connections[preset.id]),
  )
    ? "Enable a provider in Settings -> Providers"
    : null;

/** Diagnostics for why no provider model is currently routable, or `null` when ready. */
export const providerSetupIssue = (
  settings: ProvidersSettings,
): "missing-models" | "missing-credentials" | null => {
  if (hasAnyUsableProvider(settings)) return null;
  return hasAnyConfiguredConnection(settings)
    ? "missing-models"
    : "missing-credentials";
};

/** User-facing guidance string explaining which provider setting is still required. */
export const describeProviderSetupGap = (
  settings: ProvidersSettings,
): string => {
  if (hasAnyConfiguredConnection(settings)) {
    return "Add a model ID in Settings -> Providers";
  }
  return (
    findMissingBaseUrlSetupGap(settings) ??
    findDisabledSavedProviderGap(settings) ??
    "Add an API key in Settings -> Providers"
  );
};

/** Checks whether `wanted` names a specific explicit model ID in `routableIds`. */
const isExplicitRoutableModel = (
  wanted: string,
  routableIds: readonly string[],
): boolean =>
  Boolean(wanted) &&
  wanted !== "auto" &&
  wanted !== "ask" &&
  routableIds.includes(wanted);

/** Picks the first visible model ID, falling back to the first routable chat model ID. */
const pickFirstRoutableModelId = (
  visible: readonly ModelOption[],
  routableIds: readonly string[],
): string | null => {
  if (visible.length > 0) return visible[0].id;
  return routableIds.length > 0 ? routableIds[0] : null;
};

/** Concrete model ID that `"auto"` routes to right now, or `null` when none is routable. */
export const resolveActiveDefaultModelId = (
  settings: ProvidersSettings,
): string | null => {
  if (settings.chatMode === "ask") return null;
  const routable = routableChatModelIds(settings);
  const wanted = translateModelId(settings.chatMode.trim());
  if (isExplicitRoutableModel(wanted, routable)) return wanted;
  return pickFirstRoutableModelId(availableModels(settings), routable);
};

/** Providers that can embed, in the order the app prefers to route to them. */
export const embeddingProviders = (
  settings: ProvidersSettings,
): ProviderId[] =>
  PROVIDER_PRESETS.filter(
    (preset) =>
      preset.embeddings === true &&
      isConnectionUsable(preset.id, settings.connections),
  ).map((preset) => preset.id);

/** Converts a `provider/model` id into the wire slug `targetProvider` expects. */
const embeddingSlugFor = (
  targetProvider: ProviderId,
  modelId: string,
): string => {
  const id = modelId.trim();
  if (!id) return "";
  const ownPrefix = `${targetProvider}/`;
  return id.startsWith(ownPrefix) ? id.slice(ownPrefix.length) : id;
};

/** Picks `openai`, then `openrouter`, then the first candidate provider ID. */
const selectPreferredEmbeddingProvider = (
  ids: ProviderId[],
): ProviderId | undefined =>
  ids.find((id) => id === "openai") ??
  ids.find((id) => id === "openrouter") ??
  ids[0];

/** Collects discovered embedding model IDs reported on `conn`. */
const collectDiscoveredEmbeddingIds = (
  conn: ProviderConnection | undefined,
): string[] =>
  (conn?.discoveredModels ?? [])
    .filter((entry) => entry.nonChat && EMBEDDING_ID_RE.test(entry.id))
    .map((entry) => entry.id);

/** Checks whether any entry in `extraModels` matches `model` verbatim or after prefix normalization. */
const extraModelsAdvertiseModel = (
  id: ProviderId,
  extraModels: string[],
  model: string,
): boolean =>
  extraModels.some((raw) => {
    const trimmed = raw.trim();
    if (!trimmed) return false;
    return trimmed === model || normalizeExtraModelEntry(id, trimmed) === model;
  });

/** Checks whether `list` contains any model id in `candidates`. */
const listIncludesAnyCandidate = (
  list: readonly string[],
  candidates: readonly string[],
): boolean => candidates.some((candidate) => list.includes(candidate));

/** Checks whether `conn` explicitly pins or adds `chosen` or its provider variants. */
const connectionPinsEmbeddingModel = (
  id: ProviderId,
  conn: ProviderConnection | undefined,
  chosen: string,
  candidates: readonly string[],
): boolean => {
  if (!conn) return false;
  return (
    listIncludesAnyCandidate(conn.models, candidates) ||
    extraModelsAdvertiseModel(id, conn.extraModels, chosen)
  );
};

/** Checks whether `pid` advertises `chosen` via preset, discovery, or user model lists. */
const providerOffersEmbeddingModel = (
  settings: ProvidersSettings,
  pid: ProviderId,
  chosen: string,
): boolean => {
  const conn = settings.connections[pid];
  const presetEmbeds = providerPreset(pid).embeddingModels ?? [];
  const native = embeddingSlugFor(pid, chosen);
  const prefixed = chosen.includes("/") ? chosen : `${pid}/${chosen}`;
  const candidates = [native, chosen, prefixed];
  return (
    listIncludesAnyCandidate(presetEmbeds, [native, chosen]) ||
    listIncludesAnyCandidate(collectDiscoveredEmbeddingIds(conn), candidates) ||
    connectionPinsEmbeddingModel(pid, conn, chosen, candidates)
  );
};

/** Resolves an explicit `provider/` prefix on `chosen` when that wire connection is usable. */
const resolveExplicitPrefixedWireOwner = (
  chosen: string,
  wireIds: ProviderId[],
): ProviderId | undefined => {
  const slashIdx = chosen.indexOf("/");
  if (slashIdx <= 0) return undefined;
  const explicitId = canonicalProviderId(chosen.slice(0, slashIdx));
  return explicitId && wireIds.includes(explicitId) ? explicitId : undefined;
};

/** Picks a usable custom or local runtime when `chosen` is a free-form unadvertised slug. */
const selectOpenEndedEmbeddingWire = (
  wireIds: ProviderId[],
): ProviderId | undefined =>
  wireIds.find((id) => {
    const preset = providerPreset(id);
    return (
      preset.embeddings === true && (preset.embeddingModels ?? []).length === 0
    );
  }) ?? wireIds.find((id) => providerPreset(id).models.length === 0);

/** Selects the best wire owner for `chosen` across explicit prefix, catalog, open runtime, and fallback. */
const selectEmbeddingWireOwner = (
  settings: ProvidersSettings,
  wireIds: ProviderId[],
  chosen: string,
): ProviderId | undefined =>
  resolveExplicitPrefixedWireOwner(chosen, wireIds) ??
  wireIds.find((pid) => providerOffersEmbeddingModel(settings, pid, chosen)) ??
  selectOpenEndedEmbeddingWire(wireIds) ??
  selectPreferredEmbeddingProvider(wireIds);

/** Resolves the OpenAI-wire provider that should serve an explicitly chosen embedding model. */
const resolveChosenEmbeddingTarget = (
  settings: ProvidersSettings,
  wireIds: ProviderId[],
  chosen: string,
): { id: ProviderId; model: string } | null => {
  if (wireIds.length === 0) return null;
  const owner = selectEmbeddingWireOwner(settings, wireIds, chosen);
  return owner ? { id: owner, model: embeddingSlugFor(owner, chosen) } : null;
};

/** Provider that will serve the semantic index, plus the model id to send. */
export const embeddingsTarget = (
  settings: ProvidersSettings,
): { id: ProviderId; model: string } | null => {
  const wireIds = PROVIDER_PRESETS.filter(
    (preset) =>
      preset.kind === "openai" &&
      isConnectionUsable(preset.id, settings.connections),
  ).map((preset) => preset.id);
  const chosen = modelForFeature(settings, "embeddings").trim();
  if (chosen) {
    return resolveChosenEmbeddingTarget(settings, wireIds, chosen);
  }
  const known = wireIds.filter((id) => providerPreset(id).embeddings === true);
  const preferred = selectPreferredEmbeddingProvider(known);
  if (!preferred) return null;
  const fallback = providerPreset(preferred).embeddingModels?.[0] ?? "";
  return fallback ? { id: preferred, model: fallback } : null;
};

/** Prepends the normalized wire slug for `chosen` onto `presets` when absent. */
const prependChosenEmbeddingOption = (
  settings: ProvidersSettings,
  presets: string[],
  chosen: string,
): void => {
  if (!chosen) return;
  const owner = embeddingsTarget(settings)?.id;
  const normalised = owner ? embeddingSlugFor(owner, chosen) : chosen;
  if (!presets.includes(normalised)) presets.unshift(normalised);
};

/** Collects available embedding model identifiers across configured providers. */
export const embeddingModelOptions = (
  settings: ProvidersSettings,
): string[] => {
  const presets: string[] = [];
  for (const id of embeddingProviders(settings)) {
    presets.push(...(providerPreset(id).embeddingModels ?? []));
    const discovered = collectDiscoveredEmbeddingIds(
      settings.connections[id],
    ).map((modelId) => embeddingSlugFor(id, modelId));
    presets.push(...discovered);
  }
  prependChosenEmbeddingOption(
    settings,
    presets,
    modelForFeature(settings, "embeddings").trim(),
  );
  return [...new Set(presets.filter(Boolean))];
};

/** True when the semantic index has somewhere to run. */
export const embeddingsAvailable = (settings: ProvidersSettings): boolean =>
  embeddingsTarget(settings) !== null;

/** Resolve the concrete chat model for the Rust side, matching the UI Auto target. */
const resolveDefaultModel = (settings: ProvidersSettings): string =>
  resolveActiveDefaultModelId(settings) ?? "";

/** Builds a single `RustAiProviderEntry` for a usable provider connection. */
const buildRustProviderEntry = (
  preset: ProviderPreset,
  connection: ProviderConnection,
  connections: Record<ProviderId, ProviderConnection>,
): RustAiProviderEntry => {
  const trimmedBase = connection.baseUrl.trim();
  return {
    id: preset.id,
    kind: preset.kind,
    label: preset.label,
    apiKey: connection.apiKey.trim(),
    baseUrl: trimmedBase ? trimmedBase : preset.baseUrl,
    models: chatModelIdsFor(preset.id, connections),
    enabled: connection.enabled,
    keyless: preset.keyless === true,
    headers: providerHeaders(preset.id, connection),
    authStyle: providerAuthStyle(preset.id, connection),
  };
};

/** Collects `RustAiProviderEntry` items for every currently usable provider preset. */
const collectUsableRustProviders = (
  settings: ProvidersSettings,
): RustAiProviderEntry[] => {
  const providers: RustAiProviderEntry[] = [];
  for (const preset of PROVIDER_PRESETS) {
    const connection = settings.connections[preset.id];
    if (connection && isConnectionUsable(preset.id, settings.connections)) {
      providers.push(
        buildRustProviderEntry(preset, connection, settings.connections),
      );
    }
  }
  return providers;
};

/** Resolves the Composio user ID with `"bettershape-local"` fallback when blank. */
const resolveComposioUserId = (rawUserId: string): string => {
  const trimmed = rawUserId.trim();
  return trimmed ? trimmed : "bettershape-local";
};

/** Converts frontend provider settings into the Rust backend `AiConfig` wire payload. */
export const toRustAiConfig = (settings: ProvidersSettings): RustAiConfig => {
  const providers = collectUsableRustProviders(settings);
  const embeddingTarget = embeddingsTarget(settings);

  return {
    providers,
    defaultModel: resolveDefaultModel(settings),
    embeddingModel: embeddingTarget?.model ?? "",
    embeddingProvider: embeddingTarget?.id ?? "",
    search: {
      provider: settings.services.search.provider,
      apiKey: settings.services.search.apiKey.trim(),
    },
    composio: {
      apiKey: settings.services.composio.apiKey.trim(),
      userId: resolveComposioUserId(settings.services.composio.userId),
    },
  };
};

/* -------------------------------------------------------------------------- */
/* Secret handling                                                            */
/* -------------------------------------------------------------------------- */

/** Keychain id for one header value: gateways keep tokens in headers. */
export const headerSecretId = (id: ProviderId, name: string): string =>
  `header:${id}:${name}`;

/** Split a header secret id back into `(provider, header name)`. */
export const parseHeaderSecretId = (
  secretId: string,
): { id: ProviderId; name: string } | null => {
  if (!secretId.startsWith("header:")) return null;
  const rest = secretId.slice("header:".length);
  const separator = rest.indexOf(":");
  if (separator <= 0) return null;
  return {
    id: rest.slice(0, separator) as ProviderId,
    name: rest.slice(separator + 1),
  };
};

/** Strips trailing `/` characters from an endpoint URL string. */
const trimTrailingSlashes = (url: string): string => {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end -= 1;
  return url.slice(0, end);
};

/** Computes the serialized credential vault scope string for one `preset` + `connection`. */
const formatConnectionScope = (
  preset: ProviderPreset,
  connection: ProviderConnection,
): string => {
  const trimmedCustom = connection.baseUrl.trim();
  const baseUrl = trimTrailingSlashes(
    trimmedCustom ? trimmedCustom : preset.baseUrl,
  );
  return JSON.stringify([
    "provider-v1",
    preset.kind,
    baseUrl,
    providerAuthStyle(preset.id, connection),
  ]);
};

/** Versioned destination identities, persisted with credentials inside the vault. */
export const credentialScopes = (
  settings: ProvidersSettings,
): Record<string, string> => {
  const scopes: Record<string, string> = {};
  for (const preset of PROVIDER_PRESETS) {
    const connection = settings.connections[preset.id];
    if (!connection) continue;
    const scope = formatConnectionScope(preset, connection);
    scopes[preset.id] = scope;
    for (const name of Object.keys(connection.headers)) {
      scopes[headerSecretId(preset.id, name)] = scope;
    }
  }
  scopes[SEARCH_SECRET_ID] = JSON.stringify([
    "search-v1",
    settings.services.search.provider,
  ]);
  scopes[COMPOSIO_SECRET_ID] = JSON.stringify([
    "composio-v1",
    resolveComposioUserId(settings.services.composio.userId),
  ]);
  return scopes;
};

/** Records API key and non-empty custom header secrets for `presetId` into `out`. */
const collectConnectionSecrets = (
  presetId: ProviderId,
  connection: ProviderConnection | undefined,
  out: Record<string, string>,
): void => {
  if (!connection) return;
  const key = connection.apiKey.trim();
  if (key) out[presetId] = key;
  for (const [name, value] of Object.entries(connection.headers)) {
    const trimmed = value.trim();
    if (trimmed) out[headerSecretId(presetId, name)] = trimmed;
  }
};

/** Every secret the provider settings currently hold, keyed by storage id. */
export const providerSecrets = (
  settings: ProvidersSettings,
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const preset of PROVIDER_PRESETS) {
    collectConnectionSecrets(
      preset.id,
      settings.connections[preset.id],
      out,
    );
  }
  const search = settings.services.search.apiKey.trim();
  if (search) out[SEARCH_SECRET_ID] = search;
  const composio = settings.services.composio.apiKey.trim();
  if (composio) out[COMPOSIO_SECRET_ID] = composio;
  return out;
};

/** Keep header names, drop the values (they live in the keychain). */
export const blankHeaderValues = (
  headers: Record<string, string> | undefined,
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const name of Object.keys(headers ?? {})) out[name] = "";
  return out;
};

/** A copy safe to write to disk: the OS keychain owns the secrets. */
export const redactProviderSecrets = <
  T extends { ai: { providers: ProvidersSettings } },
>(
  settings: T,
): T => {
  const connections = {} as Record<ProviderId, ProviderConnection>;
  for (const preset of PROVIDER_PRESETS) {
    const connection = settings.ai.providers.connections[preset.id];
    connections[preset.id] = connection
      ? {
          ...connection,
          apiKey: "",
          headers: blankHeaderValues(connection.headers),
        }
      : emptyConnection(preset);
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
};

/** Builds a lowercased header-name -> live-value map for case-insensitive secret hydration. */
const buildLowercaseHeaderValueMap = (
  headers: Record<string, string> | undefined,
): Map<string, string> => {
  const map = new Map<string, string>();
  for (const [name, value] of Object.entries(headers ?? {})) {
    map.set(name.toLowerCase(), value);
  }
  return map;
};

/** Incoming header names with whatever values only this session still holds. */
const mergeHeaderValues = (
  live: Record<string, string> | undefined,
  incoming: Record<string, string> | undefined,
): Record<string, string> => {
  const liveByLower = buildLowercaseHeaderValueMap(live);
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(incoming ?? {})) {
    out[name] = value.trim()
      ? value
      : (liveByLower.get(name.toLowerCase()) ?? "");
  }
  return out;
};

/** Checks whether `connection` holds an in-memory API key or non-empty header secret. */
const hasInMemorySecret = (connection: ProviderConnection): boolean =>
  Boolean(connection.apiKey.trim()) ||
  Object.values(connection.headers).some((value) => Boolean(value.trim()));

/** Checks whether `current` holds live secrets under a changed credential scope. */
const shouldPreserveLiveScopedConnection = (
  current: ProviderConnection,
  scopeChanged: boolean,
): boolean => scopeChanged && hasInMemorySecret(current);

/** Merges one provider's in-memory secrets onto a freshly loaded connection record. */
const mergeSingleProviderConnection = (
  current: ProviderConnection | undefined,
  incoming: ProviderConnection,
  scopeChanged: boolean,
): ProviderConnection => {
  if (current && shouldPreserveLiveScopedConnection(current, scopeChanged)) {
    return {
      ...incoming,
      apiKey: current.apiKey,
      baseUrl: current.baseUrl,
      authStyle: current.authStyle,
      headers: current.headers,
    };
  }
  const fallbackKey = current?.apiKey ?? "";
  return {
    ...incoming,
    apiKey: incoming.apiKey.trim() ? incoming.apiKey : fallbackKey,
    headers: mergeHeaderValues(current?.headers, incoming.headers),
  };
};

/** Merges a service secret (`search` or `composio`) preserving live keys across scope changes. */
const mergeScopedServiceEntry = <T extends { apiKey: string }>(
  liveEntry: T,
  loadedEntry: T,
  scopeChanged: boolean,
): T => {
  if (liveEntry.apiKey && scopeChanged) return liveEntry;
  return {
    ...loadedEntry,
    apiKey: loadedEntry.apiKey.trim()
      ? loadedEntry.apiKey
      : liveEntry.apiKey,
  };
};

/** Fill secrets that only exist in memory back into a freshly loaded copy. */
export const mergeProviderConnections = (
  live: ProvidersSettings,
  loaded: ProvidersSettings,
): ProvidersSettings => {
  const connections = {} as Record<ProviderId, ProviderConnection>;
  const liveScopes = credentialScopes(live);
  const loadedScopes = credentialScopes(loaded);
  for (const preset of PROVIDER_PRESETS) {
    const incoming = loaded.connections[preset.id] ?? emptyConnection(preset);
    connections[preset.id] = mergeSingleProviderConnection(
      live.connections[preset.id],
      incoming,
      liveScopes[preset.id] !== loadedScopes[preset.id],
    );
  }
  return {
    ...loaded,
    connections,
    services: {
      search: mergeScopedServiceEntry(
        live.services.search,
        loaded.services.search,
        liveScopes[SEARCH_SECRET_ID] !== loadedScopes[SEARCH_SECRET_ID],
      ),
      composio: mergeScopedServiceEntry(
        live.services.composio,
        loaded.services.composio,
        liveScopes[COMPOSIO_SECRET_ID] !== loadedScopes[COMPOSIO_SECRET_ID],
      ),
    },
  };
};

/* -------------------------------------------------------------------------- */
/* Key sanity checks                                                          */
/* -------------------------------------------------------------------------- */

/** Which provider a pasted key *looks* like it belongs to. Advisory only. */
export const keyOwnerHint = (
  apiKey: string,
): { id: ProviderId; label: string } | null => {
  const key = apiKey.trim();
  if (key.length < 12) return null;
  for (const { id, prefix } of KEY_PREFIXES) {
    if (key.startsWith(prefix)) return { id, label: providerPreset(id).label };
  }
  return null;
};

/** Checks whether `ownerId` and `targetId` are distinct non-sibling providers. */
const isForeignProviderOwner = (
  ownerId: ProviderId,
  targetId: ProviderId,
): boolean =>
  ownerId !== targetId &&
  !(SIBLING_PROVIDERS[ownerId] ?? []).includes(targetId);

/** Resolves expected prefix mismatch message when `id` has a known fixed key format. */
const expectedPrefixMismatchWarning = (
  id: ProviderId,
  key: string,
): string | null => {
  const expected = KEY_PREFIXES.find((entry) => entry.id === id);
  if (!expected || key.startsWith(expected.prefix)) return null;
  return `${providerPreset(id).label} keys start with ${expected.prefix} - double-check the value.`;
};

/** One-line warning for the field the user is typing in, or null when plausible. */
export const keyFormatWarning = (
  id: ProviderId,
  apiKey: string,
): string | null => {
  const key = apiKey.trim();
  if (!key) return null;
  const owner = keyOwnerHint(key);
  if (owner && isForeignProviderOwner(owner.id, id)) {
    return `This looks like a ${owner.label} key - paste it into the ${owner.label} card instead.`;
  }
  return expectedPrefixMismatchWarning(id, key);
};

/** Same idea for the web-search keys, whose formats are also fixed. */
export const searchKeyWarning = (
  provider: (typeof SEARCH_PROVIDERS)[number]["id"],
  apiKey: string,
): string | null => {
  const key = apiKey.trim();
  const rule = SEARCH_KEY_PREFIX_REQUIREMENTS[provider];
  if (!key || !rule || key.startsWith(rule.prefix)) return null;
  return rule.message;
};

/** `sk-abc…1234` - enough to recognise a key without showing it in full. */
export const maskApiKey = (apiKey: string): string => {
  const key = apiKey.trim();
  if (key.length <= 10) return key ? `${key.slice(0, 2)}…` : "";
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
};

/* -------------------------------------------------------------------------- */
/* Model ids arriving from somewhere else                                      */
/* -------------------------------------------------------------------------- */

/** Extracts the trailing `/`-delimited segment of a model identifier. */
const extractLastPathSegment = (value: string): string => {
  const slash = value.lastIndexOf("/");
  return slash === -1 ? value : value.slice(slash + 1);
};

/** Strips a leading `provider/` namespace when present on a lowercased model query. */
const stripLeadingNamespace = (name: string): string =>
  name.includes("/") ? name.slice(name.indexOf("/") + 1) : name;

/** Checks whether a single preset model matches any requested `needles` or 6+ char `tails`. */
const presetModelMatchesNeedles = (
  model: { id: string; name: string },
  needles: string[],
  tails: Set<string>,
): boolean => {
  const slug = model.id.slice(model.id.indexOf("/") + 1).toLowerCase();
  const displayName = model.name.toLowerCase();
  if (
    needles.some(
      (needle) =>
        slug === needle ||
        displayName === needle ||
        displayName.includes(needle),
    )
  ) {
    return true;
  }
  const tail = extractLastPathSegment(slug);
  return tail.length >= 6 && tails.has(tail);
};

/** Maps routable `modelIdsFor` entries onto `{ id, name }` candidates using preset display names when known. */
const collectPresetCandidateModels = (
  preset: ProviderPreset,
  connections: Record<ProviderId, ProviderConnection>,
): Array<{ id: string; name: string }> => {
  const configuredIds = modelIdsFor(preset.id, connections);
  if (configuredIds.length === 0) return [];
  const presetNameById = new Map(
    preset.models.map((model) => [model.id, model.name] as const),
  );
  return configuredIds.map((id) => ({
    id,
    name: presetNameById.get(id) ?? fallbackModelDisplayName(id),
  }));
};

/** Checks whether `conn` holds either an API key or configured keyless endpoint/models. */
const hasEnableableCredentials = (
  preset: ProviderPreset,
  conn: ProviderConnection | undefined,
): conn is ProviderConnection => {
  if (!conn) return false;
  return (
    Boolean(conn.apiKey.trim()) || hasSavedKeylessProviderConfig(preset, conn)
  );
};

/** Checks whether `preset` is usable now or already configured with credentials to be enabled. */
const canEnableMatchingPreset = (
  preset: ProviderPreset,
  connections: Record<ProviderId, ProviderConnection>,
): boolean => {
  if (isConnectionUsable(preset.id, connections)) return true;
  const conn = connections[preset.id];
  if (!hasEnableableCredentials(preset, conn)) return false;
  return preset.needsBaseUrl ? Boolean(conn.baseUrl.trim()) : true;
};

/** Checks whether `preset` has built-in or configured models matching `needles` / `tails`. */
const isMatchingPreset = (
  preset: ProviderPreset,
  needles: string[],
  tails: Set<string>,
  connections: Record<ProviderId, ProviderConnection>,
): boolean => {
  if (
    preset.models.length === 0 &&
    !canEnableMatchingPreset(preset, connections)
  ) {
    return false;
  }
  const candidates = collectPresetCandidateModels(preset, connections);
  if (candidates.length === 0) return false;
  return candidates.some((model) =>
    presetModelMatchesNeedles(model, needles, tails),
  );
};

/** Model names a pasted config mentions, mapped onto matching provider ids. */
export const providersForModelNames = (
  names: string[],
  connections: Record<ProviderId, ProviderConnection>,
): ProviderId[] => {
  const needles = names
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
    .map(stripLeadingNamespace);
  if (needles.length === 0) return [];
  const tails = new Set(
    needles.map(extractLastPathSegment).filter((tail) => tail.length >= 6),
  );
  return PROVIDER_PRESETS.filter((preset) =>
    isMatchingPreset(preset, needles, tails, connections),
  ).map((preset) => preset.id);
};

/** Subset of {@link providersForModelNames} that are already usable today. */
export const usableProvidersForModelNames = (
  names: string[],
  connections: Record<ProviderId, ProviderConnection>,
): ProviderId[] =>
  providersForModelNames(names, connections).filter((id) =>
    isConnectionUsable(id, connections),
  );

/* -------------------------------------------------------------------------- */
/* Model discovery                                                            */
/* -------------------------------------------------------------------------- */

/** Converts catalog metadata into the persisted `DiscoveredModelEntry` shape. */
const toDiscoveredEntry = (
  entry: ReturnType<typeof enrichDiscoveredModels>[number],
  now: number,
): DiscoveredModelEntry => ({
  id: entry.id,
  name: entry.name,
  contextWindow: entry.contextWindowLabel,
  contextTokens: entry.contextWindow || undefined,
  maxOutputTokens: entry.maxOutputTokens ?? undefined,
  inputCostPerM: entry.inputCostPerM ?? undefined,
  outputCostPerM: entry.outputCostPerM ?? undefined,
  vision: entry.vision,
  reasoning: entry.reasoning,
  toolUse: entry.toolUse,
  nonChat: entry.nonChat,
  source: entry.source,
  discoveredAt: now,
});

/** Convert raw ids the provider's `/models` returned into enriched `DiscoveredModelEntry` records. */
export const enrichDiscovered = (
  providerId: ProviderId,
  discoveredIds: string[],
): DiscoveredModelEntry[] => {
  const now = Date.now();
  return enrichDiscoveredModels(providerId, discoveredIds).map((entry) =>
    toDiscoveredEntry(entry, now),
  );
};

/** Return a copy of `connection` with its discovered-models list replaced. */
export const withDiscoveredModels = (
  connection: ProviderConnection,
  entries: DiscoveredModelEntry[],
): ProviderConnection => ({
  ...connection,
  discoveredModels: entries,
});

/** Persist raw provider-reported ids as discovered models on `connection`. */
export const withRefreshedModels = (
  connection: ProviderConnection,
  discoveredIds: string[],
  providerId: ProviderId,
): ProviderConnection => ({
  ...connection,
  discoveredModels: enrichDiscovered(providerId, discoveredIds),
});

/** Turn discovered native slugs into the `provider/model` ids the app stores. */
export const modelsWithProviderPrefix = (
  id: ProviderId,
  discovered: string[],
): string[] => {
  const out: string[] = [];
  for (const raw of discovered) {
    const slug = raw.trim();
    if (slug) out.push(slug.startsWith(`${id}/`) ? slug : `${id}/${slug}`);
  }
  return [...new Set(out)];
};

/** `provider/model` ids -> the raw slugs `extraModels` expects. */
export const stripProviderPrefix = (id: ProviderId, ids: string[]): string[] =>
  ids
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => (raw.startsWith(`${id}/`) ? raw.slice(id.length + 1) : raw))
    .filter((raw, index, all) => all.indexOf(raw) === index);
