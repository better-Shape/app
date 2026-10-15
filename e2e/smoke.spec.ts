import { test, expect, expectPreviewActive, gotoRoute, ROUTES } from "./fixtures";

/**
 * @smoke, every app route must boot in a plain browser with the mocked
 * Tauri bridge: no uncaught errors, the route shell renders, and the
 * preview seed is the one the fixture asked for. This is the fastest
 * signal that a change broke app startup.
 */
test.describe("@smoke routes boot", () => {
    for (const route of ROUTES) {
        test(`${route.name} (${route.path}) loads without page errors`, async ({
            page,
            seedMode,
            expectNoPageErrors,
        }) => {
            await gotoRoute(page, route.path);
            await expectPreviewActive(page, seedMode);

            // Route-specific shells from app/client-layout.tsx. An
            // any-of selector would pass if the wrong surface rendered,
            // so each route must show its own shell.
            // client-layout: /git and /branch are secondary windows and
            // render the settings shell, not the workbench shell.
            const shellByName: Record<string, string> = {
                welcome: "#bettershape-workbench",
                git: "#bettershape-settings",
                branch: "#bettershape-settings",
                settings: "#bettershape-settings",
                popout: "#bettershape-popout",
            };
            await expect(page.locator(shellByName[route.name])).toBeVisible();

            expectNoPageErrors();
        });
    }

    test("document title names the product", async ({ page }) => {
        await gotoRoute(page, "/");
        await expect(page).toHaveTitle(/BetterShape/);
    });
});
