import AxeBuilder from "@axe-core/playwright";
import { test, expect, expectPreviewActive, gotoRoute } from "./fixtures";

/**
 * Accessibility of states the route crawl in audit.spec.ts never opens: a settings section other
 * than the first, the command palette, and the diff a Git change row opens. Each test scans the
 * state it reaches with the axe rules its controls once failed.
 */
test.describe("panel state accessibility", () => {
    test.use({ seedMode: "project" });

    test("the Legal links in Data Control settings keep their pointer targets", async ({ page }) => {
        await gotoRoute(page, "/settings");
        await page.getByRole("button", { name: "Data Control", exact: true }).click();
        for (const name of ["Terms of Service", "Privacy Policy"]) {
            const link = page.getByRole("button", { name, exact: true });
            await expect(link).toBeVisible();
            const box = await link.boundingBox();
            expect(box?.height, name).toBeGreaterThanOrEqual(24);
        }
        const axe = await new AxeBuilder({ page }).withRules(["target-size"]).analyze();
        expect(axe.violations).toEqual([]);
    });

    test("command palette rows nest no control and run on Enter", async ({ page }) => {
        await gotoRoute(page, "/");
        await expectPreviewActive(page, "project");
        const deletable = page.locator("[data-palette-index]").filter({ has: page.locator("[data-palette-delete]") });
        // The palette mounts after first paint, so the chord is retried until it answers.
        await expect(async () => {
            await page.keyboard.press("Control+Shift+P");
            await expect(deletable.first()).toBeVisible({ timeout: 2_000 });
        }).toPass({ timeout: 20_000 });
        await expect(deletable.first().locator("button, [tabindex]")).toHaveCount(0);

        const axe = await new AxeBuilder({ page }).withRules(["nested-interactive", "button-name"]).analyze();
        expect(axe.violations).toEqual([]);

        // Focus moves the selection highlight, so the highlight and the focus ring mark the same row.
        const rows = page.locator("[data-palette-index]");
        await rows.nth(1).focus();
        await expect(rows.nth(1)).toHaveClass(/--row-selected\)/);
        await expect(rows.nth(0)).not.toHaveClass(/--row-selected\)/);

        // A focused row is a button: Enter runs it, which closes the palette and deletes nothing.
        const row = deletable.first();
        await row.focus();
        await page.keyboard.press("Enter");
        await expect(row).toBeHidden();
        await expect(page.getByRole("button", { name: "Preview fixture chat" }).first()).toBeVisible();
    });

    test("the diff a Git change row opens names its icon buttons", async ({ page }) => {
        await gotoRoute(page, "/git");
        await expectPreviewActive(page, "project");
        await page.getByRole("button", { name: /App\.tsx/ }).first().click();
        await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 30_000 });
        await expect(page.getByRole("button", { name: "Close diff" })).toBeVisible();
        await expect(page.getByRole("button", { name: /^(Inline diff|Side by side)$/ })).toBeVisible();

        const axe = await new AxeBuilder({ page }).withRules(["button-name"]).analyze();
        expect(axe.violations).toEqual([]);
    });
});
