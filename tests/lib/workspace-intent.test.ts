import { afterEach, describe, expect, it, vi } from "vitest";

import {
    queueSurfaceIntent,
    requestWorkspaceTab,
    takeRequestedWorkspaceTab,
    takeSurfaceIntent,
} from "@/lib/window/workspace-intent";

describe("workspace tab requests", () => {
    afterEach(() => {
        takeRequestedWorkspaceTab();
        takeSurfaceIntent("design-inspector");
        vi.restoreAllMocks();
    });

    it("dispatches the tab request and keeps it until a workspace takes it", () => {
        const seen: string[] = [];
        const listener = (event: Event) => seen.push(String((event as CustomEvent).detail));
        window.addEventListener("bettershape-set-active-tab", listener);

        requestWorkspaceTab("design");

        expect(seen).toEqual(["design"]);
        // Nothing consumed it, so the workspace that mounts next still sees it.
        expect(takeRequestedWorkspaceTab()).toBe("design");
        expect(takeRequestedWorkspaceTab()).toBeNull();
        window.removeEventListener("bettershape-set-active-tab", listener);
    });

    it("applies a queued surface intent once", () => {
        queueSurfaceIntent("design-inspector");
        expect(takeSurfaceIntent("design-inspector")).toBe(true);
        expect(takeSurfaceIntent("design-inspector")).toBe(false);
    });
});
