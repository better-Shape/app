import AxeBuilder from "@axe-core/playwright";
import { test, expect, gotoRoute } from "./fixtures";

const sizes = [13, 16, 20];

for (const fontSize of sizes) {
    test(`session toolbar retains pointer targets at ${fontSize}px root text`, async ({ page }) => {
        await gotoRoute(page, "/");
        await page.evaluate((size) => {
            document.documentElement.style.fontSize = `${size}px`;
        }, fontSize);
        for (const name of ["Search", "Filter", "Sessions actions", "New chat"]) {
            const control = page.getByRole("button", { name, exact: true });
            await expect(control).toBeVisible();
            const box = await control.boundingBox();
            expect(box?.width, name).toBeGreaterThanOrEqual(24);
            expect(box?.height, name).toBeGreaterThanOrEqual(24);
        }
    });
}

test.describe("commit generation target", () => {
    test.use({ seedMode: "project" });
    for (const fontSize of sizes) {
        test(`retains its pointer target at ${fontSize}px root text`, async ({ page }) => {
            await gotoRoute(page, "/git");
            await page.evaluate((size) => {
                document.documentElement.style.fontSize = `${size}px`;
            }, fontSize);
            const control = page.getByRole("button", { name: "Generate commit message", exact: true });
            await expect(control).toBeVisible();
            const box = await control.boundingBox();
            expect(box?.width).toBeGreaterThanOrEqual(24);
            expect(box?.height).toBeGreaterThanOrEqual(24);
        });
    }
});

test.describe("all changes diff actions", () => {
    test.use({ seedMode: "project" });

    test("keep their pointer targets while they float over focusable diff text", async ({ page }) => {
        await gotoRoute(page, "/");
        await page.locator('button[aria-haspopup="menu"][aria-label="New tab"]').click();
        await page.getByRole("menuitem", { name: "All changes", exact: true }).click();
        const content = page.locator(".cm-content").first();
        await expect(content).toBeVisible({ timeout: 30_000 });
        await content.hover();

        const actions = page.locator("[data-diff-actions]").first();
        const controls = [
            actions.getByRole("button", { name: /^(Stage|Unstage)$/ }),
            actions.getByRole("button", { name: "Restore file" }),
        ];
        for (const control of controls) {
            await expect(control).toBeVisible();
            const box = await control.boundingBox();
            expect(box?.height).toBeGreaterThanOrEqual(24);
        }
        const axe = await new AxeBuilder({ page }).withRules(["target-size"]).analyze();
        expect(axe.violations).toEqual([]);
    });
});
