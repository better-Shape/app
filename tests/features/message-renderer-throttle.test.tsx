import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/chat/ui/md/view", () => ({
    ChatMarkdown: ({ content }: { content: string }) => <p>{content}</p>,
}));

import { MessageRenderer } from "@/features/chat/ui/md/renderer";

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
    if (root) act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
    vi.useRealTimers();
});

describe("MessageRenderer streaming parse cadence", () => {
    it("coalesces token updates and commits the latest prose at the next parse tick", async () => {
        vi.useFakeTimers();
        host = document.createElement("div");
        document.body.appendChild(host);
        root = createRoot(host);

        await act(async () => {
            root?.render(<MessageRenderer content="A streaming answer" isGenerating />);
        });
        await act(async () => {
            root?.render(<MessageRenderer content="A streaming answer with a new token" isGenerating />);
        });

        expect(host.textContent).toContain("A streaming answer");
        expect(host.textContent).not.toContain("new token");
        await act(async () => {
            await vi.advanceTimersByTimeAsync(100);
        });
        expect(host.textContent).toContain("A streaming answer with a new token");
    });
});
