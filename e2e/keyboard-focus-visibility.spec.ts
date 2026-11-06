import type { Page } from "@playwright/test";
import { test, expect, expectPreviewActive, gotoRoute, type SeedMode } from "./fixtures";
import { readSettledFocusStop, type FocusStop } from "./helpers/focus-indicator";

/**
 * Every button that keyboard focus reaches must show that it has focus (WCAG 2.4.7). The walk
 * presses Tab through a window and reads the computed style of each focused `button` or
 * `[role="button"]`: an outline, or a ring drawn as a box shadow on the element or on its
 * `::before` layer, as the commit rows draw theirs, and not hidden by a transparent ancestor.
 */

/** Records `stop` unless the walk has seen it; true when focus has come back to the first stop. */
const recordStop = (stops: FocusStop[], stop: FocusStop): boolean => {
    if (stops.length > 0 && stop.key === stops[0].key) return true;
    if (!stops.some((seen) => seen.key === stop.key)) stops.push(stop);
    return false;
};

/** Tabs forward until focus comes back to the first stop, or `limit` presses. */
const walkFocus = async (page: Page, limit: number): Promise<FocusStop[]> => {
    const stops: FocusStop[] = [];
    for (let press = 0; press < limit; press += 1) {
        await page.keyboard.press("Tab");
        const stop = await readSettledFocusStop(page);
        if (!stop) continue;
        if (recordStop(stops, stop)) break;
        // An editor keeps Tab for indentation; Escape first hands the next Tab to focus.
        if (stop.inEditor) await page.keyboard.press("Escape");
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

/** The focused element's label colour and focus ring, as computed. */
const readRing = (page: Page) =>
    page.evaluate(() => {
        const element = document.activeElement;
        if (!(element instanceof HTMLElement)) return null;
        const style = getComputedStyle(element);
        return {
            color: style.color,
            outlineColor: style.outlineColor,
            outlineStyle: style.outlineStyle,
            outlineWidth: style.outlineWidth,
            outlineOffset: style.outlineOffset,
        };
    });

/** `--accent-text`, the shared ring. */
const ACCENT_TEXT = "rgb(158, 176, 255)";

/**
 * A filled button draws its ring in its label colour: the shared `--accent-text` ring measures
 * 2.9:1 on `--accent` and 1.9:1 on `--danger`, below the 3:1 a ring at a control's edge needs.
 * The unit test `tests/ui/filled-control-focus-ring.test.tsx` checks the ratios; this checks the
 * cascade in a real build, where the base-layer ring and the button's utility meet.
 */
test.describe("filled button focus ring", () => {
    test.use({ seedMode: "project" });

    test.beforeEach(async ({ page }) => {
        await gotoRoute(page, "/");
        await expectPreviewActive(page, "project");
        await expect(page.locator("[data-openui-block]").first()).toBeVisible({ timeout: 30_000 });
    });

    test.afterEach(({ expectNoPageErrors }) => {
        expectNoPageErrors();
    });

    test("a filled dialog button rings in its label colour, and the plain one beside it keeps the accent ring", async ({ page }) => {
        await page.getByRole("button", { name: "Restore to this checkpoint" }).first().click();
        const dialog = page.getByRole("alertdialog", { name: "Discard all changes up to this checkpoint?" });
        await expect(dialog).toBeVisible();
        const cancel = dialog.getByRole("button", { name: /^Cancel/ });
        const proceed = dialog.getByRole("button", { name: /^Continue/ });

        await cancel.focus();
        await page.keyboard.press("Tab");
        await expect(proceed).toBeFocused();
        const ring = await readRing(page);
        expect(ring).toMatchObject({ outlineStyle: "solid", outlineWidth: "2px", outlineOffset: "-2px" });
        expect(ring?.outlineColor, "the ring takes the label colour").toBe(ring?.color);
        expect(ring?.outlineColor).not.toBe(ACCENT_TEXT);

        await page.keyboard.press("Shift+Tab");
        await expect(cancel).toBeFocused();
        expect((await readRing(page))?.outlineColor).toBe(ACCENT_TEXT);

        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
    });
});
