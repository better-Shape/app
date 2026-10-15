import { test as base, expect, type Page, type TestInfo } from "@playwright/test";

/**
 * Shared fixtures for the Browser Preview suite.
 *
 * Every test gets:
 *  - a `page` that runs against the mocked Tauri IPC bridge
 *    (`NEXT_PUBLIC_BROWSER_PREVIEW=1`, see `lib/preview/tauri-mock.ts`),
 *  - a deterministic seed (`seedMode`: "welcome" shows the welcome screen,
 *    "project" opens the seeded fake project in the workbench),
 *  - console/pageerror collection, attached to the test report and
 *    assertable via `expectNoPageErrors()` / `expectNoConsoleErrors()`.
 *
 * Selectors in this suite deliberately use roles and visible text, the app
 * has no test-id convention, and role/text locators double as a basic
 * accessibility signal.
 */

export type SeedMode = "welcome" | "project";

/** Route table shared by smoke/audit/visual specs. */
export const ROUTES = [
    { name: "welcome", path: "/" },
    { name: "settings", path: "/settings" },
    { name: "git", path: "/git" },
    { name: "branch", path: "/branch" },
    { name: "popout", path: "/popout" },
] as const;

/**
 * Console errors that are environmental noise in a mocked browser, not app
 * defects. Keep this list short and justified, everything else fails specs
 * that call `expectNoConsoleErrors()`.
 */
const BENIGN_CONSOLE_PATTERNS: RegExp[] = [
    /Download the React DevTools/i,
    /\[Fast Refresh\]/i,
    /favicon\.ico/i,
];

export interface PreviewFixtures {
    seedMode: SeedMode;
    /** Uncaught page errors (pageerror) seen so far on this page. */
    pageErrors: string[];
    /** console.error messages seen so far (benign patterns excluded). */
    consoleErrors: string[];
    expectNoPageErrors: () => void;
    expectNoConsoleErrors: () => void;
}

export const test = base.extend<PreviewFixtures>({
    seedMode: ["welcome", { option: true }],

    page: async ({ page, seedMode }, use, testInfo: TestInfo) => {
        const pageErrors: string[] = [];
        const consoleErrors: string[] = [];

        page.on("pageerror", (error) => {
            pageErrors.push(String(error?.stack ?? error));
        });
        page.on("console", (message) => {
            if (message.type() !== "error") return;
            const text = message.text();
            if (BENIGN_CONSOLE_PATTERNS.some((pattern) => pattern.test(text))) return;
            consoleErrors.push(text);
        });
        // Seed before any app script runs (init scripts precede page code).
        await page.addInitScript((seed: string) => {
            (window as unknown as { __BETTERSHAPE_PREVIEW_SEED__: string }).__BETTERSHAPE_PREVIEW_SEED__ = seed;
            try {
                window.localStorage.setItem(
                    "bettershape:repo-history",
                    JSON.stringify([{ path: "/preview/bettershape-demo", lastOpenedAt: Date.now() - 3_600_000 }]),
                );
            } catch {
                /* storage unavailable, welcome screen shows its empty state */
            }
        }, seedMode);

        // Expose the collectors to specs via testInfo-parallel fixtures below.
        (page as Page & { __previewErrors?: { pageErrors: string[]; consoleErrors: string[] } }).__previewErrors = {
            pageErrors,
            consoleErrors,
        };

        await use(page);

        if (consoleErrors.length) {
            await testInfo.attach("console-errors.log", {
                body: consoleErrors.join("\n\n"),
                contentType: "text/plain",
            });
        }
        if (pageErrors.length) {
            await testInfo.attach("page-errors.log", {
                body: pageErrors.join("\n\n"),
                contentType: "text/plain",
            });
        }
    },

    pageErrors: async ({ page }, use) => {
        await use((page as Page & { __previewErrors?: { pageErrors: string[] } }).__previewErrors?.pageErrors ?? []);
    },

    consoleErrors: async ({ page }, use) => {
        await use((page as Page & { __previewErrors?: { consoleErrors: string[] } }).__previewErrors?.consoleErrors ?? []);
    },

    expectNoPageErrors: async ({ pageErrors }, use) => {
        await use(() => {
            expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toEqual([]);
        });
    },

    expectNoConsoleErrors: async ({ consoleErrors }, use) => {
        await use(() => {
            expect(consoleErrors, `console errors:\n${consoleErrors.join("\n")}`).toEqual([]);
        });
    },
});

export { expect };

/**
 * Assert the Browser Preview bridge actually installed on this page. If this
 * fails, the server was started without NEXT_PUBLIC_BROWSER_PREVIEW=1
 * (e.g. Playwright reused a plain `npm run dev` server), specs should fail
 * loudly rather than test a dead, unmocked UI.
 */
export const expectPreviewActive = async (page: Page, seed: SeedMode) => {
    await expect(page.locator("html")).toHaveAttribute("data-bettershape-preview", seed, { timeout: 30_000 });
};

/** Navigate and wait until the app shell is hydrated enough to inspect. */
export const gotoRoute = async (page: Page, path: string) => {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load");
};
