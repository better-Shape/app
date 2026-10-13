"use client";

/**
 * Runtime flags (local).
 *
 * Feature flags used to come from the BetterShape API. Every capability in this
 * build is available whenever the user's own keys are configured, so flags
 * resolve to their local fallback and nothing is fetched.
 */

import { useSyncExternalStore } from "react";

export function evaluateRuntimeFlag(_key: string, fallback = true): boolean {
  return fallback;
}

export async function refreshBetterShapeRuntime(): Promise<void> {
  /* no remote runtime config */
}

export function useRuntimeFlag(key: string, fallback = true): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => evaluateRuntimeFlag(key, fallback),
    () => fallback,
  );
}

export function getRuntimeDisabledModels(): string[] {
  return [];
}
