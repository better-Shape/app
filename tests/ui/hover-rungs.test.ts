import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { must } from "../helpers/must";

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
    if (!literal) return null;
    const rgba = literal.match(/rgba\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\)/);
    if (rgba) return { red: rgba[1], green: rgba[2], blue: rgba[3], alpha: Number(rgba[4]) * share };
    // An opaque token still produces a state layer once a share is applied to it, which is
    // how `open:bg-panel/50` leaves the ladder without ever naming an alpha.
    const hex = literal.match(/^#([0-9a-f]{6})$/i);
    if (!hex) return null;
    const [red, green, blue] = [0, 2, 4].map((at) => Number.parseInt(hex[1].slice(at, at + 2), 16));
    return { red: String(red), green: String(green), blue: String(blue), alpha: share };
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

/**
 * Every background fill with the variant chain in front of it, so `data-[state=open]:focus:bg-x`
 * is read as the chain `data-[state=open]:focus:` and the name `--x`.
 */
const FILL = /(?<![\w:-])((?:[a-z-]+:|data-\[[^\]]*\]:)*)bg-\[var\((--[\w-]+)\)\]/g;

/**
 * The element that owns the fill at `index`: the nearest opening tag that starts before the
 * index and closes after it. A `>` inside quotes or braces does not close a tag, which is
 * what keeps an arrow function or a comparison from ending the element early.
 */
function elementAt(text: string, index: number): string | null {
    const opens: number[] = [];
    for (let i = 0; i < index; i++) {
        if (text[i] === "<" && /[A-Za-z]/.test(text[i + 1] ?? "")) opens.push(i);
    }
    for (let i = opens.length - 1; i >= 0; i--) {
        const end = tagEnd(text, opens[i]);
        if (end !== null && end > index) return text.slice(opens[i], end + 1);
    }
    return null;
}

function tagEnd(text: string, start: number): number | null {
    let quote: string | null = null;
    let braces = 0;
    for (let i = start; i < text.length; i++) {
        const char = text[i];
        if (quote) {
            if (char === quote) quote = null;
            continue;
        }
        if (char === '"' || char === "'" || char === "`") quote = char;
        else if (char === "{") braces++;
        else if (char === "}") braces = Math.max(0, braces - 1);
        else if (char === ">" && braces === 0) return i;
    }
    return null;
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
            expect(must(fill, token).alpha, `${token} moved off its rung`).toBeCloseTo(alpha, 5);
            expect(isWhite(must(fill, token)), `${token} is no longer a white layer`).toBe(true);
        }
    });

    it("keeps the button rung above the row rung, and each committed rung above its hover", () => {
        const alpha = (t: string) => must(fillOf(t), t).alpha;
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

    it("steps a committed fill up one rung when the pointer is already on that control", () => {
        // A committed fill and a hover fill on the same element are both `:hover` rules at
        // the same specificity, so the winner is whichever the compiler emits second. A
        // control that commits at 8% and hovers at 8% therefore looks the same either way,
        // and one that commits at 6% under an 8% hover gets lighter when the pointer
        // arrives. The rule is per element: the fill must be paired with the rung above it.
        const STEP: Record<string, string> = {
            "--row-selected": "--row-selected-hover",
            "--btn-open": "--btn-open-hover",
        };
        const offenders: string[] = [];
        for (const { rel, text } of files) {
            for (const m of text.matchAll(FILL)) {
                const token = m[2];
                if (!(token in STEP)) continue;
                const element = elementAt(text, must(m.index, "a match index"));
                if (!element) continue;
                const fills = [...element.matchAll(FILL)].map(([, chain, name]) => ({ chain, name }));
                // An element with no pointer fill cannot be hovered into a lighter fill,
                // so an indicator or a surface keeps its committed rung on its own.
                if (!fills.some(({ chain }) => /(?:^|:)hover:$|(?:^|:)focus:$/.test(chain))) continue;
                // This codebase reaches the pointer state through `hover:` on a plain
                // element and through `focus:` on a primitive that moves DOM focus, so a
                // step written either way counts.
                const step = fills.some(
                    ({ chain, name }) =>
                        name === STEP[token] && (chain === `${m[1]}hover:` || chain === `${m[1]}focus:`),
                );
                if (!step) {
                    offenders.push(
                        `${rel}:${text.slice(0, m.index).split("\n").length} commits with ${token} and never steps up from it`,
                    );
                }
            }
        }
        expect(offenders, `committed fills with no rung above them:\n  ${offenders.join("\n  ")}`).toEqual([]);
    });

    it("keeps a state fill on the ladder", () => {
        // Two shapes of the same defect. A fill written behind a variant prefix is
        // unambiguously a state layer, and `open:bg-panel/50` on a disclosure resolves to
        // half of an opaque panel colour: the surface rests on a rung and leaves the
        // ladder when it opens. A bare fill inside a state expression has the other
        // failure, where `bg-panel-hover/50` at 2% reads fainter than the 4% hover rung it
        // competes with. Opaque surfaces are left alone, because an elevation step is a
        // decision the ladder does not govern and disabled chrome never takes a pointer.
        const STATE_FILL = /(?:^|[\s"'`])((?:[a-z-]+:|data-\[[^\]]*\]:)+)bg-(?!\[)([a-z][\w-]*)(?:\/(\d+))?/g;
        const FADED = /(?<!:)bg-(?:panel-hover|\[var\(--[\w-]+\)\])(?:\/(\d+))?/g;
        const offenders: string[] = [];

        for (const { rel, text } of files) {
            for (const m of text.matchAll(STATE_FILL)) {
                const [, chain, token, share] = m;
                if (/^(?:hover|focus|focus-visible|active):$/.test(chain)) continue;
                const name = declared.has(`--color-${token}`) ? `--color-${token}` : `--${token}`;
                if (SEMANTIC.test(name.replace(/^--color-|^--/, ""))) continue;
                const literal = resolve(name);
                if (!literal) continue;
                const fill = fillOf(name, share ? Number(share) / 100 : 1);
                if (!fill) continue;
                if (fill.alpha >= 1) continue;
                if (isRung(fill)) continue;
                const key = `${rel} :: ${name}${share ? `/${share}` : ""}`;
                if (EXEMPT[key]) continue;
                offenders.push(`${rel}: ${chain}bg-${token}${share ? `/${share}` : ""} is a state fill at ${fill.alpha} alpha, and not a rung`);
            }
            for (const m of text.matchAll(FADED)) {
                if (m[1] === undefined || Number(m[1]) >= 100) continue;
                const element = elementAt(text, must(m.index, "a match index"));
                if (!element) continue;
                if (!/(?:&&|\? |data-\[state=)/.test(element)) continue;
                const share = Number(m[1]) / 100;
                const name = m[0].match(/var\((--[\w-]+)\)/)?.[1] ?? "--panel-hover";
                const fill = fillOf(name, share);
                if (fill && fill.alpha >= RUNGS["--row-hover"]) continue;
                offenders.push(`${rel}: ${m[0]} is a committed fill at ${fill?.alpha ?? "?"} alpha, under the lightest rung`);
            }
        }
        expect(offenders, `state fills off the ladder:\n  ${offenders.join("\n  ")}`).toEqual([]);
    });





    it("never fills a committed branch at the alpha the same element hovers at", () => {
        // The same defect by value rather than by name: `bg-panel-hover` resolves to the
        // row hover alpha, so a selected branch written with the alias and a hover branch
        // written with the rung are the same fill. A control whose state follows the
        // pointer is not a committed branch, so an element that wires the highlight itself
        // is left alone.
        const POINTER_DRIVEN = /on(?:Mouse|Pointer)(?:Enter|Move|Over)/;
        /** A resting fill, in either spelling: `bg-[var(--x)]` or `bg-x` with an optional share. */
        const RESTING = /(?<!:)bg-(?:\[var\((--[\w-]+)\)\]|(?!\[)([a-z][\w-]*)(?:\/(\d+))?)/g;
        const offenders: string[] = [];
        for (const { rel, text } of files) {
            for (const m of text.matchAll(RESTING)) {
                const name = m[1] ?? (declared.has(`--color-${m[2]}`) ? `--color-${m[2]}` : `--${m[2]}`);
                const bare = fillOf(name, m[3] ? Number(m[3]) / 100 : 1);
                if (!bare || !isRung(bare)) continue;
                const element = elementAt(text, must(m.index, "a match index"));
                if (!element || POINTER_DRIVEN.test(element)) continue;
                const pointer = [...element.matchAll(FILL)]
                    .filter(([, chain]) => /(?:^|:)(?:hover|focus):$/.test(chain))
                    .map(([, , name]) => fillOf(name))
                    .filter((fill): fill is Fill => Boolean(fill) && isRung(fill as Fill));
                if (!pointer.some((fill) => Math.abs(fill.alpha - bare.alpha) < 1e-9)) continue;
                offenders.push(
                    `${rel}:${text.slice(0, m.index).split("\n").length} rests at ${bare.alpha} alpha, the same as its own hover fill`,
                );
            }
        }
        expect(offenders, `committed fills equal to hover:\n  ${offenders.join("\n  ")}`).toEqual([]);
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
