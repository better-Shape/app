import { test, expect, expectPreviewActive, gotoRoute } from "./fixtures";

test.use({ seedMode: "project" });

/**
 * Brand marks, plugin logos and site icons draw from the bundle. They used to load from
 * cdn.simpleicons.org, thesvg.org and Google's and DuckDuckGo's favicon services on render, which
 * told those hosts what the user had open. AGENTS.md rules out remote fetches on a load path.
 */
test("drawing the palette's framework marks, the chat and the plugin catalog asks no other host", async ({
    page,
    expectNoPageErrors,
}) => {
    const hosts = new Set<string>();
    page.on("request", (request) => {
        const url = new URL(request.url());
        if (url.protocol.startsWith("http") && !["127.0.0.1", "localhost"].includes(url.hostname)) hosts.add(url.hostname);
    });

    await gotoRoute(page, "/");
    await expectPreviewActive(page, "project");
    await expect(page.locator("[data-openui-block]").first()).toBeVisible({ timeout: 30_000 });

    // The palette's framework rows draw Vite's mark, from a data: URL.
    await expect
        .poll(
            async () => {
                await page.keyboard.press("Control+Shift+P");
                return page.getByRole("dialog").count();
            },
            { timeout: 15_000 },
        )
        .toBeGreaterThan(0);
    await page.keyboard.type("vite");
    const marks = page.getByRole("dialog").locator('img[src^="data:image/svg+xml,"]');
    await expect(marks.first()).toBeVisible();
    await page.keyboard.press("Escape");

    await gotoRoute(page, "/settings?category=plugins");
    await expect(page.locator("#bettershape-settings")).toBeVisible({ timeout: 30_000 });

    expect([...hosts]).toEqual([]);
    expectNoPageErrors();
});
