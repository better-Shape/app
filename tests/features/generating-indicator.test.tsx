import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeneratingIndicator } from "@/features/chat/ui/blocks/generating";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
});

describe("GeneratingIndicator contextual leader", () => {
    it("renders live contextual status text with .t-think shimmer and morphs cleanly", async () => {
        await act(async () => {
            root.render(<GeneratingIndicator label="Thinking" />);
        });

        const status = host.querySelector('[role="status"]');
        expect(status).not.toBeNull();
        expect(status?.getAttribute("aria-label")).toBe("Thinking");
        expect(host.querySelector(".t-think-text")?.getAttribute("data-text")).toBe("Thinking");

        await act(async () => {
            root.render(<GeneratingIndicator label="Editing input.tsx" />);
        });
        expect(status?.getAttribute("aria-label")).toBe("Editing input.tsx");
        expect(host.textContent).toContain("Editing input.tsx");
    });

    it("reveals tabular elapsed seconds after 2s when showTimer is enabled and hides when disabled", async () => {
        await act(async () => {
            root.render(<GeneratingIndicator label="Searching" showTimer />);
        });
        expect(host.textContent).not.toContain("2s");

        await act(async () => {
            vi.advanceTimersByTime(3100);
        });
        expect(host.textContent).toContain("3s");

        await act(async () => {
            root.render(<GeneratingIndicator label="Searching" showTimer={false} />);
        });
        expect(host.textContent).not.toContain("3s");
    });
});
