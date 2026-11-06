import type { Page } from "@playwright/test";
import { test, expect, expectPreviewActive, gotoRoute, type SeedMode } from "./fixtures";
import { readFocusStop, type FocusStop } from "./helpers/focus-indicator";

/**
 * Every button that keyboard focus reaches must show that it has focus (WCAG 2.4.7). The walk
 * presses Tab through a window and reads the computed style of each focused `button` or
 * `[role="button"]`: an outline, or a ring drawn as a box shadow on the element or on its
 * `::before` layer, as the commit rows draw theirs.
 */

/** Tabs forward until focus comes back to the first stop, or `limit` presses. */
const walkFocus = async (page: Page, limit: number): Promise<FocusStop[]> => {
    const stops: FocusStop[] = [];
    const seen = new Set<string>();
    for (let press = 0; press < limit; press += 1) {
        await page.keyboard.press("Tab");
        const stop = await readFocusStop(page);
        if (!stop) continue;
        if (stops.length > 0 && stop.key === stops[0].key) break;
        if (stop.inEditor) {
            // An editor keeps Tab for indentation; Escape first hands the next Tab to focus.
            await page.keyboard.press("Escape");
        }
        if (seen.has(stop.key)) continue;
        seen.add(stop.key);
        stops.push(stop);
    }
    return stops;
};

const WINDOWS: ReadonlyArray<{ title: string; path: string; seed: SeedMode; ready: (page: Page) => Promise<void> }> = [
    {
        title: "welcome screen",
        path: "/",
        seed: "welcome",
        ready: (page) => expectPreviewActive(page, "welcome"),
    },
    {
        title: "workbench with a project open",
        path: "/",
        seed: "project",
        ready: async (page) => {
            await expectPreviewActive(page, "project");
            await expect(page.getByRole("tab", { name: "README.md" })).toBeVisible({ timeout: 30_000 });
        },
    },
    {
        title: "settings",
        path: "/settings",
        seed: "welcome",
        ready: (page) => expect(page.locator("#bettershape-settings")).toBeVisible(),
    },
    {
        title: "Git window",
        path: "/git",
        seed: "project",
        ready: async (page) => {
            await expectPreviewActive(page, "project");
            await expect(page.getByText("preview: seeded commit history").first()).toBeVisible({ timeout: 30_000 });
        },
    },
];

test.describe("keyboard focus visibility", () => {
    for (const surface of WINDOWS) {
        test.describe(surface.title, () => {
            test.use({ seedMode: surface.seed });

            test("every focused button shows a focus indicator", async ({ page }) => {
                await gotoRoute(page, surface.path);
                await surface.ready(page);
                const stops = await walkFocus(page, 160);
                const buttons = stops.filter((stop) => stop.isButton);
                expect(buttons.length, "the walk reached buttons").toBeGreaterThan(3);
                expect(buttons.filter((stop) => !stop.visible).map((stop) => stop.name)).toEqual([]);
            });
        });
    }
});
