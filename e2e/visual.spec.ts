import { test, expect, expectPreviewActive, gotoRoute } from "./fixtures";

/**
 * @visual, pixel baselines for the most stable surfaces. Time is frozen
 * (Playwright clock) and animations disabled so seeded relative dates and
 * transitions cannot flake the comparison. Update baselines deliberately:
 *
 *   npm run test:e2e:update-snapshots
 *
 * and review the diff like a code change. Baselines are generated on Linux
 * (CI); on other OSes expect font-rendering diffs on first run.
 */
const FIXED_NOW = new Date("2026-01-15T12:00:00Z");

test.describe("@visual baselines", () => {
    test.beforeEach(async ({ page }) => {
        // Baselines are generated on Linux; other OSes rasterise fonts
        // differently and would fail despite a correct UI.
        test.skip(process.platform !== "linux", "Visual baselines are Linux-generated");
        await page.clock.setFixedTime(FIXED_NOW);
    });

    test("welcome screen", async ({ page }) => {
        await gotoRoute(page, "/");
        await expectPreviewActive(page, "welcome");
        await expect(page.getByRole("button", { name: "Open project" })).toBeVisible();
        await expect(page).toHaveScreenshot("welcome.png", {
            fullPage: true,
            animations: "disabled",
            maxDiffPixelRatio: 0.02,
        });
    });

    test("settings window", async ({ page }) => {
        await gotoRoute(page, "/settings");
        await expectPreviewActive(page, "welcome");
        await expect(page.locator("#bettershape-settings")).toBeVisible();
        await expect(page).toHaveScreenshot("settings.png", {
            fullPage: true,
            animations: "disabled",
            maxDiffPixelRatio: 0.02,
        });
    });
});

test.describe("@visual baselines (project seed)", () => {
    test.use({ seedMode: "project" });

    test.beforeEach(async ({ page }) => {
        // Same Linux-only baseline guard as the describe above.
        test.skip(process.platform !== "linux", "Visual baselines are Linux-generated");
        await page.clock.setFixedTime(FIXED_NOW);
    });

    test("workbench with seeded project", async ({ page }) => {
        await gotoRoute(page, "/");
        await expectPreviewActive(page, "project");
        await expect(page.locator("#bettershape-workbench")).toBeVisible();
        await expect(page.getByText("README.md").first()).toBeVisible();
        await expect(page).toHaveScreenshot("workbench.png", {
            fullPage: true,
            animations: "disabled",
            maxDiffPixelRatio: 0.02,
        });
    });
});
