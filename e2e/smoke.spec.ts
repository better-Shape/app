import { test, expect, expectPreviewActive, gotoRoute, ROUTES, type RouteName } from "./fixtures";

/**
 * Route-specific shells from app/client-layout.tsx. An any-of selector would pass if the wrong
 * surface rendered, so each route must show its own shell. Keyed by route name, so a route added
 * to ROUTES without a shell fails typecheck instead of asserting on an undefined selector.
 * client-layout: /git and /branch are secondary windows and render the settings shell, not the
 * workbench shell.
 */
const SHELL_BY_ROUTE: Record<RouteName, string> = {
    welcome: "#bettershape-workbench",
    workbench: "#bettershape-workbench",
    git: "#bettershape-settings",
    branch: "#bettershape-settings",
    settings: "#bettershape-settings",
    popout: "#bettershape-popout",
};

/** `workbench` is the `/` route with the seeded project open; every other route boots on the welcome seed. */
const PROJECT_SEEDED: ReadonlySet<RouteName> = new Set(["workbench"]);

/**
 * @smoke, every app route must boot in a plain browser with the mocked
 * Tauri bridge: no uncaught errors, the route shell renders, and the
 * preview seed is the one the fixture asked for. This is the fastest
 * signal that a change broke app startup.
 */
test.describe("@smoke routes boot", () => {
    const bootTest = (route: (typeof ROUTES)[number]) =>
        test(`${route.name} (${route.path}) loads without page errors`, async ({
            page,
            seedMode,
            expectNoPageErrors,
        }) => {
            await gotoRoute(page, route.path);
            await expectPreviewActive(page, seedMode);
            await expect(page.locator(SHELL_BY_ROUTE[route.name])).toBeVisible();

            expectNoPageErrors();
        });

    for (const route of ROUTES.filter((r) => !PROJECT_SEEDED.has(r.name))) bootTest(route);

    test.describe("seeded project", () => {
        test.use({ seedMode: "project" });
        for (const route of ROUTES.filter((r) => PROJECT_SEEDED.has(r.name))) bootTest(route);
    });

    test("document title names the product", async ({ page }) => {
        await gotoRoute(page, "/");
        await expect(page).toHaveTitle(/BetterShape/);
    });
});
