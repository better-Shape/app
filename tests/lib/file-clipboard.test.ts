import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    lsDir: vi.fn(async (_path: string) => [] as { name: string; path: string; is_dir: boolean; }[]),
    copyPath: vi.fn(async (_from: string, _to: string) => undefined),
    renamePath: vi.fn(async (_from: string, _to: string) => undefined),
}));

vi.mock("@/lib/backend", () => ({ commands: mocks }));

import {
    baseName,
    clearFileClipboard,
    getFileClipboard,
    joinPath,
    parentDir,
    pasteFileClipboard,
    setFileClipboard,
    subscribeFileClipboard,
} from "@/lib/workspace/file-clipboard";

const entries = (...names: string[]) =>
    names.map((name) => ({ name, path: `/repo/${name}`, is_dir: false }));

describe("file-clipboard", () => {
    beforeEach(() => {
        clearFileClipboard();
        vi.clearAllMocks();
        mocks.lsDir.mockResolvedValue([]);
    });

    it("splits and joins paths for both separators", () => {
        expect(parentDir("/repo/src/app.ts")).toBe("/repo/src");
        expect(parentDir("C:\\repo\\src\\app.ts")).toBe("C:\\repo\\src");
        expect(baseName("/repo/src/app.ts")).toBe("app.ts");
        expect(baseName("C:\\repo\\src")).toBe("src");
        expect(joinPath("/repo/src", "a.ts")).toBe("/repo/src/a.ts");
        expect(joinPath("C:\\repo\\src", "a.ts")).toBe("C:\\repo\\src\\a.ts");
    });

    it("holds one clipboard at a time and clears when empty", () => {
        setFileClipboard("copy", ["/repo/a.ts", "/repo/a.ts", "  "]);
        expect(getFileClipboard()).toEqual({ mode: "copy", paths: ["/repo/a.ts"] });
        setFileClipboard("cut", []);
        expect(getFileClipboard()).toBeNull();
    });

    it("notifies subscribers on every change", () => {
        const seen = vi.fn();
        const unsubscribe = subscribeFileClipboard(seen);
        setFileClipboard("copy", ["/repo/a.ts"]);
        clearFileClipboard();
        unsubscribe();
        setFileClipboard("copy", ["/repo/b.ts"]);
        expect(seen).toHaveBeenCalledTimes(2);
    });

    it("copies under the original name when nothing is in the way", async () => {
        setFileClipboard("copy", ["/repo/src/app.ts"]);
        const written = await pasteFileClipboard("/repo/other");
        expect(mocks.copyPath).toHaveBeenCalledWith("/repo/src/app.ts", "/repo/other/app.ts");
        expect(written).toEqual(["/repo/other/app.ts"]);
        // A copy is repeatable.
        expect(getFileClipboard()).toEqual({ mode: "copy", paths: ["/repo/src/app.ts"] });
    });

    it("never overwrites: a taken name gets a copy suffix, keeping the extension", async () => {
        mocks.lsDir.mockResolvedValue(entries("app.ts", "app copy.ts"));
        setFileClipboard("copy", ["/repo/src/app.ts"]);
        const written = await pasteFileClipboard("/repo/other");
        expect(mocks.copyPath).toHaveBeenCalledWith("/repo/src/app.ts", "/repo/other/app copy 2.ts");
        expect(written).toEqual(["/repo/other/app copy 2.ts"]);
    });

    it("moves on a cut, then clears so the same move cannot replay", async () => {
        setFileClipboard("cut", ["/repo/src/app.ts"]);
        const written = await pasteFileClipboard("/repo/other");
        expect(mocks.renamePath).toHaveBeenCalledWith("/repo/src/app.ts", "/repo/other/app.ts");
        expect(mocks.copyPath).not.toHaveBeenCalled();
        expect(getFileClipboard()).toBeNull();
        expect(written).toEqual(["/repo/other/app.ts"]);
    });

    it("refuses a cut onto an existing name instead of replacing it", async () => {
        mocks.lsDir.mockResolvedValue(entries("app.ts"));
        setFileClipboard("cut", ["/repo/src/app.ts"]);
        await expect(pasteFileClipboard("/repo/other")).rejects.toThrow(/already exists/);
        expect(mocks.renamePath).not.toHaveBeenCalled();
        // The clipboard survives so the user can retry elsewhere.
        expect(getFileClipboard()).not.toBeNull();
    });

    it("skips a cut that is pasted back into its own folder", async () => {
        setFileClipboard("cut", ["/repo/src/app.ts"]);
        const written = await pasteFileClipboard("/repo/src");
        expect(written).toEqual([]);
        expect(mocks.renamePath).not.toHaveBeenCalled();
    });

    it("refuses to paste a folder into itself or a child of itself", async () => {
        setFileClipboard("copy", ["/repo/src"]);
        await expect(pasteFileClipboard("/repo/src")).rejects.toThrow(/into itself/);
        await expect(pasteFileClipboard("/repo/src/deep")).rejects.toThrow(/into itself/);
        expect(mocks.copyPath).not.toHaveBeenCalled();
    });

    it("does nothing without a clipboard or a target", async () => {
        expect(await pasteFileClipboard("/repo/other")).toEqual([]);
        setFileClipboard("copy", ["/repo/src/app.ts"]);
        await expect(pasteFileClipboard("  ")).rejects.toThrow(/Nothing to paste into/);
        expect(mocks.copyPath).not.toHaveBeenCalled();
    });

    it("tells the explorer to refresh after a paste", async () => {
        const refresh = vi.fn();
        window.addEventListener("bettershape-files-changed", refresh);
        setFileClipboard("copy", ["/repo/src/app.ts"]);
        await pasteFileClipboard("/repo/other");
        window.removeEventListener("bettershape-files-changed", refresh);
        expect(refresh).toHaveBeenCalledTimes(1);
    });
});
