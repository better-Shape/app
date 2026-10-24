import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const installerDir = path.join(root, "src-tauri", "installer");

function parseBmp(buffer: Buffer) {
    return {
        signature: buffer.subarray(0, 2).toString("ascii"),
        fileSize: buffer.readUInt32LE(2),
        pixelOffset: buffer.readUInt32LE(10),
        headerSize: buffer.readUInt32LE(14),
        width: buffer.readInt32LE(18),
        height: buffer.readInt32LE(22),
        planes: buffer.readUInt16LE(26),
        bitCount: buffer.readUInt16LE(28),
        compression: buffer.readUInt32LE(30),
    };
}

function sha256(buffer: Buffer) {
    return createHash("sha256").update(buffer).digest("hex");
}

const bmp = readFileSync(path.join(installerDir, "sidebar.bmp"));

const config = JSON.parse(
    readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"),
) as {
    bundle: {
        windows: {
            nsis: {
                sidebarImage?: string;
                installerHooks?: string;
            };
        };
    };
};

describe("Windows installer art", () => {
    it("ships a 164x314 BMP for the MUI image slot", () => {
        const parsed = parseBmp(bmp);
        expect(parsed.signature).toBe("BM");
        expect(parsed.headerSize).toBe(40);
        expect({ width: parsed.width, height: parsed.height }).toEqual({
            width: 164,
            height: 314,
        });
        expect(parsed.planes).toBe(1);
        expect(parsed.bitCount).toBe(24);
        expect(parsed.compression).toBe(0);
        expect(parsed.fileSize).toBe(bmp.length);
        const stride = (parsed.width * 3 + 3) & ~3;
        expect(parsed.pixelOffset + stride * parsed.height).toBe(bmp.length);
    });

    it("pins the sidebar bytes", () => {
        expect(sha256(bmp)).toBe(
            "f49e79abe7bafedb7a253635c9889dfd0a1a29d389c330ea47f354638c67cd3e",
        );
    });

    it("wires the image through tauri.conf.json", () => {
        // Tauri canonicalizes this path and writes it into SIDEBARIMAGE, which
        // the template maps to MUI_WELCOMEFINISHPAGE_BITMAP when it is not
        // empty (installer.nsi:42 and 127-129). That is the only input the
        // static sidebar needs, so a relative path that does not resolve fails
        // the Windows build instead of falling back to the default art.
        expect(config.bundle.windows.nsis.sidebarImage).toBe("installer/sidebar.bmp");
        expect(existsSync(path.join(root, "src-tauri", "installer", "sidebar.bmp"))).toBe(true);
    });

    it("ships no NSIS hook and no plug-in", () => {
        // The template includes a hook only when the key is present
        // (installer.nsi:28-29), so a stale installerHooks value naming a file
        // that no longer exists breaks makensis rather than degrading quietly.
        expect(config.bundle.windows.nsis.installerHooks).toBeUndefined();
        expect(existsSync(path.join(installerDir, "hooks.nsh"))).toBe(false);
        expect(existsSync(path.join(installerDir, "sidebar.gif"))).toBe(false);
        expect(existsSync(path.join(installerDir, "plugins"))).toBe(false);
    });

    it("keeps the installer folder to the image and its readme", () => {
        // Nothing else in this folder is a build input. Listing the directory
        // rather than naming expected absences is what stops a vendored binary
        // from being added back without a decision being recorded.
        expect(readdirSync(installerDir).sort()).toEqual(["README.md", "sidebar.bmp"]);
    });
});
