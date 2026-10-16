/**
 * Point the dynamic loader at the sandbox's NSS libraries before Chromium starts.
 *
 * The headless build links against `libnspr4`, `libnss3` and `libnssutil3`, which the sandbox
 * image does not ship. The directory that carries them comes from `PLAYWRIGHT_SANDBOX_LIBS`,
 * which the run command in the header of every script that needs it sets.
 *
 * There is no default. A fallback has to name a directory, the only candidate is a shared
 * temporary one, and handing a shared directory to the loader is a vulnerability rather than
 * a convenience. A variable that is set but points nowhere is left out rather than added as
 * an empty path entry, and the first call in a process says so instead of letting Chromium
 * fail with nothing on screen.
 */
const fs = require("node:fs");

let warned = false;

const applySandboxLibs = () => {
    const dir = process.env.PLAYWRIGHT_SANDBOX_LIBS;
    if (!dir || !fs.existsSync(dir)) {
        if (!warned) {
            warned = true;
            process.stderr.write(
                "PLAYWRIGHT_SANDBOX_LIBS is not set to a directory that exists, so no library path was added. Chromium will fail to launch if the system lacks its libraries.\n"
            );
        }
        return null;
    }
    const existing = process.env.LD_LIBRARY_PATH ? `:${process.env.LD_LIBRARY_PATH}` : "";
    process.env.LD_LIBRARY_PATH = `${dir}${existing}`;
    return dir;
};

module.exports = { applySandboxLibs };
