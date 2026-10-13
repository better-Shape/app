import { describe, expect, it } from "vitest";
import {
    isSettingsTab,
    isVirtualEditorTab,
    SETTINGS_TAB_PATH,
} from "@/lib/settings/tab";

describe("settings-tab", () => {
    it("detects settings tab", () => {
        expect(isSettingsTab(SETTINGS_TAB_PATH)).toBe(true);
        expect(isSettingsTab("bettershape://other")).toBe(false);
    });

    it("detects virtual editor tabs", () => {
        expect(isVirtualEditorTab(SETTINGS_TAB_PATH)).toBe(true);
        expect(isVirtualEditorTab("bettershape://design-preview/abc")).toBe(true);
        expect(isVirtualEditorTab("bettershape://browser")).toBe(true);
        expect(isVirtualEditorTab("bettershape://subagent/abc")).toBe(false);
    });
});
