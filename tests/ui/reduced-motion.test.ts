import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A stylesheet contract for `prefers-reduced-motion`, because the preference is invisible
 * in normal use: a missing guard and a no-op guard look the same.
 *
 *  1. Every infinite animation is guarded or deliberately kept.
 *  2. Decorative motion stops, informational motion slows. A frozen spinner next to
 *     "Waiting for sign-in…" is indistinguishable from a hung app.
 *  3. The guard names classes rather than widening the blanket reset in `app/globals.css`.
 *  4. Its exceptions still iterate, since that reset pins `animation-iteration-count` to 1
 *     on `*` and a longer duration alone would leave a still image.
 */

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

const transitions = read("app/transitions.css");
const globals = read("app/globals.css");

/** The last `@media (prefers-reduced-motion: reduce)` block in `transitions.css`. */
function reducedMotionBlock(css: string): string {
    const marker = "@media (prefers-reduced-motion: reduce)";
    const start = css.lastIndexOf(marker);
    expect(start, "transitions.css has no reduced-motion block").toBeGreaterThan(-1);
    // Walk braces from the opening one so nested at-rules cannot truncate it.
    const open = css.indexOf("{", start);
    let depth = 0;
    for (let i = open; i < css.length; i += 1) {
        if (css[i] === "{") depth += 1;
        else if (css[i] === "}") {
            depth -= 1;
            if (depth === 0) return css.slice(open + 1, i);
        }
    }
    throw new Error("unbalanced braces in reduced-motion block");
}

const block = reducedMotionBlock(transitions);

describe("the reduced-motion guard", () => {
    it("stops decorative motion and slows informational motion instead of stopping it", () => {
        const deco = block.slice(block.indexOf(".animate-pulse"), block.indexOf(".animate-spin"));
        const info = block.slice(block.indexOf(".animate-spin"));

        // Decorative: stopped.
        expect(deco).toMatch(/animation:\s*none\s*!important/);
        // Informational: slowed, and never stopped, a frozen spinner reads as a hang.
        expect(info).toMatch(/\.animate-spin,\s*\.imsg-typing span\s*\{[^}]*animation-duration:\s*2\.4s\s*!important/s);
        expect(info).not.toMatch(/\.animate-spin[^{]*\{[^}]*animation:\s*none/s);
        expect(info).not.toMatch(/\.imsg-typing span\s*\{[^}]*animation:\s*none/s);
    });

    it("keeps the informational exceptions iterating, on top of the blanket reset", () => {
        // The interaction is restated here on purpose: change one side and the other
        // silently stops working.
        expect(globals).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{[^}]*animation-duration:\s*0\.01ms\s*!important/s);
        expect(globals).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{[^}]*animation-iteration-count:\s*1\s*!important/s);
        // So a raised duration without a raised count is a spinner that turns once.
        expect(block).toMatch(/animation-iteration-count:\s*infinite\s*!important/);
        const info = block.slice(block.indexOf(".animate-spin"));
        expect(info.match(/animation-iteration-count:\s*infinite\s*!important/g)?.length ?? 0).toBeGreaterThan(0);
    });

    it("targets specific classes rather than a universal reset", () => {
        expect(block).not.toMatch(/^\s*\*\s*\{/m);
        expect(block).not.toMatch(/,\s*\*\s*\{/);
        // A reset without this turns every remaining infinite animation into a flicker.
        expect(block).not.toMatch(/animation-iteration-count\s*:\s*0\b/);
    });

    it("names classes that are actually applied to elements", () => {
        // A guard on a class nothing carries reads as coverage. That is how
        // `.bettershape-orb-breathe`, a keyframe name rather than the orb's class, sat in
        // the guard doing nothing.
        for (const cls of [".animate-pulse", ".animate-spin", ".imsg-typing span"]) {
            const selector = cls.split(" ")[0];
            expect(block).toContain(cls);
            expect(
                globals.includes(selector) || transitions.includes(selector),
                `${cls} is guarded but the class is not defined anywhere`,
            ).toBe(true);
        }
        expect(block).not.toContain(".bettershape-orb-breathe");
    });

    it("covers every infinite animation the app declares", () => {
        // `autoPlay`/`paused` aside, an `infinite` shorthand is the signal.
        const declared = [...globals.matchAll(/animation:\s*([a-zA-Z0-9_-]+)[^;]*\binfinite/g)].map(
            (m) => m[1],
        );
        const guarded = [
            "imsg-dot", // .imsg-typing span -> slowed
            "send-spiral-pulse", // guarded in globals.css
        ];
        expect(new Set(declared)).toEqual(new Set(guarded));
    });
});
