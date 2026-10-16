/**
 * Output for the QA scripts.
 *
 * These are command-line tools whose whole product is the text they print, and the lines
 * are read by a person and grepped by a caller. They write to the streams directly rather
 * than through the console shim, and `warn` is the one a caller looks for on failure.
 */
const write = (stream, args) => {
    stream.write(args.map((value) => (typeof value === "string" ? value : String(value))).join(" ") + "\n");
};

const log = (...args) => write(process.stdout, args);
const warn = (...args) => write(process.stderr, args);

module.exports = { log, warn };
