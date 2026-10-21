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

import publicDefaultHeaders from "./provider-default-headers.json";
import {
    enrichDiscoveredModels,
    getModelMetadata as catalogGetModelMetadata,
    registerProviderLabels,
} from "./model-catalog";
import type { ProviderId as ProviderIdType } from "./provider-ids";

// Re-export for callers that already import from this module (eliminates the
// duplicate union that previously lived here and in provider-ids.ts).
export type ProviderId = ProviderIdType;

export type ProviderKind = "openai" | "anthropic" | "google";

/** Header the provider expects the API key in. */
export type AuthStyle = "bearer" | "api-key" | "x-api-key" | "x-goog-api-key" | "none";

export type ProviderPreset = {
  id: ProviderId;
  label: string;
  /** Short group heading in Settings → Providers. */
  group: string;
  kind: ProviderKind;
  baseUrl: string;
  /** Empty base URLs are user supplied (local runtimes, self-hosted gateways). */
  needsBaseUrl: boolean;
  keyHint: string;
  docsUrl: string;
  /** One line under the wire name: what this provider needs, or what it includes. */
  note?: string;
  /**
   * True when the endpoint answers without an API key: local runtimes, and
   * gateways with a free tier. Keyless providers ship turned off so a fresh
   * install never routes somewhere the user did not choose.
   */
  keyless?: boolean;
  /** Start disabled. Defaults to `keyless`. */
  defaultEnabled?: boolean;
  /** How the key travels. Defaults to `bearer` on the OpenAI wire. */
  authStyle?: AuthStyle;
  /**
   * Headers the gateway expects on every request (attribution, gateways with
   * their own auth header). User-added headers win on conflicts.
   */
  headers?: Record<string, string>;
  /**
   * True when this provider serves an OpenAI-compatible `/embeddings` endpoint
   * and the app therefore knows a default embedding model id for it. Providers
   * without it (Groq, xAI, DeepSeek) can still embed if the user types a model
   * id by hand — the indexer only guesses a default for the ones listed here.
   */
  embeddings?: boolean;
  /** Embedding model ids to offer for this provider. */
  embeddingModels?: string[];
  models: ModelMeta[];
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
  Object.fromEntries(PROVIDER_PRESETS.map((p) => [p.id, p.label])),
);

/** Presets in display order, bucketed by their `group` heading. */
export function providerGroups(): { group: string; presets: ProviderPreset[] }[] {
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
}

/** Free-text match over a preset's name, id, group and models. */
export function matchesProviderQuery(preset: ProviderPreset, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (
    preset.label.toLowerCase().includes(needle) ||
    preset.id.includes(needle) ||
    preset.group.toLowerCase().includes(needle)
  ) {
    return true;
  }
  return preset.models.some(
    (model) => model.id.toLowerCase().includes(needle) || model.name.toLowerCase().includes(needle),
  );
}

/** Returns the built-in preset metadata for a known AI provider identifier. */
export function providerPreset(id: ProviderId): ProviderPreset {
  return PROVIDER_PRESETS.find((p) => p.id === id) ?? PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1];
}

/** One user-configured connection. */
export type ProviderConnection = {
  /** Stored in the OS keychain, never in the settings file. */
  apiKey: string;
  /** Empty means "use the preset default". */
  baseUrl: string;
  enabled: boolean;
  /** Model ids the user pinned for this provider (empty = every preset model). */
  models: string[];
  /**
   * Model ids the user has hidden from pickers. Subset of the ids offered by
   * this connection (preset + extra + imported). Hidden models stay configured
   * so they can be re-enabled without reimporting.
   */
  hiddenModels: string[];
  /** Free-form model ids for providers without a preset list (custom). */
  extraModels: string[];
  /**
   * Model ids the provider reported on the most recent Test/Refresh, keyed by
   * id. Populated automatically when the user verifies the connection; used
   * to surface context window, pricing, and capability metadata that doesn't
   * ship in static presets. Empty until the user refreshes.
   */
  discoveredModels: DiscoveredModelEntry[];
  /**
   * Extra request headers, on top of the preset's own. Values are stored in the
   * keychain beside the API key, since gateways put tokens here.
   */
  headers: Record<string, string>;
  /** Override how the key travels. Empty means "use the preset default". */
  authStyle: AuthStyle | "";
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

/**
 * How Auto picks a model for a new chat.
 *   - "auto"       : first available model (the historical default)
 *   - "ask"        : prompt every new chat with the model picker (no auto-pick)
 *   - "<model id>" : fixed default model id
 */
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
  /**
   * Per-feature model overrides. Features absent from this list inherit the
   * chat default (or "auto" when chatMode is "auto"). `embeddings` always
   * falls back to a known embedding model when no id is set.
   */
  featureModels: FeatureModelAssignment[];
  services: AiServicesSettings;
};

export const SEARCH_PROVIDERS = [
  { id: "none", label: "Off", keyHint: "", docsUrl: "" },
  { id: "tavily", label: "Tavily", keyHint: "tvly-…", docsUrl: "https://app.tavily.com/home" },
  { id: "brave", label: "Brave Search", keyHint: "BSA…", docsUrl: "https://api-dashboard.search.brave.com/app/keys" },
] as const;

/** Creates a blank `ProviderConnection` initialized from optional preset defaults. */
function emptyConnection(preset?: ProviderPreset): ProviderConnection {
  return {
    apiKey: "",
    baseUrl: "",
    // Keyless endpoints are opt-in: a fresh install must not route to a local
    // runtime that is not running, or to a gateway's free tier unasked.
    enabled: preset ? (preset.defaultEnabled ?? !preset.keyless) : true,
    models: [],
    hiddenModels: [],
    extraModels: [],
    discoveredModels: [],
    headers: {},
    authStyle: "",
  };
}

/** Baseline per-feature assignment used by a fresh settings object. */
function emptyFeatureModels(): FeatureModelAssignment[] {
    return [
        { feature: "chat", modelId: "auto" },
        { feature: "agent", modelId: "" },
        { feature: "commits", modelId: "" },
        { feature: "embeddings", modelId: "" },
    ];
}
export function defaultProvidersSettings(): ProvidersSettings {
  const connections = {} as Record<ProviderId, ProviderConnection>;
  for (const preset of PROVIDER_PRESETS) connections[preset.id] = emptyConnection(preset);
  return {
    connections,
    chatMode: "auto",
    featureModels: emptyFeatureModels(),
    services: {
      search: { provider: "none", apiKey: "" },
      composio: { apiKey: "", userId: "" },
    },
  };
}

/** Resolve the model id currently assigned to a given feature, inheriting from chat default when empty. */
export function modelForFeature(settings: ProvidersSettings, feature: FeatureModel): string {
    if (feature === "chat") {
        return settings.chatMode === "ask" ? "" : (settings.chatMode || "auto");
    }
    const assignment = settings.featureModels.find((a) => a.feature === feature);
    const id = assignment?.modelId?.trim() ?? "";
    if (id) return id;
    if (feature === "embeddings") return "";
    // agent / commits fall back to chat default.
    return modelForFeature(settings, "chat");
}

/** Update one feature's assigned model id. */
export function withFeatureModel(
    settings: ProvidersSettings,
    feature: FeatureModel,
    modelId: string,
): ProvidersSettings {
    const others = settings.featureModels.filter((a) => a.feature !== feature);
    return { ...settings, featureModels: [...others, { feature, modelId }] };
}

export function setChatMode(settings: ProvidersSettings, mode: ChatMode): ProvidersSettings {
    return { ...settings, chatMode: mode };
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
    const savedModels = saved?.models;
    const savedExtra = saved?.extraModels;
    const savedAuth = saved?.authStyle;
    connections[preset.id] = {
      ...emptyConnection(preset),
      ...(saved ?? {}),
      models: Array.isArray(savedModels) ? savedModels.filter(Boolean) : [],
      hiddenModels: Array.isArray((saved as { hiddenModels?: string[] } | undefined)?.hiddenModels)
        ? ((saved as { hiddenModels?: string[] }).hiddenModels ?? []).filter(Boolean)
        : [],
      extraModels: Array.isArray(savedExtra) ? savedExtra.filter(Boolean) : [],
      discoveredModels: Array.isArray((saved as { discoveredModels?: DiscoveredModelEntry[] } | undefined)?.discoveredModels)
        ? ((saved as { discoveredModels?: DiscoveredModelEntry[] }).discoveredModels ?? []).filter(
            (m): m is DiscoveredModelEntry => !!m && typeof m === "object" && typeof m.id === "string",
          )
        : [],
      headers: normalizeHeaders(saved?.headers),
      authStyle: isAuthStyle(savedAuth) ? savedAuth : "",
    };
  }
  // One-way migration from the legacy flat fields.
  const legacyRaw = raw as Partial<ProvidersSettings> & { defaultModel?: string; embeddingModel?: string };
  const legacyDefault = legacyRaw.defaultModel?.trim();
  const legacyEmbedding = legacyRaw.embeddingModel?.trim();
  const chatMode: ChatMode =
    (raw.chatMode as ChatMode | undefined) ?? (legacyDefault === "__ask__" ? "ask" : legacyDefault && legacyDefault !== "auto" ? legacyDefault : "auto");
  const featureModels: FeatureModelAssignment[] = Array.isArray(raw.featureModels)
    ? raw.featureModels
        .filter(
          (a): a is FeatureModelAssignment =>
            !!a && typeof a === "object" && "feature" in a && "modelId" in a,
        )
        .filter((a) => ["chat", "agent", "commits", "embeddings"].includes(a.feature))
    : emptyFeatureModels();
  // Make sure every feature slot exists.
  const knownFeatures = new Set(featureModels.map((a) => a.feature));
  for (const slot of emptyFeatureModels()) {
    if (!knownFeatures.has(slot.feature)) featureModels.push({ ...slot });
  }
  // Migrate legacy embeddingModel into the embeddings slot if it's still empty.
  const embeddingsSlot = featureModels.find((a) => a.feature === "embeddings");
  if (embeddingsSlot && !embeddingsSlot.modelId && legacyEmbedding) {
    embeddingsSlot.modelId = legacyEmbedding;
  }
  return {
    connections,
    chatMode,
    featureModels,
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
export const isConnectionUsable = (id: ProviderId, connections: Record<ProviderId, ProviderConnection>): boolean => {
  const connection = connections[id];
  if (!connection?.enabled) return false;
  const preset = providerPreset(id);
  if (preset.needsBaseUrl && !connection.baseUrl.trim()) return false;
  // Local runtimes, gateways with a free tier, and self-hosted endpoints
  // configured with `authStyle: "none"` accept requests without an API key.
  if (!connection.apiKey.trim()) {
    return preset.keyless === true || providerAuthStyle(id, connection) === "none";
  }
  return true;
};

/** Request headers for a connection: preset defaults, then the user's own. */
export function providerHeaders(id: ProviderId, connection: ProviderConnection | undefined): Record<string, string> {
  const preset = providerPreset(id);
  const merged: Record<string, string> = { ...(preset.headers ?? {}), ...normalizeHeaders(connection?.headers) };
  // Drop entries the user blanked out with an empty value.
  for (const [name, value] of Object.entries(merged)) {
    if (!value.trim()) delete merged[name];
  }
  return merged;
}

/** How the key travels for this connection. */
export function providerAuthStyle(id: ProviderId, connection: ProviderConnection | undefined): AuthStyle {
  // Empty means "whatever this wire format normally does".
  if (connection?.authStyle && isAuthStyle(connection.authStyle)) return connection.authStyle;
  const preset = providerPreset(id);
  if (preset.authStyle) return preset.authStyle;
  if (preset.kind === "anthropic") return "x-api-key";
  if (preset.kind === "google") return "x-goog-api-key";
  return "bearer";
}

/** Drop junk header names, keep the last value for duplicates. */
export function normalizeHeaders(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    const header = name.trim();
    if (!header || typeof value !== "string") continue;
    out[header] = value.trim();
  }
  return out;
}

/** Type-guards whether an unknown value is a supported HTTP auth header style. */
function isAuthStyle(value: unknown): value is AuthStyle | "" {
  return (
    value === "" ||
    value === "bearer" ||
    value === "api-key" ||
    value === "x-api-key" ||
    value === "x-goog-api-key" ||
    value === "none"
  );
}

/** `Name: value` lines ⇄ the header map shown next to a provider. */
export function parseHeaderLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf(":");
    if (separator <= 0) continue;
    const name = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (name) out[name] = value;
  }
  return out;
}

/** Serializes custom HTTP header key-value pairs into newline-delimited `Key: Value` text. */
export function formatHeaderLines(headers: Record<string, string> | undefined): string {
  return Object.entries(headers ?? {})
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n");
}

/** Has any usable provider. */
export const hasAnyUsableProvider = (settings: ProvidersSettings): boolean => {
  return availableModels(settings).length > 0;
};

/** True when at least one connection is enabled and usable (with credentials or keyless auth), even if model IDs still need to be added. */
export const hasAnyConfiguredConnection = (settings: ProvidersSettings): boolean => {
  return PROVIDER_PRESETS.some((preset) => isConnectionUsable(preset.id, settings.connections));
};

/** Diagnostics for why no provider model is currently routable, or `null` when ready. */
export const providerSetupIssue = (
  settings: ProvidersSettings,
): "missing-models" | "missing-credentials" | null => {
  if (hasAnyUsableProvider(settings)) return null;
  return hasAnyConfiguredConnection(settings) ? "missing-models" : "missing-credentials";
};

/** Concrete model ID that `"auto"` routes to right now, or `null` when none is routable. */
export const resolveActiveDefaultModelId = (settings: ProvidersSettings): string | null => {
  const models = availableModels(settings);
  if (models.length === 0) return null;
  if (settings.chatMode === "ask") return null;
  const wanted = settings.chatMode.trim();
  if (wanted && wanted !== "auto" && models.some((m) => m.id === wanted)) {
    return wanted;
  }
  return models[0]?.id ?? null;
};

/** Capability flags for a model. All are best-effort heuristics when the provider
 *  does not advertise them — they drive UI badges and feature gating, never
 *  hard failures. */
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
  /** Supports tool/function calling. Defaults to true for modern chat models;
   *  set false explicitly for embedding/reasoning-only models. */
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

/**
 * Full list of model ids the connection can serve. Includes chat + non-chat
 * (embeddings, audio, …); callers that only want chat models should filter
 * via {@link chatModelIdsFor}.
 *
 * Precedence: user-pinned ids → discovered from the provider → hardcoded preset.
 * Extra free-form ids are always appended.
 */
export function modelIdsFor(id: ProviderId, connections: Record<ProviderId, ProviderConnection>): string[] {
  const connection = connections[id];
  const preset = providerPreset(id);
  const discoveredAll = connection.discoveredModels.map((m) => m.id);
  let base: string[];
  if (connection.models.length > 0) {
    base = connection.models;
  } else if (discoveredAll.length > 0) {
    base = discoveredAll;
  } else {
    base = preset.models.map((m) => m.id);
  }
  const extra = connection.extraModels
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      if (raw.startsWith(`${id}/`)) return raw;
      const slashIdx = raw.indexOf("/");
      const head = slashIdx > 0 ? raw.slice(0, slashIdx) : "";
      if (id !== "custom" && head && canonicalProviderId(head) === id) {
        return `${id}/${raw.slice(head.length + 1)}`;
      }
      return `${id}/${raw}`;
    });
  return [...new Set([...base, ...extra, ...discoveredAll])];
}

/** Chat-capable subset of {@link modelIdsFor} (embeddings/audio filtered out). */
export function chatModelIdsFor(id: ProviderId, connections: Record<ProviderId, ProviderConnection>): string[] {
  const connection = connections[id];
  const preset = providerPreset(id);
  const discoveredChat = new Set(
    connection.discoveredModels.filter((m) => !m.nonChat).map((m) => m.id),
  );
  const discoveredNonChat = new Set(
    connection.discoveredModels.filter((m) => m.nonChat).map((m) => m.id),
  );
  const all = modelIdsFor(id, connections);
  if (connection.discoveredModels.length === 0) return all;
  return all.filter((m) => {
    if (discoveredChat.has(m)) return true;
    if (discoveredNonChat.has(m)) return false;
    // Extra models and pinned ids the user typed manually are kept even if
    // they look like non-chat — they were explicitly added.
    if (connection.extraModels.some((e) => e === m || `${id}/${e}` === m)) return true;
    if (connection.models.includes(m)) return true;
    // Preset models: keep unless the catalog explicitly tags them nonChat.
    if (preset.models.some((p: ModelMeta) => p.id === m)) {
      const meta = catalogGetModelMetadata(m, id);
      return meta.source !== "catalog" || !meta.nonChat;
    }
    return true;
  });
}

/** Subset of chat-capable models the user has not hidden from pickers. */
export function visibleModelIdsFor(
  id: ProviderId,
  connections: Record<ProviderId, ProviderConnection>,
): string[] {
  const hidden = new Set(connections[id]?.hiddenModels ?? []);
  return chatModelIdsFor(id, connections).filter((m) => !hidden.has(m));
}

/** Toggle a single model's visibility in pickers. */
export function withModelVisibility(
  connection: ProviderConnection,
  modelId: string,
  visible: boolean,
): ProviderConnection {
  const hidden = new Set(connection.hiddenModels);
  if (visible) hidden.delete(modelId);
  else hidden.add(modelId);
  return { ...connection, hiddenModels: [...hidden] };
}


export type ModelOption = {
  id: string;
  name: string;
  provider: string;
  providerId: ProviderId;
  contextWindow: string;
  capabilities: ModelCapabilities;
};

/** Builds a normalized `ModelOption` descriptor from a raw model identifier. */
const REASONING_MODEL_RE = /(^|[/\-\s])(o[1-9]|o3|o4|r1|reasoning|reasoner|deepseek-reasoner|think(ing)?|opus-?[4-9])([/\-\s]|$)/i;
const VISION_MODEL_RE = /vision|-vl|gemini|gpt-4o|gpt-4\.1|gpt-5|claude|grok|multimodal/i;
const TOOL_USE_MODEL_RE = /(gpt-[45]|o[34]|claude|gemini-2|grok|qwen|llama-?3\.[1-9]|mistral|deepseek|glm-5)/i;

function inferCapabilities(id: string, known?: ModelMeta): ModelCapabilities {
  if (known) {
    return {
      vision: known.vision ?? VISION_MODEL_RE.test(id),
      toolUse: known.toolUse ?? (!known.reasoning || /o3|o4/i.test(id)),
      reasoning: known.reasoning ?? REASONING_MODEL_RE.test(id),
    };
  }
  return {
    vision: VISION_MODEL_RE.test(id),
    toolUse: TOOL_USE_MODEL_RE.test(id) && !/(^|[/\-\s])(embed|embedding|rerank|whisper|tts)/i.test(id),
    reasoning: REASONING_MODEL_RE.test(id),
  };
}
export function modelOption(id: string): ModelOption {
  const prefix = id.split("/")[0] ?? "";
  const providerId = canonicalProviderId(prefix) ?? ("custom" as ProviderId);
  const preset = PROVIDER_PRESETS.find((p) => p.id === providerId);
  const known = preset?.models.find((m) => m.id === id);
  const catMeta = catalogGetModelMetadata(id, providerId);
  const slug = id.split("/").slice(1).join("/") || id;
  // Pick the best display name: catalog (if it adds information over the raw
  // slug) → preset hardcoded → slug.
  const catName = catMeta.source !== "inferred" ? catMeta.name : "";
  const catNameIsUseful = catName && catName.toLowerCase() !== slug.toLowerCase();
  const name = catNameIsUseful ? catName : (known?.name ?? slug);
  const ctxLabel =
    catMeta.source !== "inferred" && catMeta.contextWindowLabel
      ? catMeta.contextWindowLabel
      : (known?.contextWindow ?? "");
  const capabilities = catMeta.source !== "inferred"
    ? {
        vision: catMeta.vision,
        toolUse: catMeta.toolUse,
        reasoning: catMeta.reasoning,
      }
    : inferCapabilities(id, known);
  return {
    id,
    name,
    provider: preset?.label ?? "Custom",
    providerId: preset?.id ?? "custom",
    contextWindow: ctxLabel,
    capabilities,
  };
}

/** Every model the user can pick right now, respecting per-model visibility. */
export function availableModels(settings: ProvidersSettings): ModelOption[] {
  const out: ModelOption[] = [];
  for (const preset of PROVIDER_PRESETS) {
    if (!isConnectionUsable(preset.id, settings.connections)) continue;
    for (const id of visibleModelIdsFor(preset.id, settings.connections)) {
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

/** Collects available embedding model identifiers across configured providers. */
/**
 * Convert a BetterShape `provider/model` id into the wire slug the Rust
 * embeddings client should send to a given `targetProvider`.
 *
 * OpenAI expects a bare slug ("text-embedding-3-small"); OpenRouter expects
 * the fully-qualified vendor/model id ("openai/text-embedding-3-small");
 * other OpenAI-compatible providers (local Ollama, custom gateways) need
 * whatever slug the user typed.
 */
function embeddingSlugFor(targetProvider: ProviderId, modelId: string): string {
    const id = modelId.trim();
    if (!id) return "";
    // Strip the BetterShape-internal provider prefix only when the target
    // provider is the same one (e.g. openai/text-embedding-3-small routed to
    // openai → send "text-embedding-3-small"). For cross-provider routing
    // (e.g. openrouter/openai/... → OpenRouter) keep the full vendor/model.
    const ownPrefix = `${targetProvider}/`;
    if (id.startsWith(ownPrefix)) return id.slice(ownPrefix.length);
    return id;
}
export function embeddingModelOptions(settings: ProvidersSettings): string[] {
  const presets: string[] = [];
  for (const id of embeddingProviders(settings)) {
    const preset = providerPreset(id);
    presets.push(...(preset.embeddingModels ?? []));
    // Surface any embedding models the provider itself reported, normalised
    // to the wire slug this provider expects.
    const discoveredEmbeddings = (settings.connections[id].discoveredModels ?? [])
      .filter((m) => m.nonChat && /embed|embedding/i.test(m.id))
      .map((m) => embeddingSlugFor(id, m.id));
    presets.push(...discoveredEmbeddings);
  }
  const chosen = modelForFeature(settings, "embeddings");
  if (chosen) {
    // Normalise whatever the user saved into the current preferred provider's
    // wire format so the dropdown shows the same id we will actually send.
    const pref = embeddingProviders(settings).find((p) => p === "openai")
      ?? embeddingProviders(settings).find((p) => p === "openrouter")
      ?? embeddingProviders(settings)[0];
    if (pref) {
      const normalised = embeddingSlugFor(pref, chosen);
      if (!presets.includes(normalised)) presets.unshift(normalised);
    } else if (!presets.includes(chosen)) {
      presets.unshift(chosen);
    }
  }
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
  const chosen = modelForFeature(settings, "embeddings");

  // Every usable OpenAI-wire connection. When the chosen model is available
  // from several providers (e.g. text-embedding-3-small on both openai and
  // openrouter) we pick the preferred one, but when only one provider
  // actually knows the model we route to that provider instead of forcing
  // it through openai and 404'ing on vendor-specific slugs.
  const wire = PROVIDER_PRESETS.filter(
    (preset) => preset.kind === "openai" && isConnectionUsable(preset.id, settings.connections),
  );
  const wireIds = wire.map((p) => p.id);

  const providerOffersModel = (pid: ProviderId): boolean => {
    const conn = settings.connections[pid];
    const preset = providerPreset(pid);
    const native = embeddingSlugFor(pid, chosen);
    const presetEmbeds = preset.embeddingModels ?? [];
    const discoveredEmbeds = (conn.discoveredModels ?? [])
      .filter((m) => m.nonChat && /embed|embedding/i.test(m.id))
      .map((m) => m.id);
    return (
      presetEmbeds.includes(native) ||
      presetEmbeds.includes(chosen) ||
      discoveredEmbeds.includes(native) ||
      discoveredEmbeds.includes(chosen)

    );
  };

  if (chosen) {
    if (!wireIds.length) return null;
    const owner =
      wireIds.find(providerOffersModel) ??
      (wireIds.find((id) => id === "openai") ?? wireIds.find((id) => id === "openrouter") ?? wireIds[0]);
    return { id: owner, model: embeddingSlugFor(owner, chosen) };

  }

  const preferredOf = (ids: ProviderId[]): ProviderId | undefined =>
    ids.find((id) => id === "openai") ?? ids.find((id) => id === "openrouter") ?? ids[0];
  const known = wireIds.filter((id) => providerPreset(id).embeddings === true);
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

/** Converts frontend provider settings into the Rust backend `AiConfig` wire payload. */
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
      // Send every chat model the connection reports, not just the visible
      // subset: model visibility is a UI-picker preference, not a runtime
      // routing constraint. Hiding a model that was selected as default
      // (or pinned by a previous session) must not make Rust fall back silently.
      models: chatModelIdsFor(preset.id, settings.connections),
      enabled: connection.enabled,
      keyless: preset.keyless === true,
      headers: providerHeaders(preset.id, connection),
      authStyle: providerAuthStyle(preset.id, connection),
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
    embeddingProvider: embeddingTarget?.id ?? "",
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
 * Resolve the concrete chat model for the Rust side. `ask` mode has no concrete
 * default at launch (the UI always prompts), so we ship "" and Rust falls back
 * to asking. Otherwise: honour the user's pick, else first available.
 */
function resolveDefaultModel(settings: ProvidersSettings, providers: RustAiProviderEntry[]): string {
  const mode = settings.chatMode;
  if (mode === "ask") return "";
  const wanted = (mode === "auto" ? "" : mode).trim();
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

/** Keychain id for one header value: gateways keep tokens in headers. */
export function headerSecretId(id: ProviderId, name: string): string {
  return `header:${id}:${name}`;
}

/** Split a header secret id back into `(provider, header name)`. */
export function parseHeaderSecretId(secretId: string): { id: ProviderId; name: string } | null {
  if (!secretId.startsWith("header:")) return null;
  const rest = secretId.slice("header:".length);
  const separator = rest.indexOf(":");
  if (separator <= 0) return null;
  return { id: rest.slice(0, separator) as ProviderId, name: rest.slice(separator + 1) };
}

/** Versioned destination identities, persisted with credentials inside the vault. */
export function credentialScopes(settings: ProvidersSettings): Record<string, string> {
  const scopes: Record<string, string> = {};
  for (const preset of PROVIDER_PRESETS) {
    const connection = settings.connections[preset.id];
    if (!connection) continue;
    const url = connection.baseUrl.trim() || preset.baseUrl;
    let end = url.length;
    while (end > 0 && url[end - 1] === "/") end -= 1;
    const baseUrl = url.slice(0, end);
    const scope = JSON.stringify(["provider-v1", preset.kind, baseUrl, providerAuthStyle(preset.id, connection)]);
    scopes[preset.id] = scope;
    for (const name of Object.keys(connection.headers)) scopes[headerSecretId(preset.id, name)] = scope;
  }
  scopes[SEARCH_SECRET_ID] = JSON.stringify(["search-v1", settings.services.search.provider]);
  scopes[COMPOSIO_SECRET_ID] = JSON.stringify(["composio-v1", settings.services.composio.userId.trim() || "bettershape-local"]);
  return scopes;
}

/** Every secret the provider settings currently hold, keyed by storage id. */
export function providerSecrets(settings: ProvidersSettings): Record<string, string> {
  const out: Record<string, string> = {};
  for (const preset of PROVIDER_PRESETS) {
    const connection = settings.connections[preset.id];
    const key = connection?.apiKey?.trim();
    if (key) out[preset.id] = key;
    // Header *values* are secrets too when a gateway puts a token there; the
    // header names stay in the settings file.
    for (const [name, value] of Object.entries(connection?.headers ?? {})) {
      const trimmed = value.trim();
      if (trimmed) out[headerSecretId(preset.id, name)] = trimmed;
    }
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
      ? { ...connection, apiKey: "", headers: blankHeaderValues(connection.headers) }
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
}

/** Keep header names, drop the values (they live in the keychain). */
export function blankHeaderValues(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of Object.keys(headers ?? {})) out[name] = "";
  return out;
}

/** Incoming header names with whatever values only this session still holds. */
function mergeHeaderValues(
  live: Record<string, string> | undefined,
  incoming: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(incoming ?? {})) {
    out[name] = value.trim() ? value : (live?.[name] ?? "");
  }
  return out;
}

/**
 * Fill secrets that only exist in memory back into a freshly loaded copy.
 *
 * Storage never holds keys once the keychain is in use, so a plain merge would
 * wipe the session's keys the first time a settings payload arrived from disk or
 * from the other window. Existing values always win for non-secret fields.
 */
export function mergeProviderConnections(live: ProvidersSettings, loaded: ProvidersSettings): ProvidersSettings {
  const connections = {} as Record<ProviderId, ProviderConnection>;
  const liveScopes = credentialScopes(live);
  const loadedScopes = credentialScopes(loaded);
  for (const preset of PROVIDER_PRESETS) {
    const current = live.connections[preset.id];
    const incoming = loaded.connections[preset.id] ?? emptyConnection(preset);
    if (current && liveScopes[preset.id] !== loadedScopes[preset.id]
      && (current.apiKey.trim() || Object.values(current.headers).some((value) => value.trim()))) {
      connections[preset.id] = {
        ...incoming,
        apiKey: current.apiKey,
        baseUrl: current.baseUrl,
        authStyle: current.authStyle,
        headers: current.headers,
      };
      continue;
    }
    connections[preset.id] = {
      ...incoming,
      apiKey: incoming.apiKey.trim() ? incoming.apiKey : (current?.apiKey ?? ""),
      headers: mergeHeaderValues(current?.headers, incoming.headers),
    };
  }
  return {
    ...loaded,
    connections,
    services: {
      search: live.services.search.apiKey && liveScopes[SEARCH_SECRET_ID] !== loadedScopes[SEARCH_SECRET_ID] ? live.services.search : {
        ...loaded.services.search,
        apiKey: loaded.services.search.apiKey.trim()
          ? loaded.services.search.apiKey
          : live.services.search.apiKey,
      },
      composio: live.services.composio.apiKey && liveScopes[COMPOSIO_SECRET_ID] !== loadedScopes[COMPOSIO_SECRET_ID] ? live.services.composio : {
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
 * are listed: `sk-` alone is shared by OpenAI, DeepSeek, Moonshot and gateways,
 * so a plain `sk-…` value never triggers advice either way.
 */
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

/** Providers that share a key prefix, so a cross-card hint stays quiet. */
const SIBLING_PROVIDERS: Partial<Record<ProviderId, ProviderId[]>> = {
  zen: ["zen-messages"],
  "zen-messages": ["zen"],
};

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
  if (owner && owner.id !== id && !(SIBLING_PROVIDERS[owner.id] ?? []).includes(id)) {
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
/* Model ids arriving from somewhere else                                      */
/* -------------------------------------------------------------------------- */

/**
 * Prefixes other clients use for the same providers.
 *
 * Model ids travel between tools — a conversation saved by another agent, an
 * exported preset, a config file. Knowing that `gemini/x`, `google-ai/x` and
 * `google/x` are the same provider means a pasted id resolves instead of being
 * sent to whichever provider happens to be first.
 */
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

/** Provider a model id's prefix really means, or null when it names nothing. */
export function canonicalProviderId(prefix: string): ProviderId | null {
  const trimmed = prefix.trim();
  if (!trimmed) return null;
  if (PROVIDER_PRESETS.some((preset) => preset.id === trimmed)) return trimmed as ProviderId;
  return PROVIDER_ALIASES[trimmed.toLowerCase()] ?? null;
}

/**
 * Model id rewritten onto the id this app stores, e.g.
 * `gemini/gemini-2.5-pro` → `google/gemini-2.5-pro`. Ids this app already
 * understands come back untouched.
 */
export function translateModelId(model: string): string {
  const trimmed = model.trim();
  const separator = trimmed.indexOf("/");
  if (separator <= 0) return trimmed;
  const canonical = canonicalProviderId(trimmed.slice(0, separator));
  if (!canonical || canonical === trimmed.slice(0, separator)) return trimmed;
  return `${canonical}/${trimmed.slice(separator + 1)}`;
}

/**
 * Model names a pasted config mentions, mapped onto providers the user has.
 *
 * Matching is by model name (`deepseek/deepseek-r1` or a full display name),
 * case-insensitively, so a list copied from another tool becomes the right
 * connections instead of everything landing on "custom". Provider order follows
 * the preset order, so the result is stable.
 */
export function providersForModelNames(
  names: string[],
  _connections: Record<ProviderId, ProviderConnection>,
): ProviderId[] {
  const needles = names
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
    .map((name) => (name.includes("/") ? name.slice(name.indexOf("/") + 1) : name));
  if (needles.length === 0) return [];
  // A model name arrives namespaced in as many ways as there are clients
  // (`deepseek-ai/DeepSeek-R1`, `deepseek/deepseek-r1`), so the last path
  // segment is what identifies it.
  const lastSegment = (value: string) => {
    const slash = value.lastIndexOf("/");
    return slash === -1 ? value : value.slice(slash + 1);
  };
  const tails = new Set(needles.map(lastSegment).filter((tail) => tail.length >= 6));
  const out: ProviderId[] = [];
  for (const preset of PROVIDER_PRESETS) {
    // Presets without a model list (custom, LM Studio, vLLM) can serve anything,
    // so they would match every pasted name — never guess them.
    if (preset.models.length === 0) continue;
    const matches = preset.models.some((model) => {
      const slug = model.id.slice(model.id.indexOf("/") + 1).toLowerCase();
      const name = model.name.toLowerCase();
      if (needles.some((needle) => slug === needle || name === needle || name.includes(needle))) {
        return true;
      }
      const tail = lastSegment(slug);
      return tail.length >= 6 && tails.has(tail);
    });
    if (matches) out.push(preset.id);
  }
  return out;
}

/** Subset of {@link providersForModelNames} that are already usable today. */
export function usableProvidersForModelNames(
  names: string[],
  connections: Record<ProviderId, ProviderConnection>,
): ProviderId[] {
  return providersForModelNames(names, connections).filter((id) =>
    isConnectionUsable(id, connections),
  );
}

/* -------------------------------------------------------------------------- */
/* Model discovery                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Convert raw ids the provider's `/models` returned into the structured
 * {@link DiscoveredModelEntry} records we persist, enriched with catalog
 * metadata (context window, pricing, capabilities) from models.dev.
 *
 * Safe to call with an empty list (used to clear discovery state on reset).
 * Defensively tolerant of the catalog module being unavailable.
 */
export function enrichDiscovered(
  providerId: ProviderId,
  discoveredIds: string[],
): DiscoveredModelEntry[] {
  const now = Date.now();
  // Delegates to the shared toDiscoveredEntry helper so the field-mapping
  // code is defined in one place (previously duplicated inline here).
  return enrichDiscoveredModels(providerId, discoveredIds).map((m) => toDiscoveredEntry(m, now));
}

/** Convert catalog metadata into the persisted shape. */
function toDiscoveredEntry(m: ReturnType<typeof import("./model-catalog").enrichDiscoveredModels>[number], now: number): DiscoveredModelEntry {
  return {
    id: m.id,
    name: m.name,
    contextWindow: m.contextWindowLabel,
    contextTokens: m.contextWindow || undefined,
    maxOutputTokens: m.maxOutputTokens ?? undefined,
    inputCostPerM: m.inputCostPerM ?? undefined,
    outputCostPerM: m.outputCostPerM ?? undefined,
    vision: m.vision,
    reasoning: m.reasoning,
    toolUse: m.toolUse,
    nonChat: m.nonChat,
    source: m.source,
    discoveredAt: now,
  };
}

/** Return a copy of `connection` with its discovered-models list replaced. */
export function withDiscoveredModels(
  connection: ProviderConnection,
  entries: DiscoveredModelEntry[],
): ProviderConnection {
  return { ...connection, discoveredModels: entries };
}

/** Persist raw provider-reported ids as discovered models (enriched with
 *  catalog metadata) on the given connection. */
export function withRefreshedModels(
  connection: ProviderConnection,
  discoveredIds: string[],
  providerId: ProviderId,
): ProviderConnection {
  const now = Date.now();
  const entries = enrichDiscoveredModels(providerId, discoveredIds).map((m) => toDiscoveredEntry(m, now));
  return { ...connection, discoveredModels: entries };
}

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
