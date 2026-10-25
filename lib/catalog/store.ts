"use client";

/**
 * Catalog store (local).
 *
 * The model list is derived from the user's BYOK connections, so it updates
 * live when a key is added or removed. Empty connections mean "Auto only",
 * which is also what the composer falls back to until a key exists.
 */

import { useMemo, useSyncExternalStore } from "react";
import { AUTO_MODEL } from "@/lib/catalog";
import type { ModelInfo } from "@/lib/settings/models";
import { getSettings, subscribeSettings, useSettings } from "@/lib/settings";
import {
  availableModels,
  hasAnyConfiguredConnection,
  resolveActiveDefaultModelId,
  type ProvidersSettings,
} from "@/lib/ai/providers";

function toModelInfo(settings: ProvidersSettings): ModelInfo[] {
  return availableModels(settings).map((option) => ({
    id: option.id,
    name: option.name,
    description: `${option.provider}${option.contextWindow ? ` · ${option.contextWindow} context` : ""}`,
    provider: option.provider,
    inputCost: 0,
    cachedInputCost: 0,
    outputCost: 0,
    contextWindow: option.contextWindow,
    releaseDate: "Rolling",
    vision: option.vision,
  }));
}

/** Every model the user can currently reach (Auto always included). */
export function getCatalogModels(): ModelInfo[] {
  return [AUTO_MODEL, ...toModelInfo(getSettings().ai.providers)];
}

/** Concrete model that `"auto"` currently resolves to, or `null` when unconfigured. */
export function getCatalogResolvedAutoModel(): ModelInfo | null {
  const providers = getSettings().ai.providers;
  const activeId = resolveActiveDefaultModelId(providers);
  if (!activeId) return null;
  const list = toModelInfo(providers);
  return list.find((m) => m.id === activeId) ?? list[0] ?? null;
}

/** True when an enabled connection (with an API key or keyless local endpoint) still has zero model IDs configured. */
export function hasCatalogConnectionMissingModels(): boolean {
  const providers = getSettings().ai.providers;
  return hasAnyConfiguredConnection(providers) && availableModels(providers).length === 0;
}

/** Models offered by one provider id. */
export function getCatalogModelsForProvider(providerId: string): ModelInfo[] {
  return toModelInfo(getSettings().ai.providers).filter(
    (model) => model.id.split("/")[0] === providerId,
  );
}

export function getCatalogProviderOrder(): readonly string[] {
  return ["Auto", ...availableModels(getSettings().ai.providers).map((m) => m.provider)];
}

export function getCatalogDefaultEnabledIds(): string[] {
  return ["auto"];
}

/** Nothing is gated locally — a model is usable when its provider has a key. */
export function isCatalogModelAllowed(_modelId: string): boolean {
  return true;
}

export function getBetterShapeCatalog(): { models: ModelInfo[] } | null {
  return { models: getCatalogModels() };
}

export function useBetterShapeCatalog() {
  const settings = useSettings();
  const providers = settings.ai.providers;
  const models = useMemo(() => [AUTO_MODEL, ...toModelInfo(providers)], [providers]);
  // A stable object identity per provider set keeps consumer effects honest.
  return useMemo(
    () => ({ catalog: { models }, loading: false, error: null, models }),
    [models],
  );
}

/** Kept for callers that awaited a refresh; there is nothing to fetch now. */
export async function refreshBetterShapeCatalog(): Promise<{ models: ModelInfo[] }> {
  return { models: getCatalogModels() };
}

export function clearBetterShapeCatalog() {
  /* no server state to clear */
}

/** True once at least one provider can serve chat requests. */
export function useHasUsableProvider(): boolean {
  // Server snapshot is false (static export prerender); the client store
  // re-renders with the real value as soon as it hydrates.
  return useSyncExternalStore(
    subscribeSettings,
    () => availableModels(getSettings().ai.providers).length > 0,
    () => false,
  );
}
