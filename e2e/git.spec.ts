import { test, expect, expectPreviewActive, gotoRoute } from "./fixtures";

test.use({ seedMode: "project" });

/**
 * Git window route (/git, /branch) against the seeded fake repository:
 * two branches, a dirty working tree, and three commits (see
 * lib/preview/tauri-mock.ts).
 */
test.describe("git manager", () => {
    for (const path of ["/git", "/branch"]) {
        test(`${path} finishes loading with the seeded repo`, async ({ page, expectNoPageErrors }) => {
            await gotoRoute(page, path);
            await expectPreviewActive(page, "project");

            // The loading skeleton carries this aria-label; it must resolve.
            await expect(page.getByLabel("Loading Git Manager")).toBeHidden({ timeout: 30_000 });

            // Not the "Project is empty" dead end, the seeded repo resolves.
            await expect(page.getByText("Project is empty")).toBeHidden();

            // Positive proof the seeded repo rendered (blank content would
            // pass the hidden-checks above): /branch lists the fixture
            // branch; /git shows the seeded commit history.
            const seeded = path === "/branch" ? "preview/browser-qa" : "preview: seeded commit history";
            await expect(page.getByText(seeded).first()).toBeVisible({ timeout: 30_000 });
            expectNoPageErrors();
        });
    }

    test("virtualized graph exposes full positions and keeps ref filters tabbable", async ({ page, expectNoPageErrors }) => {
        await gotoRoute(page, "/git?section=graph");
        await expectPreviewActive(page, "project");
        await expect(page.getByLabel("Loading Git Manager")).toBeHidden({ timeout: 30_000 });

        const graph = page.getByRole("list", { name: "Commit graph" });
        await expect(graph).toBeVisible({ timeout: 30_000 });
        const firstCommit = graph.getByRole("listitem").first();
        await expect(firstCommit).toHaveAttribute("aria-posinset", /^[1-9]\d*$/);
        await expect(firstCommit).toHaveAttribute("aria-setsize", /^[1-9]\d*$/);

        const refFilter = page.getByRole("button", { name: /Filter graph to/ }).first();
        await expect(refFilter).toBeVisible({ timeout: 30_000 });
        await refFilter.focus();
        await expect(refFilter).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(refFilter).not.toBeFocused();
        expectNoPageErrors();
    });
});
