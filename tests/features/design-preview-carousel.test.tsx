import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesignPreviewItem } from "@/features/chat/ui/blocks/gallery";

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => path }));

import { DesignPreviewCarousel } from "@/features/chat/ui/blocks/carousel";

const ITEMS: DesignPreviewItem[] = [
    { id: "one", name: "First preview", style: "A", path: "/first.png", width: 320, height: 200, kind: "png" },
    { id: "two", name: "Second preview", style: "B", path: "/second.png", width: 320, height: 200, kind: "png" },
];

function CarouselHarness() {
    const [activeIndex, setActiveIndex] = useState(0);
    return (
        <DesignPreviewCarousel
            items={ITEMS}
            activeIndex={activeIndex}
            onActiveIndexChange={setActiveIndex}
        />
    );
}

describe("design preview carousel keyboard navigation", () => {
    let host: HTMLDivElement;
    let root: Root;

    afterEach(() => {
        if (root) act(() => root.unmount());
        host?.remove();
    });

    it("changes slides immediately without remounting the preview animation", () => {
        host = document.createElement("div");
        document.body.appendChild(host);
        root = createRoot(host);
        act(() => root.render(<CarouselHarness />));
        const firstImage = host.querySelector("img");
        expect(firstImage?.getAttribute("alt")).toBe("First preview");

        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
        });

        const nextImage = host.querySelector("img");
        expect(nextImage).toBe(firstImage);
        expect(nextImage?.getAttribute("alt")).toBe("Second preview");
        expect(host.textContent).toContain("2/2");
    });
});
