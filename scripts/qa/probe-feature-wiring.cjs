/**
 * Proves the settings that were wired this round do something visible.
 *
 * Source tests can show a switch renders and a flag is read; they cannot show
 * the switch reaches the panel, the disabled state of a dependent row, or the
 * home screen it gates. This probe drives the real settings page, flips the
 * switches, and writes a screenshot per claim.
 *
 * Run: PLAYWRIGHT_SANDBOX_LIBS=/tmp/chrome-deps/lib node scripts/qa/probe-feature-wiring.cjs
 * Needs the Browser Preview build (`npm run build:preview && npm run preview:browser`),
 * because the mocked IPC bridge only exists there. PROBE_URL defaults to
 * http://127.0.0.1:48921.
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

  // 5. A folder added to the workspace appears in the explorer, and can be
  //    removed from there. The backend half (IPC path grants) already worked;
  //    without a row the action looked inert.
  await page.evaluate(() => {
    window.localStorage.setItem(
      "bettershape-workspace-folders",
      JSON.stringify(["/preview/shared-lib"]),
    );
  });
  await page.goto(`${BASE_URL}/?seed=project`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "New tab" }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole("menuitem", { name: "Files" }).first().click();
  await page.waitForTimeout(2000);
  const explorer = page.locator('[data-explorer-root="true"]');
  assert.equal(await explorer.count(), 1, "the Files tab has no explorer");
  assert.ok((await explorer.textContent()).includes("shared-lib"), "extra root is not listed");
  assert.ok((await explorer.textContent()).includes("notes.md"), "extra root files are not listed");
  await page.screenshot({ path: path.join(SHOTS, "explorer-extra-root.png"), fullPage: false });

  const remove = page.getByRole("button", { name: "Remove shared-lib from the workspace" });
  assert.equal(await remove.count(), 1, "extra root has no remove control");
  await explorer.getByText("shared-lib", { exact: true }).hover();
  await remove.click();
  await page.waitForTimeout(800);
  assert.ok(
    !(await explorer.textContent()).includes("shared-lib"),
    "removing the folder left the row on screen",
  );
  assert.equal(
    await page.evaluate(() => window.localStorage.getItem("bettershape-workspace-folders")),
    "[]",
    "removing the folder did not persist",
  );

  // 6. Settings -> Git -> Inline Git Blame reaches the editor: the annotation
  //    is drawn from `git_blame_file`, is not part of the document text, and
  //    disappears when the switch goes back off.
  await page.goto(`${BASE_URL}/settings?category=git`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(2000);
  const blameSwitch = rowSwitch(page, "Inline Git Blame");
  assert.equal(await isSwitchOn(blameSwitch), false, "inline blame starts off");
  await blameSwitch.click();
  await page.waitForTimeout(500);
  await page.goto(`${BASE_URL}/?seed=project`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "New tab" }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole("menuitem", { name: "Files" }).first().click();
  await page.waitForTimeout(1500);
  // Open a file first: the Files surface starts on the explorer.
  await page.locator('[data-explorer-root="true"]').getByText("README.md", { exact: true }).first().click();
  await page.waitForTimeout(2000);
  // It opens in rendered mode; blame belongs to the source view.
  const viewSource = page.getByRole("button", { name: /view source/i }).first();
  assert.equal(await viewSource.count(), 1, "no way to reach the file source");
  await viewSource.click();
  await page.waitForTimeout(2500);
  const blame = page.locator(".cm-inline-blame");
  assert.equal(await blame.count(), 1, "the caret line has no blame annotation");
  const blameText = (await blame.first().textContent()) ?? "";
  assert.ok(blameText.includes("Preview Fixture"), `blame is not attributed: ${blameText}`);
  // Drawn is not the same as readable: the dock is narrower than the fixture
  // line, so the in-document annotation can sit past the right edge. The status
  // bar carries the copy that is always on screen, so that is what is asserted.
  const blameStatus = page.getByText(/Preview Fixture · /).last();
  assert.equal(await blameStatus.count(), 1, "the status bar has no blame segment");
  const statusText = (await blameStatus.textContent()) ?? "";
  assert.ok(statusText.includes("d ago"), `status blame has no age: ${statusText}`);
  const onScreen = await blameStatus.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && box.right <= window.innerWidth + 1;
  });
  assert.equal(onScreen, true, "the status blame segment is off screen");
  await page.screenshot({ path: path.join(SHOTS, "inline-blame.png"), fullPage: false });

  await page.goto(`${BASE_URL}/settings?category=git`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(1500);
  await rowSwitch(page, "Inline Git Blame").click();
  await page.waitForTimeout(400);

  // 7. Two editor settings that used to render a control and change nothing:
  //    the caret glyph is asserted from the live editor's computed style, not
  //    from the settings object.
  await page.goto(`${BASE_URL}/settings?category=editor`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: "Cursor style" }).click();
  await page.waitForTimeout(300);
  await page.locator("[role=menu]").getByText("Block", { exact: true }).first().click();
  await page.waitForTimeout(400);

  await page.goto(`${BASE_URL}/?seed=project`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "New tab" }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole("menuitem", { name: "Files" }).first().click();
  await page.waitForTimeout(1200);
  await page.locator('[data-explorer-root="true"]').getByText("README.md", { exact: true }).first().click();
  await page.waitForTimeout(1500);
  const sourceToggle = page.getByRole("button", { name: /view source/i }).first();
  if (await sourceToggle.count()) await sourceToggle.click();
  await page.waitForTimeout(2000);

  // Draw the caret: CodeMirror only paints its custom cursor while focused.
  await page.locator(".cm-line").first().click({ position: { x: 4, y: 8 } });
  // The caret blinks; shoot while it is painted, then assert the computed style.
  await page.waitForTimeout(60);
  await page.screenshot({ path: path.join(SHOTS, "editor-block-cursor.png"), fullPage: false });
  await page.waitForTimeout(400);
  const caret = await page.evaluate(() => {
    const node = document.querySelector(".cm-cursor");
    if (!node) return null;
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, width: style.width, borderLeft: style.borderLeftWidth };
  });
  assert.ok(caret, "the editor has no caret element");
  assert.notEqual(caret.background, "rgba(0, 0, 0, 0)", `cursor is still a thin line: ${JSON.stringify(caret)}`);

  // Leave these as they were found too.
  await page.goto(`${BASE_URL}/settings?category=editor`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Cursor style" }).click();
  await page.locator("[role=menu]").getByText("Line", { exact: true }).first().click();
  await page.waitForTimeout(300);

  // 8. Render whitespace: the row must reach the live editor's decorations,
  //    not only the settings object. `highlightWhitespace` marks every space
  //    and tab with `cm-highlightSpace`, so the count is the proof.
  await page.goto(`${BASE_URL}/settings?category=editor`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /^Render whitespace/ }).click();
  await page.waitForTimeout(300);
  await page.locator("[role=menu]").getByText("All", { exact: true }).first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, "settings-render-whitespace.png"), fullPage: false });

  await page.goto(`${BASE_URL}/?seed=project`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "New tab" }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole("menuitem", { name: "Files" }).first().click();
  await page.waitForTimeout(1200);
  await page.locator('[data-explorer-root="true"]').getByText("README.md", { exact: true }).first().click();
  await page.waitForTimeout(1500);
  const whitespace = await page.locator(".cm-highlightSpace").count();
  assert.ok(whitespace > 0, `Render whitespace left the editor unchanged (${whitespace} markers)`);
  await page.screenshot({ path: path.join(SHOTS, "editor-render-whitespace.png"), fullPage: false });

  // 9. Bracket colors: typing nested brackets must produce a second colour
  //    step on the inner pair. The edit is undone before the probe moves on.
  await page.locator(".cm-line").last().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" nested(call(inner(value))) ");
  await page.waitForTimeout(600);
  const bracketColors = await page.locator('[class*="cm-bracket-depth-"]').count();
  assert.ok(bracketColors >= 2, `Bracket colors drew ${bracketColors} marks for nested brackets`);
  await page.screenshot({ path: path.join(SHOTS, "editor-bracket-colors.png"), fullPage: false });
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(400);

  // Leave Render whitespace as it was found.
  await page.goto(`${BASE_URL}/settings?category=editor`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /^Render whitespace/ }).click();
  await page.waitForTimeout(300);
  await page.locator("[role=menu]").getByText("Selection", { exact: true }).first().click();
  await page.waitForTimeout(300);

  // Leave the setting as it was found.
  await page.goto(`${BASE_URL}/settings?category=privacy`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(1500);
  await rowSwitch(page, "Show welcome page on startup").click();
  await page.waitForTimeout(400);

  const unexpected = errors.filter((text) => !/favicon|Download the React DevTools/i.test(text));
  assert.deepEqual(unexpected, [], `console errors: ${unexpected.join(" | ")}`);

  await browser.close();
  console.log(
    `probe passed: linting switches, dependent disable state, welcome gating, extra workspace roots, inline blame, render whitespace and bracket colors (${SHOTS})`,
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
