import { describe, expect, it } from "vitest";
import { getEditorOptionsFromSettings, updateSettingSection } from "@/lib/settings";

const ESTABLISHED_SETTINGS_STORAGE_KEY = "bettershape-settings-v1";

describe("settings", () => {
    it("editor options", () => {
        updateSettingSection("editor", { fontFamily: "Fira Code", fontSize: 18 });
        const options = getEditorOptionsFromSettings();
        expect(options.fontFamily).toBe("Fira Code");
        expect(options.fontSize).toBe(18);
    });

    it("guides", () => {
        updateSettingSection("editor", { showIndentGuides: true, showBracketGuides: true });
        const options = getEditorOptionsFromSettings();
        expect(options.guides.indentation).toBe(true);
        expect(options.guides.highlightActiveIndentation).toBe(true);
        expect(options.guides.bracketPairs).toBe(true);
    });

    it("emit", () => {
        const events: string[] = [];
        const handler = () => events.push("changed");
        window.addEventListener("bettershape-settings-changed", handler);
        updateSettingSection("editor", { fontSize: 16 });
        window.removeEventListener("bettershape-settings-changed", handler);
        expect(events).toContain("changed");
    });

    it("persist", () => {
        updateSettingSection("editor", { tabSize: 4, fontSize: 15 });
        const stored = localStorage.getItem(ESTABLISHED_SETTINGS_STORAGE_KEY);
        expect(stored).not.toBeNull();
        const parsed = JSON.parse(stored!);
        expect(parsed.editor.tabSize).toBe(4);
        expect(parsed.editor.fontSize).toBe(15);
    });

    it("persists the reduced-motion preference and applies it immediately", () => {
        updateSettingSection("appearance", { motionPreference: "reduced" });
        const parsed = JSON.parse(localStorage.getItem(ESTABLISHED_SETTINGS_STORAGE_KEY)!);
        expect(parsed.appearance.motionPreference).toBe("reduced");
        expect(document.documentElement.dataset.motionPreference).toBe("reduced");

        updateSettingSection("appearance", { motionPreference: "system" });
        expect(document.documentElement.dataset.motionPreference).toBeUndefined();
    });
});
