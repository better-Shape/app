import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IndexingProgressBar } from "@/features/settings/ui/sections/index-progress";

describe("indexing progress semantics", () => {
    function renderProgress(props: Parameters<typeof IndexingProgressBar>[0]) {
        const host = document.createElement("div");
        host.innerHTML = renderToStaticMarkup(<IndexingProgressBar {...props} />);
        return host.querySelector<HTMLElement>('[role="progressbar"]')!;
    }

    it("stays indeterminate and says saving while the index is being persisted", () => {
        const progress = renderProgress({
            indexing: true,
            phase: "persisting",
            percent: 100,
            status: { filesIndexed: 12, totalFiles: 12, chunks: 48 },
        });

        expect(progress.hasAttribute("aria-valuenow")).toBe(false);
        expect(progress.getAttribute("aria-valuetext")).toBe("Saving index");
        expect(progress.querySelector(".bettershape-loading-progress")).not.toBeNull();
    });

    it("caps an active determinate value below completion until the done event", () => {
        const progress = renderProgress({
            indexing: true,
            phase: "indexing",
            percent: 100,
            status: { filesIndexed: 12, totalFiles: 12, chunks: 48 },
        });

        expect(progress.getAttribute("aria-valuenow")).toBe("99");
        expect(progress.getAttribute("aria-valuetext")).toBe("Indexing 99%");
    });

    it("announces completion only after indexing stops", () => {
        const progress = renderProgress({
            indexing: false,
            phase: undefined,
            percent: 100,
            status: { filesIndexed: 12, totalFiles: 12, chunks: 48 },
        });

        expect(progress.getAttribute("aria-valuenow")).toBe("100");
        expect(progress.getAttribute("aria-valuetext")).toBe("Indexed");
    });
});
