import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesignPreviewItem } from "@/features/chat/ui/blocks/gallery";

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => path }));

import { DesignPreviewGallery } from "@/features/chat/ui/blocks/gallery";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ITEMS: DesignPreviewItem[] = [
    { id: "one", name: "First preview", style: "A", path: "/first.png", width: 320, height: 200, kind: "png" },
    { id: "two", name: "Second preview", style: "B", path: "/second.png", width: 320, height: 200, kind: "png" },
    { id: "three", name: "Third preview", style: "C", path: "/third.png", width: 320, height: 200, kind: "png" },
];

describe("design gallery keyboard navigation", () => {
    let host: HTMLDivElement | null = null;
    let root: Root | null = null;

    afterEach(() => {
        const mountedRoot = root;
        if (mountedRoot) act(() => mountedRoot.unmount());
        host?.remove();
        root = null;
        host = null;
        document.body.style.overflow = "";
    });

    function mount() {
        host = document.createElement("div");
        document.body.appendChild(host);
        const mountedRoot = createRoot(host);
        root = mountedRoot;
        act(() => {
            mountedRoot.render(<DesignPreviewGallery previews={ITEMS} status="pending" pickId="pick-1" />);
        });
        return host;
    }

    it("swaps the enlarged preview in place instead of remounting the frame element", () => {
        const container = mount();
        const open = container.querySelector<HTMLButtonElement>('button[aria-label="Open preview"]');
        expect(open).not.toBeNull();
        act(() => open!.click());

        const dialog = document.querySelector('[role="dialog"]');
        expect(dialog).not.toBeNull();
        const firstImage = dialog!.querySelector("img");
        expect(firstImage?.getAttribute("alt")).toBe("First preview");

        // Arrow keys only belong to the enlarged view, so the strip keeps its
        // buttons as the accessible path while the dialog is closed.
        act(() => {
            document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
        });
        expect(dialog!.querySelector("img")).toBe(firstImage);
        expect(firstImage?.getAttribute("alt")).toBe("Second preview");

        act(() => {
            document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
        });
        expect(firstImage?.getAttribute("alt")).toBe("Third preview");
        // Past the last concept the key is inert rather than wrapping around.
        act(() => {
            document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
        });
        expect(firstImage?.getAttribute("alt")).toBe("Third preview");

        act(() => {
            document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        });
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
});
