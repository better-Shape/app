import { describe, expect, it } from "vitest";
import { SETTINGS_CATEGORIES, SETTINGS_NAV, allSettingsLeaves } from "@/features/settings/ui/shared/nav";

describe("voice settings route", () => {
    it("lists a Voice leaf under Features", () => {
        const features = SETTINGS_NAV.find((group) => group.id === "features");
        const voice = features?.children.find((leaf) => leaf.id === "voice");
        expect(voice).toBeDefined();
        expect(voice?.label).toBe("Voice");
        expect(voice?.targetId).toBe("settings-microphone");
    });

    it("targets the microphone section the page renders", () => {
        const leaf = allSettingsLeaves().find((entry) => entry.targetId === "settings-microphone");
        expect(leaf?.id).toBe("voice");
    });

    it("is reachable from the command palette", () => {
        expect(SETTINGS_CATEGORIES.some((category) => category.id === "voice")).toBe(true);
    });
});
