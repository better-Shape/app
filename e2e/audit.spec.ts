import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, expectPreviewActive, gotoRoute, ROUTES } from "./fixtures";
import {
    assertA11yWithinBaseline,
    captureRoute,
    collectIpcInventory,
    collectTimings,
    runAxeAudit,
    waitForIpcQuiet,
    type A11yBaseline,
    type RouteAudit,
} from "./helpers/audit";

const __dirname = dirname(fileURLToPath(import.meta.url));

const a11yBaseline = JSON.parse(
    readFileSync(join(__dirname, "a11y-baseline.json"), "utf8"),
) as A11yBaseline;

/**
 * @audit, the agent QA crawl. For every route: load it, scan it with axe
 * (WCAG 2.x AA, checked against e2e/a11y-baseline.json), screenshot it, and inventory
 * console errors, page errors, and IPC usage (including commands the
 * fixture does not mock yet). Produces `browser-audit.json` + one PNG per
 * route in the test artifacts, so an agent can review UI state from a CI
 * run without opening a browser.
 *
 * Run it directly with: npm run qa:audit
 */
test.describe("@audit route crawl", () => {
    const audits: RouteAudit[] = [];

    const auditRoute = async (
        route: (typeof ROUTES)[number],
        fixtures: {
            page: import("@playwright/test").Page;
            seedMode: "welcome" | "project";
            pageErrors: string[];
            consoleErrors: string[];
        },
        testInfo: import("@playwright/test").TestInfo,
    ) => {
        const { page, seedMode, pageErrors, consoleErrors } = fixtures;
        await gotoRoute(page, route.path);
        await expectPreviewActive(page, seedMode);
        // Let post-mount effects (settings, git, chat loads) settle:
        // wait for a quiet IPC window rather than a fixed sleep.
        await waitForIpcQuiet(page);
        // IPC quiet can precede time-gated content mounts (the Git
        // manager plays a ~1.65s intro). Wait for route content, not
        // just transport silence, so axe and the screenshot see the
        // real UI instead of a splash.
        if (route.name === "git" || route.name === "branch") {
            const seeded = route.name === "branch" ? "preview/browser-qa" : "preview: seeded commit history";
            await expect(page.getByText(seeded).first()).toBeVisible({ timeout: 30_000 });
            await waitForIpcQuiet(page);
        }

        const violations = await runAxeAudit(page);
        await captureRoute(page, testInfo, route.name);

        const ipc = await collectIpcInventory(page);
        // Record first, assert second: a baseline failure must not omit
        // the failing route and its violations from the audit JSON.
        audits.push({
            route: route.path,
            title: await page.title(),
            axeViolations: violations.map((v) => ({
                id: v.id,
                impact: v.impact ?? null,
                nodes: v.nodes.length,
                // The baseline records counts, which is enough to catch a
                // regression but not enough to fix one. Naming the failing
                // nodes turns "38 unnamed buttons" into a list to work through.
                targets: v.nodes.map((node) => node.target.join(" ")),
                help: v.help,
            })),
            consoleErrors: [...consoleErrors],
            pageErrors: [...pageErrors],
            unknownIpcCommands: ipc.unknown,
            ipcCommandCount: ipc.count,
            timings: await collectTimings(page),
        });
        assertA11yWithinBaseline(violations, route.path, a11yBaseline);

        expect(pageErrors, `${route.name}: uncaught page errors`).toEqual([]);
        // Console errors are a gate too, not report-only data. The fixture
        // already excludes documented benign noise (React DevTools notice,
        // Fast Refresh, favicon) and `requestfailed` entries, so anything
        // left is an app defect such as a failing chunk or a handled
        // console.error on mount.
        expect(consoleErrors, `${route.name}: console errors`).toEqual([]);
    };

    for (const route of ROUTES.filter((r) => r.name !== "git" && r.name !== "branch")) {
        test(`audit ${route.name} (${route.path})`, async ({ page, seedMode, pageErrors, consoleErrors }, testInfo) => {
            await auditRoute(route, { page, seedMode, pageErrors, consoleErrors }, testInfo);
        });
    }

    // The Git windows need the seeded repo open; the welcome seed leaves
    // them on an empty state that is not worth auditing.
    test.describe("seeded repo routes", () => {
        test.use({ seedMode: "project" });
        for (const route of ROUTES.filter((r) => r.name === "git" || r.name === "branch")) {
            test(`audit ${route.name} (${route.path})`, async ({ page, seedMode, pageErrors, consoleErrors }, testInfo) => {
                await auditRoute(route, { page, seedMode, pageErrors, consoleErrors }, testInfo);
            });
        }
    });

    // Playwright requires a destructured fixtures arg even when the hook
    // only needs testInfo; `browser` is worker-scoped so it is legal (and
    // already running) in afterAll.
    test.afterAll(async ({ browser: _browser }, testInfo) => {
        // A real file (not just a report attachment) so agents/tooling can
        // diff audits across runs: test-results/browser-audit.json.
        const body = JSON.stringify(audits, null, 2);
        try {
            mkdirSync("test-results", { recursive: true });
            writeFileSync(join("test-results", "browser-audit.json"), body);
        } catch {
            /* attachment below still carries the data */
        }
        await testInfo.attach("browser-audit.json", {
            body,
            contentType: "application/json",
        });
    });
});
