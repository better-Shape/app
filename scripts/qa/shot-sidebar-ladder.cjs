/**
 * Two frames of the sidebar, for looking at the ladder rather than reading it:
 * rest, and with an unselected control hovered, so the midpoint (4%) and the committed
 * fill (8%) are on screen at the same time and can be compared by eye.
 *
 * Run: PLAYWRIGHT_SANDBOX_LIBS=/tmp/sandboxlibs/lib node scripts/qa/shot-sidebar-ladder.cjs
 * Out: .dump/app/qa/motion/sidebar-ladder-{rest,hover}.png
 */
const { chromium } = require("playwright");
const { default: sparticuz } = require("@sparticuz/chromium");
const OUT = process.env.CAPTURE_OUT ?? ".dump/app/qa/motion";

(async () => {
    process.env.LD_LIBRARY_PATH = `/tmp/sandboxlibs/lib:${process.env.LD_LIBRARY_PATH ?? ""}`;
    const browser = await chromium.launch({
        executablePath: await sparticuz.executablePath(),
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 3 });
    await page.goto("http://127.0.0.1:48921/?seed=project", { waitUntil: "commit", timeout: 120_000 });
    await page.waitForLoadState("domcontentloaded", { timeout: 120_000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await page.addStyleTag({ content: "nextjs-portal{display:none !important}" });

    const side = page.locator("aside").first();
    const box = await side.boundingBox();
    const clip = { x: box.x, y: box.y, width: Math.min(box.width + 8, 280), height: Math.min(box.height, 420) };

    await page.mouse.move(900, 500);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/sidebar-ladder-rest.png`, clip });

    const nav = page.locator('button:has-text("New Chat")').first();
    await nav.hover();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/sidebar-ladder-hover.png`, clip });

    console.log(`wrote ${OUT}/sidebar-ladder-{rest,hover}.png  clip=${JSON.stringify(clip)}`);
    await browser.close();
})();
