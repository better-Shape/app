import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The rung contract: which alpha a hover fill is allowed to resolve to.
 *
 * The failure this guards is a fill invented per component. Round 7 moved every sidebar,
 * toolbar and panel control onto the two ladders in `app/globals.css`, and the census that
 * signed that work off counted token names. It could not see the nine rows still hovering
 * through `bg-panel-hover/40`, which is 1.6% white, or the eleven controls still committing
 * through `--panel-active`, which is a sixth alpha that no research asked for. Those fills
 * are not wrong by a rule, they are wrong by the value they resolve to, so the contract is
 * written against the resolved value.
 *
 * Resolution follows aliases: `hover:bg-panel-hover` is a class, `--color-panel-hover` is
 * its theme alias, and `--panel-hover` is the token that carries the alpha. A test that
 * matched class names would pass a file that reached the same alpha by another name.
 */

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const globalsCss = read("app/globals.css");

/** The alpha each rung must carry. These numbers are the decision, not a sample. */
const RUNGS: Record<string, number> = {
    "--row-hover": 0.04,
    "--row-selected": 0.08,
    "--row-selected-hover": 0.1,
    "--btn-hover": 0.08,
    "--btn-open": 0.12,
    "--btn-open-hover": 0.14,
};

const declared = new Map(
    [...globalsCss.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]),
);

/** Follow `var()` chains to the literal: a token may be declared as another token. */
function resolve(name: string, seen: string[] = []): string | null {
    const value = declared.get(name);
    if (value === undefined || seen.includes(name)) return null;
    const alias = value.match(/^var\((--[\w-]+)\)$/);
    return alias ? resolve(alias[1], [...seen, name]) : value;
}

type Fill = { red: string; green: string; blue: string; alpha: number };

function fillOf(token: string, share = 1): Fill | null {
    const literal = resolve(token);
    const m = literal?.match(/rgba\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\)/);
    if (!m) return null;
    return { red: m[1], green: m[2], blue: m[3], alpha: Number(m[4]) * share };
}

const ladderAlphas = Object.values(RUNGS);

const isWhite = (fill: Fill) => fill.red === "255" && fill.green === "255" && fill.blue === "255";
const isRung = (fill: Fill) => isWhite(fill) && ladderAlphas.some((a) => Math.abs(a - fill.alpha) < 1e-9);

/** Semantic colour: the rung ladders govern neutral chrome, not intent. */
const SEMANTIC = /^(accent|error|success|warning|info|danger|destructive)/;

/**
 * Fills that are deliberately not on the ladder. Every entry needs the reason it is exempt,
 * and every entry is keyed by file so that a new use in a new file fails this test.
 */
const EXEMPT: Record<string, string> = {
    "app/welcome-screen.tsx :: text-primary": "inverted fill on the welcome surface, the page inverts rather than tints",
    "components/ui/scroll.tsx :: scrollbar-hover": "scrollbar thumb, not chrome",
    "components/ui/button.tsx :: surface-4": "secondary variant lifts to a raised surface, an elevation step rather than a state layer",
    "components/ui/button.tsx :: surface-2": "labels on a disabled button, which never take a pointer",
    "features/chat/ui/blocks/carousel.tsx :: text-muted": "slide indicator dot over media",
    "features/chat/ui/blocks/lightbox.tsx :: black/70": "close control over a full-screen image, where a white layer would be invisible",
    "features/chat/ui/blocks/lightbox.tsx :: white/55": "thumbnail dot over the image scrim",
    "features/chat/ui/shell/history-stepper.tsx :: text-muted": "step indicator dot",
    "features/preview/design/panel/layout.tsx :: current/10": "drop target, the fill inherits the text colour of whatever it wraps",
    "features/settings/ui/shared/controls.tsx :: white/12": "filled select trigger, paired with a black layer for the light palette below",
    "features/settings/ui/shared/controls.tsx :: black/10": "the light-palette half of the select trigger above",
    "features/agent/workbench/titlebar/ui/window-controls.tsx :: #e81123": "the Windows close control, which takes the platform red rather than a rung",
};

/** Every hover fill in a file, as the token it resolves through plus its share of that token. */
function hoverFills(text: string): Array<{ token: string; share: number }> {
    const found = [...text.matchAll(/hover:bg-\[var\((--[\w-]+)\)\]/g)].map((m) => ({ token: m[1], share: 1 }));
    for (const m of text.matchAll(/hover:bg-(?!\[)([a-z][\w/-]*)/g)) {
        const [name, share] = m[1].split("/");
        const themeToken = declared.has(`--color-${name}`) ? `--color-${name}` : `--${name}`;
        found.push({ token: themeToken, share: share ? Number(share) / 100 : 1 });
    }
    for (const m of text.matchAll(/hover:bg-\[(#[0-9a-fA-F]{3,8})\]/g)) found.push({ token: m[1], share: 1 });
    return found;
}

function bareFills(line: string): string[] {
    // A state layer is written `hover:bg-...`, so the character before `bg-` is a colon.
    // Stripping the prefixes instead would turn every hover fill into a bare fill.
    return [...line.matchAll(/(?<!:)bg-\[var\((--[\w-]+)\)\]/g)].map((m) => m[1]);
}

function hoverTokens(line: string): string[] {
    return [...line.matchAll(/hover:bg-\[var\((--[\w-]+)\)\]/g)].map((m) => m[1]);
}

function sourceFiles(): string[] {
    return ["app", "components", "features", "lib", "core"].flatMap((dir) =>
        fs
            .readdirSync(path.join(process.cwd(), dir), { recursive: true, encoding: "utf8" })
            .filter((f) => f.endsWith(".tsx"))
            .map((f) => `${dir}/${f}`),
    );
}

const files = sourceFiles().map((rel) => ({ rel, text: read(rel) }));

describe("the hover rung contract", () => {
    it("declares the six rungs at the alphas the research settled on", () => {
        for (const [token, alpha] of Object.entries(RUNGS)) {
            const fill = fillOf(token);
            expect(fill, `${token} is not declared as an rgba() colour`).not.toBeNull();
            expect(fill!.alpha, `${token} moved off its rung`).toBeCloseTo(alpha, 5);
            expect(isWhite(fill!), `${token} is no longer a white layer`).toBe(true);
        }
    });

    it("keeps the button rung above the row rung, and each committed rung above its hover", () => {
        const alpha = (t: string) => fillOf(t)!.alpha;
        expect(alpha("--btn-hover")).toBeGreaterThan(alpha("--row-hover"));
        expect(alpha("--row-selected")).toBeGreaterThan(alpha("--row-hover"));
        expect(alpha("--row-selected-hover")).toBeGreaterThan(alpha("--row-selected"));
        expect(alpha("--btn-open")).toBeGreaterThan(alpha("--btn-hover"));
        expect(alpha("--btn-open-hover")).toBeGreaterThan(alpha("--btn-open"));
    });

    it("uses a rung for every hover fill, or says why not", () => {
        const offenders: string[] = [];
        for (const { rel, text } of files) {
            for (const { token, share } of hoverFills(text)) {
                const name = token.replace(/^--color-/, "").replace(/^--/, "");
                if (name.startsWith("transparent")) continue;
                const fill = fillOf(token, share);
                if (fill && isRung(fill)) continue;
                if (SEMANTIC.test(name)) continue;
                const key = `${rel} :: ${name}${share === 1 ? "" : `/${Math.round(share * 100)}`}`;
                if (EXEMPT[key]) continue;
                offenders.push(`${key} resolves to ${fill ? `${fill.alpha} alpha` : "no declared colour"}`);
            }
        }
        expect(offenders, `hover fills outside the ladder:\n  ${offenders.join("\n  ")}`).toEqual([]);
    });

    it("leaves no hover fill on the legacy panel alias", () => {
        // The sweep that landed the ladder rewrote `hover:bg-panel-hover`, so the name is
        // gone from hover position and cannot come back by copy and paste.
        const found = files.filter(({ text }) => /hover:bg-panel-hover(?![\w/-])/.test(text)).map(({ rel }) => rel);
        expect(found, `hover fills back on the legacy alias: ${found.join(", ")}`).toEqual([]);
    });

    it("never gives a control the same fill on hover as at rest", () => {
        // The defect Microsoft filed against Fluent: a hover fill equal to the selected
        // fill, so pointing at a committed control looks like pointing at nothing.
        const offenders: string[] = [];
        for (const { rel, text } of files) {
            for (const line of text.split("\n")) {
                const rest = bareFills(line);
                const hover = hoverTokens(line);
                for (const token of rest.filter((t) => hover.includes(t))) {
                    offenders.push(`${rel}: ${token} is both the rest fill and the hover fill`);
                }
            }
        }
        expect(offenders, offenders.join("\n")).toEqual([]);
    });

    it("confines the legacy committed fill to the three places that are not a rung", () => {
        const found = files
            .filter(({ text }) => /(?:^|[\s"'])(?:active:)?bg-panel-active(?![\w-])/m.test(text))
            .map(({ rel }) => rel);
        expect(found.sort()).toEqual([
            // A keyboard chip inside a tooltip, and the pressed state of the two window
            // controls. The ladder has no pressed rung, and the chip is a surface, not a
            // state layer, so both keep the 6% alias and are counted here instead.
            "components/ui/tooltip.tsx",
            "features/agent/workbench/titlebar/ui/window-controls.tsx",
        ]);
    });
});
