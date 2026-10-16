/**
 * Point the dynamic loader at the sandbox's NSS libraries before Chromium starts.
 *
 * The headless build links against `libnspr4`, `libnss3` and `libnssutil3`, which the
 * sandbox image does not ship, and the run commands in these scripts set
 * `PLAYWRIGHT_SANDBOX_LIBS` to the directory that carries them. The fallback is the path
 * those notes use. A directory that is not there is left out of the path rather than added
 * as an empty entry, so a machine with the libraries in the system path still launches.
 */
const fs = require("node:fs");

const DEFAULT_SANDBOX_LIBS = "/tmp/sandboxlibs/lib";

function applySandboxLibs() {
    const dir = process.env.PLAYWRIGHT_SANDBOX_LIBS || DEFAULT_SANDBOX_LIBS;
    if (!fs.existsSync(dir)) return null;
    const existing = process.env.LD_LIBRARY_PATH ? `:${process.env.LD_LIBRARY_PATH}` : "";
    process.env.LD_LIBRARY_PATH = `${dir}${existing}`;
    return dir;
}

module.exports = { applySandboxLibs, DEFAULT_SANDBOX_LIBS };
