#!/usr/bin/env node
/**
 * Serve the Browser Preview static export (`out/`) over HTTP.
 *
 * The production build uses `output: "export"` + `trailingSlash`, so each
 * route is a directory with an index.html (`/settings/` → `out/settings/`).
 * This dependency-free server mirrors that layout, binds 0.0.0.0 so
 * sandboxed/cloud browser previews can reach it, and 404s honestly for
 * missing assets (no SPA fallback masking broken chunks).
 *
 * Usage: npm run build:preview && npm run preview:browser
 */
const { createServer } = require("node:http");
const { createReadStream, existsSync, lstatSync, realpathSync, statSync } = require("node:fs");
const { extname, join, normalize, sep } = require("node:path");

const root = join(__dirname, "..", "..", "out");
// Check existence before realpathSync: on a fresh checkout (no `out/` yet)
// realpathSync throws ENOENT and hides the build instruction below.
if (!existsSync(join(root, "index.html"))) {
    process.stderr.write("[preview:browser] out/index.html not found. Run `npm run build:preview` first.\n");
    process.exit(1);
}
// The containment checks below trust realRoot. A symlinked out/ would move
// that trust root outside the repo, so refuse to serve through one.
if (lstatSync(root).isSymbolicLink()) {
    process.stderr.write("[preview:browser] out/ is a symlink; refusing to serve an export outside the repo.\n");
    process.exit(1);
}
const realRoot = realpathSync(root);
const port = Number(process.env.PORT ?? "48921");
const host = process.env.HOST ?? "0.0.0.0";

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".wasm": "application/wasm",
    ".txt": "text/plain; charset=utf-8",
    ".map": "application/json; charset=utf-8",
};

/** Decode a request path; malformed percent-encoding resolves to null. */
const decodePath = (urlPath) => {
    try {
        return decodeURIComponent(urlPath);
    } catch {
        return null; // malformed percent-encoding, 400/404, never a crash
    }
};

/** Whether a real path is the served root or sits below it. */
const isInsideRoot = (real) => real === realRoot || real.startsWith(realRoot + sep);

/** Whether a path currently resolves to a regular file. */
const isFile = (path) => {
    try {
        return statSync(path).isFile();
    } catch {
        return false;
    }
};

/** First candidate that resolves to a real file inside the served root. */
const firstServedFile = (candidates) => {
    for (const candidate of candidates) {
        // Lexical containment is not enough: a symlink inside `out/` can
        // point outside it. Compare real paths before serving. realpath
        // also absorbs the stat race during a rebuild: a candidate that
        // vanished (or is not a file) is skipped, never thrown.
        let real = "";
        try {
            real = realpathSync(candidate);
        } catch {
            continue;
        }
        if (isFile(real) && isInsideRoot(real)) return real;
    }
    return null;
};

/** Resolve a request path to a real file below `out/`, or null. */
const resolveFile = (urlPath) => {
    const decoded = decodePath(urlPath);
    if (decoded === null || decoded.includes("\0")) return null;
    const clean = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
    const direct = join(root, clean);
    // Hard containment: the resolved path must stay inside `out/`.
    if (direct !== root && !direct.startsWith(root + sep)) return null;
    return firstServedFile([direct, join(direct, "index.html")]);
};

/** Parse the request URL against its Host header; null when malformed. */
const parseRequestUrl = (req) => {
    try {
        return new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    } catch {
        return null;
    }
};

createServer((req, res) => {
    const url = parseRequestUrl(req);
    if (url === null) {
        res.writeHead(400, { "content-type": "text/plain" });
        res.end("Bad request\n");
        return;
    }
    const file = resolveFile(url.pathname);
    if (!file) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end(`Not found: ${url.pathname}\n`);
        return;
    }
    res.writeHead(200, {
        "content-type": MIME[extname(file)] ?? "application/octet-stream",
        "cache-control": "no-store",
    });
    const stream = createReadStream(file);
    // The file can vanish between the stat above and this open; an
    // unhandled stream error would take every route down with it.
    stream.on("error", () => res.destroy());
    stream.pipe(res);
}).listen(port, host, () => {
    process.stdout.write(`[preview:browser] Serving out/ at http://${host}:${port}\n`);
});
