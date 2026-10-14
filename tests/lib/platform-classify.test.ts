import { afterEach, describe, expect, it, vi } from "vitest";
import { getPlatform, isWindows } from "@/lib/platform";

function stubNavigator(platform: string, userAgent: string) {
    vi.stubGlobal("navigator", { platform, userAgent });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("platform classification", () => {
    it("classifies a darwin user agent as macOS, not Windows", () => {
        // jsdom builds its default UA from process.platform, so this is what the macOS CI runner sees.
        stubNavigator("", "Mozilla/5.0 (darwin) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/29.1.1");
        expect(getPlatform()).toBe("macos");
        expect(isWindows()).toBe(false);
    });

    it("still detects real Windows signals", () => {
        stubNavigator("Win32", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
        expect(getPlatform()).toBe("windows");
        expect(isWindows()).toBe(true);
    });

    it("still detects macOS browsers", () => {
        stubNavigator("MacIntel", "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)");
        expect(getPlatform()).toBe("macos");
    });
});
