"use strict";
/**
 * Absolute paths to the ImageMagick tools these recorders shell out to.
 *
 * `execFileSync("convert", ...)` resolves through PATH, so whatever a writable
 * directory puts there first gets executed. The binary is resolved once, from the
 * fixed system directories below, and a missing tool fails with a message instead of
 * leaving a GIF that was never written.
 */
const fs = require("node:fs");
const path = require("node:path");

const SYSTEM_DIRS = ["/usr/bin", "/usr/local/bin", "/opt/homebrew/bin", "/bin"];

const tool = (name) => {
    for (const dir of SYSTEM_DIRS) {
        const candidate = path.join(dir, name);
        if (fs.existsSync(candidate)) return candidate;
    }
    throw new Error(`ImageMagick's ${name} was not found in ${SYSTEM_DIRS.join(", ")}`);
};

module.exports = {
    convert: () => tool("convert"),
    montage: () => tool("montage"),
};
