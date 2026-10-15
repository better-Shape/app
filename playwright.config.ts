import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
import { defineConfig } from "@playwright/test";

/**
 * Browser Preview + agent QA suite. See `e2e/README.md` for the full guide.
 *
 * Quick start:
 *   npm run test:e2e     # this config (auto-starts the dev server)
 *   npm run qa           # same, plus an agent-friendly summary
 *
 * By default tests run against `npm run dev:browser` (Next dev + mocked
 * Tauri IPC). Set `E2E_STATIC=1` to run against the production static
 * export instead (`npm run build:preview` first), that is what the PR
 * preview workflow does before deploying.
 */

const PORT = process.env.PORT ?? "48921";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const useStatic = process.env.E2E_STATIC === "1";

/**
 * Resolve a Chromium executable. Order:
 *   1. `PLAYWRIGHT_CHROMIUM_PATH`, explicit override (any environment).
 *   2. Playwright's own downloaded browser (`npx playwright install chromium`).
 *   3. `@sparticuz/chromium`, an npm-registry-hosted Chromium build, for
 *      sandboxes/CI images where the Playwright browser CDN is unreachable.
 *      Set `PLAYWRIGHT_SANDBOX_LIBS` to a directory of shared libraries
 *      (libnss3/libnspr4) to prepend to LD_LIBRARY_PATH if the host lacks them.
 */
const bundledChromiumUsable = (): boolean => {
    try {
        // playwright-core is a dependency of @playwright/test; use it only
        // to ask where its bundled Chromium would live.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { chromium } = require("playwright-core") as typeof import("playwright-core");
        const executablePath = chromium.executablePath();
        if (!existsSync(executablePath)) return false;
        // Existence is not usability: a CDN-downloaded browser on a host
        // without libnss3/libnspr4 cannot start. Probe it the way the
        // sandboxChromium path resolves its binary, a child Node process.
        execFileSync(executablePath, ["--version"], { stdio: "ignore", timeout: 15_000 });
        return true;
    } catch {
        return false;
    }
};

/** Prepend the sandbox shared-lib dir (libnss3/libnspr4) when provided. */
const applySandboxLibs = () => {
    const libs = process.env.PLAYWRIGHT_SANDBOX_LIBS;
    if (!libs) return;
    const existing = process.env.LD_LIBRARY_PATH;
    process.env.LD_LIBRARY_PATH = existing ? `${libs}:${existing}` : libs;
};

/** Whether this Node runtime satisfies @sparticuz/chromium's range (^22.17.0 || >=24.0.0). */
const sparticuzNodeSupported = (): boolean => {
    const [major, minor] = process.versions.node.split(".").map(Number);
    return major >= 24 || (major === 22 && minor >= 17);
};

/** Resolve the @sparticuz/chromium fallback for sandboxed Linux hosts without a usable bundled browser. */
const sandboxChromium = (): { executablePath?: string; args?: string[] } => {
    // @sparticuz/chromium ships an Amazon Linux (glibc x86_64/arm64) build.
    // Handing it to macOS or Windows would fail at launch with a confusing
    // OS error, so gate on platform before the Node version check.
    if (process.platform !== "linux") return {};
    // @sparticuz/chromium requires Node ^22.17.0 || >=24.0.0; on older
    // runtimes fail loudly instead of silently returning no browser.
    // Exactly the package's range: ^22.17.0 || >=24.0.0 (Node 23 excluded).
    if (!sparticuzNodeSupported()) {
        throw new Error(
            `Playwright's bundled Chromium is unavailable and the @sparticuz/chromium fallback requires Node ^22.17.0 || >=24.0.0 (current: ${process.versions.node}). ` +
            "Install Node 22.17+ / 24+, run `npx playwright install chromium`, or set PLAYWRIGHT_CHROMIUM_PATH.",
        );
    }
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const sparticuzModule = require("@sparticuz/chromium") as {
            default?: { args: string[] };
        };
        if (!sparticuzModule.default) return {};
        const executablePath = execFileSync(
            process.execPath,
            [
                "-e",
                "require('@sparticuz/chromium').default.executablePath().then((p) => process.stdout.write(p))",
            ],
            { encoding: "utf8", cwd: __dirname },
        ).trim();
        applySandboxLibs();
        // Deliberately NOT sparticuz's full Lambda arg set: `--single-process`
        // makes the browser process unresponsive under a heavy dev bundle.
        // Playwright supplies sane defaults; add only sandbox essentials.
        return {
            executablePath,
            args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"],
        };
    } catch {
        return {};
    }
};

/** Pick the Chromium executable and args for this environment, honouring the explicit override first. */
const resolveChromium = (): { executablePath?: string; args?: string[] } => {
    if (process.env.PLAYWRIGHT_CHROMIUM_PATH) {
        return { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH };
    }
    return bundledChromiumUsable() ? {} : sandboxChromium();
};

const chromiumResolution = resolveChromium();

export default defineConfig({
    testDir: "./e2e",
    testMatch: "**/*.spec.ts",
    timeout: 90_000,
    expect: { timeout: 20_000 },
    // One worker: the app is a single heavy Next dev server / static bundle,
    // and deterministic seeds matter more than wall-clock speed here.
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    reporter: [
        ["list"],
        ["html", { open: "never" }],
        ["json", { outputFile: "test-results/results.json" }],
    ],
    use: {
        baseURL,
        viewport: { width: 1440, height: 900 },
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        video: "off",
        launchOptions: chromiumResolution,
    },
    projects: [
        {
            name: "chromium",
            use: { browserName: "chromium" },
        },
    ],
    webServer: process.env.PLAYWRIGHT_BASE_URL
        ? undefined
        : {
              command: useStatic ? "npm run preview:browser" : "npm run dev:browser",
              url: baseURL,
              // Never silently reuse a running server: a developer's plain
              // `next dev` on this port serves the app WITHOUT the mocked
              // IPC bridge (no NEXT_PUBLIC_BROWSER_PREVIEW), and the suite
              // would test the wrong thing. Opt in explicitly
              // with E2E_REUSE_SERVER=1 when the server really is
              // `npm run dev:browser`.
              reuseExistingServer:
                  !process.env.CI && !useStatic && process.env.E2E_REUSE_SERVER === "1",
              timeout: 300_000,
          },
});
