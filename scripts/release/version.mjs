import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pkgPath = join(root, "package.json");
const tauriPath = join(root, "src-tauri", "tauri.conf.json");
const cargoPath = join(root, "src-tauri", "Cargo.toml");

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const version = pkg.version;
if (!version || typeof version !== "string") {
    console.error("package.json is missing a string version field");
    process.exit(1);
}

const tauri = JSON.parse(readFileSync(tauriPath, "utf8"));
const tauriVersion = tauri.version;

let cargo = readFileSync(cargoPath, "utf8");
const cargoMatch = cargo.match(/^version\s*=\s*"([^"]+)"/m);
if (!cargoMatch) {
    console.error("Cargo.toml is missing a package version field");
    process.exit(1);
}
const cargoVersion = cargoMatch[1];

if (checkOnly) {
    let ok = true;
    if (tauriVersion !== version) {
        console.error(`Version mismatch: package.json ${version} != tauri.conf.json ${tauriVersion}`);
        ok = false;
    }
    if (cargoVersion !== version) {
        console.error(`Version mismatch: package.json ${version} != Cargo.toml ${cargoVersion}`);
        ok = false;
    }
    if (!ok) {
        console.error("Run 'npm run sync-version' to fix.");
        process.exit(1);
    }
    console.log(`✓ Versions in sync: ${version}`);
    process.exit(0);
}

tauri.version = version;
writeFileSync(tauriPath, `${JSON.stringify(tauri, null, 2)}\n`);

if (!/^version\s*=\s*"[^"]+"/m.test(cargo)) {
    console.error("Cargo.toml is missing a package version field");
    process.exit(1);
}
cargo = cargo.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`);
writeFileSync(cargoPath, cargo);

console.log(`Synced version ${version} → tauri.conf.json, Cargo.toml`);
