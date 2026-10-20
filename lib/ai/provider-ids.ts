/**
 * Provider id & prefix map, kept in its own module so the model catalog can
 * map catalog prefixes (e.g. "x-ai", "meta-llama") onto BetterShape provider
 * ids without creating a circular dependency with providers.ts (which itself
 * imports the catalog to enrich metadata).
 */

export type ProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "azure"
  | "openrouter"
  | "zen"
  | "zen-messages"
  | "zen-go"
  | "nvidia"
  | "xai"
  | "deepseek"
  | "groq"
  | "mistral"
  | "cerebras"
  | "together"
  | "fireworks"
  | "moonshot"
  | "zai"
  | "zai-coding"
  | "qwen"
  | "deepinfra"
  | "venice"
  | "vercel"
  | "minimax"
  | "baseten"
  | "digitalocean"
  | "cohere"
  | "perplexity"
  | "llmgateway"
  | "zenmux"
  | "kilo"
  | "cloudflare"
  | "cloudflare-gateway"
  | "databricks"
  | "ollama"
  | "lmstudio"
  | "vllm"
  | "custom";

/**
 * Maps catalog author prefixes (e.g. "x-ai", "meta-llama") to the
 * BetterShape provider id they should route to. A model whose prefix isn't
 * in this map falls through to "custom" until the user configures an
 * OpenAI-compatible gateway that can serve it.
 */
export const MODEL_PROVIDER_PREFIX_MAP: Record<string, ProviderId> = {
  // First-party/native APIs.
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  groq: "groq",
  "x-ai": "xai",
  deepseek: "deepseek",
  mistralai: "mistral",
  nvidia: "nvidia",
  cohere: "cohere",
  moonshotai: "moonshot",
  "z-ai": "zai",
  qwen: "qwen",
  perplexity: "perplexity",
  minimax: "minimax",
  openrouter: "openrouter",
  microsoft: "azure",
  // Alias/temp accounts on gateways (same routing as the primary id).
  "~openai": "openai",
  "~anthropic": "anthropic",
  "~google": "google",
  "~moonshotai": "moonshot",
  // Community/open-weight models — routed through OpenRouter by default
  // since the user likely brings a single OpenRouter key for these; they
  // can still be reached through any other OpenAI-compatible gateway the
  // user adds (getModelMetadata pins them to the active connection).
  alibaba: "openrouter",
  amazon: "openrouter",
  "meta-llama": "openrouter",
  baidu: "openrouter",
  bytedance: "openrouter",
  "bytedance-seed": "openrouter",
  tencent: "openrouter",
  xiaomi: "openrouter",
  "arcee-ai": "openrouter",
  nousresearch: "openrouter",
  inception: "openrouter",
  liquid: "openrouter",
  rekaai: "openrouter",
  writer: "openrouter",
  ai21: "openrouter",
  "ibm-granite": "openrouter",
  inflection: "openrouter",
  upstage: "openrouter",
  stepfun: "openrouter",
  poolside: "openrouter",
  "prime-intellect": "openrouter",
  "nvidia-l40s": "nvidia",
};
