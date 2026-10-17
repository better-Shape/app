import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const installerDir = path.join(root, "src-tauri", "installer");

type GifFrame = {
    delay: number;
    disposal: number;
    transparent: boolean;
};

type GifCursor = {
    buffer: Buffer;
    offset: number;
};

function escapeRegExp(text: string) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Every read is bounds-checked. A malformed asset has to fail the suite with a
// message, not spin a worker until vitest gives up on it.
function requireBytes(cursor: GifCursor, count: number, what: string) {
    if (cursor.offset + count > cursor.buffer.length) {
        throw new Error(
            `truncated GIF: ${what} needs ${count} more bytes at offset ${cursor.offset}`,
        );
    }
}

function readSubBlocks(cursor: GifCursor) {
    const chunks: Buffer[] = [];
    for (;;) {
        requireBytes(cursor, 1, "a sub-block terminator");
        const size = cursor.buffer[cursor.offset];
        if (size === 0) {
            cursor.offset += 1;
            return Buffer.concat(chunks);
        }
        requireBytes(cursor, 1 + size, `a ${size} byte sub-block`);
        chunks.push(cursor.buffer.subarray(cursor.offset + 1, cursor.offset + 1 + size));
        cursor.offset += size + 1;
    }
}

function readGraphicControlExtension(cursor: GifCursor): GifFrame {
    requireBytes(cursor, 6, "a graphic control extension");
    expect(cursor.buffer[cursor.offset]).toBe(4);
    const packed = cursor.buffer[cursor.offset + 1];
    const frame = {
        delay: cursor.buffer.readUInt16LE(cursor.offset + 2),
        disposal: (packed >> 2) & 0x07,
        transparent: (packed & 0x01) === 1,
    };
    cursor.offset += 6;
    return frame;
}

function readApplicationExtension(cursor: GifCursor) {
    requireBytes(cursor, 1, "an extension block size");
    const size = cursor.buffer[cursor.offset];
    requireBytes(cursor, 1 + size, "an extension identifier");
    const identifier = cursor.buffer
        .subarray(cursor.offset + 1, cursor.offset + 1 + size)
        .toString("ascii");
    cursor.offset += size + 1;
    const data = readSubBlocks(cursor);
    if (identifier !== "NETSCAPE2.0" || data[0] !== 1) {
        return null;
    }
    if (data.length < 3) {
        throw new Error("truncated GIF: the NETSCAPE2.0 loop count is incomplete");
    }
    return data.readUInt16LE(1);
}

function readImageDescriptor(cursor: GifCursor) {
    requireBytes(cursor, 9, "an image descriptor");
    expect({
        left: cursor.buffer.readUInt16LE(cursor.offset),
        top: cursor.buffer.readUInt16LE(cursor.offset + 2),
        width: cursor.buffer.readUInt16LE(cursor.offset + 4),
        height: cursor.buffer.readUInt16LE(cursor.offset + 6),
    }).toEqual({ left: 0, top: 0, width: 164, height: 314 });

    const packed = cursor.buffer[cursor.offset + 8];
    const localTable = (packed & 0x80) !== 0;
    const interlaced = (packed & 0x40) !== 0;
    expect(interlaced).toBe(false);
    cursor.offset += 9;
    if (localTable) {
        const bytes = 3 * (1 << ((packed & 0x07) + 1));
        requireBytes(cursor, bytes, "a local colour table");
        cursor.offset += bytes;
    }
    requireBytes(cursor, 1, "an LZW minimum code size");
    cursor.offset += 1;
    readSubBlocks(cursor);
}

function parseGif(buffer: Buffer) {
    const signature = buffer.subarray(0, 6).toString("ascii");
    const width = buffer.readUInt16LE(6);
    const height = buffer.readUInt16LE(8);
    const packed = buffer[10];
    const cursor: GifCursor = { buffer, offset: 13 };
    if (packed & 0x80) {
        cursor.offset += 3 * (1 << ((packed & 0x07) + 1));
    }

    const frames: GifFrame[] = [];
    let loop: number | null = null;
    let pending: GifFrame = { delay: 0, disposal: 0, transparent: false };

    while (cursor.offset < buffer.length) {
        requireBytes(cursor, 1, "a block introducer");
        const block = buffer[cursor.offset];
        cursor.offset += 1;

        if (block === 0x21) {
            requireBytes(cursor, 1, "an extension label");
            const label = buffer[cursor.offset];
            cursor.offset += 1;
            if (label === 0xf9) {
                pending = readGraphicControlExtension(cursor);
            } else if (label === 0xff) {
                loop = readApplicationExtension(cursor) ?? loop;
            } else {
                readSubBlocks(cursor);
            }
            continue;
        }

        if (block === 0x2c) {
            readImageDescriptor(cursor);
            frames.push(pending);
            continue;
        }

        if (block === 0x3b) {
            break;
        }

        throw new Error(`unexpected GIF block 0x${block.toString(16)} at ${cursor.offset - 1}`);
    }

    return { signature, width, height, frames, loop };
}

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

const gif = readFileSync(path.join(installerDir, "sidebar.gif"));
const bmp = readFileSync(path.join(installerDir, "sidebar.bmp"));
const dll = readFileSync(path.join(installerDir, "plugins", "x86-unicode", "AnimGif.dll"));
const hooks = readFileSync(path.join(installerDir, "hooks.nsh"), "utf8");

// The hook is read the way makensis reads it: comments removed, so a commented
// out instruction cannot satisfy an assertion, and the hook's own !defines
// expanded, so the assertions test the paths the installer really uses.
function stripNsisComments(source: string) {
    return source
        .split("\n")
        .map((line) => {
            const outsideQuotes = line.split('"');
            for (let index = 0; index < outsideQuotes.length; index += 2) {
                const cut = outsideQuotes[index].search(/(^|\s);/);
                if (cut !== -1) {
                    return outsideQuotes
                        .slice(0, index)
                        .concat(outsideQuotes[index].slice(0, cut))
                        .join('"');
                }
            }
            return line;
        })
        .join("\n");
}

function expandDefines(source: string) {
    const defines = new Map<string, string>();
    for (const match of source.matchAll(/^!define (\w+) "?([^"\r\n]*)"?\s*$/gm)) {
        defines.set(match[1], match[2]);
    }
    return source.replace(/\$\{(\w+)\}/g, (whole, name: string) => defines.get(name) ?? whole);
}

const compiledHooks = expandDefines(stripNsisComments(hooks));

function hookFunction(name: string) {
    const body = new RegExp(`^Function ${name}\\s*$\\n([\\s\\S]*?)^FunctionEnd\\s*$`, "m").exec(
        compiledHooks,
    );
    if (!body) {
        throw new Error(`hooks.nsh does not define Function ${name}`);
    }
    return body[1];
}

function hookCallbacks() {
    return [...hooks.matchAll(/^!define (MUI_PAGE_CUSTOMFUNCTION_\w+) (\S+)\s*$/gm)].map(
        (match) => ({ slot: match[1], target: match[2] }),
    );
}

// Resolving a callback slot through its !define and then through the Function
// it names keeps a swapped SHOW and LEAVE from passing, and rejects a target
// that is merely a prefix of a real function name.
function callbackTarget(slot: string) {
    const match = new RegExp(`^!define ${slot} (\\S+)\\s*$`, "m").exec(hooks);
    if (!match) {
        throw new Error(`hooks.nsh does not define ${slot}`);
    }
    return match[1];
}

function registerCleanupLabel(body: string) {
    const pops = [...body.matchAll(/^\s*Pop (\$\w+)\s*$/gm)];
    if (pops.length === 0) {
        throw new Error("the show callback pops no registers");
    }
    const labels = [...body.slice(0, pops[0].index ?? 0).matchAll(/^\s*(\w+):\s*$/gm)];
    const cleanup = labels.at(-1);
    if (!cleanup) {
        throw new Error("the show callback pops registers behind no label");
    }
    return cleanup[1];
}

const branchingInstruction = /^\s*(?:Goto|StrCmp|StrCmpS|IntCmp|IntCmpU|IfFileExists|IfErrors)\b/;

function branchTargets(body: string) {
    const targets: string[] = [];
    for (const line of body.split("\n")) {
        if (!branchingInstruction.test(line)) {
            continue;
        }
        for (const token of line.trim().split(/\s+/).slice(1)) {
            if (/^[A-Za-z_]\w*:?$/.test(token)) {
                targets.push(token.replace(/:$/, ""));
            }
        }
    }
    return targets;
}

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
    it("ships a 164x314 animated GIF at 10 fps", () => {
        const parsed = parseGif(gif);
        expect(parsed.signature).toBe("GIF89a");
        expect({ width: parsed.width, height: parsed.height }).toEqual({
            width: 164,
            height: 314,
        });
        expect(parsed.frames).toHaveLength(100);
        expect(parsed.loop).toBe(0);
        expect(parsed.frames.every((frame) => frame.delay === 10)).toBe(true);
        expect(parsed.frames.every((frame) => frame.disposal === 1)).toBe(true);
        expect(parsed.frames.some((frame) => frame.transparent)).toBe(false);
    });

    it("reports a truncated GIF instead of scanning past the end", () => {
        // Header with no global colour table, then an application extension cut
        // off before its terminator. An unchecked sub-block loop reads undefined
        // forever here and the worker never finishes the suite.
        const truncated = Buffer.concat([
            Buffer.from("GIF89a", "ascii"),
            Buffer.from([0xa4, 0x00, 0x3a, 0x01, 0x00, 0x00, 0x00]),
            Buffer.from([0x21, 0xff, 0x0b]),
            Buffer.from("NETSCAPE2.0", "ascii"),
            Buffer.from([0x03, 0x01, 0x00, 0x00]),
        ]);
        expect(truncated.length).toBe(31);
        expect(() => parseGif(truncated)).toThrow(/truncated GIF/i);
    });

    it("keeps the GIF under the 5 MB repository limit", () => {
        expect(gif.length).toBeLessThan(5 * 1024 * 1024);
    });

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

    it("pins the vendored plug-in bytes", () => {
        expect(dll.length).toBe(8704);
        expect(sha256(dll)).toBe(
            "a1fa2e0191f986824f5fc0ef62aee8b4b25695cc56d4b00fecdc1c92f8ea237f",
        );
        expect(sha256(gif)).toBe(
            "19994d877cb2356c0d2d8e6faa87446ab2b19baf7af767b2f0147666ada5640a",
        );
        expect(sha256(bmp)).toBe(
            "f49e79abe7bafedb7a253635c9889dfd0a1a29d389c330ea47f354638c67cd3e",
        );
    });

    it("wires the assets through tauri.conf.json", () => {
        expect(config.bundle.windows.nsis.sidebarImage).toBe("installer/sidebar.bmp");
        expect(config.bundle.windows.nsis.installerHooks).toBe("installer/hooks.nsh");
    });

    it("points both MUI callbacks at functions that exist", () => {
        const slots = ["MUI_PAGE_CUSTOMFUNCTION_SHOW", "MUI_PAGE_CUSTOMFUNCTION_LEAVE"];
        expect(hookCallbacks().map((callback) => callback.slot)).toEqual(slots);

        const targets = slots.map((slot) => callbackTarget(slot));
        expect(new Set(targets).size).toBe(2);
        for (const target of targets) {
            expect(hookFunction(target).trim().length).toBeGreaterThan(0);
        }
    });

    it("plays the GIF into the control it resolved and stops on leave", () => {
        const show = hookFunction(callbackTarget("MUI_PAGE_CUSTOMFUNCTION_SHOW"));
        const leave = hookFunction(callbackTarget("MUI_PAGE_CUSTOMFUNCTION_LEAVE"));

        // AnimGif must be pointed at the handle FindWindow wrote, and MUI's
        // bitmap must be detached from that same control before playback.
        const target = /AnimGif::play[^\n]*\/HWND=\$(R\d)/.exec(show)?.[1];
        expect(target).toBeDefined();
        expect(show).toContain(`FindWindow $${target} "" ""`);
        expect(show).toContain(`\${NSD_ClearImage} $${target}`);
        expect(leave).toMatch(/^\s*AnimGif::stop\s*$/m);

        // The plug-in can only read what File wrote, so both instructions have
        // to name one path, and that path has to be the staged copy.
        const staged = /^\s*File \/oname=(\S+) "([^"]+)"\s*$/m.exec(show);
        expect(staged?.[1]).toBe("$PLUGINSDIR\\bettershape-sidebar.gif");
        expect(staged?.[2]).toMatch(/^\$\{__FILEDIR__\}\\sidebar\.gif$/);
        expect(show).toMatch(
            new RegExp(`AnimGif::play[^\\n]*"${escapeRegExp(staged?.[1] ?? "")}"`),
        );
    });

    it("saves every register the show callback touches", () => {
        const show = hookFunction(callbackTarget("MUI_PAGE_CUSTOMFUNCTION_SHOW"));
        const pushed = [...show.matchAll(/^\s*Push (\$\w+)\s*$/gm)].map((match) => match[1]);
        const popped = [...show.matchAll(/^\s*Pop (\$\w+)\s*$/gm)].map((match) => match[1]);

        expect(pushed.length).toBeGreaterThan(0);
        expect(popped).toEqual([...pushed].reverse());
        for (const register of new Set(show.match(/\$R\d/g) ?? [])) {
            expect(pushed).toContain(register);
        }
    });

    it("routes every exit of the show callback through the register restore", () => {
        const show = hookFunction(callbackTarget("MUI_PAGE_CUSTOMFUNCTION_SHOW"));
        const popped = [...show.matchAll(/^\s*Pop (\$\w+)\s*$/gm)].map((match) => match[1]);
        expect(popped.length).toBeGreaterThan(0);

        // The only way out is falling off the end: no early exit instruction,
        // the pops are the last instructions, and no branch reaches a label
        // that is not defined inside the function.
        expect(show).not.toMatch(/^\s*(?:Return|Abort|Quit)\s*$/m);
        expect(show.trimEnd().endsWith(`Pop ${popped.at(-1)}`)).toBe(true);

        const labels = new Set([...show.matchAll(/^\s*(\w+):\s*$/gm)].map((match) => match[1]));
        expect(labels.size).toBeGreaterThan(0);
        for (const target of branchTargets(show)) {
            expect(labels.has(target)).toBe(true);
        }
    });

    it("stages the GIF before it clears the bitmap MUI drew", () => {
        const show = hookFunction(callbackTarget("MUI_PAGE_CUSTOMFUNCTION_SHOW"));

        // $PLUGINSDIR is empty until something creates it, and an empty variable
        // would send File to $OUTDIR instead of the plug-in directory.
        const initialized = show.search(/^\s*InitPluginsDir\s*$/m);
        const firstUse = show.search(/^(?!\s*InitPluginsDir).*(\$PLUGINSDIR)/m);
        expect(initialized).toBeGreaterThanOrEqual(0);
        expect(firstUse).toBeGreaterThan(initialized);

        // File offers abort, retry and ignore when it cannot create its target,
        // and ignore continues the install without the GIF. The guard has to
        // test the path File wrote and bail to the register cleanup, so MUI's
        // static bitmap stays attached instead of showing a blank sidebar.
        const staged = /^\s*File \/oname=(\S+) /m.exec(show)?.[1];
        const guard = /^\s*IfFileExists "([^"]+)" (\S+) (\S+)\s*$/m.exec(show);
        expect(guard?.[1]).toBe(staged);
        expect(guard?.[2]).toBe("0");
        expect(guard?.[3]).toBe(registerCleanupLabel(show));
        expect(show.indexOf("NSD_ClearImage")).toBeGreaterThan(show.indexOf("IfFileExists"));
    });

    it("anchors both asset paths to the hook directory", () => {
        // makensis resolves a relative !addplugindir against the working
        // directory at call time and silently skips a directory it cannot find.
        expect(hooks).toMatch(
            /^!addplugindir \/x86-unicode "\$\{__FILEDIR__\}\\plugins\\x86-unicode"$/m,
        );
        expect(hooks).toMatch(
            /^!define BETTERSHAPE_SIDEBAR_GIF "\$\{__FILEDIR__\}\\sidebar\.gif"$/m,
        );
    });
});
