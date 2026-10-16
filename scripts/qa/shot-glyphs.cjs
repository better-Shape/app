#!/usr/bin/env node
/**
 * A contact sheet of every hand-drawn glyph and mark, at real size beside its magnification.
 *
 * A full-window screenshot shows a 16px icon too small to judge, and an 8x blow-up shows a
 * shape nobody sees. Both are needed at once: the crash mark's first version read as a
 * camera at 24px after passing review at large size.
 *
 *   PLAYWRIGHT_SANDBOX_LIBS=/tmp/sandboxlibs/lib node scripts/qa/shot-glyphs.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const { default: sparticuz } = require("@sparticuz/chromium");
const magick = require("./imagemagick.cjs");

const { applySandboxLibs } = require("./sandbox-libs.cjs");
const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(ROOT, ".dump/app/qa/motion/glyphs.png");

const crashSrc = fs.readFileSync(path.join(ROOT, "components/layout/error/crash-screen.tsx"), "utf8");

/** Pull a component's JSX out of its file so this cannot drift from what ships. */
const extract = (src, start) => {
    const from = src.indexOf(start);
    const svgStart = src.indexOf(`<svg`, from);
    const svgEnd = src.indexOf(`</svg>`, svgStart) + 6;
    return src.slice(svgStart, svgEnd);
};

const crashMark = extract(crashSrc, "function CrashMark");

// The panel glyph is built from a mask, so it cannot be lifted as markup. The URLs below
// are the app itself, with the toggles in each state.

(async () => {
    applySandboxLibs();
    const browser = await chromium.launch({
        executablePath: await sparticuz.executablePath(),
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"],
    });

    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    await page.goto(process.env.PROBE_URL ?? "http://127.0.0.1:48921/?seed=project", { waitUntil: "commit", timeout: 120_000 });
    await page.waitForLoadState("domcontentloaded", { timeout: 120_000 }).catch(() => {});
    await page.waitForTimeout(4000);
    await page.addStyleTag({ content: "nextjs-portal{display:none !important}" });

    // The real toggles, magnified. The mask geometry exists nowhere in the source as a
    // picture, only as custom properties.
    const shots = [];
    for (const [name, selector] of [
        ["sidebar", '[data-panel-toggle="sidebar"]'],
        ["workspace", '[data-panel-toggle="workspace"]'],
        ["terminal", '[data-panel-toggle="terminal"]'],
    ]) {
        const el = page.locator(selector).first();
        if (!(await el.count())) {
            console.log(`  ${name}: not present`);
            continue;
        }
        const box = await el.boundingBox();
        // 4x the button, so the glyph inside is seen at roughly 4x its drawn size.
        const scale = 4;
        const clip = {
            x: Math.max(0, box.x - 6),
            y: Math.max(0, box.y - 6),
            width: box.width + 12,
            height: box.height + 12,
        };
        const raw = path.join(ROOT, ".dump/app/qa/motion", `_toggle-${name}.png`);
        await page.screenshot({ path: raw, clip });
        // Nearest-neighbour upscale: a smooth one would hide exactly the aliasing this is
        // supposed to reveal.
        const big = path.join(ROOT, ".dump/app/qa/motion", `_toggle-${name}-big.png`);
        execFileSync(magick.convert(), [raw, "-filter", "point", "-resize", `${scale * 100}%`, big]);
        shots.push(big);
        console.log(`  captured ${name} toggle at ${box.width}x${box.height} → ${scale}x`);
    }

    // The crash mark at the sizes it renders, next to the same mark large.
    const markCard = await browser.newPage({ viewport: { width: 640, height: 200 }, deviceScaleFactor: 2 });
    await markCard.setContent(`<!doctype html><html><body style="margin:0;background:#1b1b1b;display:flex;align-items:center;gap:28px;padding:28px;font:11px ui-sans-serif;color:#8b8b93">
      <div style="width:200px;height:200px">${crashMark.replace(/className="size-14"/, 'width="100%" height="100%"').replace(/className="text-text-disabled"/g, 'stroke="#6b6b73"').replace(/className="text-error"/g, 'fill="#ef4444"')}</div>
      ${[56, 40, 32, 24].map((px) => `<div style="width:${px}px;height:${px}px">${crashMark.replace(/className="size-14"/, 'width="100%" height="100%"').replace(/className="text-text-disabled"/g, 'stroke="#6b6b73"').replace(/className="text-error"/g, 'fill="#ef4444"')}</div>`).join("")}
    </body></html>`);
    await markCard.waitForTimeout(250);
    const markShot = path.join(ROOT, ".dump/app/qa/motion", "_crash-mark-sheet.png");
    await markCard.screenshot({ path: markShot, fullPage: true });

    // One sheet.
    const args = ["-background", "#1b1b1b", "-gravity", "center"];
    for (const s of shots) args.push(s, "-splice", "0x10");
    args.push(markShot, "-append", OUT);
    execFileSync(magick.convert(), args);
    console.log(`\nsheet: ${path.relative(ROOT, OUT)}`);
    for (const f of fs.readdirSync(path.join(ROOT, ".dump/app/qa/motion"))) {
        if (f.startsWith("_toggle-") || f.startsWith("_crash-mark")) fs.rmSync(path.join(ROOT, ".dump/app/qa/motion", f));
    }
    await browser.close();
})().catch((error) => {
    process.stderr.write(String(error?.stack ?? error) + "\n");
    process.exit(1);
});
