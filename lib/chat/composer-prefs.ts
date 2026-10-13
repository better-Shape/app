/** Composer preferences shared by the chat view and the settings panel. */

const COMPOSER_PREFS_KEY = "bettershape-composer";

export type ComposerEffort = "low" | "high" | "ultra" | "max" | "super";
export type ComposerPrefs = { model?: string; effort?: ComposerEffort; fast?: boolean };

export function readComposerPrefs(): ComposerPrefs {
    if (typeof window === "undefined") return {};
    try {
        const raw = localStorage.getItem(COMPOSER_PREFS_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as ComposerPrefs;
        const effort = parsed.effort;
        const known = effort === "low" || effort === "high" || effort === "ultra" || effort === "max" || effort === "super";
        return {
            model: typeof parsed.model === "string" ? parsed.model : undefined,
            effort: known ? effort : undefined,
            fast: typeof parsed.fast === "boolean" ? parsed.fast : undefined,
        };
    } catch {
        return {};
    }
}

export function writeComposerPrefs(prefs: ComposerPrefs) {
    try {
        localStorage.setItem(COMPOSER_PREFS_KEY, JSON.stringify(prefs));
    } catch {
        /* ignore */
    }
}

/** The model the composer is set to, for callers outside the chat view. */
export function composerModel(): string | undefined {
    return readComposerPrefs().model;
}
