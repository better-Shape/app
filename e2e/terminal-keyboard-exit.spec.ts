import { test, expect, expectPreviewActive, gotoRoute } from "./fixtures";
import type { Page } from "@playwright/test";

test.use({ seedMode: "project" });

const inTerminal = (page: Page) =>
    page.evaluate(() => Boolean(document.activeElement?.closest(".xterm")));

/**
 * The terminal sends Tab to the shell, so WCAG 2.1.2 needs another way out that the user is told
 * about: Ctrl+M makes Tab move focus, as in VS Code, and Ctrl+J hides the dock from inside it.
 */
test.describe("leaving the terminal from the keyboard", () => {
    test.beforeEach(async ({ page }) => {
        await gotoRoute(page, "/");
        await expectPreviewActive(page, "project");
        await expect(page.getByRole("tab", { name: "README.md" })).toBeVisible({ timeout: 30_000 });
        await page.getByRole("tab", { name: "README.md", exact: true }).focus();
        await page.evaluate(() =>
            window.dispatchEvent(new CustomEvent("bettershape-layout-toggle", { detail: { id: "terminal", value: true } })),
        );
        await expect(page.locator("[data-terminal-dock] .xterm").first()).toBeVisible({ timeout: 15_000 });
        await page.locator("[data-terminal-dock] .xterm").first().click();
        await expect.poll(() => inTerminal(page)).toBe(true);
    });

    test("Ctrl+M makes Tab move focus, and says so", async ({ page, expectNoPageErrors }) => {
        const description = await page.evaluate(() => {
            const id = document.activeElement?.getAttribute("aria-describedby");
            return id ? document.getElementById(id)?.textContent : null;
        });
        expect(description).toBe("Tab goes to the shell. Press Ctrl+M so Tab moves focus, or Ctrl+J to hide the terminal.");

        await page.keyboard.press("Tab");
        expect(await inTerminal(page)).toBe(true);

        await page.keyboard.press("Control+m");
        const dock = page.locator("[data-terminal-dock]");
        const badge = dock.locator("span").filter({ hasText: /^Tab moves focus$/ });
        await expect(badge).toBeVisible();
        await expect(dock.getByRole("status")).toHaveText("Tab moves focus");

        await page.keyboard.press("Tab");
        await expect.poll(() => inTerminal(page)).toBe(false);

        await page.locator("[data-terminal-dock] .xterm").first().click();
        await page.keyboard.press("Control+m");
        await expect(badge).toHaveCount(0);
        await expect(dock.getByRole("status")).toHaveText("Tab goes to the terminal");
        await page.keyboard.press("Tab");
        expect(await inTerminal(page)).toBe(true);
        expectNoPageErrors();
    });

    test("Ctrl+J hides the terminal and gives focus back", async ({ page, expectNoPageErrors }) => {
        await page.keyboard.press("Control+j");
        await expect(page.locator("[data-terminal-dock]")).toHaveAttribute("data-terminal-open", "false");
        await expect(page.getByRole("tab", { name: "README.md", exact: true })).toBeFocused();
        expectNoPageErrors();
    });
});
