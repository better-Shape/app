/**
 * Verifies the spring system against a real engine.
 *
 *   1. Does `transition-timing-function: var(--spring-*)` resolve? A custom property is
 *      only substituted at computed-value time, and an engine that rejects `linear()`
 *      falls back to `ease` silently.
 *   2. Does the curve drive the motion? `document.getAnimations()` reports the timing
 *      function the engine applied, which tells a real spring from a silent fallback.
 *   3. Does it hold a frame budget? Two animated surfaces move layout properties, the one
 *      place a smooth curve cannot save a stutter.
 *   4. Does the panel rail still preview its midpoint? Read before anything is clicked,
 *      because a commit deliberately spends the preview.
 *
 * Run: PLAYWRIGHT_SANDBOX_LIBS=/tmp/sandboxlibs/lib node scripts/qa/probe-springs.cjs
 */
const { chromium } = require("playwright");
const { default: sparticuz } = require("@sparticuz/chromium");

const URL = process.env.PROBE_URL ?? "http://127.0.0.1:48921/?seed=project";

(async () => {
    process.env.LD_LIBRARY_PATH = `/tmp/sandboxlibs/lib:${process.env.LD_LIBRARY_PATH ?? ""}`;
    const browser = await chromium.launch({
        executablePath: await sparticuz.executablePath(),
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(URL, { waitUntil: "commit", timeout: 120_000 });
    await page.waitForLoadState("domcontentloaded", { timeout: 120_000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // ── 1. tokens ──────────────────────────────────────────────────────────────────
    const tokens = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        const out = {};
        for (const n of ["tap", "quick", "panel", "surface", "flick", "delight"]) {
            const val = cs.getPropertyValue(`--spring-${n}`).trim();
            out[n] = {
                kind: val.startsWith("linear(") ? "linear()" : val.startsWith("cubic-bezier") ? "BEZIER FALLBACK" : "MISSING",
                stops: val.startsWith("linear(") ? val.split(",").length : 0,
                dur: cs.getPropertyValue(`--spring-${n}-dur`).trim(),
                accepted:
                    CSS.supports("transition-timing-function", val) ||
                    CSS.supports("animation-timing-function", val),
            };
        }
        return out;
    });
    console.log("1. SPRING TOKENS");
    for (const [n, t] of Object.entries(tokens)) {
        console.log(
            `   --spring-${n.padEnd(9)} ${t.kind.padEnd(14)} ${String(t.stops).padEnd(3)} stops  ${t.dur.padEnd(7)} accepted=${t.accepted}`,
        );
    }

    // ── 4 (first, before any click commits it). rail midpoint preview ─────────────
    const railValue = async () =>
        page.evaluate(() => {
            const el = document.querySelector("[data-panel-toggle] .panel-glyph__hide");
            if (!el) return null;
            const m = getComputedStyle(el).transform.match(/matrix\(([^)]+)\)/);
            return m ? +(+m[1].split(",")[0]).toFixed(3) : null;
        });
    const toggle = page.locator("[data-panel-toggle]").first();
    console.log("\n4. PANEL RAIL (midpoint preview, before anything is committed)");
    await page.mouse.move(900, 500);
    await page.waitForTimeout(400);
    const rest = await railValue();
    await toggle.hover();
    await page.waitForTimeout(450);
    const hovered = await railValue();
    await page.mouse.move(900, 500);
    await page.waitForTimeout(450);
    console.log(
        `   rest=${rest}  hovered=${hovered}  released=${await railValue()}  midpoint-holds=${hovered === 0.5}`,
    );

    // ── 2. what the engine actually runs ──────────────────────────────────────────
    const inspect = async (label, act) => {
        await act();
        const running = await page.evaluate(() =>
            document.getAnimations().map((a) => {
                const t = a.effect?.getTiming?.() ?? {};
                const el = a.effect?.target;
                return {
                    prop: a.transitionProperty ?? a.animationName ?? a.constructor.name,
                    dur: Math.round(Number(t.duration) || 0),
                    easing: String(t.easing ?? ""),
                    el: el ? `${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(" ")[0] : ""}` : "?",
                };
            }),
        );
        console.log(`   ${label}`);
        if (!running.length) console.log("      (nothing running at sample time)");
        for (const r of running.slice(0, 8)) {
            const kind = r.easing.startsWith("linear(")
                ? `SPRING ${r.easing.split(",").length} stops`
                : r.easing.startsWith("cubic-bezier")
                  ? "bezier"
                  : r.easing || "(engine default)";
            console.log(`      ${String(r.prop).padEnd(20)} ${String(r.dur + "ms").padEnd(8)} ${kind.padEnd(18)} ${r.el}`);
        }
    };
    console.log("\n2. WHAT THE ENGINE ACTUALLY RUNS");
    await inspect("panel toggle:", async () => toggle.dispatchEvent("click"));
    await page.waitForTimeout(600);
    const shelf = page.locator("[data-shelf-header]").first();
    if (await shelf.count()) {
        await inspect("section reveal:", async () => shelf.dispatchEvent("click"));
        await page.waitForTimeout(600);
    }

    // ── 3. frame pacing, after a warm-up pass ─────────────────────────────────────
    const measureFrames = async (label, act) => {
        await page.evaluate(() => {
            window.__frames = [];
            window.__raf = true;
            let last = performance.now();
            const tick = (now) => {
                window.__frames.push(now - last);
                last = now;
                if (window.__raf) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        });
        await act();
        await page.waitForTimeout(600);
        const f = await page.evaluate(() => {
            window.__raf = false;
            return window.__frames.slice(3);
        });
        const sorted = [...f].sort((a, b) => a - b);
        const q = (p) => +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))].toFixed(1);
        const verdict = q(0.95) <= 20 ? "smooth" : "HITCHY";
        console.log(
            `   ${label.padEnd(24)} n=${String(f.length).padEnd(4)} median=${String(q(0.5)).padEnd(6)} p95=${String(q(0.95)).padEnd(6)} worst=${String(+Math.max(...f).toFixed(1)).padEnd(7)} >25ms: ${String(f.filter((d) => d > 25).length).padEnd(3)} ${verdict}`,
        );
    };
    console.log("\n3. FRAME PACING (16.7ms budget; 25ms+ is a visible hitch)");
    console.log("   -- warm-up pass, excluded from the verdict --");
    await measureFrames("panel (cold)", async () => toggle.dispatchEvent("click"));
    await page.waitForTimeout(400);
    console.log("   -- measured --");
    await measureFrames("panel toggle", async () => toggle.dispatchEvent("click"));
    await page.waitForTimeout(400);
    await measureFrames("panel toggle back", async () => toggle.dispatchEvent("click"));
    if (await shelf.count()) {
        await measureFrames("section reveal", async () => shelf.dispatchEvent("click"));
        await page.waitForTimeout(400);
        await measureFrames("section reveal back", async () => shelf.dispatchEvent("click"));
    }

    await browser.close();
})().catch((error) => {
    process.stderr.write(String(error?.stack ?? error) + "\n");
    process.exit(1);
});
