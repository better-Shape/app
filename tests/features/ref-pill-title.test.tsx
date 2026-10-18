import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SuppressNativeTooltips } from "@/components/ui/suppress-native-tooltips";
import { RefPill } from "@/features/git/ui/graph/ref-pill";

const REF_INFO = {
    label: "feature/a-long-branch-name",
    isRemote: false,
    isHead: false,
    isTag: false,
} as const;

const TITLE = "Branch: feature/a-long-branch-name";

async function mount(pill: ReactNode) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
        root.render(
            <>
                <SuppressNativeTooltips />
                {pill}
            </>,
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return { host, root };
}

describe("RefPill native title preservation", () => {
    let host: HTMLDivElement | undefined;
    let root: Root | undefined;

    afterEach(() => {
        if (root) act(() => root?.unmount());
        host?.remove();
        root = undefined;
        host = undefined;
    });

    it("keeps the activated ref's title through global suppression", async () => {
        const onActivate = vi.fn();
        ({ host, root } = await mount(
            <RefPill refInfo={REF_INFO} color="var(--color-accent)" onActivate={onActivate} />,
        ));

        const button = host.querySelector<HTMLButtonElement>("button[aria-label]");
        expect(button?.getAttribute("title")).toBe(TITLE);
        expect(button?.getAttribute("data-preserve-native-title")).toBe("");
        expect(button?.hasAttribute("data-native-title")).toBe(false);
    });

    it("keeps the manager-only ref title through global suppression", async () => {
        ({ host, root } = await mount(
            <RefPill refInfo={REF_INFO} color="var(--color-accent)" hoverOnly />,
        ));

        const pill = host.querySelector<HTMLElement>("span[title]");
        expect(pill?.getAttribute("title")).toBe(TITLE);
        expect(pill?.getAttribute("data-preserve-native-title")).toBe("");
        expect(pill?.hasAttribute("data-native-title")).toBe(false);
    });
});
