import AxeBuilder from "@axe-core/playwright";
import { test, expect, expectPreviewActive, gotoRoute } from "./fixtures";

test.use({ seedMode: "project" });

/**
 * Keyboard focus in the workbench: where focus lands after a workbench or terminal tab closes,
 * and the focus ring of a read-only editor surface, which draws no caret of its own.
 */
test.describe("workbench keyboard focus", () => {
    test.beforeEach(async ({ page }) => {
        await gotoRoute(page, "/");
        await expectPreviewActive(page, "project");
        await expect(page.getByRole("tab", { name: "README.md" })).toBeVisible({ timeout: 30_000 });
    });

    test("Delete moves focus to the next tab, or the previous one after the last", async ({ page }) => {
        await page.getByRole("tab", { name: "Files" }).focus();
        await page.keyboard.press("Delete");
        await expect(page.getByRole("tab", { name: "Files" })).toHaveCount(0);
        await expect(page.getByRole("tab", { name: "README.md", exact: true })).toBeFocused();

        await page.keyboard.press("Delete");
        await expect(page.getByRole("tab", { name: "README.md" })).toHaveCount(0);
        await expect(page.getByRole("tab", { name: "Graph", exact: true })).toBeFocused();
    });

    test("terminal tabs sit in a tablist, nest no control, and hand focus on when Delete closes one", async ({
        page,
    }) => {
        await page.evaluate(() =>
            window.dispatchEvent(
                new CustomEvent("bettershape-layout-toggle", { detail: { id: "terminal", value: true } }),
            ),
        );
        const strip = page.getByRole("tablist").filter({ has: page.getByRole("tab", { name: /^PowerShell/ }) });
        await expect(strip.getByRole("tab")).toHaveCount(1, { timeout: 15_000 });
        await page.getByRole("button", { name: "New Terminal" }).click();
        await expect(strip.getByRole("tab")).toHaveCount(2);

        const axe = await new AxeBuilder({ page })
            .include(".workbench-tab-bar, [role='tablist']")
            .withRules(["aria-required-parent", "nested-interactive", "button-name", "target-size"])
            .analyze();
        expect(axe.violations).toEqual([]);

        await strip.getByRole("tab", { name: /^PowerShell 1/ }).focus();
        await page.keyboard.press("Delete");
        await expect(strip.getByRole("tab")).toHaveCount(1);
        await expect(strip.getByRole("tab", { name: /^PowerShell 2/ })).toBeFocused();
    });

    test("closing the open tab opens the tab focus moves to", async ({ page }) => {
        // The strip reads Graph, Files, README.md. Closing Graph, the first, hands focus to Files,
        // which must open too, not README.md at the end.
        const graph = page.getByRole("tab", { name: "Graph", exact: true });
        await graph.click();
        await expect(graph).toHaveAttribute("aria-selected", "true");
        await page.keyboard.press("Delete");
        const files = page.getByRole("tab", { name: "Files", exact: true });
        await expect(files).toBeFocused();
        await expect(files).toHaveAttribute("aria-selected", "true");
        // The strip is one Tab stop, the open tab.
        await expect(page.getByRole("tablist", { name: "Workspace" }).getByRole("tab")).toHaveCount(2);
        await expect(files).toHaveAttribute("tabindex", "0");
        await expect(page.getByRole("tab", { name: "README.md", exact: true })).toHaveAttribute("tabindex", "-1");
    });

    test("closing the open terminal from its strip keeps focus on the strip", async ({ page }) => {
        await page.evaluate(() =>
            window.dispatchEvent(
                new CustomEvent("bettershape-layout-toggle", { detail: { id: "terminal", value: true } }),
            ),
        );
        const strip = page.getByRole("tablist").filter({ has: page.getByRole("tab", { name: /^PowerShell/ }) });
        await expect(strip.getByRole("tab")).toHaveCount(1, { timeout: 15_000 });
        await page.getByRole("button", { name: "New Terminal" }).click();
        const second = strip.getByRole("tab", { name: /^PowerShell 2/ });
        await expect(second).toHaveAttribute("aria-selected", "true");

        await second.focus();
        await page.keyboard.press("Delete");
        const first = strip.getByRole("tab", { name: /^PowerShell 1/ });
        await expect(first).toHaveAttribute("aria-selected", "true");
        await expect(first).toBeFocused();
        // Activating a terminal focuses it, but not when its strip closed the tab before it.
        await page.waitForTimeout(300);
        await expect(first).toBeFocused();
    });

    test("a read-only diff shows a focus ring while its text has keyboard focus", async ({ page }) => {
        await page.evaluate(() =>
            window.dispatchEvent(
                new CustomEvent("bettershape-open-file-diff", {
                    detail: { id: "diff-readme", path: "README.md", status: "M", staged: false, repo: "/preview/bettershape-demo" },
                }),
            ),
        );
        const content = page.locator('.cm-content[aria-label="README.md diff"]');
        await expect(content).toBeVisible();
        const editor = page.locator(".cm-editor").filter({ has: content });
        await expect(editor).toHaveCSS("outline-style", "none");

        await page.keyboard.press("Shift");
        await content.focus();
        await expect(editor).toHaveCSS("outline-style", "solid");
        await expect(editor).toHaveCSS("outline-width", "2px");
        await expect(editor).toHaveCSS("outline-color", "rgb(158, 176, 255)");
    });
});
