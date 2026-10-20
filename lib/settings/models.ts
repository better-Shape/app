/**
 * Model display helpers.
 *
 * Models come from the user's BYOK connections (`lib/ai/providers`), never from
 * a server catalog. Costs are whatever the user's own account charges, so the
 * UI shows provider + context instead of pretend credit prices.
 */

import { AUTO_MODEL, providerLabelForModel } from "@/lib/catalog";
import {
  modelOption,
  type ProvidersSettings,
} from "@/lib/ai/providers";

export interface ModelInfo {
    id: string;
    name: string;
    description: string;
    provider: string;
    inputCost: number;
    cachedInputCost: number;
    outputCost: number;
    contextWindow: string;
    releaseDate: string;
    tags?: { label: string }[];
    tier?: "flagship" | "balanced" | "fast";
    /** True when the model accepts image input. */
    vision?: boolean;
}

/** Build the picker list from local settings, Auto first. */
export function modelsFromProviders(settings: ProvidersSettings, usable: string[]): ModelInfo[] {
    const out: ModelInfo[] = [AUTO_MODEL];
    for (const id of usable) {
        const option = modelOption(id);
        out.push({
            id: option.id,
            name: option.name,
            description: `${option.provider}${option.contextWindow ? ` · ${option.contextWindow} context` : ""}`,
            provider: option.provider,
            inputCost: 0,
            cachedInputCost: 0,
            outputCost: 0,
            contextWindow: option.contextWindow,
            releaseDate: "Rolling",
            vision: option.capabilities.vision,
        });
    }
    return out;
}

export function resolveChatModels(models: ModelInfo[]): ModelInfo[] {
    const byId = new Map<string, ModelInfo>();
    byId.set(AUTO_MODEL.id, models.find((m) => m.id === AUTO_MODEL.id) ?? AUTO_MODEL);
    for (const model of models) {
        if (model.id === AUTO_MODEL.id) continue;
        if (!byId.has(model.id)) byId.set(model.id, model);
    }
    return [...byId.values()];
}

function isAutoId(id: string): boolean {
    return id === "auto";
}

/** Drop ids nobody can route any more. Empty means "all models". */
export function sanitizeEnabledModels(
    enabled: string[],
    knownIds: string[],
    _defaults: string[] = [],
): string[] {
    if (enabled.length === 0) return [];
    const known = new Set(knownIds);
    const kept = enabled.filter((id) => isAutoId(id) || known.has(id));
    const keptReal = kept.filter((id) => !isAutoId(id));
    if (keptReal.length === 0) return [];
    const knownReal = knownIds.filter((id) => !isAutoId(id));
    if (knownReal.length > 0 && knownReal.every((id) => keptReal.includes(id))) return [];
    return kept;
}

export function getModelsByProvider(models: ModelInfo[]): Record<string, ModelInfo[]> {
    const grouped: Record<string, ModelInfo[]> = {};
    for (const m of models) {
        if (!grouped[m.provider]) grouped[m.provider] = [];
        grouped[m.provider].push(m);
    }
    return grouped;
}

export function isModelEnabled(modelId: string, enabledModels: string[]): boolean {
    if (enabledModels.length === 0) return true;
    return enabledModels.includes(modelId);
}

export function getVisibleModels(allModels: ModelInfo[], enabledModels: string[]): ModelInfo[] {
    return allModels.filter((m) => m.id === "auto" || isModelEnabled(m.id, enabledModels));
}

/** Subagents never inherit the parent chat model. Empty / unknown → Auto only. */
export const DEFAULT_SUBAGENT_MODELS = ["auto"];

export function sanitizeSubagentModels(enabled: string[] | undefined, knownIds: string[]): string[] {
    const known = new Set(knownIds);
    const kept: string[] = [];
    const seen = new Set<string>();
    for (const raw of enabled ?? []) {
        const id = isAutoId(raw) ? "auto" : raw;
        if (seen.has(id)) continue;
        if (!isAutoId(id) && !known.has(id)) continue;
        seen.add(id);
        kept.push(id);
    }
    return kept.length > 0 ? kept : [...DEFAULT_SUBAGENT_MODELS];
}

export function isSubagentModelEnabled(modelId: string, enabled: string[]): boolean {
    const list = enabled.length === 0 ? DEFAULT_SUBAGENT_MODELS : enabled;
    if (isAutoId(modelId)) return list.some((id) => isAutoId(id));
    return list.includes(modelId);
}

export function resolveSubagentDefaultModel(defaultModel: string | undefined, allowed: string[]): string {
    const list = allowed.length === 0 ? DEFAULT_SUBAGENT_MODELS : allowed;
    const wanted = defaultModel && isAutoId(defaultModel) ? "auto" : defaultModel;
    if (wanted && isSubagentModelEnabled(wanted, list)) return wanted;
    return list.includes("auto") ? "auto" : list[0] ?? "auto";
}

/**
 * What the composer sends to `send_chat_message`. There are no credits to
 * budget any more: everything the user enabled and can route is allowed.
 */
export function subagentModelsForSend(
    enabled: string[] | undefined,
    knownIds: string[],
    opts?: { defaultModel?: string },
): { models: string[]; defaultModel: string } {
    const models = sanitizeSubagentModels(enabled, knownIds);
    return {
        models,
        defaultModel: resolveSubagentDefaultModel(opts?.defaultModel, models),
    };
}

export { providerLabelForModel };
