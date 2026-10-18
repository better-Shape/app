import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prefersReducedMotion } from "@/lib/ui/motion";

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

function setMatchMedia(matches: boolean) {
    Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: vi.fn(() => ({ matches }) as MediaQueryList),
    });
}

beforeEach(() => {
    delete document.documentElement.dataset.motionPreference;
    setMatchMedia(false);
});

afterEach(() => {
    delete document.documentElement.dataset.motionPreference;
    if (originalMatchMedia) {
        Object.defineProperty(window, "matchMedia", originalMatchMedia);
    } else {
        Reflect.deleteProperty(window, "matchMedia");
    }
});

describe("prefersReducedMotion", () => {
    it("uses the persisted app preference before the operating-system preference", () => {
        setMatchMedia(false);
        document.documentElement.dataset.motionPreference = "reduced";
        expect(prefersReducedMotion()).toBe(true);

        delete document.documentElement.dataset.motionPreference;
        expect(prefersReducedMotion()).toBe(false);
    });

    it("reads the operating-system preference live when the app follows the system", () => {
        setMatchMedia(true);
        expect(prefersReducedMotion()).toBe(true);

        setMatchMedia(false);
        expect(prefersReducedMotion()).toBe(false);
    });

    it("fails safely if matchMedia is unavailable or throws", () => {
        Reflect.deleteProperty(window, "matchMedia");
        expect(prefersReducedMotion()).toBe(false);

        Object.defineProperty(window, "matchMedia", {
            configurable: true,
            value: vi.fn(() => {
                throw new Error("unavailable");
            }),
        });
        expect(prefersReducedMotion()).toBe(false);
    });
});
