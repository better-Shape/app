import { chromium } from "@playwright/test";

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH, args: ["--no-sandbox"] });
for (const height of [720, 400, 260]) {
    const page = await browser.newPage({ viewport: { width: 1280, height } });
    await page.goto("http://127.0.0.1:48921/git?section=graph&seed=project", { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    const pill = page.getByRole("button", { name: /Filter graph to/ }).first();
    const box = await pill.boundingBox();
    await pill.focus();
    const after = await page.evaluate(() => ({
        tag: document.activeElement?.tagName,
        label: document.activeElement?.getAttribute("aria-label"),
    }));
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
    const muted = await page.locator(".graph-commit-mute").count();
    console.log(`height=${height} box=${JSON.stringify(box)} focus=${JSON.stringify(after)} muted=${muted}`);
    await page.close();
}
await browser.close();
