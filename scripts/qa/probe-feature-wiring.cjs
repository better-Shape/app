/**
 * Proves the settings that were wired this round do something visible.
 *
 * Source tests can show a switch renders and a flag is read; they cannot show
 * the switch reaches the panel, the disabled state of a dependent row, or the
 * home screen it gates. This probe drives the real settings page, flips the
 * switches, and writes a screenshot per claim.
 *
 * Run: PLAYWRIGHT_SANDBOX_LIBS=/tmp/chrome-deps node scripts/qa/probe-feature-wiring.cjs
 * Requires a dev server at PROBE_URL (default http://127.0.0.1:48921).
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { default: sparticuz } = require("@sparticuz/chromium");
const { applySandboxLibs } = require("./sandbox-libs.cjs");

const BASE_URL = (process.env.PROBE_URL || "http://127.0.0.1:48921").replace(/\/$/, "");
const SHOTS = path.join(__dirname, "..", "..", ".qa-artifacts", "feature-wiring");

/** The switch inside the settings row whose title is `title`. */
function rowSwitch(page, title) {
  return page.locator("div").filter({ hasText: new RegExp(`^${title}`) }).locator('[role="switch"]').first();
}

async function isSwitchOn(locator) {
  return (await locator.getAttribute("data-state")) === "checked";
}

(async () => {
  applySandboxLibs();
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({
    executablePath: await sparticuz.executablePath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(String(error)));

  // 1. The Editor page carries the formatter and linter switches.
  await page.goto(`${BASE_URL}/settings?category=editor`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(2500);
  const body = await page.textContent("body");
  for (const label of ["Format with Prettier", "ESLint", "Fix ESLint issues on save"]) {
    assert.ok(body.includes(label), `Settings is missing "${label}"`);
  }
  await page.screenshot({ path: path.join(SHOTS, "settings-editor-linting.png"), fullPage: false });

  // 2. Turning ESLint off disables the fix-on-save row instead of lying about it.
  const eslintSwitch = rowSwitch(page, "ESLint");
  const fixSwitch = rowSwitch(page, "Fix ESLint issues on save");
  assert.equal(await isSwitchOn(eslintSwitch), true, "ESLint starts on");
  await eslintSwitch.click();
  await page.waitForTimeout(500);
  assert.equal(await isSwitchOn(eslintSwitch), false, "ESLint did not switch off");
  assert.equal(await fixSwitch.isDisabled(), true, "Fix on save is not disabled while ESLint is off");
  await page.screenshot({ path: path.join(SHOTS, "settings-eslint-off-disables-fix.png"), fullPage: false });
  await eslintSwitch.click();
  await page.waitForTimeout(400);

  // 3. Prettier off is reflected by the same page and can be turned back on.
  const prettierSwitch = rowSwitch(page, "Format with Prettier");
  assert.equal(await isSwitchOn(prettierSwitch), true, "Prettier starts on");
  await prettierSwitch.click();
  await page.waitForTimeout(400);
  assert.equal(await isSwitchOn(prettierSwitch), false, "Prettier did not switch off");
  await prettierSwitch.click();
  await page.waitForTimeout(400);

  // 4. Show welcome page on startup really changes the empty home.
  await page.goto(`${BASE_URL}/settings?category=privacy`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(2000);
  const welcomeSwitch = rowSwitch(page, "Show welcome page on startup");
  assert.equal(await isSwitchOn(welcomeSwitch), true, "welcome page starts on");
  await welcomeSwitch.click();
  await page.waitForTimeout(600);

  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(3000);
  const home = await page.textContent("body");
  assert.ok(home.includes("No project open"), "home did not switch to the quiet state");
  assert.equal(await page.getByRole("button", { name: "Open folder" }).count(), 1, "quiet home has no way in");
  await page.screenshot({ path: path.join(SHOTS, "home-without-welcome.png"), fullPage: false });

  // Leave the setting as it was found.
  await page.goto(`${BASE_URL}/settings?category=privacy`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(1500);
  await rowSwitch(page, "Show welcome page on startup").click();
  await page.waitForTimeout(400);

  const ignored = errors.filter((text) => /favicon|Download the React DevTools/i.test(text));
  assert.deepEqual(ignored, [], `console errors: ${ignored.join(" | ")}`);

  await browser.close();
  console.log(`probe passed: linting switches, dependent disable state and welcome gating (${SHOTS})`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
