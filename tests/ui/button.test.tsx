import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";
import { SuppressNativeTooltips } from "@/components/ui/suppress-native-tooltips";

describe("Button", () => {
    let host: HTMLDivElement | undefined;
    let root: Root | undefined;

    afterEach(() => {
        if (root) act(() => root?.unmount());
        host?.remove();
        root = undefined;
        host = undefined;
    });

    it("renders an intentional native title from the server pass", () => {
        const markup = renderToString(<Button title="Save changes">Save</Button>);

        expect(markup).toContain('title="Save changes"');
        expect(markup).toContain('data-preserve-native-title=""');
        expect(markup).not.toContain("data-native-title");
    });

    it("keeps Button titles while suppressing incidental native tooltips", async () => {
        host = document.createElement("div");
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(
                <>
                    <SuppressNativeTooltips />
                    <Button title="Save changes">Save</Button>
                    <button type="button" title="Incidental title">Other</button>
                </>,
            );
        });
        await act(async () => {
            // The strip waits for the first pointer movement rather than rewriting
            // attributes during hydration, so this is the gesture it is built for.
            document.body.dispatchEvent(new Event("pointermove", { bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        const saveButton = host.querySelector<HTMLButtonElement>("button[data-preserve-native-title]");
        const otherButton = [...host.querySelectorAll<HTMLButtonElement>("button")]
            .find((button) => button.textContent === "Other");
        expect(saveButton?.getAttribute("title")).toBe("Save changes");
        expect(otherButton?.hasAttribute("title")).toBe(false);
        expect(otherButton?.getAttribute("data-native-title")).toBe("Incidental title");
    });
});
