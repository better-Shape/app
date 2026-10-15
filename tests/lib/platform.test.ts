import { afterEach, describe, expect, it, vi } from "vitest";
import { getPlatform, modKeyGlyph, primaryModifier } from "@/lib/platform";
afterEach(() => vi.unstubAllGlobals());
describe("central platform detection", () => {
    it.each([
        ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "macos", "meta"],
        ["Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "windows", "ctrl"],
        ["Mozilla/5.0 (X11; Linux aarch64)", "linux", "ctrl"],
        ["Mozilla/5.0 (darwin) AppleWebKit/537.36 jsdom/28.1.0", "macos", "meta"],
        ["Darwin arm64", "macos", "meta"],
        ["Twin browser", "unknown", "ctrl"],
        ["", "unknown", "ctrl"],
    ])("detects %s without deprecated platform reads", (userAgent, platform, modifier) => {
        vi.stubGlobal("navigator", { userAgent, get platform() { throw new Error("Deprecated API read"); } });
        expect(getPlatform()).toBe(platform);
        expect(primaryModifier()).toBe(modifier);
        expect(modKeyGlyph()).toBe(platform === "macos" ? "⌘" : "Ctrl");
    });
    it("prefers userAgentData when available", () => {
        vi.stubGlobal("navigator", { userAgentData: { platform: "macOS" }, userAgent: "Windows" });
        expect(getPlatform()).toBe("macos");
    });
});
