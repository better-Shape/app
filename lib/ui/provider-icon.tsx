"use client";

import React from "react";
import type { IconModule } from "thesvg";
import anthropic from "thesvg/anthropic";
import baseten from "thesvg/baseten";
import cerebras from "thesvg/cerebras";
import cloudflare from "thesvg/cloudflare";
import cohere from "thesvg/cohere";
import databricks from "thesvg/databricks";
import deepinfra from "thesvg/deepinfra";
import deepseek from "thesvg/deepseek";
import digitalocean from "thesvg/digitalocean";
import fireworks from "thesvg/fireworks";
import gemini from "thesvg/gemini";
import grok from "thesvg/grok";
import groq from "thesvg/groq";
import kiloCode from "thesvg/kilo-code";
import lmStudio from "thesvg/lm-studio";
import meta from "thesvg/meta";
import microsoftAzure from "thesvg/microsoft-azure";
import minimax from "thesvg/minimax";
import mistral from "thesvg/mistral-ai";
import moonshot from "thesvg/moonshot-ai";
import nvidia from "thesvg/nvidia";
import ollama from "thesvg/ollama";
import openai from "thesvg/openai";
import opencode from "thesvg/opencode";
import openrouter from "thesvg/openrouter";
import perplexity from "thesvg/perplexity";
import qwen from "thesvg/qwen";
import togetherAi from "thesvg/together-ai";
import vercel from "thesvg/vercel";
import vllm from "thesvg/vllm";
import zenmux from "thesvg/zenmux";
import zhipu from "thesvg/zhipu";
import { BetterShapeLogo } from "@/components/ui/bettershape-logo";

type BrandKey =
    | "anthropic"
    | "azure"
    | "baseten"
    | "cerebras"
    | "cloudflare"
    | "cohere"
    | "databricks"
    | "deepinfra"
    | "deepseek"
    | "digitalocean"
    | "fireworks"
    | "google"
    | "groq"
    | "kilo"
    | "lmstudio"
    | "meta"
    | "minimax"
    | "mistralai"
    | "moonshotai"
    | "nvidia"
    | "ollama"
    | "openai"
    | "opencode"
    | "openrouter"
    | "perplexity"
    | "qwen"
    | "together"
    | "vercel"
    | "vllm"
    | "x-ai"
    | "z-ai"
    | "zenmux";

type Provider = "bettershape" | BrandKey;

const BRANDS: Record<BrandKey, IconModule> = {
    anthropic,
    azure: microsoftAzure,
    baseten,
    cerebras,
    cloudflare,
    cohere,
    databricks,
    deepinfra,
    deepseek,
    digitalocean,
    fireworks,
    google: gemini,
    groq,
    kilo: kiloCode,
    lmstudio: lmStudio,
    meta,
    minimax,
    mistralai: mistral,
    moonshotai: moonshot,
    nvidia,
    ollama,
    openai,
    opencode,
    openrouter,
    perplexity,
    qwen,
    together: togetherAi,
    vercel,
    vllm,
    "x-ai": grok,
    "z-ai": zhipu,
    zenmux,
};

const PREFIX_TO_BRAND: Record<string, BrandKey> = {
    anthropic: "anthropic",
    openai: "openai",
    google: "google",
    gemini: "google",
    azure: "azure",
    openrouter: "openrouter",
    zen: "opencode",
    "zen-messages": "opencode",
    "zen-go": "opencode",
    opencode: "opencode",
    nvidia: "nvidia",
    vercel: "vercel",
    zenmux: "zenmux",
    kilo: "kilo",
    "kilo-code": "kilo",
    cloudflare: "cloudflare",
    "cloudflare-gateway": "cloudflare",
    xai: "x-ai",
    "x-ai": "x-ai",
    grok: "x-ai",
    deepseek: "deepseek",
    "deepseek-ai": "deepseek",
    groq: "groq",
    mistral: "mistralai",
    mistralai: "mistralai",
    cerebras: "cerebras",
    together: "together",
    togetherai: "together",
    fireworks: "fireworks",
    moonshot: "moonshotai",
    moonshotai: "moonshotai",
    zai: "z-ai",
    "zai-coding": "z-ai",
    "z-ai": "z-ai",
    zhipu: "z-ai",
    qwen: "qwen",
    "alibaba-coding": "qwen",
    deepinfra: "deepinfra",
    minimax: "minimax",
    "minimax-coding": "minimax",
    baseten: "baseten",
    digitalocean: "digitalocean",
    cohere: "cohere",
    perplexity: "perplexity",
    databricks: "databricks",
    ollama: "ollama",
    lmstudio: "lmstudio",
    "lm-studio": "lmstudio",
    vllm: "vllm",
    meta: "meta",
    "meta-llama": "meta",
};

function providerFromModelId(modelId: string): Provider {
    if (!modelId || modelId === "auto" || modelId === "openrouter/auto") {
        return "bettershape";
    }
    const parts = modelId.split("/").map((part) => part.trim().toLowerCase());
    // Multi-segment gateway IDs (`nvidia/deepseek-ai/deepseek-r1`,
    // `openrouter/anthropic/claude-sonnet-4.5`) carry the model maker in segment 2.
    if (parts.length >= 3 && parts[1] && PREFIX_TO_BRAND[parts[1]]) {
        return PREFIX_TO_BRAND[parts[1]];
    }
    const prefix = parts[0] ?? "";
    return PREFIX_TO_BRAND[prefix] ?? "bettershape";
}

function BrandIcon({ icon, size }: { icon: IconModule; size: number }) {
    const html = icon.variants.dark || icon.variants.default || icon.svg;
    return (
        <span
            aria-hidden
            className="inline-flex shrink-0 [&_svg]:size-full"
            style={{ width: size, height: size }}
            dangerouslySetInnerHTML={{ __html: html }}
        />
    );
}

export function BetterShapeAutoIcon({
    size = 16,
    marquee = false,
    className,
}: {
    size?: number;
    marquee?: boolean;
    className?: string;
}) {
    return <BetterShapeLogo size={size} marquee={marquee} className={className} />;
}

export function providerIcon(modelId: string, size = 16): React.ReactNode {
    const provider = providerFromModelId(modelId);
    if (provider === "bettershape") return <BetterShapeAutoIcon size={size} />;
    return <BrandIcon icon={BRANDS[provider]} size={size} />;
}
