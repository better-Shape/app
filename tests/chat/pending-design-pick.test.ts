import { afterEach, describe, expect, it } from "vitest";
import { shouldAnnouncePendingDesignPick } from "@/lib/agent-preview/pending-notice";

function anchorAt(doc: Document, rect: Partial<DOMRect>): void {
    const element = doc.createElement("div");
    element.setAttribute("data-pending-approval-kind", "approval");
    element.getBoundingClientRect = () =>
        ({
            top: 0,
            left: 0,
            right: 320,
            bottom: 200,
            width: 320,
            height: 200,
            x: 0,
            y: 0,
            toJSON: () => ({}),
            ...rect,
        }) as DOMRect;
    doc.body.appendChild(element);
}

describe("pending design pick announcement", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("announces when no gallery is on screen", () => {
        expect(shouldAnnouncePendingDesignPick(document)).toBe(true);
    });

    it("stays quiet while the gallery is visible", () => {
        anchorAt(document, { top: 100, bottom: 300, height: 200 });
        expect(shouldAnnouncePendingDesignPick(document)).toBe(false);
    });

    it("announces when the gallery has been scrolled past", () => {
        anchorAt(document, { top: -400, bottom: -200, height: 200 });
        expect(shouldAnnouncePendingDesignPick(document)).toBe(true);
    });

    it("ignores a collapsed gallery that cannot be seen anyway", () => {
        anchorAt(document, { top: 10, bottom: 10, height: 0 });
        expect(shouldAnnouncePendingDesignPick(document)).toBe(true);
    });
});
