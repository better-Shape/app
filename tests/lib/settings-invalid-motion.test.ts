import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
    vi.resetModules();
    localStorage.clear();
});

describe("stored motion preference normalization", () => {
    it("normalizes an unknown value loaded from the established settings key", async () => {
        localStorage.setItem(
            "bettershape-settings-v1",
            JSON.stringify({ appearance: { motionPreference: "unexpected-value" } }),
        );
        const { getSettings } = await import("@/lib/settings/store");

        expect(getSettings().appearance.motionPreference).toBe("system");
    });
});
