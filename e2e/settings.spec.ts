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

    test("the About panel reads the version and checks only when asked", async ({ page, expectNoPageErrors }) => {
        await page
            .locator("#bettershape-settings nav")
            .getByRole("button", { name: "About" })
            .click();
        const panel = page.locator("#settings-updates");
        await expect(panel).toBeVisible();
        await expect(panel).toContainText("Current version is v");
        // Opening the panel is not a check: the preview mock records no
        // `check_app_update` call until the button is pressed.
        const calls = async () =>
            page.evaluate(
                () =>
                    (window as unknown as { __BETTERSHAPE_PREVIEW__?: { invokes: { cmd: string }[] } })
                        .__BETTERSHAPE_PREVIEW__?.invokes.filter((entry) => entry.cmd === "check_app_update")
                        .length ?? 0,
            );
        await expect.poll(calls).toBe(0);

        await panel.getByRole("button", { name: "Check for updates" }).click();
        await expect.poll(calls).toBe(1);
        await expect(panel).toContainText("You're on the latest version.");
        // Nothing to download, so the panel never offers an install.
        await expect(panel.getByRole("button", { name: /^Get / })).toHaveCount(0);
        expectNoPageErrors();
    });

    test("a select closes once an option is picked", async ({ page, expectNoPageErrors }) => {
        await page.locator("#bettershape-settings nav").getByRole("button", { name: "Terminal" }).click();
        const shell = page.locator("#settings-terminal").getByRole("button", { name: /^Default Shell/ });
        await shell.click();
        await page.getByRole("menuitemradio", { name: "Command Prompt" }).click();
        await expect(page.getByRole("menu")).toHaveCount(0);
        await expect(shell).toHaveAccessibleName("Default Shell Command Prompt");
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
