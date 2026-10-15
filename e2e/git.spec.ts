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
});
