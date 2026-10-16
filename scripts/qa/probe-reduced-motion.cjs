/**
 * Proves the reduced-motion guard in app/transitions.css against a real engine.
 *
 * The stylesheet-contract test in tests/ui/reduced-motion.test.ts holds the *source*;
 * this holds the *computed* result, which is the part a specificity mistake breaks:
 * Tailwind's `.animate-spin` and this guard both set `animation-duration`, and only
 * `!important` (or source order) decides who wins.
 *
 * Run: PLAYWRIGHT_SANDBOX_LIBS=/tmp/sandboxlibs/lib node scripts/qa/probe-reduced-motion.cjs
 */
const { chromium } = require("playwright");
const { default: sparticuz } = require("@sparticuz/chromium");

const { applySandboxLibs } = require("./sandbox-libs.cjs");
const { log } = require("./log.cjs");
const URL = process.env.PROBE_URL ?? "http://127.0.0.1:48921/?seed=project";

const PROBE = () => {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:-9999px;top:0";
    for (const cls of ["animate-spin", "animate-pulse", "git-generate-shimmer", "imsg-typing"]) {
        const el = document.createElement("div");
        el.className = cls;
        if (cls === "imsg-typing") el.innerHTML = "<span></span>";
        el.dataset.probe = cls;
        host.append(el);
    }
    document.body.append(host);
    const read = (sel) => {
        const el = document.querySelector(sel);
        const cs = getComputedStyle(el);
        return {
            name: cs.animationName,
            duration: cs.animationDuration,
            count: cs.animationIterationCount,
        };
    };
    return {
        "animate-spin": read('[data-probe="animate-spin"]'),
        "animate-pulse": read('[data-probe="animate-pulse"]'),
        "git-generate-shimmer": read('[data-probe="git-generate-shimmer"]'),
        "imsg-typing span": read('[data-probe="imsg-typing"] span'),
        media: matchMedia("(prefers-reduced-motion: reduce)").matches,
    };
};

(async () => {
    applySandboxLibs();
    const browser = await chromium.launch({
        executablePath: await sparticuz.executablePath(),
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"],
    });
    for (const reducedMotion of ["no-preference", "reduce"]) {
        const page = await browser.newPage({ reducedMotion });
        await page.goto(URL, { waitUntil: "commit", timeout: 120_000 });
        await page.waitForLoadState("domcontentloaded", { timeout: 120_000 }).catch(() => {});
        await page.waitForTimeout(1500);
        const out = await page.evaluate(PROBE);
        log(`\nprefers-reduced-motion: ${reducedMotion} (matches: ${out.media})`);
        for (const key of ["animate-spin", "animate-pulse", "git-generate-shimmer", "imsg-typing span"]) {
            const v = out[key];
            log(`  ${key.padEnd(22)} name=${v.name.padEnd(24)} duration=${v.duration.padEnd(8)} count=${v.count}`);
        }
        await page.close();
    }
    await browser.close();
})().catch((error) => {
    process.stderr.write(String(error?.stack ?? error) + "\n");
    process.exit(1);
});
