import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "bettershape-resolved-files";

async function freshModule() {
    vi.resetModules();
    localStorage.clear();
    return import("@/features/chat/lib/proposed-edits");
}

describe("resolved-file memo", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("does not re-parse the same stored text", async () => {
        const mod = await freshModule();
        mod.markFileResolved("conv", "src/a.ts", "applied");
        const parse = vi.spyOn(JSON, "parse");
        expect(mod.isFileResolved("conv", "src/a.ts")).toBe(true);
        expect(mod.isFileResolved("conv", "src/a.ts")).toBe(true);
        expect(parse).not.toHaveBeenCalled();
        parse.mockRestore();
    });

    it("serves the update after a successful write", async () => {
        const mod = await freshModule();
        mod.markFileResolved("conv", "src/a.ts", "applied");
        mod.markFileResolved("conv", "src/b.ts", "applied");
        expect(mod.isFileResolved("conv", "src/a.ts")).toBe(true);
        expect(mod.isFileResolved("conv", "src/b.ts")).toBe(true);
    });

    it("falls back to persisted storage when the write fails", async () => {
        const mod = await freshModule();
        mod.markFileResolved("conv", "src/a.ts", "applied");

        const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("quota exceeded");
        });
        mod.markFileResolved("conv", "src/b.ts", "applied");
        setItem.mockRestore();

        // b.ts never reached storage, so it must not read as resolved.
        expect(mod.isFileResolved("conv", "src/b.ts")).toBe(false);
        expect(mod.isFileResolved("conv", "src/a.ts")).toBe(true);
        // And the persisted payload really is the old one.
        expect(localStorage.getItem(KEY)).not.toContain("src/b.ts");
    });

    it("notices a write from another window", async () => {
        const mod = await freshModule();
        mod.markFileResolved("conv", "src/a.ts", "applied");
        // Simulate a second window writing the same key.
        localStorage.setItem(
            KEY,
            JSON.stringify({ conv: { "src/c.ts": { status: "applied" } } }),
        );
        expect(mod.isFileResolved("conv", "src/c.ts")).toBe(true);
        expect(mod.isFileResolved("conv", "src/a.ts")).toBe(false);
    });
});
