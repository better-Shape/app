import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/dropdown", () => ({
    DropdownMenu: ({ children }: { children: ReactNode }) => children,
    DropdownMenuContent: ({ children }: { children: ReactNode }) => children,
    DropdownMenuTrigger: ({ children }: { children: ReactNode }) => children,
}));

import { ThinkingEffortControl } from "@/features/chat/ui/composer/thinking-bar";
import type { ReasoningEffort } from "@/features/chat/ui/composer/reasoning-effort";

describe("ThinkingEffortControl keyboard range input", () => {
    let host: HTMLDivElement | undefined;
    let root: Root | undefined;

    afterEach(() => {
        if (root) act(() => root?.unmount());
        host?.remove();
        root = undefined;
        host = undefined;
    });

    it.each([
        { key: "ArrowUp", effort: "low", value: "1", expected: "high" },
        { key: "ArrowDown", effort: "high", value: "0", expected: "low" },
    ] as const)("commits native $key changes", ({ key, effort, value, expected }) => {
        const onChange = vi.fn<(next: ReasoningEffort) => void>();
        host = document.createElement("div");
        document.body.appendChild(host);
        root = createRoot(host);
        act(() => {
            root?.render(
                <ThinkingEffortControl
                    effort={effort}
                    modelId="gpt-5"
                    onChange={onChange}
                />,
            );
        });

        const slider = host.querySelector<HTMLInputElement>('input[type="range"]');
        expect(slider).not.toBeNull();
        if (!slider) return;

        act(() => {
            slider.value = value;
            slider.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
        });

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith(expected);
    });
});
