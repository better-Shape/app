import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectInstallers } from "@/scripts/build/collect-installers.mjs";
let root: string;
let bundles: string;
let output: string;
beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "bettershape-installers-"));
    bundles = path.join(root, "bundle"); output = path.join(root, "output");
    await mkdir(bundles);
});
afterEach(async () => rm(root, { recursive: true, force: true }));
async function file(format: string, name: string, content = "installer") {
    await mkdir(path.join(bundles, format), { recursive: true });
    await writeFile(path.join(bundles, format, name), content);
}
describe("installer collection gate", () => {
    it("requires every requested Linux format, not merely one nonempty artifact", async () => {
        await file("deb", "BetterShape.deb");
        await expect(collectInstallers(bundles, output, "deb,rpm,appimage")).rejects.toThrow("Missing rpm");
        await expect(readdir(output)).rejects.toThrow();
    });
    it("rejects signatures and zero-byte installers", async () => {
        await file("nsis", "BetterShape.exe.sig");
        await expect(collectInstallers(bundles, output, "nsis")).rejects.toThrow("Missing nsis");
        await file("nsis", "BetterShape.exe", "");
        await expect(collectInstallers(bundles, output, "nsis")).rejects.toThrow("Empty installer");
    });
    it("collects all requested formats and writes verifiable checksums", async () => {
        await file("deb", "BetterShape.deb"); await file("rpm", "BetterShape.rpm"); await file("appimage", "BetterShape.AppImage");
        const names = await collectInstallers(bundles, output, "deb,rpm,appimage");
        expect(names).toHaveLength(3);
        const sums = await readFile(path.join(output, "SHA256SUMS.txt"), "utf8");
        for (const name of names) {
            const bytes = await readFile(path.join(output, name));
            expect(sums).toContain(`${createHash("sha256").update(bytes).digest("hex")}  ${name}\n`);
        }
        await expect(collectInstallers(bundles, output, "deb,rpm,appimage")).rejects.toThrow("must be empty");
    });
});
