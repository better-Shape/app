#!/usr/bin/env node
/**
 * After `tauri build`, collect the platform's bundle outputs into --out-dir.
 *
 * Windows (NSIS): renames to clean release names and builds a portable zip:
 *   BetterShape-<arch>-setup.exe  (NSIS installer)
 *   BetterShape-<arch>.zip        (portable: exe + sidecar files)
 *
 * macOS: copies bundle/dmg/*.dmg and tars bundle/macos/*.app
 * Linux: copies bundle/deb/*.deb, bundle/rpm/*.rpm, bundle/appimage/*.AppImage
 *
 * Usage (from repo root, after a build):
 *   node scripts/release/assets.mjs --arch x86_64
 *   node scripts/release/assets.mjs --arch aarch64 --out-dir dist/release
 *   node scripts/release/assets.mjs --target x86_64-apple-darwin --arch x86_64
 */
import { execFileSync } from "node:child_process";
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readdirSync,
    rmSync,
    statSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const IS_WINDOWS = process.platform === "win32";

/** Windows-only cross-compile sub-target dir; native builds use target/release. */
const ARCH_TARGETS = {
    x86_64: null,
    aarch64: "aarch64-pc-windows-msvc",
};

/** Bundle sub-directories tauri-bundler writes on macOS/Linux. */
const UNIX_BUNDLE_DIRS = ["deb", "rpm", "appimage", "dmg", "macos"];

function parseArgs(argv) {
    const out = { outDir: join(root, "dist", "release"), arch: "x86_64", target: null, bundles: null };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--out-dir") out.outDir = argv[++i];
        else if (argv[i] === "--arch") out.arch = argv[++i];
        else if (argv[i] === "--target") out.target = argv[++i];
        else if (argv[i] === "--bundles") out.bundles = argv[++i];
    }
    return out;
}

function releaseDirForArch(arch, target) {
    const triple = ARCH_TARGETS[arch];
    if (triple === undefined) {
        console.error(`Unknown arch: ${arch} (expected x86_64 or aarch64)`);
        process.exit(1);
    }
    // An explicit --target always wins: `tauri build --target <triple>` writes to
    // src-tauri/target/<triple>/release, which is how the CI matrices build.
    if (target) {
        return join(root, "src-tauri", "target", target, "release");
    }
    // Only Windows cross-builds into a per-target sub-directory; on macOS and
    // Linux a native build of either arch lands in target/release.
    if (triple && IS_WINDOWS) {
        return join(root, "src-tauri", "target", triple, "release");
    }
    return join(root, "src-tauri", "target", "release");
}

function findNsisSetup(releaseDir) {
    const nsisDir = join(releaseDir, "bundle", "nsis");
    if (!existsSync(nsisDir)) return null;
    const setups = readdirSync(nsisDir).filter((f) => f.endsWith("-setup.exe"));
    if (setups.length === 0) return null;
    return join(nsisDir, setups[0]);
}

function findReleaseExe(releaseDir) {
    if (!existsSync(releaseDir)) return null;
    const preferred = join(releaseDir, "BetterShape.exe");
    if (existsSync(preferred)) return preferred;
    const exes = readdirSync(releaseDir).filter(
        (f) => f.endsWith(".exe") && !f.includes("uninstall"),
    );
    return exes.length ? join(releaseDir, exes[0]) : null;
}

function portableSidecars(dir, mainExeName) {
    const skip = new Set([mainExeName.toLowerCase(), "uninstall.exe"]);
    return readdirSync(dir)
        .filter((name) => {
            const lower = name.toLowerCase();
            if (skip.has(lower)) return false;
            if (name.endsWith(".pdb")) return false;
            if (name.endsWith(".exe")) return true;
            const full = join(dir, name);
            const st = statSync(full);
            if (st.isDirectory()) {
                return ["resources", "locales"].includes(name);
            }
            return /\.(dll|json|dat|bin|pak|txt)$/i.test(name);
        })
        .map((name) => join(dir, name));
}

function zipWindows(paths, outZip) {
    if (existsSync(outZip)) rmSync(outZip);
    const list = paths.map((p) => `'${p.replace(/'/g, "''")}'`).join(", ");
    const ps = `Compress-Archive -Path @(${list}) -DestinationPath '${outZip.replace(/'/g, "''")}' -Force`;
    // Arguments are passed straight to PowerShell: no shell parses these paths.
    execFileSync("powershell", ["-NoProfile", "-Command", ps], { stdio: "inherit" });
}

function validateBundles(outDir, bundlesStr) {
    const requested = bundlesStr.split(",").map((s) => s.trim()).filter(Boolean);
    const files = existsSync(outDir) ? readdirSync(outDir) : [];
    const missing = [];
    for (const bundle of requested) {
        const extMap = {
            deb: ".deb",
            rpm: ".rpm",
            appimage: ".AppImage",
            dmg: ".dmg",
            app: ".app.tar.gz",
            nsis: "-setup.exe",
        };
        const ext = extMap[bundle.toLowerCase()];
        if (!ext) continue;
        const found = files.some((f) => f.endsWith(ext));
        if (!found) missing.push(bundle);
    }
    if (missing.length) {
        console.log(`::error::Missing requested bundles: ${missing.join(", ")} (requested: ${bundlesStr}, found: ${files.join(", ")})`);
        process.exit(1);
    }
    console.log(`Validated bundles: ${requested.join(", ")} present`);
}

/**
 * macOS/Linux: the bundler already emits cleanly-named, single files
 * (`.dmg`, `.deb`, `.rpm`, `.AppImage`), so just copy them to --out-dir.
 * `.app` is a directory and cannot be a release asset on its own — tar it.
 * When multiple archs are built, their .app archives must not overwrite each other,
 * so the arch is baked into the tarball name (e.g. BetterShape-aarch64.app.tar.gz).
 */
function collectUnixBundles(releaseDir, outDir, arch) {
    const bundleRoot = join(releaseDir, "bundle");
    if (!existsSync(bundleRoot)) {
        console.log(`No bundle directory at ${bundleRoot}; nothing to collect.`);
        return;
    }
    let copied = 0;
    for (const dir of UNIX_BUNDLE_DIRS) {
        const src = join(bundleRoot, dir);
        if (!existsSync(src)) continue;
        for (const name of readdirSync(src)) {
            const full = join(src, name);
            if (statSync(full).isDirectory()) {
                archiveDirectory(full, outDir, arch);
                continue;
            }
            const dest = join(outDir, name);
            copyFileSync(full, dest);
            console.log(`Wrote ${dest}`);
            copied += 1;
        }
    }
    if (copied === 0) {
        console.log(
            `No release assets under ${bundleRoot} ` +
                `(looked in ${UNIX_BUNDLE_DIRS.join(", ")}); nothing to collect.`,
        );
    }
}

function archiveDirectory(dir, outDir, arch) {
    const base = basename(dir);
    // Distinct name per arch so Publish's merge-multiple doesn't clobber one arch with the other.
    const fileName = arch ? `${base.replace(/\.app$/, `-${arch}.app`)}.tar.gz` : `${base}.tar.gz`;
    const dest = join(outDir, fileName);
    if (existsSync(dest)) rmSync(dest);
    // -C so the archive holds `Foo.app/...`, and tar keeps the symlinks and
    // permissions a .app bundle's code signature depends on.
    try {
        execFileSync("tar", ["-czf", dest, "-C", dirname(dir), basename(dir)], {
            stdio: "inherit",
        });
    } catch (err) {
        console.warn(`Could not archive ${dir} (is tar installed?): ${err.message}`);
        return;
    }
    console.log(`Wrote ${dest}`);
}

function main() {
    const { outDir, arch, target, bundles } = parseArgs(process.argv.slice(2));
    const releaseDir = releaseDirForArch(arch, target);

    mkdirSync(outDir, { recursive: true });

    if (!IS_WINDOWS) {
        console.log(`Collecting ${process.platform} assets from ${releaseDir}`);
        collectUnixBundles(releaseDir, outDir, arch);
        if (bundles) validateBundles(outDir, bundles);
        return;
    }

    const setupSrc = findNsisSetup(releaseDir);
    if (!setupSrc) {
        console.error(`NSIS setup.exe not found under ${join(releaseDir, "bundle", "nsis")}`);
        process.exit(1);
    }

    const setupDest = join(outDir, `BetterShape-${arch}-setup.exe`);
    copyFileSync(setupSrc, setupDest);
    console.log(`Wrote ${setupDest}`);

    const setupSig = `${setupSrc}.sig`;
    if (existsSync(setupSig)) {
        const sigDest = `${setupDest}.sig`;
        copyFileSync(setupSig, sigDest);
        console.log(`Wrote ${sigDest}`);
    } else {
        // Not a failure: bundle.createUpdaterArtifacts is deliberately false in
        // this fork (no updater plugin, no update server), so the bundler
        // emits no .sig. The installer is still signed by `windows.signCommand`
        // when one is configured.
        console.warn(
            `No updater signature at ${setupSig} — expected, ` +
                "bundle.createUpdaterArtifacts is false.",
        );
    }

    const exe = findReleaseExe(releaseDir);
    if (!exe) {
        console.error(`Release BetterShape.exe not found under ${releaseDir}`);
        process.exit(1);
    }

    const mainName = exe.split(/[\\/]/).pop();
    const zipPaths = [exe, ...portableSidecars(releaseDir, mainName)];
    const zipDest = join(outDir, `BetterShape-${arch}.zip`);
    zipWindows(zipPaths, zipDest);
    console.log(`Wrote ${zipDest} (${zipPaths.length} entries)`);
}

main();
