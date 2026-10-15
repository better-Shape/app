#!/usr/bin/env node
/**
 * Renders the crash mark alone, at every size it has to survive.
 *
 * A mark is normally judged at whatever size the screenshot happened to be, which is the
 * largest it will ever be drawn. This draws it at 4x for inspection, then at 24, 32, 40 and
 * 56 CSS pixels, the range it actually renders in, and the sizes at which a seam made of
 * dashes stops resolving into a gap and becomes a texture.
 *
 *   PLAYWRIGHT_SANDBOX_LIBS=/tmp/sandboxlibs/lib node scripts/qa/shot-mark.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { default: sparticuz } = require("@sparticuz/chromium");

const ROOT = path.resolve(__dirname, "../..");
const SRC = fs.readFileSync(path.join(ROOT, "components/layout/error/crash-screen.tsx"), "utf8");

// Pull the markup straight out of the component so this cannot drift from what ships.
const svg = SRC.match(/<svg viewBox="0 0 24 24"[\s\S]*?<\/svg>/)[0]
    .replace(/className="size-14"/, 'width="100%" height="100%"')
    .replace(/className="text-text-disabled"/g, 'stroke="#6b6b73"')
    .replace(/className="text-error"/g, 'fill="#ef4444"');

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin:0; background:#1b1b1b; font:12px ui-sans-serif,sans-serif; color:#8b8b93;
         display:flex; align-items:flex-end; gap:34px; padding:34px; }
  figure { margin:0; display:flex; flex-direction:column; align-items:center; gap:12px; }
  .hero { filter: drop-shadow(0 0 0 #000); }
  figcaption { font-variant-numeric: tabular-nums; }
</style></head><body>
  <figure class="hero"><div style="width:240px;height:240px">${svg}</div><figcaption>4x, seen large</figcaption></figure>
  ${[56, 40, 32, 24]
      .map(
          (px) =>
              `<figure><div style="width:${px}px;height:${px}px">${svg}</div><figcaption>${px}px, as it renders</figcaption></figure>`,
      )
      .join("")}
</body></html>`;

(async () => {
    process.env.LD_LIBRARY_PATH = `/tmp/sandboxlibs/lib:${process.env.LD_LIBRARY_PATH ?? ""}`;
    const browser = await chromium.launch({
        executablePath: await sparticuz.executablePath(),
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"],
    });
    const page = await browser.newPage({ viewport: { width: 720, height: 330 }, deviceScaleFactor: 2 });
    await page.setContent(PAGE);
    await page.waitForTimeout(300);
    const out = path.join(ROOT, ".dump/app/qa/motion/crash-mark.png");
    await page.screenshot({ path: out, fullPage: true });
    console.log(`mark: ${path.relative(ROOT, out)}`);
    await browser.close();
})().catch((error) => {
    process.stderr.write(String(error?.stack ?? error) + "\n");
    process.exit(1);
});
