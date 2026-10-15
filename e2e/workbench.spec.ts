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
        await page.getByText("src", { exact: true }).first().click();
        await expect(page.getByText("App.tsx").first()).toBeVisible();
        await page.getByText("App.tsx").first().click();
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

    test("seeded conversation is listed", async ({ page, expectNoPageErrors }) => {
        await expect(page.getByText("Preview fixture chat").first()).toBeVisible();
        expectNoPageErrors();
    });
});
