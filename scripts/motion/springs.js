
/**
 * These scripts print their report to stdout, and the generated files are written
 * separately. A one-line writer keeps the output free of the console shim.
 */
const log = (...args) => process.stdout.write(args.join(" ") + "\n");
/**
 * Spring physics for CSS, and the motion tokens the app is built from.
 *
 * A cubic-bezier makes one hump, so it can fake overshoot but never a decaying settle,
 * and it must reach its endpoint at zero velocity. The curve this app used to ship,
 * `cubic-bezier(0.16, 1, 0.3, 1)`, covered 95% of its distance in the first 42.6% of the
 * duration, which left 57.4% of every transition as an invisible crawl.
 *
 * The parameters are Apple's: a response in seconds and a bounce, where a bounce of zero
 * is critically damped and a positive bounce overshoots. Stiffness, damping and mass are
 * derived from them.
 *
 *     w = 2pi / response    k = w^2    zeta = 1 - bounce    c = 2*zeta*w
 *
 * Output is a `linear()` stop list, since there is no animation runtime. Every caller
 * keeps a bezier fallback behind `@supports`.
 *
 * Response is a pure time scale, so the shape of a curve depends on bounce alone. The
 * responses are chosen backwards from settle time, which is about 1.35x response.
 *
 * Generated: `--write` writes `app/springs.css`, and `tests/ui/spring-tokens.test.ts`
 * fails the suite if that file is stale or hand-edited.
 */
/**
 * Damped harmonic oscillator position, 0 to 1, for normalised time.
 *
 * Mass is fixed at 1, so stiffness is `w^2` and damping is `2*zeta*w`.
 */
export const springValue = (bounce, response, t) => {
    const w = (2 * Math.PI) / response;
    const z = 1 - bounce;
    if (z < 1) {
        const wd = w * Math.sqrt(1 - z * z);
        const zf = z / Math.sqrt(1 - z * z);
        return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + zf * Math.sin(wd * t));
    }
    if (Math.abs(z - 1) < 1e-9) return 1 - Math.exp(-w * t) * (1 + w * t);
    const s = Math.sqrt(z * z - 1);
    const r1 = -w * (z - s);
    const r2 = -w * (z + s);
    const c2 = -r1 / (r2 - r1);
    const c1 = 1 - c2;
    return 1 - (c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t));
}

/**
 * When the spring is close enough to rest that no one can tell.
 *
 * 0.002 (0.2%) rather than a looser threshold on purpose: the curve is truncated here
 * and the last stop is forced to exactly 1, so anything left over becomes a step at
 * the end of the transition. At 0.2% that step is under a pixel on a 400px surface,
 * and sub-pixel on the controls this mostly drives.
 */
export const settleTime = (bounce, response, tolerance = 0.002) => {
    let last = 0;
    for (let t = 0; t < 12; t += 0.0005) {
        if (Math.abs(springValue(bounce, response, t) - 1) > tolerance) last = t;
    }
    return last;
}

/**
 * Sample a spring into a CSS `linear()` easing.
 *
 * The `linear()` shorthand accepts bare values (evenly spaced) or `value pct%` pairs.
 * Percent pairs are used here only for the first and last stop, so the string stays
 * compact, because most of the length in a spring curve is data rather than syntax, and trimming it
 * would round off the oscillation that is the whole point.
 */
export const springToLinear = (bounce, response, { samples = 64 } = {}) => {
    const settle = settleTime(bounce, response);
    const stops = [];
    for (let i = 0; i <= samples; i++) {
        const t = (i / samples) * settle;
        const v = i === samples ? 1 : springValue(bounce, response, t);
        stops.push(Math.round(v * 10000) / 10000);
    }
    return { stops, durationMs: Math.round(settle * 1000), easing: `linear(${stops.join(", ")})` };
}

/** Largest value in a sampled curve, and the fraction of the duration where it happens. */
export const peakOf = (stops) => {
    let peak = 0;
    let peakAt = 0;
    stops.forEach((v, i) => {
        if (v > peak) {
            peak = v;
            peakAt = i / (stops.length - 1);
        }
    });
    return { peak, peakAt };
}

/**
 * The app's spring family.
 *
 * Response scales with the size of what moves, which is the thing a flat
 * `--transition-fast: 90ms` / `--transition-base: 140ms` pair cannot express: a tab
 * label and a whole panel should not share a duration. Bounce is 0 everywhere except
 * the two cases that actually carry momentum or are allowed delight.
 */
export const SPRINGS = {
    /**
     * Press release, tints, urgent state. The shortest curve that still reads as
     * motion; a press is a 1.5% scale change, so its whole budget is 140ms.
     */
    tap: { response: 0.104, bounce: 0, note: "micro feedback: press, tint, urgent state" },
    /** Tabs, list fills, in-place swaps, the panel rail. */
    quick: { response: 0.134, bounce: 0, note: "small controls and in-place changes" },
    /** Panels, popovers, section reveals, sidebar motion. */
    panel: { response: 0.178, bounce: 0, note: "panels, popovers, container reveals" },
    /** Dialogs and full-surface transitions. */
    surface: { response: 0.237, bounce: 0, note: "dialogs and large surfaces" },
    /**
     * Under-damped, and only ever after a gesture that had momentum: a drag release,
     * a flick, a reorder settling. The overshoot is earned by the user's own velocity.
     */
    flick: { response: 0.2, bounce: 0.2, note: "drag release / reorder settle only" },
    /**
     * The delight budget: first-run and empty states, seen once. Never on a surface
     * that is visited daily.
     */
    delight: { response: 0.3, bounce: 0.32, note: "first-run and empty states only" },
};

/** The cubic-bezier each spring degrades to where `linear()` is unavailable. */
export const FALLBACKS = {
    tap: "cubic-bezier(0.22, 1, 0.36, 1)",
    quick: "cubic-bezier(0.22, 1, 0.36, 1)",
    panel: "cubic-bezier(0.16, 1, 0.3, 1)",
    surface: "cubic-bezier(0.16, 1, 0.3, 1)",
    flick: "cubic-bezier(0.34, 1.35, 0.64, 1)",
    delight: "cubic-bezier(0.34, 1.4, 0.64, 1)",
};

/** Render the whole family as the CSS the app imports. */
export const renderCss = () => {
    const lines = [];
    lines.push("/*");
    lines.push(" * Generated by `node scripts/motion/springs.js --write`, do not edit by hand.");
    lines.push(" *");
    lines.push(" * Spring curves sampled from a damped harmonic oscillator into `linear()` stops. The");
    lines.push(" * parameters are the source of truth and live in the generator.");
    lines.push(" *");
    lines.push(" * Each spring comes with the duration it settles in, because `linear()` does not infer");
    lines.push(" * one. Use them as a pair: `var(--spring-quick-dur)` and `var(--spring-quick)`.");
    lines.push(" *");
    lines.push(" *   response  the period of one oscillation; smaller is snappier");
    lines.push(" *   bounce    0 is critically damped, the fastest arrival with no overshoot");
    lines.push(" *   settle    when the spring is within 0.2% of its target");
    lines.push(" *   peak      how far past the target it goes. A spring peaks early and decays; a");
    lines.push(" *             hand-written overshoot peaks late and reads as a released rubber band.");
    lines.push(" */");
    lines.push(":root {");
    for (const [name, cfg] of Object.entries(SPRINGS)) {
        const { easing, durationMs, stops } = springToLinear(cfg.bounce, cfg.response);
        const { peak, peakAt } = peakOf(stops);
        lines.push("");
        lines.push(`  /* ${cfg.note}`);
        lines.push(
            `     response ${cfg.response}s, bounce ${cfg.bounce}, settles in ${durationMs}ms,` +
                ` peaks ${((peak - 1) * 100).toFixed(1)}% at ${Math.round(peakAt * 100)}% of the duration */`,
        );
        lines.push(`  --spring-${name}: ${easing};`);
        lines.push(`  --spring-${name}-dur: ${durationMs}ms;`);
        lines.push(`  --spring-${name}-fallback: ${FALLBACKS[name]};`);
    }
    lines.push("}");
    lines.push("");
    lines.push("/*");
    lines.push(" * Where `linear()` is missing, every spring degrades to the closest cubic-bezier");
    lines.push(" * (one overshoot instead of a decaying oscillation). Declared in one place so a");
    lines.push(" * call site never has to think about it and no call site can forget it.");
    lines.push(" */");
    lines.push("@supports not (animation-timing-function: linear(0, 1)) {");
    lines.push("  :root {");
    for (const name of Object.keys(SPRINGS)) {
        lines.push(`    --spring-${name}: var(--spring-${name}-fallback);`);
    }
    lines.push("  }");
    lines.push("}");
    return lines.join("\n") + "\n";
}

/** Parameter table, for the CLI and for the test's physics assertions. */
export const table = () => {
    return Object.entries(SPRINGS).map(([name, cfg]) => {
        const { stops, durationMs, easing } = springToLinear(cfg.bounce, cfg.response);
        const { peak, peakAt } = peakOf(stops);
        return {
            name,
            ...cfg,
            durationMs,
            peak: Number(((peak - 1) * 100).toFixed(2)),
            peakAtPct: Math.round(peakAt * 100),
            easingLength: easing.length,
            stops,
        };
    });
}

// ── CLI ────────────────────────────────────────────────────────────────────────────
// `--write` regenerates the stylesheet; `--table` prints the physics for review.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
    const args = process.argv.slice(2);
    const out = new URL("../../app/springs.css", import.meta.url);
    if (args.includes("--write")) {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(out, renderCss());
        log(`wrote app/springs.css (${renderCss().length} bytes)`);
    }
    if (args.includes("--table") || args.length === 0) {
        const rows = table();
        const pad = (v, n) => String(v).padEnd(n);
        log(
            pad("token", 22) + pad("response", 10) + pad("bounce", 8) + pad("settle", 9) +
            pad("overshoot", 11) + pad("peak at", 9) + "crosses target at",
        );
        for (const r of rows) {
            const stops = r.stops;
            let cross = null;
            for (let i = 1; i < stops.length; i++) {
                if (stops[i] >= 1) { cross = Math.round((i / (stops.length - 1)) * 100); break; }
            }
            log(
                pad("--spring-" + r.name, 22) + pad(r.response + "s", 10) + pad(r.bounce, 8) +
                pad(r.durationMs + "ms", 9) + pad((r.peak > 0 ? "+" : "") + r.peak + "%", 11) +
                pad(r.peakAtPct + "%", 9) + (cross === null ? "never (monotonic)" : cross + "%"),
            );
        }
    }
}
