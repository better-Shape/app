import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, cssToken } from "../helpers/contrast";

const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
const declaration = (name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim();

/** The surfaces a focus indicator is drawn on. */
const SURFACES = ["--surface-0", "--surface-1", "--surface-2", "--surface-3", "--surface-4", "--sidebar", "--editor", "--panel"];

/** Every .tsx file under `dir`, recursively. */
const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) return entry === "node_modules" ? [] : sources(path);
        return path.endsWith(".tsx") ? [path] : [];
    });

describe("focus indicator colour", () => {
    it("draws every focus token in --accent-text, which clears 3:1 on each surface", () => {
        expect(declaration("--focus")).toBe("var(--accent-text)");
        expect(declaration("--border-focus")).toBe("var(--focus)");
        expect(declaration("--color-border-focus-ring")).toBe("var(--focus)");
        for (const surface of SURFACES) {
            expect(contrastRatio(cssToken("--accent-text"), cssToken(surface)), surface).toBeGreaterThanOrEqual(3);
        }
        // The deep accent the tokens used to name fails WCAG 1.4.11 on the darker surfaces.
        expect(contrastRatio(cssToken("--accent"), cssToken("--surface-0"))).toBeLessThan(3);
    });

    it("leaves no control drawing its focus in the deep accent", () => {
        const offenders = ["app", "components", "features"]
            .flatMap((dir) => sources(join(process.cwd(), dir)))
            .filter((path) => /focus(-visible)?:(ring|border|outline)-accent(?![-\w])/.test(readFileSync(path, "utf8")))
            .map((path) => path.slice(process.cwd().length + 1));
        expect(offenders).toEqual([]);
    });
});

describe("the base size", () => {
    it("is a size only: no theme colour is named base, so text-base cannot also set a colour", () => {
        expect(css).not.toMatch(/--color-base\s*:/);
    });
});
