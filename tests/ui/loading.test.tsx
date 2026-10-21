import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { LoadingBar } from "@/components/ui/loading";
import { LoadingProvider, useLoading } from "@/features/loading/context";

function LoadingHarness() {
    const { isLoading, startLoading, stopLoading } = useLoading();
    return (
        <>
            <button type="button" onClick={() => (isLoading ? stopLoading() : startLoading())}>
                Toggle loading
            </button>
            <LoadingBar />
        </>
    );
}

describe("global loading bar", () => {
    let host: HTMLDivElement;
    let root: Root;

    afterEach(() => {
        if (root) act(() => root.unmount());
        host?.remove();
    });

    it("is hidden from assistive technology while idle and labeled while active", () => {
        host = document.createElement("div");
        document.body.appendChild(host);
        root = createRoot(host);
        act(() => root.render(<LoadingProvider><LoadingHarness /></LoadingProvider>));

        expect(host.querySelector('[role="progressbar"]')).toBeNull();
        expect(host.querySelector('[aria-hidden="true"]')).not.toBeNull();

        act(() => host.querySelector("button")?.click());
        const activeProgress = host.querySelector<HTMLElement>('[role="progressbar"]');
        expect(activeProgress?.getAttribute("aria-label")).toBe("Loading");
        expect(activeProgress?.querySelector(".bettershape-loading-progress")).not.toBeNull();

        act(() => host.querySelector("button")?.click());
        expect(host.querySelector('[role="progressbar"]')).toBeNull();
    });
});
