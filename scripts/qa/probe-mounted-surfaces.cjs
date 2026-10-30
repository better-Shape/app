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

// PROBE_URL is what lets this run against a preview build on another port; a
// hard-coded host would silently test whatever happens to answer on 48921.
const BASE_URL = (process.env.PROBE_URL || "http://127.0.0.1:48921").replace(/\/$/, "");

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
  await page.goto(`${BASE_URL}/settings?category=voice`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(2500);
  const voiceNav = page.getByRole("button", { name: "Voice" });
  const voiceCount = await voiceNav.count();
  assert.equal(voiceCount, 1, "Settings has no Voice nav leaf");
  await voiceNav.first().click();
  await page.waitForTimeout(800);
  const micHeading = await page.getByText("Microphone", { exact: true }).count();
  await page.screenshot({ path: ".qa-artifacts/voice-settings.png", fullPage: false });
  console.log(JSON.stringify({ voiceNav: voiceCount, microphoneHeading: micHeading }));
  assert.equal(micHeading, 1, "The Voice page does not render the Microphone section");

  // 2. Workspace tabs: design + all changes
  await page.goto(`${BASE_URL}/?seed=project`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(3000);
  const newTab = page.getByRole("button", { name: "New tab" });
  const newTabCount = await newTab.count();
  // Every step is an assertion: skipping the block when the control is missing
  // is exactly the case where Design and All changes are unreachable.
  assert.equal(newTabCount, 1, "The workbench has no New tab control");
  await newTab.first().click();
  await page.waitForTimeout(400);
  const design = page.getByRole("menuitem", { name: "Design" });
  const allChanges = page.getByRole("menuitem", { name: "All changes" });
  assert.equal(await design.count(), 1, "The new-tab menu has no Design entry");
  assert.equal(await allChanges.count(), 1, "The new-tab menu has no All changes entry");
  await design.first().click();
  await page.waitForTimeout(2500);
  assert.equal(
    await page.getByRole("tab", { name: "Design", selected: true }).count(),
    1,
    "Clicking Design did not activate the Design tab",
  );
  await page.screenshot({ path: ".qa-artifacts/design-tab.png" });
  await newTab.first().click();
  await page.waitForTimeout(400);
  await allChanges.first().click();
  await page.waitForTimeout(2500);
  assert.equal(
    await page.getByRole("tab", { name: "All changes", selected: true }).count(),
    1,
    "Clicking All changes did not activate the All changes tab",
  );
  await page.screenshot({ path: ".qa-artifacts/all-changes-tab.png" });
  // 3. Status bar notifications menu (mounted next to the editor status items)
  const notifications = page.getByRole("button", { name: /^Notifications/ });
  const notificationCount = await notifications.count();
  console.log("notifications buttons", notificationCount);
  assert.equal(notificationCount, 1, "The status bar has no Notifications control");
  await notifications.first().click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: ".qa-artifacts/notifications-menu.png" });
  await page.keyboard.press("Escape");

  assert.deepEqual(errors, [], `Console errors: ${JSON.stringify(errors.slice(0, 5))}`);
  console.log("probe passed: voice, design, all-changes and notifications surfaces render with no console errors");
  await browser.close();
})().catch((e) => { console.error("FAILED", e.message); process.exit(1); });
