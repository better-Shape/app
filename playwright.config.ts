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
 *   1. `PLAYWRIGHT_CHROMIUM_PATH`, explicit override (any environment). When
 *      the browser comes from the vendored tree, point this at
 *      `chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell`:
 *      the full Chrome build starts but exits mid-run in this sandbox.
 *   2. Playwright's own downloaded browser (`npx playwright install chromium`).
 *   3. `@sparticuz/chromium`, an npm-registry-hosted Chromium build, for
 *      sandboxes/CI images where the Playwright browser CDN is unreachable.
 *      Set `PLAYWRIGHT_SANDBOX_LIBS` to a directory of shared libraries
 *      (libnss3/libnspr4) to prepend to LD_LIBRARY_PATH for the browser
 *      process if the host lacks them. It applies to all three paths,
 *      including `PLAYWRIGHT_CHROMIUM_PATH`, and never to this process's
 *      own environment, so the dev server does not inherit it. Sources for
 *      those libraries are in `engineering/sandbox-vendored-toolchain.md`.
 *
 * A network that blocks the CDN can still get the exact build via step 2: the
 * orphan branch `vendor/sandbox-toolchain` carries Chrome for Testing
 * 156.0.8078.4 in Playwright's own registry layout, so pointing
 * `PLAYWRIGHT_BROWSERS_PATH` at the extracted tree needs no override at all.
 * See `AGENTS.md` under Blocked sandbox toolchain.
 */
/**
 * Environment for browser children: a copy of this process's environment with
 * the sandbox shared-lib dir (libnss3/libnspr4) prepended to LD_LIBRARY_PATH.
 * A copy on purpose, so the dev server this config starts never inherits
 * browser-only libraries. Without the variable set, it is a plain copy.
 */
const sandboxLibsEnv = (): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = Object.assign({}, process.env);
    const libs = process.env.PLAYWRIGHT_SANDBOX_LIBS;
    const existing = process.env.LD_LIBRARY_PATH;
    if (libs) {
        env.LD_LIBRARY_PATH = existing ? `${libs}:${existing}` : libs;
    }
    return env;
};

const bundledChromiumUsable = (): boolean => {
    try {
        // playwright-core is a dependency of @playwright/test; use it only
        // to ask where its bundled Chromium would live.
        const { chromium } = require("playwright-core") as typeof import("playwright-core");
        const executablePath = chromium.executablePath();
        if (!existsSync(executablePath)) return false;
        // Existence is not usability: a CDN-downloaded browser on a host
        // without libnss3/libnspr4 cannot start. Probe it the way the
        // sandboxChromium path resolves its binary, a child Node process.
        // Give the probe the same environment the launch gets: on a host
        // without NSS/NSPR, --version fails for the same reason a launch
        // would, and the fallback would be skipped for the wrong reason.
        execFileSync(executablePath, ["--version"], {
            stdio: "ignore",
            timeout: 15_000,
            env: sandboxLibsEnv(),
        });
        return true;
    } catch {
        return false;
    }
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
            "Install Node 22.17+ / 24+, run `npx playwright install chromium`, set PLAYWRIGHT_CHROMIUM_PATH, " +
            "or stage the vendored browser tree from vendor/sandbox-toolchain (AGENTS.md, Blocked sandbox toolchain).",
        );
    }
    try {
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
const resolveChromium = (): {
    executablePath?: string;
    args?: string[];
    env?: NodeJS.ProcessEnv;
} => {
    // Every path below can land on a Chromium that needs NSS/NSPR the host
    // does not have: the explicit override used to skip the prepend and the
    // browser died with "error while loading shared libraries: libnspr4.so".
    // The directory rides in `launchOptions.env` only, so it reaches the
    // browser process and not the Next dev server started alongside it.
    const env = sandboxLibsEnv();
    if (process.env.PLAYWRIGHT_CHROMIUM_PATH) {
        return { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH, env };
    }
    return { ...(bundledChromiumUsable() ? {} : sandboxChromium()), env };
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
