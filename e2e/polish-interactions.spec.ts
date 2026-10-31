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
                .withRules(["button-name", "label", "aria-toggle-field-name"])
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
            const commitMenu = page.locator("[data-radix-popper-content-wrapper] [role='menu']");
            const appMenuItem = commitMenu.getByRole("menuitem", { name: /App\.tsx/ });
            await expect(appMenuItem).toBeVisible();
            await expect
                .poll(() =>
                    commitMenu.evaluate((menu) => {
                        const active = document.activeElement;
                        return menu === active || menu.contains(active);
                    }),
                )
                .toBe(true);
            for (let step = 0; step < 8; step += 1) {
                const highlighted = await appMenuItem.getAttribute("data-highlighted");
                if (highlighted !== null) break;
                await page.keyboard.press("ArrowDown");
                await page.evaluate(
                    () =>
                        new Promise<null>((resolve) => {
                            requestAnimationFrame(() => setTimeout(() => resolve(null), 0));
                        }),
                );
            }
            await expect(appMenuItem).toHaveAttribute("data-highlighted", "");
            await page.keyboard.press("Enter");

            const discardBtn = page.locator("button.t-hold").first();
            await expect(discardBtn).toBeVisible();
            await expect(discardBtn).toHaveAttribute("data-state", "idle");

            // Assistive or quick activation arms the HoldButton rather than immediately discarding work.
            await discardBtn.evaluate((button: HTMLButtonElement) => button.click());
            await expect(discardBtn).toHaveAttribute("data-state", "armed");

            // Escape disarms back to idle without invoking gitDiscard.
            await discardBtn.focus();
            await page.keyboard.press("Escape");
            await expect(discardBtn).toHaveAttribute("data-state", "idle");
            await expect(discardBtn).not.toHaveAttribute("aria-busy", "true");

            // Pressing inside enters holding, and dragging outside aborts without CDP timer races.
            const dragStates = await discardBtn.evaluate(async (button: HTMLButtonElement) => {
                const flushCommit = () =>
                    new Promise<void>((resolve) => {
                        requestAnimationFrame(() => setTimeout(resolve, 0));
                    });
                const waitForState = async (expected: string) => {
                    if (button.getAttribute("data-state") === expected) return;
                    await new Promise<void>((resolve) => setTimeout(resolve, 0));
                    for (let frame = 0; frame < 6; frame += 1) {
                        if (button.getAttribute("data-state") === expected) return;
                        await flushCommit();
                    }
                };
                const rect = button.getBoundingClientRect();
                const insideX = rect.left + rect.width / 2;
                const insideY = rect.top + rect.height / 2;
                const outsideX = rect.left - 48;
                const emitPointer = (target: EventTarget, type: string, clientX: number) =>
                    target.dispatchEvent(
                        new PointerEvent(type, {
                            bubbles: true,
                            button: 0,
                            pointerId: 41,
                            width: 4,
                            height: 4,
                            clientX,
                            clientY: insideY,
                        }),
                    );
                emitPointer(button, "pointerdown", insideX);
                await waitForState("holding");
                const afterDown = button.getAttribute("data-state");
                emitPointer(document.body, "pointermove", outsideX);
                await waitForState("idle");
                const afterLeave = button.getAttribute("data-state");
                emitPointer(document.body, "pointerup", outsideX);
                await flushCommit();
                const preview = (
                    window as unknown as {
                        __BETTERSHAPE_PREVIEW__?: { invokes: Array<{ cmd: string }> };
                    }
                ).__BETTERSHAPE_PREVIEW__;
                const discardInvoked =
                    preview?.invokes.some((entry) => entry.cmd === "git_discard_changes") ?? false;
                return {
                    afterDown,
                    afterLeave,
                    afterUp: button.getAttribute("data-state"),
                    ariaBusy: button.getAttribute("aria-busy"),
                    discardInvoked,
                };
            });
            expect(dragStates).toEqual({
                afterDown: "holding",
                afterLeave: "idle",
                afterUp: "idle",
                ariaBusy: null,
                discardInvoked: false,
            });

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
