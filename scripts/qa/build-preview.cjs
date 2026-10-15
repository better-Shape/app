#!/usr/bin/env node
/**
 * Build the statically-exportable Browser Preview bundle into `out/`.
 *
 * Identical to the production `next build` except NEXT_PUBLIC_BROWSER_PREVIEW=1
 * is set, so the exported site installs the mocked Tauri IPC bridge and can
 * be clicked through on any static host (Vercel preview, GitHub Pages, a
 * local `preview:browser` server). Never use this bundle for Tauri releases:
 * `npm run tauri:build` runs the plain `npm run build` without the flag, and
 * the mock installer additionally refuses to run inside a real Tauri webview.
 */
const { spawnSync } = require("node:child_process");
const { join } = require("node:path");
// Spawn Node with resolved entry files instead of `npm`/`npx` from PATH:
// no shell shim, no PATH hijack surface (and identical behavior on win32).
const nextBin = require.resolve("next/dist/bin/next");
const runtimeScript = join(__dirname, "../build/preview.mjs");

const env = { ...process.env, NEXT_PUBLIC_BROWSER_PREVIEW: "1" };

// `npm run build:runtime` then `npm run build`, via node directly.
for (const args of [[runtimeScript], [nextBin, "build"]]) {
    const result = spawnSync(process.execPath, args, { stdio: "inherit", env });
    if (result.status !== 0) process.exit(result.status ?? 1);
}
process.stdout.write("[build:preview] Static Browser Preview written to out/\n");
