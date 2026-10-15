import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { steerFrame } from "@/features/agent/workspace/browser";

function makeFrame(): HTMLIFrameElement {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    return frame;
}

/** jsdom cannot hold a real cross-origin frame, so the reload branch gets the
 *  only shape it can see: a window whose location records the call. */
function frameWithReload(reload: () => void): HTMLIFrameElement {
    return { contentWindow: { location: { reload } } } as unknown as HTMLIFrameElement;
}

afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
});

describe.each([
    ["Linux", "Mozilla/5.0 (X11; Linux x86_64)"],
    ["macOS", "Mozilla/5.0 (darwin) AppleWebKit/537.36 jsdom/28.1.0"],
])("page frame steering on %s", (_platform, userAgent) => {
    beforeEach(() => vi.stubGlobal("navigator", { userAgent }));
    it("navigates the frame by url when the page cannot be scripted", () => {
        const frame = makeFrame();
        frame.src = "https://example.com/first";
        expect(steerFrame(frame, "goto", "https://example.com/second")).toBe(true);
        expect(frame.src).toBe("https://example.com/second");
    });

    it("reloads through the frame's own location", () => {
        const reload = vi.fn();
        expect(steerFrame(frameWithReload(reload), "reload")).toBe(true);
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it("leaves Windows to the injected page script", () => {
        vi.stubGlobal("navigator", { platform: "Win32", userAgent: "Windows" });
        const frame = makeFrame();
        frame.src = "https://example.com/first";
        const reload = vi.fn();
        expect(steerFrame(frame, "goto", "https://example.com/second")).toBe(false);
        expect(frame.src).toBe("https://example.com/first");
        expect(steerFrame(frameWithReload(reload), "reload")).toBe(false);
        expect(reload).not.toHaveBeenCalled();
    });

    it("reports a missing frame instead of throwing", () => {
        expect(steerFrame(null, "reload")).toBe(false);
        expect(steerFrame(undefined, "goto", "https://example.com")).toBe(false);
    });
});