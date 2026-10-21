import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const transitionStyles = readFileSync(resolve(process.cwd(), "app/transitions.css"), "utf8");
const globalStyles = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
const systemReducedMotionRule = globalStyles.match(
    /@media \(prefers-reduced-motion: reduce\) \{\s+\*,\s+\*::before,\s+\*::after \{[\s\S]*?\n\s+\}\s+\}/,
)?.[0];
const appReducedMotionRule = globalStyles.match(
    /:root\[data-motion-preference="reduced"\],[\s\S]*?\n\}/,
)?.[0];
if (!systemReducedMotionRule || !appReducedMotionRule) {
    throw new Error("Could not find the app's system and saved reduced-motion rules.");
}

async function expectStaticVisibleProgress(page: Page) {
    const metrics = await page.locator("#segment").evaluate((element: HTMLElement) => {
        const track = document.querySelector<HTMLElement>("#track")!;
        const segmentRect = element.getBoundingClientRect();
        const trackRect = track.getBoundingClientRect();
        return {
            animationName: getComputedStyle(element).animationName,
            segmentLeft: segmentRect.left,
            segmentRight: segmentRect.right,
            segmentWidth: segmentRect.width,
            trackLeft: trackRect.left,
            trackRight: trackRect.right,
            trackWidth: trackRect.width,
        };
    });

    expect(metrics.animationName).toBe("none");
    expect(metrics.segmentWidth).toBeCloseTo(metrics.trackWidth * 0.3, 0);
    expect(metrics.segmentLeft).toBeGreaterThanOrEqual(metrics.trackLeft);
    expect(metrics.segmentRight).toBeLessThanOrEqual(metrics.trackRight);
    expect(metrics.segmentRight).toBeGreaterThan(metrics.segmentLeft);
}

test("active loading progress remains visible and static with reduced motion", async ({ page }) => {
    await page.setContent(`
        <div id="track" style="position:relative;width:400px;height:4px;overflow:hidden;background:#222">
            <div id="segment" class="bettershape-loading-progress" style="height:100%;background:#7c6af0"></div>
        </div>
    `);
    await page.addStyleTag({ content: transitionStyles });
    await page.addStyleTag({ content: `${systemReducedMotionRule}\n${appReducedMotionRule}` });

    await page.emulateMedia({ reducedMotion: "reduce" });
    await expectStaticVisibleProgress(page);

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.locator("html").evaluate((root) => {
        root.setAttribute("data-motion-preference", "reduced");
    });
    await expectStaticVisibleProgress(page);
});
