import { test, expect, expectPreviewActive, gotoRoute } from "./fixtures";

/**
 * Settings window route (/settings). Runs in the same mocked-browser
 * harness as the main window, no Tauri multi-window needed.
 */
test.describe("settings", () => {
    test.beforeEach(async ({ page }) => {
        await gotoRoute(page, "/settings");
        await expectPreviewActive(page, "welcome");
        await expect(page.locator("#bettershape-settings")).toBeVisible();
    });

    test("renders the settings navigation", async ({ page, expectNoPageErrors }) => {
        await expect(page.getByText("Providers", { exact: true }).first()).toBeVisible();
        await expect(page.getByText("Models", { exact: true }).first()).toBeVisible();
        await expect(page.getByText("Editor", { exact: true }).first()).toBeVisible();
        expectNoPageErrors();
    });

    test("switching sections changes the visible panel", async ({ page, expectNoPageErrors }) => {
        // The Editor nav group header is an inert div; the actual navigation
        // control is the leaf <button> named "Editor" inside the settings
        // nav. Clicking the group header leaves the default Providers panel
        // in place, so assert Editor-only panel state: the editor section
        // mounts and the panel shows switch controls (a no-op click fails).
        const editorButton = page
            .locator("#bettershape-settings nav")
            .getByRole("button", { name: "Editor" });
        await editorButton.click();
        await expect(page.locator("#settings-editor-font")).toBeVisible();
        await expect(page.getByRole("switch").first()).toBeVisible();
        expectNoPageErrors();
    });

    test("a switch control toggles", async ({ page, expectNoPageErrors }) => {
        await page
            .locator("#bettershape-settings nav")
            .getByRole("button", { name: "Editor" })
            .click();
        await expect(page.locator("#settings-editor-font")).toBeVisible();
        const firstSwitch = page.getByRole("switch").first();
        await expect(firstSwitch).toBeVisible();
        const before = await firstSwitch.getAttribute("aria-checked");
        await firstSwitch.click();
        await expect(firstSwitch).toHaveAttribute("aria-checked", before === "true" ? "false" : "true");
        expectNoPageErrors();
    });
});
