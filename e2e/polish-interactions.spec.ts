import AxeBuilder from "@axe-core/playwright";
import { test, expect, expectPreviewActive, gotoRoute } from "./fixtures";

test.describe("micro-interactions, accessible settings switches, and workspace empty states", () => {
    test("welcome screen tiles step +1 surface on hover and overflow projects expand via Collapse", async ({
        page,
        expectNoPageErrors,
        expectNoConsoleErrors,
    }) => {
        await page.addInitScript(() => {
            const entries = Array.from({ length: 7 }, (_, index) => ({
                path: `/preview/repo-${index + 1}`,
                lastOpenedAt: Date.now() - index * 60_000,
            }));
            window.localStorage.setItem("bettershape:repo-history", JSON.stringify(entries));
        });

        await gotoRoute(page, "/");
        await expectPreviewActive(page, "welcome");

        const panel = page.getByTestId("welcome-screen");
        const openBtn = panel.getByRole("button", { name: "Open project" });
        await openBtn.hover();
        const hoveredBg = await openBtn.evaluate((el) => getComputedStyle(el).backgroundColor);
        // Must remain a dark surface step (#2a2a2d -> rgb(42, 42, 45)), never a light-fill inversion.
        expect(hoveredBg).not.toBe("rgb(244, 244, 245)");

        const viewAll = panel.getByRole("button", { name: "View all (7)" });
        await expect(viewAll).toHaveAttribute("aria-expanded", "false");
        await viewAll.click();
        await expect(panel.getByRole("button", { name: "Show less" })).toHaveAttribute(
            "aria-expanded",
            "true",
        );
        await expect(panel.getByRole("button", { name: /repo-7/ })).toBeVisible();

        expectNoPageErrors();
        expectNoConsoleErrors();
    });

    test("every switch across settings sections exposes a programmatic accessible name", async ({
        page,
        expectNoPageErrors,
        expectNoConsoleErrors,
    }) => {
        await gotoRoute(page, "/settings");
        await expectPreviewActive(page, "welcome");

        for (const navLabel of ["Providers", "Models", "Editor", "Git", "Terminal"]) {
            const navButton = page.locator("nav button", { hasText: navLabel }).first();
            await expect(navButton).toBeVisible();
            await navButton.click();
            if (navLabel === "Models") {
                await expect(
                    page.getByRole("button", { name: /^Auto-run mode\s+\S+/ }),
                ).toBeVisible();
            }
            if (navLabel === "Editor") {
                await expect(
                    page.getByRole("button", { name: /^Exclude\s+\S+/ }),
                ).toBeVisible();
            }
            const axe = await new AxeBuilder({ page })
                .withRules(["button-name", "label"])
                .analyze();
            expect(axe.violations, `a11y label violations on ${navLabel}`).toEqual([]);
        }

        expectNoPageErrors();
        expectNoConsoleErrors();
    });

    test.describe("seeded project workspace polish", () => {
        test.use({ seedMode: "project" });

        test("diff Discard uses HoldButton two-step guard and empty workspace panels offer recovery actions", async ({
            page,
            expectNoPageErrors,
            expectNoConsoleErrors,
        }) => {
            await gotoRoute(page, "/");
            await expectPreviewActive(page, "project");
            await expect(page.locator("#bettershape-workbench")).toBeVisible();

            // Open Commit menu and navigate via keyboard ArrowDown + Enter to open SingleFileDiffEditor.
            await page.getByRole("button", { name: /^Commit\b/ }).click();
            const appMenuItem = page
                .locator("[data-radix-popper-content-wrapper]")
                .getByRole("menuitem", { name: /App\.tsx/ });
            await expect(appMenuItem).toBeVisible();
            for (let step = 0; step < 6; step += 1) {
                const highlighted = await appMenuItem.getAttribute("data-highlighted");
                if (highlighted !== null) break;
                await page.keyboard.press("ArrowDown");
            }
            await expect(appMenuItem).toHaveAttribute("data-highlighted", "");
            await page.keyboard.press("Enter");

            const discardBtn = page.locator("button.t-hold").first();
            await expect(discardBtn).toBeVisible();
            await expect(discardBtn).toHaveAttribute("data-state", "idle");

            // A quick click arms the HoldButton rather than immediately discarding work.
            await discardBtn.click();
            await expect(discardBtn).toHaveAttribute("data-state", "armed");

            // Escape disarms back to idle without invoking gitDiscard.
            await discardBtn.press("Escape");
            await expect(discardBtn).toHaveAttribute("data-state", "idle");

            // Pressing and dragging the pointer outside bounds aborts the hold immediately.
            const box = await discardBtn.boundingBox();
            expect(box).not.toBeNull();
            if (box) {
                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                await page.mouse.down();
                await expect(discardBtn).toHaveAttribute("data-state", "holding");
                await page.mouse.move(box.x - 48, box.y + box.height / 2);
                await expect(discardBtn).toHaveAttribute("data-state", "idle");
                await page.mouse.up();
                await expect(discardBtn).toHaveAttribute("data-state", "idle");
            }

            // Switch to Search workspace tab and verify empty-state recovery action.
            await page.evaluate(() => {
                window.dispatchEvent(
                    new CustomEvent("bettershape-set-active-tab", { detail: "search" }),
                );
            });
            const focusSearchBtn = page.getByRole("button", { name: "Focus search" });
            await expect(focusSearchBtn).toBeVisible();
            await focusSearchBtn.click();
            await expect(page.getByRole("searchbox", { name: "Search in files" })).toBeFocused();

            expectNoPageErrors();
            expectNoConsoleErrors();
        });
    });
});
