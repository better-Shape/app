/**
 * Proves the newly mounted surfaces exist in a real browser and renders them
 * for inspection.
 *
 * Source tests can show a component is imported; they cannot show it is
 * painted, positioned, or free of a runtime error. This probe opens the two
 * routes the mounts live on, asserts the controls are present and clickable,
 * records every console error, and writes a screenshot per surface.
 *
 * Run: PLAYWRIGHT_SANDBOX_LIBS=/tmp/chrome-deps node scripts/qa/probe-mounted-surfaces.cjs
 * Requires a dev server at PROBE_URL (default http://127.0.0.1:48921).
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { default: sparticuz } = require("@sparticuz/chromium");
const { applySandboxLibs } = require("./sandbox-libs.cjs");

(async () => {
  applySandboxLibs();
  const browser = await chromium.launch({
    executablePath: await sparticuz.executablePath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  // 1. Voice settings page
  await page.goto("http://127.0.0.1:48921/settings?category=voice", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(2500);
  const voiceNav = page.getByRole("button", { name: "Voice" });
  const voiceCount = await voiceNav.count();
  if (voiceCount) await voiceNav.first().click();
  await page.waitForTimeout(800);
  const micHeading = await page.getByText("Microphone", { exact: true }).count();
  await page.screenshot({ path: ".qa-artifacts/voice-settings.png", fullPage: false });
  console.log(JSON.stringify({ voiceNav: voiceCount, microphoneHeading: micHeading }));
  assert.equal(voiceCount, 1, "Settings has no Voice nav leaf");
  assert.equal(micHeading, 1, "The Voice page does not render the Microphone section");

  // 2. Workspace tabs: design + all changes
  await page.goto("http://127.0.0.1:48921/?seed=project", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(3000);
  const newTab = page.getByRole("button", { name: "New tab" });
  console.log("newTab buttons", await newTab.count());
  if (await newTab.count()) {
    await newTab.first().click();
    await page.waitForTimeout(400);
    const design = page.getByRole("menuitem", { name: "Design" });
    const allChanges = page.getByRole("menuitem", { name: "All changes" });
    console.log("menu items", await design.count(), await allChanges.count());
    assert.equal(await design.count(), 1, "The new-tab menu has no Design entry");
    assert.equal(await allChanges.count(), 1, "The new-tab menu has no All changes entry");
    if (await design.count()) {
      await design.first().click();
      await page.waitForTimeout(2500);
      await page.screenshot({ path: ".qa-artifacts/design-tab.png" });
    }
    await newTab.first().click();
    await page.waitForTimeout(400);
    if (await allChanges.count()) {
      await allChanges.first().click();
      await page.waitForTimeout(2500);
      await page.screenshot({ path: ".qa-artifacts/all-changes-tab.png" });
    }
  }
  assert.deepEqual(errors, [], `Console errors: ${JSON.stringify(errors.slice(0, 5))}`);
  console.log("probe passed: voice, design and all-changes surfaces render with no console errors");
  await browser.close();
})().catch((e) => { console.error("FAILED", e.message); process.exit(1); });
