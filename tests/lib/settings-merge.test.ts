import { describe, expect, it } from "vitest";
import { getSettings, normalizeMotionPreference, updateSettingSection } from "@/lib/settings";
import { resetSettings } from "../helpers/settings";

describe("settings merge", () => {
    it("deep merges git blame without dropping siblings", () => {
        resetSettings();
        updateSettingSection("git", { blame: { enabled: true } });
        const settings = getSettings();
        expect(settings.git.blame.enabled).toBe(true);
        expect(settings.git.autoFetch).toBe(false);
    });

    it("merges partial editor fields", () => {
        resetSettings();
        updateSettingSection("editor", { fontSize: 20, tabSize: 2 });
        const settings = getSettings();
        expect(settings.editor.fontSize).toBe(20);
        expect(settings.editor.tabSize).toBe(2);
        expect(settings.editor.minimap).toBe(false);
    });

    it("merges partial ai without resetting models", () => {
        resetSettings();
        updateSettingSection("ai", { autoApplyEdits: true });
        const settings = getSettings();
        expect(settings.ai.autoApplyEdits).toBe(true);
        expect(settings.ai.defaultModel).toBe("auto");
        expect(settings.ai.subagentModels).toEqual(["auto"]);
        expect(settings.ai.subagentDefaultModel).toBe("auto");
    });

    it("defaults motion to the system and normalizes unknown stored values", () => {
        resetSettings();
        expect(getSettings().appearance.motionPreference).toBe("system");
        expect(normalizeMotionPreference("reduced")).toBe("reduced");
        expect(normalizeMotionPreference("system")).toBe("system");
        expect(normalizeMotionPreference("unknown")).toBe("system");
    });

    it("applies the reduced preference to the document and removes it when following the system", () => {
        resetSettings();
        updateSettingSection("appearance", { motionPreference: "reduced" });
        expect(document.documentElement.dataset.motionPreference).toBe("reduced");

        updateSettingSection("appearance", { motionPreference: "system" });
        expect(document.documentElement.dataset.motionPreference).toBeUndefined();
    });
});
