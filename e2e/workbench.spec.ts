import { test, expect, expectPreviewActive, gotoRoute } from "./fixtures";

test.use({ seedMode: "project" });

/**
 * Workbench with the seeded project open (seed: "project", a fake repo at
 * /preview/bettershape-demo with README.md open, a file tree, one chat).
 * This is the main human-agentic development surface, so it gets the
 * deepest browser coverage.
 */
test.describe("workbench (seeded project)", () => {
    test.beforeEach(async ({ page }) => {
        await gotoRoute(page, "/");
        await expectPreviewActive(page, "project");
        await expect(page.locator("#bettershape-workbench")).toBeVisible();
    });

    test("welcome screen is replaced by the workspace", async ({ page, expectNoPageErrors }) => {
        await expect(page.getByRole("button", { name: "Open project" })).toBeHidden();
        // The seeded open file appears as an editor tab / in the explorer.
        await expect(page.getByText("README.md").first()).toBeVisible();
        expectNoPageErrors();
    });

    test("seeded files are visible and openable", async ({ page, expectNoPageErrors }) => {
        // File tree: expand the seeded src/ folder, then open App.tsx.
        const explorer = page.getByRole("region", { name: "File explorer" });
        await explorer.getByText("src", { exact: true }).click();
        await expect(explorer.getByText("App.tsx", { exact: true })).toBeVisible();
        await explorer.getByText("App.tsx", { exact: true }).click();
        // Opening a file creates a workspace tab and the editor reads the
        // file through the IPC bridge (read_file for src/App.tsx).
        await expect
            .poll(() =>
                page.evaluate(() => {
                    const preview = (window as unknown as {
                        __BETTERSHAPE_PREVIEW__?: {
                            invokes: Array<{ cmd: string; args?: { path?: unknown } }>;
                        };
                    }).__BETTERSHAPE_PREVIEW__;
                    return (
                        preview?.invokes.some(
                            (i) => i.cmd === "read_file" && String(i.args?.path ?? "").endsWith("App.tsx"),
                        ) ?? false
                    );
                }),
            )
            .toBe(true);
        // ...and the returned content is actually rendered, not swallowed.
        await expect(page.getByText("Hello from the preview fixture").first()).toBeVisible();
        expectNoPageErrors();
    });

    test("keeps the file editor usable when the workspace narrows", async ({ page, expectNoPageErrors, expectNoConsoleErrors }) => {
        const explorer = page.getByRole("region", { name: "File explorer" });
        await expect(explorer).toBeVisible();

        await page.setViewportSize({ width: 1000, height: 500 });
        await expect(explorer).toBeHidden();
        const editorText = page.getByText("bettershape-demo (preview fixture)", { exact: true });
        await expect(editorText).toBeVisible();
        const editorBounds = await editorText.boundingBox();
        expect(editorBounds?.width ?? 0).toBeGreaterThan(200);

        const filesTab = page.getByRole("button", { name: "Files", exact: true, pressed: false });
        await filesTab.focus();
        await page.keyboard.press("Enter");
        const selectedFilesTab = page.getByRole("button", { name: "Files", exact: true, pressed: true });
        await expect(selectedFilesTab).toBeVisible();
        await expect(page.getByRole("textbox", { name: "Filter files" })).toBeVisible();
        await expect
            .poll(() =>
                selectedFilesTab.evaluate((element) => {
                    const style = getComputedStyle(element);
                    return {
                        focused: document.activeElement === element,
                        boxShadow: style.boxShadow,
                    };
                }),
            )
            .toMatchObject({
                focused: true,
            });
        await expect
            .poll(() => selectedFilesTab.evaluate((element) => getComputedStyle(element).boxShadow))
            .not.toBe("none");

        const workspaceTabOrder = () =>
            page.locator("#bettershape-workbench [aria-roledescription='sortable'][aria-label]").evaluateAll((elements) =>
                elements
                    .map((element) => element.getAttribute("aria-label"))
                    .filter((label) => label === "Graph" || label === "Files"),
            );
        const originalTabOrder = await workspaceTabOrder();
        expect(originalTabOrder).toEqual(["Graph", "Files"]);
        const graphTab = page.locator("#bettershape-workbench [aria-roledescription='sortable'][aria-label='Graph']");
        await graphTab.focus();
        await page.keyboard.press("Space");
        await expect.poll(() => graphTab.evaluate((element) => (element as HTMLElement).style.zIndex)).toBe("20");
        await page.keyboard.press("ArrowRight");
        await expect
            .poll(() =>
                graphTab.evaluate((element) => {
                    const offset = /translate3d\((-?[\d.]+)px/.exec((element as HTMLElement).style.transform)?.[1];
                    return Number(offset ?? 0);
                }),
            )
            .toBeGreaterThan(0);
        await page.keyboard.press("Enter");
        await expect.poll(workspaceTabOrder).toEqual(["Files", "Graph"]);

        await page.getByText("README.md", { exact: true }).first().click();
        await page.setViewportSize({ width: 1440, height: 900 });
        await expect(explorer).toBeVisible();
        expectNoPageErrors();
        expectNoConsoleErrors();
    });

    test("copy action includes rendered OpenUI text instead of its source", async ({ page }) => {
        await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
        await expect(page.locator("[data-openui-block]")).toBeVisible();

        await page.getByRole("button", { name: "Copy message" }).last().click();
        const copied = await page.evaluate(() => navigator.clipboard.readText());

        expect(copied).toContain("The project tree and conversation use local fixture data.");
        expect(copied).toContain("Root files");
        expect(copied).not.toContain("root = Surface");
    });

    test("seeded conversation renders a visual answer", async ({ page, expectNoPageErrors, expectNoConsoleErrors }) => {
        await expect(page.getByText("Preview fixture chat").first()).toBeVisible();
        await expect(page.locator("[data-openui-block]")).toBeVisible();
        await expect(page.getByText("The project tree and conversation use local fixture data.")).toBeVisible();
        await expect(page.getByText("Root files", { exact: true })).toBeVisible();
        await expect(page.locator("figure figcaption")).toContainText("Files by folder");
        await expect(page.locator("[data-openui-block] table.sr-only tbody tr")).toHaveCount(2);
        await expect(page.getByRole("note")).toContainText("Local fixture");
        expectNoPageErrors();
        expectNoConsoleErrors();
    });
});
