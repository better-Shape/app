import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { collectUnixBundles } from "../../scripts/release/assets.mjs";
let root: string;
let release: string;
let output: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "bettershape-assets-")); release = join(root, "release"); output = join(root, "output"); mkdirSync(output); });
afterEach(() => rmSync(root, { recursive: true, force: true }));
function file(format: string, name: string, contents = "installer") {
    const dir = join(release, "bundle", format); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, name), contents);
}
it("fails closed when a requested Linux format is absent or empty", () => {
    expect(() => collectUnixBundles(release, output, "x86_64", "linux")).toThrow("No bundle directory");
    file("deb", "app.deb"); file("rpm", "app.rpm");
    expect(() => collectUnixBundles(release, output, "x86_64", "linux")).toThrow("appimage");
    file("appimage", "app.AppImage", "");
    expect(() => collectUnixBundles(release, output, "x86_64", "linux")).toThrow("appimage");
    expect(readdirSync(output)).toEqual([]);
});
it("collects every Linux format", () => {
    file("deb", "app.deb"); file("rpm", "app.rpm"); file("appimage", "app.AppImage");
    collectUnixBundles(release, output, "aarch64", "linux");
    expect(readdirSync(output).sort()).toEqual(["app.AppImage", "app.deb", "app.rpm"]);
});
it("names macOS application archives by architecture to prevent release upload collisions", () => {
    file("dmg", "app.dmg"); file("macos/BetterShape.app/Contents", "Info.plist");
    file("macos/BetterShape.app/Contents/MacOS", "app");
    collectUnixBundles(release, output, "aarch64", "darwin");
    collectUnixBundles(release, output, "x86_64", "darwin");
    expect(readdirSync(output)).toEqual(expect.arrayContaining(["BetterShape-aarch64.app.tar.gz", "BetterShape-x86_64.app.tar.gz"]));
});

it("rejects empty or incomplete macOS application directories", () => {
    file("dmg", "app.dmg");
    mkdirSync(join(release, "bundle", "macos", "BetterShape.app"), { recursive: true });
    expect(() => collectUnixBundles(release, output, "aarch64", "darwin")).toThrow("macos");
    file("macos/BetterShape.app/Contents", "Info.plist");
    expect(() => collectUnixBundles(release, output, "aarch64", "darwin")).toThrow("macos");
    file("macos/BetterShape.app/Contents/MacOS", "app", "");
    expect(() => collectUnixBundles(release, output, "aarch64", "darwin")).toThrow("macos");
    expect(readdirSync(output)).toEqual([]);
});
