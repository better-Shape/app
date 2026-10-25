import { DEFAULT_SETTINGS, getSettings, updateSettingSection, type BetterShapeSettings } from "@/lib/settings";
import { SETTINGS_STORAGE_KEY } from "@/lib/settings/constants";

/**
 * A settings patch, partial at the section level and inside each section.
 *
 * `withSettings` merges every section it is given against the stored settings,
 * so `withSettings({ node: { packageManager: "pnpm" } })` is a valid call. A bare
 * `Partial<BetterShapeSettings>` only made the top level optional and forced
 * every test to restate a whole section, which is why five call sites could not
 * typecheck.
 */
export type SettingsPatch = {
    [K in keyof BetterShapeSettings]?: Partial<BetterShapeSettings[K]>;
};

export function resetSettings() {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(DEFAULT_SETTINGS));
    updateSettingSection("editor", { ...DEFAULT_SETTINGS.editor });
    updateSettingSection("skills", { ...DEFAULT_SETTINGS.skills });
    updateSettingSection("appearance", { ...DEFAULT_SETTINGS.appearance });
}

export function withSettings(patch: SettingsPatch) {
    const current = getSettings();
    localStorage.setItem(
        SETTINGS_STORAGE_KEY,
        JSON.stringify({
            ...current,
            ...patch,
            editor: { ...current.editor, ...patch.editor },
            git: {
                ...current.git,
                ...patch.git,
                blame: { ...current.git.blame, ...patch.git?.blame },
            },
            lsp: { ...current.lsp, ...patch.lsp },
            node: { ...current.node, ...patch.node },
            ai: { ...current.ai, ...patch.ai },
            appearance: { ...current.appearance, ...patch.appearance },
        }),
    );
    if (patch.editor) updateSettingSection("editor", patch.editor);
    if (patch.git) updateSettingSection("git", patch.git);
    if (patch.lsp) updateSettingSection("lsp", patch.lsp);
    if (patch.node) updateSettingSection("node", patch.node);
    if (patch.terminal) updateSettingSection("terminal", patch.terminal);
    if (patch.ai) updateSettingSection("ai", patch.ai);
    if (patch.appearance) updateSettingSection("appearance", patch.appearance);
}
