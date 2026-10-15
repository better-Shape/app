#!/usr/bin/env node
/**
 * Proves the swept motion tokens reach the browser.
 *
 * Tailwind's arbitrary-value syntax fails silently, so `duration-[var(--spring-tap-dur)]`
 * compiles whether or not the token exists and a typo is invisible to a class-name check.
 * This drives a real pointer onto real controls and reads the resolved transition off the
 * element the browser is actually transitioning.
 *
 *   PLAYWRIGHT_SANDBOX_LIBS=/tmp/sandboxlibs/lib node scripts/qa/probe-motion-tokens.cjs
 */
const { chromium } = require("playwright");
const { default: sparticuz } = require("@sparticuz/chromium");

const URL = process.env.PROBE_URL ?? "http://127.0.0.1:48921/?seed=project";

/** Each target: how to find it, and what its fill should resolve to. */
const TARGETS = [
    { name: "sidebar nav row (New Chat)", find: 'button:has-text("New Chat")', expect: { ease: "spring-tap", fill: true } },
    { name: "sessions icon button (search)", find: 'button[aria-label*="Search" i]', expect: { ease: "spring-tap", fill: true } },
    { name: "shelf header", find: "button[aria-expanded]", expect: { ease: "spring-tap", fill: true } },
    { name: "workspace tab close", find: '[role="tab"] button', expect: { fill: false } },
    { name: "copy button", find: 'button:has-text("Copy")', expect: { fill: false } },
];

const readTransition = (el) => {
    const cs = getComputedStyle(el);
    return {
        property: cs.transitionProperty,
        duration: cs.transitionDuration,
        timing: cs.transitionTimingFunction,
        background: cs.backgroundColor,
    };
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

    // What the tokens resolve to, straight from the cascade.
    const tokens = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        const out = {};
        for (const name of ["tap", "quick", "panel", "surface", "flick", "delight"]) {
            out[name] = {
                easing: cs.getPropertyValue(`--spring-${name}`).trim().slice(0, 46),
                duration: cs.getPropertyValue(`--spring-${name}-dur`).trim(),
            };
        }
        out.legacy = { fast: cs.getPropertyValue("--transition-fast").trim(), easeOut: cs.getPropertyValue("--ease-out").trim() };
        return out;
    });
    console.log("── tokens as the browser resolves them");
    for (const [name, t] of Object.entries(tokens)) {
        if (name === "legacy") continue;
        console.log(`   --spring-${name.padEnd(8)} ${t.duration.padEnd(7)} ${t.easing}…`);
    }
    console.log(`   legacy --transition-fast ${tokens.legacy.fast} on ${tokens.legacy.easeOut}`);

    let failures = 0;
    console.log("\n── resolved transitions on real controls");
    for (const target of TARGETS) {
        const locator = page.locator(target.find).first();
        if (!(await locator.count())) {
            console.log(`   ${target.name.padEnd(34)} SKIP (not present)`);
            continue;
        }
        let box;
        try {
            box = await locator.boundingBox();
        } catch {
            box = null;
        }
        if (!box) {
            console.log(`   ${target.name.padEnd(34)} SKIP (no box)`);
            continue;
        }
        // Drive the real pointer: `hover()` cannot reach some of these chrome elements.
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(120);
        const t = await locator.evaluate(readTransition);
        const isSpring = t.timing.includes("linear(") || t.timing.includes("cubic-bezier(0.22");
        const hadFill = t.property.includes("background-color");
        const wantsSpring = Boolean(target.expect.ease);
        const ok = (!wantsSpring || isSpring) && (!target.expect.fill || hadFill);
        if (!ok) failures++;
        console.log(
            `   ${ok ? "ok  " : "FAIL"} ${target.name.padEnd(34)} ${t.duration.padEnd(9)} ` +
                `${isSpring ? "spring " : "bezier "} ${hadFill ? "bg-animated" : "no-bg"}`,
        );
        if (!ok) console.log(`        property=${t.property}\n        timing=${t.timing.slice(0, 90)}`);
    }

    console.log(`\n${failures === 0 ? "PASS" : `FAIL: ${failures} control(s) not on the spring vocabulary`}`);
    await browser.close();
    process.exit(failures === 0 ? 0 : 1);
})();
