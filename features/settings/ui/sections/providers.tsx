"use client";

/**
 * Settings → Providers (barrel re-export).
 *
 * Implementation lives in ./providers/ and is split across:
 *   - providers-view.tsx — page composition (groups, defaults, services)
 *   - provider-card.tsx — per-provider collapsible card
 *   - inputs.tsx       — KeyInput + TextInput primitives
 *   - status.tsx       — connection status logic + icons
 *   - use-vault-status.ts — OS keychain probe hook
 */
export { ProvidersSettingsView } from "./providers/providers-view";
