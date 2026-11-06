import path from "node:path";
import { test, expect, expectPreviewActive, gotoRoute } from "./fixtures";

test.use({ seedMode: "project" });

const FONT_FILE = path.join(process.cwd(), "node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2");

/**
 * An uploaded terminal font is kept in IndexedDB, so it draws again after a reload instead of
 * falling back to `monospace` while the setting still names it.
 */
test("an uploaded terminal font is registered again after a reload", async ({ page, expectNoPageErrors }) => {
    await gotoRoute(page, "/settings");
    await expect(page.locator("#bettershape-settings")).toBeVisible({ timeout: 30_000 });
    await page.locator("#bettershape-settings nav").getByRole("button", { name: "Terminal" }).click();
    const fontSelect = page.locator("#settings-terminal").getByRole("button", { name: /^Font Family/ });
    await expect(fontSelect).toHaveAccessibleName("Font Family IBM Plex Mono");

    await page.locator('input[type="file"][aria-label="Upload custom font file"]').setInputFiles(FONT_FILE);
    await expect(fontSelect).toHaveAccessibleName("Font Family geist-latin-wght-normal");

    // The fonts are radio choices and none is checked; the upload is an action after them.
    await fontSelect.click();
    await expect(page.getByRole("menuitemradio", { checked: true })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Upload font..." })).toBeVisible();
    await page.keyboard.press("Escape");

    await gotoRoute(page, "/");
    await expectPreviewActive(page, "project");
    await page.evaluate(() =>
        window.dispatchEvent(new CustomEvent("bettershape-layout-toggle", { detail: { id: "terminal", value: true } })),
    );
    await expect(page.getByRole("tab", { name: /^PowerShell/ }).first()).toBeVisible({ timeout: 15_000 });
    await expect
        .poll(() =>
            page.evaluate(() =>
                [...document.fonts]
                    .filter((face) => face.family.replaceAll(/["']/g, "").startsWith("BetterShapeCustom-geist-latin-wght-normal-"))
                    .map((face) => face.status),
            ),
        )
        .toEqual(["loaded"]);
    expectNoPageErrors();
});
