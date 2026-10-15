import { test, expect, expectPreviewActive, gotoRoute } from "./fixtures";

/**
 * Welcome screen (seed: "welcome"). The four entry actions and the recent
 * project list are the first thing a human or agent sees; they must render
 * and respond without the Tauri backend.
 */
test.describe("welcome screen", () => {
    test.beforeEach(async ({ page }) => {
        await gotoRoute(page, "/");
        await expectPreviewActive(page, "welcome");
    });

    test("shows the four project entry actions", async ({ page, expectNoPageErrors }) => {
        // Scope to the welcome screen: the sidebar also has a
        // "Connect GitHub" button, so unscoped role queries are ambiguous.
        const panel = page.getByTestId("welcome-screen");
        await expect(panel.getByRole("button", { name: "Open project" })).toBeVisible();
        await expect(panel.getByRole("button", { name: "Clone repo" })).toBeVisible();
        await expect(panel.getByRole("button", { name: "Connect via SSH" })).toBeVisible();
        await expect(panel.getByRole("button", { name: "Connect GitHub" })).toBeVisible();
        expectNoPageErrors();
    });

    test("lists the seeded recent project", async ({ page }) => {
        await expect(page.getByText("Recent projects")).toBeVisible();
        // Seeded via localStorage in fixtures.ts (bettershape-demo).
        await expect(page.getByRole("button", { name: /bettershape-demo/ })).toBeVisible();
    });

    test("clone dialog opens and closes", async ({ page, expectNoPageErrors }) => {
        await page.getByTestId("welcome-screen").getByRole("button", { name: "Clone repo" }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        expectNoPageErrors();
    });
});
