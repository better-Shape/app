#!/usr/bin/env node
/**
 * Ad-hoc measurement probe: report the geometry of a selector over time.
 *
 * Used to check motion claims against the browser rather than against a crop or an
 * expectation. Prints one row per sample: time, x, y, width, height, and the
 * transition/animation state, so a jump (instant reposition) is visually distinct
 * from a travel (interpolated).
 *
 *   node scripts/qa/probe-geometry.cjs --url="http://127.0.0.1:48921/?seed=project" \
 *     --click="[data-panel-toggle=sidebar]" --watch="[data-panel-toggle=sidebar]"
 */
const { chromium } = require("playwright");
const { default: sparticuz } = require("@sparticuz/chromium");

const { applySandboxLibs } = require("./sandbox-libs.cjs");
const { log } = require("./log.cjs");
const arg = (name, fallback) => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
};

const URL_ = arg("url", "http://127.0.0.1:48921/?seed=project");
const WATCH = arg("watch", '[data-panel-toggle="sidebar"]');
const CLICK = arg("click", "");
const SAMPLES = Number(arg("samples", "40"));
const INTERVAL = Number(arg("interval", "16"));
const EVERY = Number(arg("every", "1"));

const describe = (r) => `x${r.x} y${r.y} ${r.w}x${r.h}${r.panel ? `[${r.panel}]` : ""}`;
const fmtSide = (s) => (s ? `${s.x} ${s.w}` : "none");

async function main() {
    applySandboxLibs();
    const browser = await chromium.launch({
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (await sparticuz.executablePath()),
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, colorScheme: "dark" });
    await page.goto(URL_, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    const probe = () =>
        page.evaluate((sel) => {
            const nodes = [...document.querySelectorAll(sel)];
            const rects = nodes.map((n) => {
                const r = n.getBoundingClientRect();
                return {
                    x: +r.x.toFixed(2),
                    y: +r.y.toFixed(2),
                    w: +r.width.toFixed(2),
                    h: +r.height.toFixed(2),
                    panel: n.getAttribute("data-panel-toggle"),
                    id: n.closest("[id]")?.id ?? "",
                };
            });
            const sidebar = document.querySelector("aside");
            const sr = sidebar?.getBoundingClientRect();
            // What is animating on each watched node right now. A rect that moves with an
            // empty list here moved because the layout changed, not because a transition
            // is running, which is the distinction this probe exists to make.
            const live = nodes.map(
                (n) =>
                    n
                        .getAnimations()
                        .filter((a) => a.playState === "running")
                        .map((a) => a.transitionProperty ?? a.animationName ?? "?")
                        .join("+") || "-",
            );
            return {
                rects,
                live,
                sidebar: sr ? { x: +sr.x.toFixed(2), w: +sr.width.toFixed(2), cls: sidebar.className.slice(0, 60) } : null,
            };
        }, WATCH);

    log("t(ms)\t" + ["#", "x", "y", "w", "h"].join("\t") + "\tsidebar(x,w)\tlive");
    const before = await probe();
    log(`0\t\t${before.rects.map(describe).join(" | ")}\t${fmtSide(before.sidebar)}\t${before.live.join(" | ")}`);

    if (CLICK) {
        await page.locator(CLICK).first().click();
    }

    const t0 = Date.now();
    for (let i = 1; i <= SAMPLES; i++) {
        await page.waitForTimeout(INTERVAL);
        if (i % EVERY !== 0 && i !== SAMPLES) continue;
        const s = await probe();
        log(`${Date.now() - t0}\t\t${s.rects.map(describe).join(" | ")}\t${fmtSide(s.sidebar)}\t${s.live.join(" | ")}`);
    }

    await browser.close();
}

main().catch((e) => {
    process.stderr.write(String(e?.stack ?? e) + "\n");
    process.exit(1);
});
