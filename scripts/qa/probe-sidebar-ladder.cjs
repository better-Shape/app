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

    const alphaOf = (el) => {
        const cs = getComputedStyle(el);
        const m = String(cs.backgroundColor).match(/rgba?\(([^)]+)\)/);
        const parts = m ? m[1].split(",").map((p) => parseFloat(p)) : [];
        return {
            alpha: parts.length === 4 ? Math.round(parts[3] * 1000) / 1000 : 1,
            transition: cs.transitionProperty === "all" ? `${cs.transitionDuration}` : `${cs.transitionDuration} ${cs.transitionTimingFunction}`,
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
    const clickedWhileHovered = await read("clicked, still hovered");

    await page.mouse.move(900, 400); // pointer off the sidebar
    await page.waitForTimeout(350);
    const committed = await read("committed (pointer away)");

    await rows.first().hover();
    await page.waitForTimeout(350);
    const rehovered = await read("re-hovered");

    await page.mouse.move(900, 400);
    await page.waitForTimeout(350);
    const released = await read("released again");

    // An unselected control on the same ladder: the nav row above the list.
    const nav = page.locator('button:has-text("New Chat")').first();
    if (await nav.count()) {
        const navRest = await nav.evaluate(alphaOf);
        await nav.hover();
        await page.waitForTimeout(300);
        const navHover = await nav.evaluate(alphaOf);
        await page.mouse.move(900, 400);
        await page.waitForTimeout(300);
        const navBack = await nav.evaluate(alphaOf);
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
    const pct = (hex) => Number(((parseInt(hex.slice(7, 9), 16) / 255) * 100).toFixed(1));
    console.log("\ntokens:", tokens);
    const h = pct(tokens["--row-hover"]);
    const s = pct(tokens["--row-selected"]);
    const sh = pct(tokens["--row-selected-hover"]);
    console.log(`  hover ${h}%  selected ${s}%  selected+hover ${sh}%`);
    console.log(`  midpoint check: hover is ${h === s / 2 ? "exactly" : "NOT"} half of selected`);
    console.log(`  ordering check: rest(${rest}) < hover(${hovered}) < selected(${committed}) < selected+hover(${rehovered})`);
    console.log(`  reversibility:  selected+hover(${rehovered}) -> released(${released})`);
    await browser.close();
})();
