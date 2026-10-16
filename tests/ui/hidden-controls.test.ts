import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A control that only the pointer can reveal is a control the keyboard cannot see.
 *
 * Tab strips and message rows keep their close and copy buttons at `opacity-0` until the
 * row is hovered, which is the right call for a pointer: the affordance appears where the
 * pointer already is. The buttons stay in the tab order either way, so a keyboard user who
 * tabs to one lands on nothing they can see, and a screen reader announces a control with
 * no visual confirmation for the sighted user beside them.
 *
 * The fix is one class per control: `focus-visible:opacity-100` on the control itself, or
 * `focus-within:opacity-100` when the alpha sits on the wrapper the buttons live in. The
 * review that found this named the terminal's tab strip; the sweep below is what stops the
 * same defect reappearing in the next tab strip someone writes, which is why it reads the
 * source rather than a fixed list of files.
 */

const ROOTS = ["app", "components", "features", "lib", "core"];
const SKIP = new Set(["node_modules", ".next", ".dump", "dist", "build"]);
const FOCUS_COUNTERPARTS = ["focus-visible:opacity-100", "focus-within:opacity-100"];

function sourceFiles(dir: string, found: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIP.has(entry.name)) sourceFiles(full, found);
        } else if (entry.name.endsWith(".tsx")) {
            found.push(full);
        }
    }
    return found;
}

describe("controls hidden until hover", () => {
    const sites: { file: string; line: number; text: string }[] = [];
    for (const root of ROOTS) {
        if (!fs.existsSync(root)) continue;
        for (const file of sourceFiles(root)) {
            const lines = fs.readFileSync(file, "utf8").split("\n");
            lines.forEach((text, index) => {
                if (text.includes("group-hover:opacity-100")) sites.push({ file, line: index + 1, text });
            });
        }
    }

    it("finds the pattern it guards", () => {
        // A glob that stopped matching would make the contract below vacuous, and the
        // pattern is used by the tab strips the pointer relies on today.
        expect(sites.length).toBeGreaterThan(0);
    });

    it("gives every one of them a keyboard path", () => {
        const stranded = sites
            .filter((site) => !FOCUS_COUNTERPARTS.some((counterpart) => site.text.includes(counterpart)))
            .map((site) => `${site.file}:${site.line}`);
        expect(stranded).toEqual([]);
    });
});
