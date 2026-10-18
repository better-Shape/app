import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GraphLoadingStatus } from "@/features/git/ui/graph/graph-loading-status";

describe("Git graph loading status", () => {
    it("announces loading without keeping its own status live region busy", () => {
        const host = document.createElement("div");
        host.innerHTML = renderToStaticMarkup(<GraphLoadingStatus />);
        const status = host.querySelector<HTMLElement>('[role="status"]');

        expect(status?.textContent).toContain("Loading commits");
        expect(status?.hasAttribute("aria-busy")).toBe(false);
    });
});
