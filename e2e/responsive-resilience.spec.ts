import { test, expect, expectPreviewActive, gotoRoute } from "./fixtures";

test.describe("responsive workbench, popout, git, and settings resilience", () => {
    test.use({ seedMode: "project" });

    test("popout editor route mounts code and markdown files without missing-provider errors", async ({
        page,
    }) => {
        const runtimeErrors: string[] = [];
        page.on("pageerror", (err) => runtimeErrors.push(err.message));

        await gotoRoute(page, "/popout?file=/preview/bettershape-demo/src/App.tsx");
        await expect(page.locator("[data-popout-title='App.tsx']")).toBeVisible();
        await expect(page.locator(".cm-editor").first()).toBeVisible();

        await gotoRoute(page, "/popout?file=/preview/bettershape-demo/README.md");
        await expect(page.locator("[data-popout-title='README.md']")).toBeVisible();
        await expect(page.getByText("bettershape-demo", { exact: false }).first()).toBeVisible();

        expect(runtimeErrors).toEqual([]);
    });

    test("narrow workbench folds sidebar cleanly and keeps chrome and status bar unclipped", async ({
        page,
    }) => {
        await page.setViewportSize({ width: 520, height: 540 });
        await gotoRoute(page, "/");
        await expectPreviewActive(page, "project");
        await expect(page.locator("#bettershape-workbench")).toBeVisible();

        const peekToggle = page.locator("[data-sidebar-peek-toggle]");
        await expect(peekToggle).toBeVisible();

        const workspaceToggle = page.locator("button[data-panel-toggle='workspace']");
        await expect(workspaceToggle).toBeVisible();
        const toggleBox = await workspaceToggle.boundingBox();
        expect(toggleBox).not.toBeNull();
        expect((toggleBox?.x ?? 0) + (toggleBox?.width ?? 0)).toBeLessThanOrEqual(520 - 130);
    });

    test("narrow settings providers section wraps header summary cleanly without stacking status labels", async ({
        page,
    }) => {
        await page.setViewportSize({ width: 480, height: 640 });
        await gotoRoute(page, "/settings");
        await expect(page.locator("#bettershape-settings")).toBeVisible();

        const heading = page.getByRole("heading", { name: "Model providers", exact: true });
        const summary = page.getByText("No usable providers available", { exact: true });
        await expect(heading).toBeVisible();
        await expect(summary).toBeVisible();

        const headingBox = await heading.boundingBox();
        const summaryBox = await summary.boundingBox();
        expect(headingBox).not.toBeNull();
        expect(summaryBox).not.toBeNull();
        const overlapsHorizontally =
            Math.min(
                (headingBox?.x ?? 0) + (headingBox?.width ?? 0),
                (summaryBox?.x ?? 0) + (summaryBox?.width ?? 0),
            ) -
                Math.max(headingBox?.x ?? 0, summaryBox?.x ?? 0) >
            2;
        const overlapsVertically =
            Math.min(
                (headingBox?.y ?? 0) + (headingBox?.height ?? 0),
                (summaryBox?.y ?? 0) + (summaryBox?.height ?? 0),
            ) -
                Math.max(headingBox?.y ?? 0, summaryBox?.y ?? 0) >
            2;
        expect(overlapsHorizontally && overlapsVertically).toBe(false);
    });

    test("git source control pluralizes single-file headers and bounds tall commit descriptions", async ({
        page,
    }) => {
        await page.setViewportSize({ width: 960, height: 560 });
        await gotoRoute(page, "/git");
        await expect(page.getByText("1 file", { exact: true }).first()).toBeVisible();
        await expect(page.getByText("1 files", { exact: true })).toHaveCount(0);

        const desc = page.getByPlaceholder("Add description...");
        await expect(desc).toBeVisible();
        const manyLines = Array.from({ length: 30 }, (_, idx) => `Line ${idx + 1}`).join("\n");
        await desc.fill(manyLines);
        const box = await desc.boundingBox();
        expect(box).not.toBeNull();
        expect(box?.height ?? 999).toBeLessThanOrEqual(180);
    });
});
