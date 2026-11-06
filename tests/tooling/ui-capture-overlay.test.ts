import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

type CaptureOverlay = { set: (x: number, y: number) => void; move: (x: number, y: number) => void; destroy: () => void };

const overlaySource = readFileSync(join(process.cwd(), ".agents/skills/ui-capture/scripts/overlay.js"), "utf8");

/** Runs the overlay script as Playwright's init script would, and returns its API and marks. */
const mountOverlay = () => {
    window.eval(overlaySource);
    const api = (window as unknown as { __uicap: CaptureOverlay }).__uicap;
    const host = [...document.documentElement.children].find((element) => element.shadowRoot);
    const mark = (name: string) => host?.shadowRoot?.querySelector<HTMLElement>(`.${name}`);
    return { api, ring: mark("ring"), ripple: mark("ripple") };
};

afterEach(() => {
    (window as unknown as { __uicap?: CaptureOverlay }).__uicap?.destroy();
});

describe("ui-capture overlay", () => {
    it("puts the press ring and the click ripple on the pointer, where their scale animation keeps them", () => {
        const { api, ring, ripple } = mountOverlay();
        api.set(300, 200);
        // `translate` composes with the keyframes' `transform: scale()`; a translated `transform`
        // would be replaced by them, and the marks drew in the top-left corner.
        expect(ring?.style.translate).toBe("300px 200px");
        expect(ripple?.style.translate).toBe("300px 200px");
        expect(ring?.style.transform).toBe("");
        expect(ripple?.style.transform).toBe("");
        api.move(40, 60);
        expect(ripple?.style.translate).toBe("40px 60px");
    });
});
