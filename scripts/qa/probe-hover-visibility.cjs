#!/usr/bin/env node
/**
 * Measures the hover fill the user actually sees, in pixels.
 *
 * The complaint was that hovering the sessions cluster "does nothing". A token audit
 * says those buttons DO have a hover fill (4% white), so the audit and the complaint
 * disagree, which means the audit is measuring the wrong thing. What matters is the
 * rendered delta: how far the button's background moves between rest and hover, in
 * 0-255 channel units, against the panel it sits on.
 *
 * Below roughly 4 channel units on a dark surface a fill is not reliably visible on an
 * uncalibrated display, which is the ordinary case. This prints the delta so the claim
 * "the hover is there, you just cannot see it" is checkable rather than asserted.
 *
 *   PLAYWRIGHT_SANDBOX_LIBS=/tmp/sandboxlibs/lib node scripts/qa/probe-hover-visibility.cjs
 */
const { chromium } = require("playwright");
const { default: sparticuz } = require("@sparticuz/chromium");

const URL = process.env.PROBE_URL ?? "http://127.0.0.1:48921/?seed=project";

const CONTROLS = [
    { name: "Search", label: 'button[aria-label="Search"]' },
    { name: "Filter", label: 'button[aria-label="Filter"]' },
    { name: "Sessions actions", label: 'button[aria-label="Sessions actions"]' },
    { name: "New chat", label: 'button[aria-label="New chat"]' },
    { name: "sidebar nav row", label: 'button:has-text("New Chat")' },
    { name: "sidebar toggle", label: '[data-panel-toggle="sidebar"]' },
    { name: "terminal toggle", label: '[data-panel-toggle="terminal"]' },
];

/** Composite an rgba over an opaque base and return 0-255 channels. */
const composite = (fg, bg) => {
    const parse = (s) => (String(s).match(/[\d.]+/g) ?? []).map(Number);
    const [r1, g1, b1, a1 = 1] = parse(fg);
    const [r2, g2, b2] = parse(bg);
    return [r1 * a1 + r2 * (1 - a1), g1 * a1 + g2 * (1 - a1), b1 * a1 + b2 * (1 - a1)].map((v) => Math.round(v));
};

(async () => {
    process.env.LD_LIBRARY_PATH = `/tmp/sandboxlibs/lib:${process.env.LD_LIBRARY_PATH ?? ""}`;
    const browser = await chromium.launch({
        executablePath: await sparticuz.executablePath(),
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(URL, { waitUntil: "commit", timeout: 120_000 });
    await page.waitForLoadState("domcontentloaded", { timeout: 120_000 }).catch(() => {});
    await page.waitForTimeout(3500);

    const panel = await page.evaluate(() => {
        const el = document.querySelector("aside") || document.body;
        return getComputedStyle(el).backgroundColor;
    });
    console.log(`sidebar surface, for reference: ${panel}`);
    console.log("each control is composited over its own backdrop, printed per row\n");
    console.log(`${"control".padEnd(20)} ${"rest".padEnd(18)} ${"hover".padEnd(18)} Δ (channel)`);
    console.log("─".repeat(76));

    const rows = [];
    for (const c of CONTROLS) {
        const loc = page.locator(c.label).first();
        if (!(await loc.count())) {
            console.log(`${c.name.padEnd(20)} SKIP (not present)`);
            continue;
        }
        const box = await loc.boundingBox().catch(() => null);
        if (!box) {
            console.log(`${c.name.padEnd(20)} SKIP (no box)`);
            continue;
        }
        // Park the pointer far away first so no neighbouring hover leaks in.
        await page.mouse.move(660, 660);
        await page.waitForTimeout(260);
        // What this control is painted over, walked from its own ancestors rather than
        // assumed from one surface: a titlebar toggle does not sit on the sidebar, and
        // compositing it against the wrong base reports the wrong delta and the wrong
        // verdict on whether its hover is visible at all.
        const surface = await loc.evaluate((el) => {
            const parse = (text) => {
                const m = String(text).match(/[\d.]+/g);
                if (!m) return null;
                const v = m.map(Number);
                return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 };
            };
            const over = (node, depth) => {
                if (!node || depth > 10) return { r: 0, g: 0, b: 0, a: 1 };
                const under = over(node.parentElement, depth + 1);
                const c = parse(getComputedStyle(node).backgroundColor);
                if (!c || c.a === 0) return under;
                return {
                    r: c.r * c.a + under.r * (1 - c.a),
                    g: c.g * c.a + under.g * (1 - c.a),
                    b: c.b * c.a + under.b * (1 - c.a),
                    a: c.a + under.a * (1 - c.a),
                };
            };
            const b = over(el.parentElement, 0);
            return {
                fill: getComputedStyle(el).backgroundColor,
                backdrop: `rgb(${Math.round(b.r)}, ${Math.round(b.g)}, ${Math.round(b.b)})`,
            };
        });
        const rest = surface.fill;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(320);
        const hover = await loc.evaluate((el) => getComputedStyle(el).backgroundColor);

        const restPx = composite(rest, surface.backdrop);
        const hoverPx = composite(hover, surface.backdrop);
        const delta = Math.max(...restPx.map((v, i) => Math.abs(v - hoverPx[i])));
        rows.push({ name: c.name, rest, hover, restPx, hoverPx, delta, backdrop: surface.backdrop });
        console.log(
            `${c.name.padEnd(20)} ${rest.replace(/\s/g, "").padEnd(18)} ${hover.replace(/\s/g, "").padEnd(18)} ${String(delta).padEnd(4)} over ${surface.backdrop}` +
                (delta === 0 ? "   no visible change" : ""),
        );
    }

    console.log("\nverdict");
    for (const r of rows) {
        const verdict = r.delta === 0 ? "INVISIBLE, no hover state" : r.delta < 4 ? "BELOW THRESHOLD, present but not reliably readable" : "visible";
        console.log(`   ${r.name.padEnd(20)} ${verdict}`);
    }

    await browser.close();
})().catch((error) => {
    process.stderr.write(String(error?.stack ?? error) + "\n");
    process.exit(1);
});
