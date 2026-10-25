import { act, createElement } from "react";
import { hydrateRoot, createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prefersReducedMotion } from "@/lib/ui/motion";
import { useReducedMotion } from "@/lib/ui/use-reduced-motion";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

function setMatchMedia(matches: boolean) {
    const queryList = {
        matches,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    } as unknown as MediaQueryList;
    const matcher = vi.fn((query: string) => {
        expect(query).toBe(REDUCED_MOTION_QUERY);
        return queryList;
    });
    Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: matcher,
    });
    return matcher;
}

function MotionProbe() {
    const reduced = useReducedMotion();
    return createElement("span", { "data-reduced": String(reduced) }, reduced ? "reduced" : "full");
}

function mountProbe() {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(createElement(MotionProbe)));
    return { host, root };
}

function unmountProbe(root: Root, host: HTMLElement) {
    act(() => root.unmount());
    host.remove();
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

describe("useReducedMotion", () => {
    it("subscribes safely when matchMedia is unavailable", () => {
        Reflect.deleteProperty(window, "matchMedia");
        const { host, root } = mountProbe();
        expect(host.textContent).toBe("full");
        unmountProbe(root, host);
    });

    it("uses the exact reduced-motion query for its OS subscription", () => {
        const matcher = setMatchMedia(true);
        const { host, root } = mountProbe();
        expect(host.textContent).toBe("reduced");
        expect(matcher).toHaveBeenCalledWith(REDUCED_MOTION_QUERY);
        unmountProbe(root, host);
    });

    it("keeps server and initial client markup equal before applying the saved preference", async () => {
        document.documentElement.dataset.motionPreference = "reduced";
        const markup = renderToString(createElement(MotionProbe));
        expect(markup).toContain('data-reduced="false"');

        const host = document.createElement("div");
        host.innerHTML = markup;
        document.body.appendChild(host);
        const recoverableErrors = vi.fn();
        let root: ReturnType<typeof hydrateRoot> | undefined;
        await act(async () => {
            root = hydrateRoot(host, createElement(MotionProbe), {
                onRecoverableError: recoverableErrors,
            });
        });

        expect(recoverableErrors).not.toHaveBeenCalled();
        expect(host.textContent).toBe("reduced");
        const hydrated = root;
        if (hydrated) {
            act(() => {
                hydrated.unmount();
            });
        }
        host.remove();
    });

    it("tracks operating-system preference changes after mount", () => {
        let matches = false;
        let onChange: ((event: Event) => void) | undefined;
        const queryList = {
            get matches() {
                return matches;
            },
            addEventListener: vi.fn((_type: string, listener: EventListener) => {
                onChange = listener;
            }),
            removeEventListener: vi.fn(),
        } as unknown as MediaQueryList;
        Object.defineProperty(window, "matchMedia", {
            configurable: true,
            value: vi.fn(() => queryList),
        });

        const { host, root } = mountProbe();
        try {
            expect(host.textContent).toBe("full");
            act(() => {
                matches = true;
                onChange?.(new Event("change"));
            });
            expect(host.textContent).toBe("reduced");

            act(() => {
                matches = false;
                onChange?.(new Event("change"));
            });
            expect(host.textContent).toBe("full");
        } finally {
            unmountProbe(root, host);
        }
    });

    it("tracks saved application preference changes after mount", async () => {
        const { host, root } = mountProbe();
        try {
            await act(async () => {
                document.documentElement.dataset.motionPreference = "reduced";
                await new Promise((resolve) => setTimeout(resolve, 0));
            });
            expect(host.textContent).toBe("reduced");

            await act(async () => {
                delete document.documentElement.dataset.motionPreference;
                await new Promise((resolve) => setTimeout(resolve, 0));
            });
            expect(host.textContent).toBe("full");
        } finally {
            unmountProbe(root, host);
        }
    });
});
