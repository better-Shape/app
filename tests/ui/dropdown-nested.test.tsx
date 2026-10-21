import { act, useState, type MouseEventHandler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuNested,
    DropdownMenuNestedContent,
    DropdownMenuNestedTrigger,
} from "@/components/ui/dropdown";

function NestedMenuHarness({ onClick }: { onClick: MouseEventHandler<HTMLDivElement> }) {
    const [open, setOpen] = useState(false);
    return (
        <DropdownMenu open onOpenChange={() => {}}>
            <DropdownMenuContent portalled={false}>
                <DropdownMenuNested open={open} onOpenChange={setOpen}>
                    <DropdownMenuNestedTrigger data-testid="nested-trigger" onClick={onClick}>
                        Nested menu
                    </DropdownMenuNestedTrigger>
                    <DropdownMenuNestedContent>
                        <span data-testid="nested-child">Submenu item</span>
                    </DropdownMenuNestedContent>
                </DropdownMenuNested>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

describe("nested menu triggers", () => {
    let host: HTMLDivElement | undefined;
    let root: Root | undefined;

    afterEach(() => {
        if (root) act(() => root?.unmount());
        host?.remove();
        root = undefined;
        host = undefined;
        vi.unstubAllGlobals();
    });

    it("runs a custom click handler without replacing submenu toggling", () => {
        vi.stubGlobal("ResizeObserver", class {
            observe() {}
            disconnect() {}
        });
        const onClick = vi.fn();
        host = document.createElement("div");
        document.body.appendChild(host);
        root = createRoot(host);
        act(() => root?.render(<NestedMenuHarness onClick={onClick} />));

        const trigger = host.querySelector<HTMLElement>("[data-testid='nested-trigger']");
        const child = host.querySelector<HTMLElement>("[data-testid='nested-child']");
        expect(trigger?.getAttribute("aria-expanded")).toBe("false");
        expect(child?.closest("[aria-hidden]")?.getAttribute("aria-hidden")).toBe("true");

        act(() => {
            trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        });

        expect(onClick).toHaveBeenCalledOnce();
        expect(trigger?.getAttribute("aria-expanded")).toBe("true");
        expect(child?.closest("[aria-hidden]")?.getAttribute("aria-hidden")).toBe("false");
    });
});
