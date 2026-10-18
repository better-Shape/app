#!/usr/bin/env node
/**
 * Launch the full BetterShape UI in a plain browser (no Tauri, no Rust).
 *
 * Sets NEXT_PUBLIC_BROWSER_PREVIEW=1 so `lib/preview/tauri-mock.ts`
 * installs the mocked Tauri IPC bridge, builds the design-preview runtime
 * bundle (same first step as `tauri dev`), then starts Next dev on
 * $HOST:$PORT (default 127.0.0.1:48921, loopback only, so the mocked
 * app is never LAN-exposed by accident; set HOST=0.0.0.0 and
 * NEXT_DEV_ALLOWED_ORIGINS to an explicit forwarded host pattern when a
 * sandbox or VM needs to expose the preview).
 *
 * Usage: npm run dev:browser   →   http://localhost:48921
 * Seed a fake open project instead of the welcome screen:
 *   open http://localhost:48921/?seed=project
 */
const { spawn, spawnSync } = require("node:child_process");
const { join } = require("node:path");
// Node + resolved entries instead of `npm`/`npx` via PATH (see build-preview).
const nextBin = require.resolve("next/dist/bin/next");
const runtimeScript = join(__dirname, "../build/preview.mjs");

const port = process.env.PORT ?? "48921";
const host = process.env.HOST ?? "127.0.0.1";
const env = { ...process.env, NEXT_PUBLIC_BROWSER_PREVIEW: "1" };

const runtime = spawnSync(process.execPath, [runtimeScript], { stdio: "inherit", env });
if (runtime.status !== 0) {
    process.stderr.write("[dev:browser] build:runtime failed, see output above.\n");
    process.exit(runtime.status ?? 1);
}

const child = spawn(process.execPath, [nextBin, "dev", "-H", host, "-p", port], {
    stdio: "inherit",
    env,
});

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal));
}
// A signal-killed child reports a null code; the run was interrupted,
// not successful, so map it to a failure exit.
child.on("exit", (code) => process.exit(code ?? 1));
