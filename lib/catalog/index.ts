/**
 * Local model catalog.
 *
 * There is no server catalog any more: the models you can use are exactly the
 * ones your configured BYOK providers expose. Nothing here touches the network.
 */

import type { ModelInfo } from "@/lib/settings/models";
import { PROVIDER_PRESETS, providerPreset, type ProviderId } from "@/lib/ai/providers";

export type CatalogModel = ModelInfo;

export const AUTO_MODEL: ModelInfo = {
  id: "auto",
  name: "Auto",
  description: "Uses your default model.",
  provider: "Auto",
  inputCost: 0,
  cachedInputCost: 0,
  outputCost: 0,
  contextWindow: "",
  releaseDate: "Rolling",
};

/** Friendly provider name for a `provider/model` id. */
export function providerLabelForModel(modelId: string): string {
  const prefix = modelId.split("/")[0] ?? "";
  const preset = PROVIDER_PRESETS.find((p) => p.id === prefix);
  return preset?.label ?? "Custom";
}

export function isKnownProviderPrefix(modelId: string): boolean {
  const prefix = modelId.split("/")[0] ?? "";
  return PROVIDER_PRESETS.some((p) => p.id === prefix);
}

export { providerPreset };
export type { ProviderId };
