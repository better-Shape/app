import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const extensions = { nsis: ".exe", dmg: ".dmg", deb: ".deb", rpm: ".rpm", appimage: ".AppImage" };

async function digest(file) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest("hex");
}

/** Validate every requested format BEFORE copying; a signature alone is not an installer. */
export async function collectInstallers(bundleDir, outputDir, bundles) {
    const formats = [...new Set(bundles.split(",").map((format) => format.trim()))];
    for (const format of formats) {
        if (!Object.hasOwn(extensions, format)) throw new Error(`Unsupported installer format: ${format}`);
    }
    const found = [];
    for (const entry of await readdir(bundleDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const directory = path.join(bundleDir, entry.name);
        for (const file of await readdir(directory, { withFileTypes: true })) {
            if (!file.isFile()) continue;
            const format = formats.find((format) => file.name.endsWith(extensions[format]));
            if (!format) continue;
            const source = path.join(directory, file.name);
            if ((await stat(source)).size === 0) throw new Error(`Empty installer: ${source}`);
            if (found.some((item) => item.name === file.name)) throw new Error(`Duplicate installer name: ${file.name}`);
            found.push({ format, name: file.name, source });
        }
    }
    for (const format of formats) {
        if (!found.some((file) => file.format === format)) throw new Error(`Missing ${format} installer under ${bundleDir}`);
    }
    found.sort((a, b) => a.name.localeCompare(b.name, "en"));
    // Never mix leftovers from a previous build into a new artifact.
    await mkdir(outputDir, { recursive: true });
    if ((await readdir(outputDir)).length !== 0) throw new Error(`Installer output must be empty: ${outputDir}`);
    const sums = [];
    for (const file of found) {
        const destination = path.join(outputDir, file.name);
        await copyFile(file.source, destination);
        sums.push(`${await digest(destination)}  ${file.name}`);
    }
    await writeFile(path.join(outputDir, "SHA256SUMS.txt"), `${sums.join("\n")}\n`);
    return found.map((file) => file.name);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const [bundleDir, outputDir, bundles] = process.argv.slice(2);
    if (!bundleDir || !outputDir || !bundles) throw new Error("Usage: collect-installers.mjs <bundle-dir> <output-dir> <formats>");
    for (const name of await collectInstallers(bundleDir, outputDir, bundles)) console.info(name);
}
