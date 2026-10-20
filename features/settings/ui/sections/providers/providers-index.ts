"use client";

/**
 * Barrel for the Providers surface. New code within ./providers/ should prefer
 * direct imports (to avoid circular deps); this file exists only so callers
 * outside the surface can `import { X } from "./providers"` conveniently.
 */

export { ProvidersSettingsView } from "./providers-view";
