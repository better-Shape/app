import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PlanningBlock } from "@/features/chat/ui/blocks/plan";

describe("PlanningBlock disclosure semantics", () => {
    it("keeps the collapsed summary outside the controlled full list", () => {
        const markup = renderToStaticMarkup(
            <PlanningBlock
                steps={[
                    { label: "One", status: "done" },
                    { label: "Two", status: "done" },
                    { label: "Three", status: "done" },
                    { label: "Four", status: "pending" },
                    { label: "Five", status: "pending" },
                    { label: "Active task", status: "active" },
                ]}
                completedCount={3}
                totalCount={6}
                isGenerating
            />,
        );
        const host = document.createElement("div");
        host.innerHTML = markup;

        const control = host.querySelector<HTMLButtonElement>("button[aria-controls]");
        const panelId = control?.getAttribute("aria-controls");
        const controlledPanel = panelId ? host.querySelector<HTMLElement>(`#${panelId}`) : null;

        expect(control?.getAttribute("aria-expanded")).toBe("false");
        expect(controlledPanel).not.toBeNull();
        expect(controlledPanel?.hidden).toBe(true);
        expect(controlledPanel?.textContent).not.toContain("Active task");
        expect(host.textContent).toContain("Active task");
    });

    it("uses unambiguous keys for repeated and suffix-like step labels", () => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        const root = createRoot(host);
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        try {
            act(() => {
                root.render(
                    <PlanningBlock
                        steps={[
                            { label: "Build", status: "done" },
                            { label: "Build", status: "active" },
                            { label: "Build-1", status: "pending" },
                        ]}
                        completedCount={1}
                        totalCount={3}
                        isGenerating
                    />,
                );
            });

            expect(errorSpy.mock.calls.some(([message]) => String(message).includes("same key"))).toBe(false);
        } finally {
            act(() => root.unmount());
            host.remove();
            errorSpy.mockRestore();
        }
    });
});
