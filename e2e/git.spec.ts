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

    test("virtualized graph exposes full positions and supports keyboard ref filtering", async ({ page, expectNoPageErrors }) => {
        await gotoRoute(page, "/git?section=graph");
        await expectPreviewActive(page, "project");
        await expect(page.getByLabel("Loading Git Manager")).toBeHidden({ timeout: 30_000 });

        const graph = page.getByRole("list", { name: "Commit graph" });
        await expect(graph).toBeVisible({ timeout: 30_000 });
        const firstCommit = graph.getByRole("listitem").first();
        await expect(firstCommit).toHaveAttribute("aria-posinset", /^[1-9]\d*$/);
        await expect(firstCommit).toHaveAttribute("aria-setsize", /^[1-9]\d*$/);

        const refFilter = page.getByRole("button", { name: /Filter graph to (?:Branch|Remote branch|Tag):/ }).first();
        await expect(refFilter).toBeVisible({ timeout: 30_000 });
        await refFilter.focus();
        await expect(refFilter).toBeFocused();
        const pillLabel = await refFilter.getAttribute("aria-label");
        // Count what actually happens to the pill, so a red run can tell "the key
        // never reached it" apart from "the activation ran and changed nothing".
        await page.evaluate(() => {
            const w = window as unknown as { __pillClicks: number; __pillKey: string | null };
            w.__pillClicks = 0;
            w.__pillKey = null;
            for (const el of Array.from(document.querySelectorAll("[aria-label^='Filter graph to']"))) {
                el.addEventListener("click", () => (w.__pillClicks += 1), true);
                el.addEventListener(
                    "keydown",
                    (event) => {
                        w.__pillKey = (event as KeyboardEvent).key;
                    },
                    true,
                );
            }
        });
        await page.keyboard.press("Enter");
        // The filter mutes rows rather than dropping them, so a muted row proves it
        // applied. The CI runner is slower than any local reproduction, so when the
        // rows never mute, report the DOM state immediately instead of spending the
        // test budget and leaving "element(s) not found" as the only evidence.
        const muted = await expect
            .poll(() => graph.locator(".graph-commit-mute").count(), { timeout: 5_000, intervals: [100] })
            .toBeGreaterThan(0)
            .then(() => true)
            .catch(() => false);
        if (!muted) {
            const state = await page.evaluate(() => {
                const list = document.querySelector("[role='list'][aria-label='Commit graph']");
                return {
                    active: document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName ?? "none",
                    activeTag: document.activeElement?.tagName ?? "none",
                    pills: Array.from(document.querySelectorAll("[aria-label^='Filter graph to']")).map((el) => ({
                        label: el.getAttribute("aria-label"),
                        tag: el.tagName,
                    })),
                    listItems: list?.querySelectorAll("[role='listitem']").length ?? -1,
                    muted: document.querySelectorAll(".graph-commit-mute").length,
                    emptyState: document.body.innerText.includes("No commits found"),
                    clicks: (window as unknown as { __pillClicks?: number }).__pillClicks ?? -1,
                    key: (window as unknown as { __pillKey?: string | null }).__pillKey ?? null,
                    url: location.href,
                    text: document.body.innerText.replace(/\s+/g, " ").slice(0, 300),
                };
            });
            throw new Error(`ref filter did not mute any row after Enter: ${JSON.stringify({ pillLabel, ...state })}`);
        }
        await page.keyboard.press("Tab");
        await expect(refFilter).not.toBeFocused();
        expectNoPageErrors();
    });
});
