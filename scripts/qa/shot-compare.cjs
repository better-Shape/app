const { chromium } = require("playwright");
const { default: sparticuz } = require("@sparticuz/chromium");
const { applySandboxLibs } = require("./sandbox-libs.cjs");
(async () => {
  applySandboxLibs();
  const b = await chromium.launch({ executablePath: await sparticuz.executablePath(), args: ["--no-sandbox","--disable-dev-shm-usage","--enable-unsafe-swiftshader"] });
  const p = await b.newPage({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 2 });
  await p.goto("file:///home/user/app/scripts/motion/compare.html");
  await p.waitForTimeout(1200);
  await p.screenshot({ path: "/home/user/app/.dump/app/qa/motion/spring-compare.png", fullPage: true });
  console.log("captured");
  await b.close();
})().catch((error) => {
    process.stderr.write(String(error?.stack ?? error) + "\n");
    process.exit(1);
});
