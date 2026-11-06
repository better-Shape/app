import type { Locator, Page } from "@playwright/test";
import { test, expect, expectPreviewActive, gotoRoute } from "./fixtures";
import { readFocusStop } from "./helpers/focus-indicator";

/**
 * Closing a pop-up that opened without a trigger button, from a shortcut, a menu item or a
 * palette command, puts keyboard focus back where it was, with its ring showing (WCAG 2.4.3,
 * 2.4.7). Before, focus fell to the page and the next Tab started from the end of the window.
 */

/** Presses Tab until `target` has focus, so it holds keyboard focus. */
const tabTo = async (page: Page, target: Locator) => {
    for (let press = 0; press < 60; press += 1) {
        await page.keyboard.press("Tab");
        if (await target.evaluate((element) => element === document.activeElement)) return;
    }
    throw new Error("Tab never reached the control");
};

/** Opens the command palette; it mounts after first paint, so the chord is retried until it answers. */
const openPalette = async (page: Page) => {
    const palette = page.getByRole("dialog", { name: "Command Palette" });
    await expect(async () => {
        await page.keyboard.press("Control+Shift+P");
        await expect(palette).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    return palette;
};

/** Runs a palette command from its focused row, as a keyboard user does. */
const runPaletteCommand = async (page: Page, label: string) => {
    await openPalette(page);
    await page.keyboard.type(label);
    const row = page.locator("[data-palette-index]").filter({ hasText: label }).first();
    await row.focus();
    await page.keyboard.press("Enter");
};

/** Escape closes `dialog`, and `opener` has focus again with its ring showing. */
const expectEscapeReturnsFocus = async (page: Page, dialog: Locator, opener: Locator) => {
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    expect((await readFocusStop(page))?.visible, "the returned focus shows its ring").toBe(true);
};

test.describe("dialog focus return", () => {
    test.use({ seedMode: "project" });

    test.beforeEach(async ({ page }) => {
        await gotoRoute(page, "/");
        await expectPreviewActive(page, "project");
        await expect(page.getByRole("tab", { name: "README.md" })).toBeVisible({ timeout: 30_000 });
    });

    test("the command palette, opened by its shortcut", async ({ page }) => {
        const opener = page.getByRole("button", { name: "Hide sidebar" });
        await tabTo(page, opener);
        const palette = await openPalette(page);
        await expectEscapeReturnsFocus(page, palette, opener);
    });

    test("the keyboard shortcuts sheet, opened from a palette command", async ({ page }) => {
        const opener = page.getByRole("button", { name: "Sessions actions" });
        await tabTo(page, opener);
        await runPaletteCommand(page, "Preferences: Keyboard Shortcuts");
        await expectEscapeReturnsFocus(page, page.getByRole("dialog", { name: "Keyboard Shortcuts" }), opener);
    });

    test("the new file prompt, opened from a palette command", async ({ page }) => {
        const opener = page.getByRole("button", { name: "Filter", exact: true });
        await tabTo(page, opener);
        await runPaletteCommand(page, "File: New Text File");
        await expectEscapeReturnsFocus(page, page.getByRole("dialog", { name: "New file" }), opener);
    });

    test("the project picker, opened from a menu item, returns focus to the menu button", async ({ page }) => {
        const opener = page.getByRole("button", { name: "Account" });
        await tabTo(page, opener);
        await page.keyboard.press("Enter");
        const item = page.getByRole("menuitem", { name: "Open folder" });
        await item.focus();
        await page.keyboard.press("Enter");
        await expectEscapeReturnsFocus(page, page.getByRole("dialog", { name: /^Open folder or create a project/ }), opener);
    });

    test("the attachment preview, opened from its attachment", async ({ page }) => {
        await page.locator("#chat-media-upload").setInputFiles({
            name: "notes.txt",
            mimeType: "text/plain",
            buffer: Buffer.from("first line\nsecond line\n"),
        });
        const opener = page.getByRole("button", { name: "Preview notes.txt" });
        await tabTo(page, opener);
        await page.keyboard.press("Enter");
        await expectEscapeReturnsFocus(page, page.getByRole("dialog", { name: "notes.txt" }), opener);
    });
});
