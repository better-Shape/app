import { describe, expect, it } from "vitest";
import { designPreviewSessionId } from "@/lib/agent-preview/store";
import type { DesignPreviewItem } from "@/features/chat/ui/blocks/gallery";

const item = (id: string): DesignPreviewItem => ({
    id,
    name: id,
    style: "default",
    path: `/tmp/${id}.html`,
    width: 800,
    height: 600,
});

describe("design preview session ids", () => {
    // The tab id is derived from an int32 hash, so the same preview set must keep
    // the same tab across reloads. A refactor away from `| 0` has to preserve it.
    it("keeps the int32 fingerprint for the same preview set", () => {
        expect(designPreviewSessionId([item("a"), item("b")])).toBe("p22yv");
    });

    it("is stable for the same order and falls back when no identifier is usable", () => {
        expect(designPreviewSessionId([item("a"), item("b")])).toBe(
            designPreviewSessionId([item("a"), item("b")]),
        );
        expect(designPreviewSessionId([{ ...item("a"), id: "", path: "" }])).toMatch(/^preview-\d+$/);
    });
});
