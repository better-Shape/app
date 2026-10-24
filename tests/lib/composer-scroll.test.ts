import { describe, expect, it } from "vitest";
import {
    buildComposerScrollMaskImage,
    computeComposerScrollMask,
    revealComposerCaret,
    syncComposerOverlayScroll,
} from "@/lib/chat/composer-scroll";

describe("composer overlay scroll & edge masks", () => {
    it("copies scrollLeft, scrollTop, and clientWidth onto the overlay", () => {
        const overlay = { scrollLeft: 0, scrollTop: 0, style: { width: "" } };
        syncComposerOverlayScroll({ scrollLeft: 120, scrollTop: 44, clientWidth: 512 }, overlay);
        expect(overlay.scrollLeft).toBe(120);
        expect(overlay.scrollTop).toBe(44);
        expect(overlay.style.width).toBe("512px");
    });

    it("no-ops when overlay is missing", () => {
        expect(() => syncComposerOverlayScroll({ scrollLeft: 10, scrollTop: 0 }, null)).not.toThrow();
    });

    it("scrolls horizontally and vertically to the end when caret is at end of overflowing text", () => {
        const textarea = {
            selectionStart: 40,
            value: "x".repeat(40),
            scrollWidth: 400,
            clientWidth: 100,
            scrollLeft: 0,
            scrollHeight: 360,
            clientHeight: 220,
            scrollTop: 20,
        };
        expect(revealComposerCaret(textarea)).toBe(300);
        expect(textarea.scrollLeft).toBe(300);
        expect(textarea.scrollTop).toBe(140);
    });

    it("leaves scroll alone when the caret is in the middle", () => {
        const textarea = {
            selectionStart: 2,
            value: "hello world this is long",
            scrollWidth: 400,
            clientWidth: 100,
            scrollLeft: 12,
            scrollHeight: 360,
            clientHeight: 220,
            scrollTop: 24,
        };
        expect(revealComposerCaret(textarea)).toBe(12);
        expect(textarea.scrollLeft).toBe(12);
        expect(textarea.scrollTop).toBe(24);
    });

    it("computes truthful scroll-edge masks across top, middle, bottom, and non-overflowing states", () => {
        expect(computeComposerScrollMask({ scrollTop: 0, scrollHeight: 120, clientHeight: 120 })).toEqual({
            top: false,
            bottom: false,
        });
        expect(computeComposerScrollMask({ scrollTop: 0, scrollHeight: 400, clientHeight: 220 })).toEqual({
            top: false,
            bottom: true,
        });
        expect(computeComposerScrollMask({ scrollTop: 80, scrollHeight: 400, clientHeight: 220 })).toEqual({
            top: true,
            bottom: true,
        });
        expect(computeComposerScrollMask({ scrollTop: 180, scrollHeight: 400, clientHeight: 220 })).toEqual({
            top: true,
            bottom: false,
        });
    });

    it("builds a two-layer scrollbar-preserving mask-image only when an edge overflows", () => {
        expect(buildComposerScrollMaskImage({ top: false, bottom: false })).toBeUndefined();
        const mid = buildComposerScrollMaskImage({ top: true, bottom: true }, 18);
        expect(mid).toContain("linear-gradient(to left, black 8px, transparent 8px)");
        expect(mid).toContain("transparent 0px, black 18px");
        expect(mid).toContain("black calc(100% - 18px), transparent 100%");
    });
});
