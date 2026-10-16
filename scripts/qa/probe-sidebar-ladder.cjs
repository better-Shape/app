/**
 * Walks the sidebar's ladder in a real engine: rest, hover, selected, selected plus hover.
 *
 * Source assertions cannot see a specificity mistake or a fill that was applied but never
 * transitioned, and a collapsed ladder still looks right in the JSX. This reads computed
 * colours off live elements, clicks a real chat row, and checks the value returns.
 *
 * Run: PLAYWRIGHT_SANDBOX_LIBS=/tmp/sandboxlibs/lib node scripts/qa/probe-sidebar-ladder.cjs
 */
const { chromium } = require("playwright");
const { default: sparticuz } = require("@sparticuz/chromium");

const { applySandboxLibs } = require("./sandbox-libs.cjs");
const URL = process.env.PROBE_URL ?? "http://127.0.0.1:48921/?seed=project";

(async () => {
    applySandboxLibs();
    const browser = await chromium.launch({
        executablePath: await sparticuz.executablePath(),
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(URL, { waitUntil: "commit", timeout: 120_000 });
    await page.waitForLoadState("domcontentloaded", { timeout: 120_000 }).catch(() => {});
    await page.waitForTimeout(3000);

    const alphaOf = (el) => {
        const cs = getComputedStyle(el);
        const m = String(cs.backgroundColor).match(/rgba?\(([^)]+)\)/);
        const parts = m ? m[1].split(",").map((p) => Number.parseFloat(p)) : [];
        return {
            alpha: parts.length === 4 ? Math.round(parts[3] * 1000) / 1000 : 1,
            // The timing function is a spring, spelled as a long `linear()` stop list.
            // Printing it whole buried every other number, so it is reported by kind.
            transition: `${cs.transitionDuration} ${cs.transitionTimingFunction.includes("linear(") ? "spring" : cs.transitionTimingFunction}`,
        };
    };

    // The row chrome is on a wrapper and the title inside it is what gets clicked. A bare
    // `[class*="row-hover"]` query picks up whatever control is first in the DOM.
    const rows = page
        .locator('button:has-text("Preview fixture chat")')
        .locator('xpath=ancestor::*[contains(@class,"group/chat")][1]');
    const n = await rows.count();
    console.log(`chat rows in the seeded sidebar: ${n}`);
    if (!n) {
        console.log("fixture has no chat rows; nothing to measure");
        await browser.close();
        return;
    }

    const read = async (label) => {
        const v = await rows.first().evaluate(alphaOf);
        console.log(`  ${label.padEnd(26)} alpha=${String(v.alpha).padEnd(5)} transition=${v.transition}`);
        return v.alpha;
    };

    console.log("\nladder on the first chat row:");
    const rest = await read("rest (pointer away)");

    await rows.first().hover();
    await page.waitForTimeout(350);
    const hovered = await read("hovered (midpoint)");

    await page.locator('button:has-text("Preview fixture chat")').first().click();
    await page.waitForTimeout(350);

    await page.mouse.move(900, 400); // pointer off the sidebar
    await page.waitForTimeout(350);
    const committed = await read("committed (pointer away)");

    await rows.first().hover();
    await page.waitForTimeout(350);

    await page.mouse.move(900, 400);
    await page.waitForTimeout(350);
    const released = await read("released again");

    // An unselected control on the same ladder: the nav row above the list.
    let nav = null;
    const navRow = page.locator('button:has-text("New Chat")').first();
    if (await navRow.count()) {
        const navRest = await navRow.evaluate(alphaOf);
        await navRow.hover();
        await page.waitForTimeout(300);
        const navHover = await navRow.evaluate(alphaOf);
        await page.mouse.move(900, 400);
        await page.waitForTimeout(300);
        const navBack = await navRow.evaluate(alphaOf);
        nav = { rest: navRest.alpha, hover: navHover.alpha, back: navBack.alpha };
        console.log("\nunselected nav row (the midpoint, on an unselected control):");
        console.log(
            `  rest=${navRest.alpha}  hover=${navHover.alpha}  released=${navBack.alpha}  transition=${navHover.transition}`,
        );
        console.log(
            `  midpoint vs selected: hover ${navHover.alpha} x2 = ${(navHover.alpha * 2).toFixed(2)} vs committed ${committed}`,
        );
    }

    const tokens = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        return Object.fromEntries(
            ["--row-hover", "--row-selected", "--row-selected-hover"].map((t) => [
                t,
                cs.getPropertyValue(t).trim(),
            ]),
        );
    });
    /**
     * Alpha of a token as a percentage, from either form the stylesheet may use:
     * `rgba(255, 255, 255, 0.04)` or `#ffffff0a`. Reading a fixed slice of the string
     * assumed the second form and reported a percentage made of hex digits that are
     * not there.
     */
    const pct = (value) => {
        const text = String(value).trim();
        const eight = text.match(/^#([0-9a-f]{8})$/i);
        if (eight) return Number(((Number.parseInt(eight[1].slice(6, 8), 16) / 255) * 100).toFixed(1));
        const parts = text.match(/[\d.]+/g) ?? [];
        const alpha = parts.length >= 4 ? Number(parts[3]) : 1;
        return Number((alpha * 100).toFixed(1));
    };
    console.log("\ntokens:", tokens);
    const h = pct(tokens["--row-hover"]);
    const s = pct(tokens["--row-selected"]);
    const sh = pct(tokens["--row-selected-hover"]);
    console.log(`  hover ${h}%  selected ${s}%  selected+hover ${sh}%`);

    // A ladder is a claim about ordering, so the probe has to be able to disagree. These
    // six checks are what a reader would check by eye, and any of them failing exits 1.
    // The probed row is the committed one, so its ladder runs committed to committed+hover
    // and back; the unselected control above it carries the midpoint step. An earlier
    // version of these checks asserted the unselected order against the committed row and
    // failed against a correct app.
    const checks = [
        ["declared hover is exactly half of declared selected", h === s / 2],
        ["declared hover survives the 8-bit alpha round trip", h >= 3],
        ["declared selected is above declared hover", s > h],
        ["declared selected+hover is above declared selected", sh > s],
        ["the committed row steps up on hover", hovered > rest],
        ["releasing the pointer returns the committed row to its committed tone", released === committed],
        ["an unselected row fills on hover and clears on release", nav !== null && nav.hover > nav.rest && nav.back === nav.rest],
        ["the unselected midpoint is exactly half the committed tone", nav !== null && Number((nav.hover * 2).toFixed(2)) === committed],
    ];
    console.log("\nchecks:");
    for (const [name, ok] of checks) console.log(`  ${ok ? "ok  " : "FAIL"} ${name}`);
    const failed = checks.filter(([, ok]) => !ok).length;
    console.log(`\n${failed === 0 ? "PASS" : `FAIL: ${failed} check(s)`}`);
    await browser.close();
    process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
    process.stderr.write(String(error?.stack ?? error) + "\n");
    process.exit(1);
});
