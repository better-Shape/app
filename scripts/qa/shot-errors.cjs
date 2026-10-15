const { chromium } = require("playwright");
const { default: sparticuz } = require("@sparticuz/chromium");
(async () => {
  process.env.LD_LIBRARY_PATH = `/tmp/sandboxlibs/lib:${process.env.LD_LIBRARY_PATH ?? ""}`;
  const browser = await chromium.launch({
    executablePath: await sparticuz.executablePath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 620 }, deviceScaleFactor: 2, colorScheme: "dark" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 120)));
  for (const [name, url] of [
    ["route", "http://127.0.0.1:48921/?crash=route"],
    ["global", "http://127.0.0.1:48921/?seed=project&crash=global"],
  ]) {
    await page.goto(url, { waitUntil: "commit", timeout: 120_000 });
    await page.waitForLoadState("domcontentloaded", { timeout: 120_000 }).catch(() => {});
    await page.waitForTimeout(2000);
    // Next.js' dev error overlay is not part of the product: it sits on top of the very
    // screen we want to look at, so hide the portal and re-shoot the honest render.
    await page.addStyleTag({ content: "nextjs-portal{display:none !important}" });
    await page.waitForTimeout(600);
    const text = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 220);
    const out = `/home/user/app/.dump/app/qa/motion/crash-${name}.png`;
    await page.screenshot({ path: out });
    console.log(`\n[${name}] ${url}`);
    console.log("  visible:", text);
    console.log("  shot:", out);
  }
  console.log("\npageerrors:", errors.slice(0, 4));
  await browser.close();
})().catch((error) => {
    process.stderr.write(String(error?.stack ?? error) + "\n");
    process.exit(1);
});
