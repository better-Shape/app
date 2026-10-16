#!/usr/bin/env node
/**
 * Probe the panel-glyph rail through hover → click → pointer-out.
 *
 * The rail's position is `--panel-rail-hide` on `.panel-glyph`, consumed by
 * `.panel-glyph__hide { transform: scaleX(...) }`. Reading that custom property tells
 * us the *target* the transition is heading for; reading the resolved `transform`
 * matrix tells us where the rail actually is, on both axes so the bottom strip's
 * vertical rail is measured on the axis it uses. Both are printed, so a target that
 * never changes (a rule winning on specificity) is distinguishable from a transition
 * that is merely slow.
 *
 *   node scripts/qa/probe-rail.cjs [--selector='[data-panel-toggle="sidebar"]']
 */
const { chromium } = require("playwright");
const { default: sparticuz } = require("@sparticuz/chromium");

const { applySandboxLibs } = require("./sandbox-libs.cjs");
const arg = (name, fallback) => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
};
const SEL = arg("selector", '[data-panel-toggle="sidebar"]');

const state = (sel) =>
    [...document.querySelectorAll(sel)].map((btn) => {
        const glyph = btn.querySelector(".panel-glyph");
        const hide = glyph?.querySelector(".panel-glyph__hide");
        const r = btn.getBoundingClientRect();
        return {
            open: glyph?.getAttribute("data-open"),
            target: glyph ? getComputedStyle(glyph).getPropertyValue("--panel-rail-hide").trim() : null,
            // Both axes: side rails scale on X, the bottom strip scales on Y, and reading
            // only `a` reports a flat 1 for every vertical rail and calls it no movement.
            scaleX: hide ? new DOMMatrixReadOnly(getComputedStyle(hide).transform).a.toFixed(3) : null,
            scaleY: hide ? new DOMMatrixReadOnly(getComputedStyle(hide).transform).d.toFixed(3) : null,
            aria: btn.getAttribute("aria-label"),
            x: +r.x.toFixed(1),
            // Who claimed what: a committed button must not be previewing, and a
            // button born from a commit must carry the mount marker.
            commit: btn.getAttribute("data-panel-committed") ?? "-",
            mount: btn.getAttribute("data-panel-commit-mount") ?? "-",
            onscreen: r.right > 0 && r.x < window.innerWidth,
        };
    });

async function main() {
    applySandboxLibs();
    const browser = await chromium.launch({
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (await sparticuz.executablePath()),
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, colorScheme: "dark" });
    await page.goto("http://127.0.0.1:48921/?seed=project", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    const show = async (label) => {
        const rows = await page.evaluate(state, SEL);
        console.log(
            label.padEnd(26),
            rows
                .filter((r) => r.onscreen)
                .map((r) => `x${r.x} open=${r.open} target=${r.target} scaleX=${r.scaleX} scaleY=${r.scaleY} commit=${r.commit} mount=${r.mount} [${r.aria}]`)
                .join("\n" + " ".repeat(26)),
        );
    };

    await show("0. at rest (no pointer)");
    await page.locator(`${SEL}:visible`).last().hover();
    await page.waitForTimeout(250);
    await show("1. hovered (expect peek)");

    // Timeline across the click: 16ms is one frame at 60fps, so a snap shows as a
    // single step and a travel shows as intermediate values.
    console.log("\n-- 16ms timeline from the click --");
    const samples = [];
    const clickAt = Date.now();
    await page.locator(SEL).first().click({ noWaitAfter: true });
    for (let i = 0; i < 14; i++) {
        await page.waitForTimeout(16);
        const rows = await page.evaluate(state, SEL);
        samples.push(
            `${String(Date.now() - clickAt).padStart(3)}ms  ${rows
                .map((r) => `x${r.x} scaleX=${r.scaleX} scaleY=${r.scaleY} t=${r.target}`)
                .join("  |  ")}`,
        );
    }
    for (const line of samples) console.log("   " + line);

    await page.waitForTimeout(400);
    await show("\n2. clicked, pointer still on");

    // Reversibility: the mark clears on pointer-out, so the preview must come back.
    await page.mouse.move(640, 500);
    await page.waitForTimeout(300);
    await show("3. pointer away (committed state held)");
    await page.locator(`${SEL}:visible`).last().hover();
    await page.waitForTimeout(300);
    await show("4. hovered again (preview must return)");

    await browser.close();
}

main().catch((e) => {
    process.stderr.write(String(e?.stack ?? e) + "\n");
    process.exit(1);
});
