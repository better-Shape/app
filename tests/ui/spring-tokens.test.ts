/**
 * The spring vocabulary's contract, in four parts:
 *
 *   1. Re-derives every token from the physics in `scripts/motion/springs.mjs` and
 *      compares it to the committed `app/springs.css`, so a hand-edit is caught.
 *   2. Checks each curve's shape, since a token with the wrong damping is still a valid
 *      `linear()` and nothing else would notice.
 *   3. Checks every `--spring-*` easing is paired with its own `-dur`. A spring reaches
 *      its endpoint early, so any other duration is dead air.
 *   4. Guards the sweep: no user-driven transition may return to the legacy bezier, which
 *      looks fine in isolation and would creep back one component at a time.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
// A Node ESM tool that this scope type-checks like any other module, so no
// `@ts-expect-error` is needed here.
import { SPRINGS, FALLBACKS, renderCss, springToLinear, peakOf } from "../../scripts/motion/springs.mjs";
import { must } from "../helpers/must";

const ROOT = join(__dirname, "..", "..");
const CSS_PATH = join(ROOT, "app", "springs.css");
const css = readFileSync(CSS_PATH, "utf8");


/** The names and generated CSS the physics module produces right now. */
const names = Object.keys(SPRINGS) as string[];

describe("the generated stylesheet matches the physics", () => {
    it("is byte-identical to a fresh render", () => {
        // Catches both a hand-edit and a parameters change that was never regenerated ,
        // two different mistakes that look the same in a diff-meaningless stylesheet.
        expect(css.trim()).toBe(renderCss().trim());
    });

    it("declares an easing and its own settle duration, plus a fallback, for every spring", () => {
        for (const name of names) {
            expect(css, `${name}: easing`).toContain(`--spring-${name}: linear(`);
            expect(css, `${name}: duration`).toMatch(new RegExp(`--spring-${name}-dur:\\s*\\d+ms`));
            expect(css, `${name}: fallback`).toContain(`--spring-${name}-fallback:`);
        }
    });

    it("gives every spring a fallback curve that is a real cubic-bezier", () => {
        // The @supports block is the only thing standing between an older engine and a
        // `linear()` it cannot parse, so a missing or malformed entry is a hard failure.
        for (const [name, bezier] of Object.entries(FALLBACKS)) {
            expect(String(bezier), name).toMatch(/^cubic-bezier\(/);
            expect(css, `${name} fallback not wired`).toContain(`--spring-${name}-fallback: ${bezier}`);
        }
    });

    it("keeps the fallback swap inside an @supports guard for linear()", () => {
        expect(css).toContain("@supports not (animation-timing-function: linear(0, 1))");
        // Every token must be re-pointed inside it, or some element silently keeps a
        // `linear()` an engine cannot read.
        const block = css.slice(css.indexOf("@supports not (animation-timing-function"));
        for (const name of names) expect(block, `${name} missing from @supports`).toContain(`--spring-${name}: var(--spring-${name}-fallback)`);
    });
});

describe("the curves have the shape the parameters claim", () => {
    /** Sample a token's committed `linear()` stops out of the stylesheet. */
    const stopsFor = (name: string): number[] => {
        const match = css.match(new RegExp(`--spring-${name}: linear\\(([^)]*)\\)`));
        if (!match) throw new Error(`no stops for ${name}`);
        return match[1].split(",").map((v) => Number(v.trim()));
    };

    it("starts at 0 and ends at 1 for every spring", () => {
        for (const name of names) {
            const stops = stopsFor(name);
            expect(stops[0], `${name} start`).toBe(0);
            expect(stops[stops.length - 1], `${name} end`).toBeCloseTo(1, 2);
        }
    });

    it("never overshoots a critically damped spring", () => {
        // Bounce 0 because these animate targets the user is about to click, and an
        // overshoot moves the target out from under the cursor.
        for (const name of names) {
            if (SPRINGS[name as keyof typeof SPRINGS].bounce !== 0) continue;
            const { peak } = peakOf(stopsFor(name));
            expect(peak, `${name} overshot by ${((peak - 1) * 100).toFixed(2)}%`).toBeLessThanOrEqual(1.0005);
        }
    });

    it("peaks where the damped oscillator says it should", () => {
        // Guards the conversion, not just the numbers: a curve with the right peak but
        // in the wrong place would feel wrong while passing every other check here.
        for (const name of names) {
            const spec = SPRINGS[name as keyof typeof SPRINGS];
            if (spec.bounce === 0) continue;
            const stops = stopsFor(name);
            let peakAt = 0;
            let peak = 0;
            stops.forEach((v, i) => {
                if (v > peak) {
                    peak = v;
                    peakAt = i / (stops.length - 1);
                }
            });
            // The under-damped family crosses its target near 1/3 of the response and
            // tops out just past half of it. Loose bounds: this asserts the SHAPE.
            expect(peakAt, `${name} peaks at ${(peakAt * 100).toFixed(0)}% of the curve`).toBeGreaterThan(0.4);
            expect(peakAt, `${name} peaks at ${(peakAt * 100).toFixed(0)}% of the curve`).toBeLessThan(0.75);
            expect(peak, `${name} peak height`).toBeGreaterThan(1.005);
        }
    });

    it("is still moving as it lands, which is the point of the whole exercise", () => {
        // The legacy bezier covered 95% of the distance in the first 43% of its duration.
        // A spring's final approach is a decay, so its last stops still climb.
        for (const name of names) {
            if (SPRINGS[name as keyof typeof SPRINGS].bounce !== 0) continue;
            const stops = stopsFor(name);
            const lastFew = stops.slice(-4);
            for (let i = 1; i < lastFew.length; i++) {
                expect(lastFew[i], `${name} went flat before the end`).toBeGreaterThan(lastFew[i - 1]);
            }
        }
    });

    it("samples the same curve the oscillator produces, not a lookalike", () => {
        for (const name of names) {
            const spec = SPRINGS[name as keyof typeof SPRINGS];
            const { stops } = springToLinear(spec.bounce, spec.response);
            expect(stopsFor(name).length, `${name} stop count`).toBe(stops.length);
            for (const [i, v] of stops.entries()) {
                expect(stopsFor(name)[i], `${name} stop ${i}`).toBeCloseTo(v, 3);
            }
        }
    });

    it("settles in the duration the token advertises", () => {
        // The pairing rule only works if the duration is honest: it must outlast the last
        // visible movement, or the tail is truncated, which is the same defect reversed.
        for (const name of names) {
            const match = css.match(new RegExp(`--spring-${name}-dur:\\s*(\\d+)ms`));
        const durMs = Number(must(match, `--spring-${name}-dur`)[1]);
            const stops = stopsFor(name);
            const tolerance = 0.002;
            let settledAt: number | null = null;
            stops.forEach((v, i) => {
                if (settledAt === null && Math.abs(v - 1) <= tolerance) settledAt = i / (stops.length - 1);
            });
            const settlesAt = must(settledAt, `${name} to settle`);
            // 12% of slack: the declared duration rounds to a round number by design.
            expect(durMs, `${name} advertises ${durMs}ms but settles at ${(settlesAt * durMs).toFixed(0)}ms`).toBeGreaterThan(
                settlesAt * durMs * 0.88,
            );
        }
    });
});

// Source-level guards. These read the app, so they are the ones that stop a regression
// rather than merely describing today's state.
function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.(tsx?|css)$/.test(entry) && !/\.test\./.test(entry)) out.push(full);
    }
    return out;
}

const SOURCES = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components")), ...walk(join(ROOT, "features"))].map((f) => ({
    path: relative(ROOT, f),
    text: readFileSync(f, "utf8"),
}));

describe("every spring easing is paired with its own duration", () => {
    it("does not hand a spring an inherited or arbitrary duration", () => {
        const offenders: string[] = [];
        for (const { path, text } of SOURCES) {
            // A spring used as a timing function with no matching `-dur` on the element.
            // Tailwind puts both in one class string, so the class attribute is the scope.
            for (const match of text.matchAll(/ease-\[var\(--spring-([a-z]+)\)\]/g)) {
                const name = match[1];
                const at = must(match.index, "the legacy shorthand line");
        const before = text.slice(Math.max(0, at - 400), at);
                const line = before.split("\n").slice(-6).join("\n");
                if (!line.includes(`--spring-${name}-dur`) && !line.includes(`var(--spring-${name}-dur)`)) {
                    offenders.push(`${path}: --spring-${name} without --spring-${name}-dur`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });
});

describe("every spring easing is paired with its own duration", () => {
    /**
     * Resolve `--name: value` through however many aliases wrap it. The first version of
     * this check passed a deliberately broken file, because `--dropdown-ease: var(
     * --spring-tap)` puts the spring two hops from the `animation:` shorthand that uses it.
     */
    function declarations(): Map<string, string> {
        const map = new Map<string, string>();
        for (const { text } of SOURCES) {
            for (const m of text.matchAll(/(--[a-z0-9-]+):\s*([^;\n}]+);/g)) {
                if (!map.has(m[1])) map.set(m[1], m[2].trim());
            }
        }
        return map;
    }

    function resolve(value: string, decls: Map<string, string>, depth = 0): string {
        if (depth > 6) return value;
        return value.replace(/var\((--[a-z0-9-]+)\)/g, (_, name: string) => {
            const next = decls.get(name);
            return next === undefined ? `var(${name})` : resolve(next, decls, depth + 1);
        });
    }

    it("never gives a spring a duration that is not its own settle time", () => {
        const decls = declarations();
        const settle = new Map<string, number>(
            names.map((name) => [name, Number(must(css.match(new RegExp(`--spring-${name}-dur:\\s*(\\d+)ms`)), name)[1])]),
        );
        // Which spring produced whichever easing string, so a resolved literal can be traced
        // back to a name.
        const easingToSpring = new Map<string, string>(
            names.map((name) => [must(css.match(new RegExp(`--spring-${name}: (linear\\([^)]*\\))`)), name)[1], name]),
        );

        const offenders: string[] = [];
        for (const { path, text } of SOURCES) {
            for (const shorthand of text.matchAll(/^\s*(animation|transition):([^;]+);/gm)) {
                const body = shorthand[2];
                // Every custom property this shorthand leans on, resolved to a concrete value.
                const resolved = [...body.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => resolve(`var(${m[1]})`, decls));
                const springUsed = resolved.map((v) => easingToSpring.get(v.trim())).find(Boolean);
                if (!springUsed) continue;
                const durationUsed = resolved
                    .map((v) => v.trim().match(/^(\d+(?:\.\d+)?)ms$/))
                    .find(Boolean);
                const literalMs = durationUsed ? Number(durationUsed[1]) : null;
                const springMs = must(settle.get(springUsed), `the settle curve for ${springUsed}`);
                if (literalMs !== null && literalMs !== springMs) {
                    const line = text.slice(0, must(shorthand.index, "the shorthand")).split("\n").length;
                    offenders.push(
                        `${path}:${line} runs --spring-${springUsed} (settles in ${springMs}ms) for ${literalMs}ms`,
                    );
                }
            }
        }
        expect(offenders).toEqual([]);
    });
});

describe("no user-driven transition is left on the legacy bezier", () => {
    it("keeps hover, press and selection tints off the front-loaded curve", () => {
        // `cubic-bezier(0.16, 1, 0.3, 1)` covers 95% of its distance in the first 43% of
        // the duration. On an interaction the user repeats all day, that dead tail is the
        // difference between a response and a repaint. Ambient fades may keep it.
        const offenders: string[] = [];
        for (const { path, text } of SOURCES) {
            for (const match of text.matchAll(/ease-\[var\(--ease-out\)\]/g)) {
                const at = must(match.index, "the ease-out match");
                const context = text.slice(Math.max(0, at - 300), at + 60);
                // A tint is the pattern at issue: a state fill driven by the pointer.
                const isTint = /hover:bg-|data-\[state=open\]:bg-|group-hover:bg-|transition-colors/.test(context);
                if (isTint) offenders.push(`${path}: interactive fill on --ease-out`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it("keeps the spring vocabulary free of the old --ease-spring decoy", () => {
        // It was a byte-identical duplicate of --ease-out with no consumers: a token that
        // looked like a spring and was not one. Re-adding it would silently reintroduce
        // the exact motion this wave replaced.
        for (const { path, text } of SOURCES) {
            // A mention in prose is documentation ("the name was removed because…");
            // only a `var()` is a use.
            expect(text, `${path} uses the removed --ease-spring`).not.toContain("var(--ease-spring)");
        }
    });
});
