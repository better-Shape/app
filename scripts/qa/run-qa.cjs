#!/usr/bin/env node
/**
 * Agent QA entry point: run the whole Playwright browser suite, then print
 * a compact machine-friendly summary (counts, failing specs, artifact
 * locations, unmocked IPC commands seen during the audit crawl).
 *
 *   npm run qa                 # smoke + functional + audit + visual
 *   npm run qa -- --grep @smoke
 *
 * Exit code is Playwright's: 0 = green. Reports land in
 * `playwright-report/` (HTML, for humans) and `test-results/results.json`
 * (JSON, for agents/tooling).
 */
const { spawnSync } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");
const { dirname, join } = require("node:path");
// `playwright/cli.js` is not an exported subpath, resolve via package.json.
// Spawning node directly avoids `npx` PATH lookup entirely.
const playwrightCli = join(dirname(require.resolve("playwright/package.json")), "cli.js");

/** Print one line on stdout; this script runs in Node, never a browser. */
const log = (line = "") => process.stdout.write(`${line}\n`);

/** Append a suite's failing spec titles to `failures`, prefixed by trail. */
const collectSpecFailures = (suite, trail, failures) => {
    for (const spec of suite.specs ?? []) {
        if (!spec.ok) failures.push([...trail, spec.title].join(" › "));
    }
};

/** Walk a suite tree collecting failing spec titles. */
const walkSuites = (suite, trail, failures) => {
    collectSpecFailures(suite, trail, failures);
    for (const child of suite.suites ?? []) {
        walkSuites(child, [...trail, child.title].filter(Boolean), failures);
    }
};


const extraArgs = process.argv.slice(2);
const run = spawnSync(process.execPath, [playwrightCli, "test", ...extraArgs], {
    stdio: "inherit",
});

const resultsPath = "test-results/results.json";
if (existsSync(resultsPath)) {
    try {
        const report = JSON.parse(readFileSync(resultsPath, "utf8"));
        const stats = report.stats ?? {};
        log("\n── QA summary ─────────────────────────────────────────");
        log(
            `tests: ${stats.expected ?? 0} passed, ${stats.unexpected ?? 0} failed, ` +
            `${stats.flaky ?? 0} flaky, ${stats.skipped ?? 0} skipped ` +
            `(${(Number(stats.duration ?? 0) / 1000).toFixed(1)}s)`,
        );
        const failures = [];
        for (const suite of report.suites ?? []) walkSuites(suite, [], failures);
        if (failures.length) {
            log("failing:");
            for (const f of failures) log(`  ✗ ${f}`);
        }
        log("artifacts: playwright-report/index.html · test-results/ (traces, screenshots)");
        log("─────────────────────────────────────────────────────────");
    } catch {
        log("[qa] Could not parse test-results/results.json, see Playwright output above.");
    }
} else {
    log("[qa] No JSON report produced, see Playwright output above.");
}

process.exit(run.status ?? 1);
