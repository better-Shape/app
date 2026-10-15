import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The sidebar's interaction ladder: rest, hover at exactly half of selected, selected,
 * selected plus hover. The failure this guards is invisible in a component tree, because
 * a row can render two indistinguishable fills and still look correct in isolation.
 *
 * `scripts/qa/probe-sidebar-ladder.cjs` measures the same ladder in Chromium. A source
 * test cannot see a specificity mistake or a Tailwind conflict resolved the wrong way.
 */

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const globals = read("app/globals.css");

const sidebarFiles = fs
    .readdirSync(path.join(process.cwd(), "features/agent/sidebar"))
    .filter((f) => f.endsWith(".tsx") && f !== "collection-dialog.tsx")
    .map((f) => `features/agent/sidebar/${f}`);

/** Alpha of a token declared as `rgba(r, g, b, a)`. */
function tokenAlpha(name: string): number {
    const m = globals.match(new RegExp(`${name}:\\s*rgba\\([^)]*?([0-9.]+)\\s*\\)`));
    expect(m, `${name} is not declared as an rgba() token`).not.toBeNull();
    return Number(m![1]);
}

describe("the sidebar interaction ladder", () => {
    it("declares hover as exactly half of the committed fill", () => {
        // A drifted ratio makes hover a second, unrelated tone instead of a preview.
        const hover = tokenAlpha("--row-hover");
        const selected = tokenAlpha("--row-selected");
        expect(hover).toBeGreaterThan(0);
        expect(selected).toBeGreaterThan(hover);
        expect(hover * 2).toBeCloseTo(selected, 5);
    });

    it("keeps a selected control responsive to the pointer", () => {
        // Material's additive state layers: selected + hover both apply. A selected row
        // that stops responding reads as disabled.
        expect(tokenAlpha("--row-selected-hover")).toBeGreaterThan(tokenAlpha("--row-selected"));
    });

    it("puts every sidebar row and control on the ladder", () => {
        for (const file of sidebarFiles) {
            const source = read(file);
            // `hover:bg-panel-hover` is the defect this ladder replaced: it made hover and
            // selected the same fill.
            expect(source, `${file} hovers with a raw panel token`).not.toMatch(/hover:bg-panel-(hover|active)/);
            expect(source, `${file} selects with an unknown tone`).not.toMatch(/(?<!hover:)bg-panel-active/);
        }
        // At least the row recipe and the rail button must actually use the ladder.
        const sections = read("features/agent/sidebar/sections.tsx");
        expect(sections).toContain("hover:bg-[var(--row-hover)]");
        expect(sections).toContain("bg-[var(--row-selected)]");
        expect(sections).toContain("hover:bg-[var(--row-selected-hover)]");
        const rail = read("features/agent/sidebar/index.tsx");
        expect(rail).toContain("hover:bg-[var(--row-hover)]");
        expect(rail).toContain("hover:bg-[var(--row-selected-hover)]");
    });

    it("animates the fill instead of snapping it", () => {
        // Measured failure: controls that carried the new hover fill but no transition
        // still reported `transition: all 0s ease`, so the fill appeared as a hard cut.
        for (const file of sidebarFiles) {
            const source = read(file);
            for (const [i, line] of source.split("\n").entries()) {
                if (!line.includes("var(--row-hover)")) continue;
                const sibling = source.split("\n").slice(Math.max(0, i - 12), i + 13).join("\n");
                const parent = source.slice(0, source.indexOf(line));
                expect(
                    line.includes("transition-colors") || sibling.includes("transition-colors") || parent.includes("rowChromeClass"),
                    `${file}:${i + 1} applies the hover fill with no transition in scope`,
                ).toBe(true);
            }
        }
    });

    it("keeps the coloured rows' tint ladder arithmetic", () => {
        // 22, 26, 30, 34 percent of `--chat-tint`: the same ladder in the row's own colour.
        // The old values hovered at 34 and committed at 30, which is the ladder upside down.
        const source = read("features/agent/sidebar/sections.tsx");
        const selected = source.match(/active\s*\?\s*"bg-\[color-mix\(in_oklch,var\(--chat-tint\)_(\d+)%/);
        const rest = source.match(/:\s*"bg-\[color-mix\(in_oklch,var\(--chat-tint\)_(\d+)%/);
        const step = source.match(/hover:bg-\[color-mix\(in_oklch,var\(--chat-tint\)_(\d+)%/);
        expect(rest, "coloured row rest tint not found").not.toBeNull();
        expect(selected, "coloured row selected tint not found").not.toBeNull();
        expect(step, "coloured row hover step not found").not.toBeNull();

        const [r, s, h] = [Number(rest![1]), Number(selected![1]), Number(step![1])];
        expect([r, s]).toEqual([22, 30]);
        expect(r).toBeLessThan(s);
        // Hover = rest + step, and that has to be the midpoint of the ladder.
        expect(r + h).toBe((r + s) / 2);
        // Selected + hover stays below full, and above selected.
        expect(s + h).toBeGreaterThan(s);
        expect(s + h).toBeLessThan(100);
    });
});

/**
 * The button rung, one step above the row rung. A 28px icon at the row's 4% measures about
 * 8 channel units against the sidebar, which is why it read as having no hover state while
 * the token was present. Material 3 and macOS both put a button above a row.
 */
describe("the button rung", () => {
    it("declares a button ladder above the row ladder", () => {
        const [rowHover, rowSelected, rowSelectedHover] = [
            tokenAlpha("--row-hover"),
            tokenAlpha("--row-selected"),
            tokenAlpha("--row-selected-hover"),
        ];
        const [btnHover, btnOpen, btnOpenHover] = [
            tokenAlpha("--btn-hover"),
            tokenAlpha("--btn-open"),
            tokenAlpha("--btn-open-hover"),
        ];

        // Each ladder ascends, so nothing is inert and every step is distinguishable.
        for (const [name, ladder] of [
            ["row", [rowHover, rowSelected, rowSelectedHover]],
            ["button", [btnHover, btnOpen, btnOpenHover]],
        ] as const) {
            for (let i = 1; i < ladder.length; i++) {
                expect(ladder[i], `${name} ladder step ${i} does not rise`).toBeGreaterThan(ladder[i - 1]);
            }
        }

        // The button rung is deliberately ABOVE the row rung: that is the whole change.
        expect(btnHover).toBeGreaterThan(rowHover);
        // ...and a button's committed state still outranks its own hover, which is the
        // defect the row ladder was built to avoid repeating here.
        expect(btnOpen).toBeGreaterThan(btnHover);
        expect(btnHover).toBeGreaterThan(btnOpen * 0.5);
    });

    it("never lets a button hover fill equal its committed fill", () => {
        // The Microsoft combobox defect, restated for this ladder: if hover and committed
        // are the same value a user cannot tell "I am pointing at this" from "this one is
        // open", and the control has spent its only state before the click arrives.
        const pairs: Array<[string, string]> = [
            ["--row-hover", "--row-selected"],
            ["--btn-hover", "--btn-open"],
        ];
        for (const [hover, committed] of pairs) {
            expect(tokenAlpha(hover), `${hover} equals ${committed}`).not.toBe(tokenAlpha(committed));
        }
    });

    it("puts every icon-only button on the button rung, not the row rung", () => {
        // The failure this prevents is specific and happened: a 28px icon and a 200px row
        // react at the same strength, so the icon reads as having no hover at all.
        const offenders: string[] = [];
        for (const dir of ["features", "components", "app"]) {
            for (const file of walk(path.join(process.cwd(), dir))) {
                const lines = fs.readFileSync(file, "utf8").split("\n");
                lines.forEach((line, i) => {
                    if (!line.includes("hover:bg-[var(--row-hover)]")) return;
                    // Look at the whole className expression, not the line. A Tailwind
                    // class block is routinely split across five or six lines, and a
                    // line-scoped version of this check passes a mutated file: the
                    // `size-7` and the `justify-center` land on different lines from the
                    // hover. That was the first version of this test, and it silently
                    // allowed exactly the regression it was written to catch.
                    const block = classBlockAt(lines, i);
                    const isIconButton =
                        /size-\d+/.test(block) &&
                        block.includes("items-center justify-center") &&
                        !block.includes("w-full") &&
                        !block.includes("flex-1");
                    if (isIconButton) offenders.push(`${path.relative(process.cwd(), file)}:${i + 1}`);
                });
            }
        }
        expect(offenders).toEqual([]);
    });

    it("leaves no hover fill on the legacy --panel-hover alias", () => {
        // `--panel-hover` is a 4% tone equal to `--row-hover`, so a hover written against it
        // is the row rung wearing a different name. Two names for one value is how the app
        // ended up with two vocabularies in the first place. The token survives for
        // committed and focus states; a hover fill is not one of them.
        const offenders: string[] = [];
        for (const dir of ["features", "components", "app"]) {
            for (const file of walk(path.join(process.cwd(), dir))) {
                fs.readFileSync(file, "utf8")
                    .split("\n")
                    .forEach((line, i) => {
                        if (/(?<![\w\-\].])hover:bg-panel-hover(?!\/)/.test(line)) {
                            offenders.push(`${path.relative(process.cwd(), file)}:${i + 1}`);
                        }
                    });
            }
        }
        expect(offenders).toEqual([]);
    });
});

/**
 * The `className` expression a line belongs to: from the nearest opening `className=` the
 * line sits inside, to the end of that expression. Handles both the single-string form and
 * the multi-line `cn(...)` form, which is the one that hides things.
 */
function classBlockAt(lines: string[], index: number): string {
    for (let start = index; start >= 0 && index - start < 20; start--) {
        const line = lines[start];
        if (!line.includes("className=")) continue;
        // A self-contained one-liner.
        if (/className="[^"]*"/.test(line)) return line;
        // Otherwise take everything up to the line that closes the expression: the first
        // line at or after the opening whose trimmed text ends with `)}` or `}"`.
        const out: string[] = [];
        for (let end = start; end < lines.length && end - start < 24; end++) {
            out.push(lines[end]);
            const t = lines[end].trimEnd();
            if (end > start && /(\)\}|\}"|\}\)",?|\}",?)$/.test(t)) break;
        }
        return out.join("\n");
    }
    return lines[index];
}

/** Every non-test source file under a directory. */
function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (entry === "node_modules" || entry.startsWith(".")) continue;
        if (fs.statSync(full).isDirectory()) walk(full, out);
        else if (/\.(tsx?|css)$/.test(entry) && !/\.test\./.test(entry)) out.push(full);
    }
    return out;
}
