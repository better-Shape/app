#!/usr/bin/env node
/**
 * Captures a micro-interaction as a frame sequence, a GIF and a contact sheet.
 *
 * A screenshot proves a state was reached; it cannot show whether the motion between two
 * states is smooth or travels the right distance. A description of a curve is not
 * evidence, so this pauses every animation as it appears, then seeks the real
 * `document.getAnimations()` objects to chosen times. Each frame is the browser's own
 * rendering of the real CSS at that instant.
 *
 *   node scripts/qa/capture-motion.cjs [--only=name,name] [--out=dir] [--list]
 *
 * Needs `@sparticuz/chromium` unpacked into `/tmp/sandboxlibs/lib`.
 */
const { execFileSync } = require("node:child_process");
const magick = require("./imagemagick.cjs");
const { mkdirSync, readdirSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");

const OUT = resolve(process.env.CAPTURE_OUT ?? ".dump/app/qa/motion");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7).split(",").filter(Boolean);
const LIST = process.argv.includes("--list");
const BASE = process.env.CAPTURE_BASE_URL ?? "http://127.0.0.1:48921";
/** GIF frame delay in 1/100s. 4 = 40ms = 25fps, below the 2/100s floor that
 *  browsers clamp, and smooth enough to read a 200ms travel. */
const FRAME_DELAY_CS = 4;

const log = (...a) => process.stdout.write(a.join(" ") + "\n");

// ── chromium resolution (same order as playwright.config.ts) ────────────────
/**
 * A sandbox Chromium build needs its own copies of libnss3/libnspr4. The config
 * takes them via `PLAYWRIGHT_SANDBOX_LIBS`; this script runs outside that config, so
 * it applies the same override to the environment the browser is spawned in.
 */
const applySandboxLibs = () => {
    const libs = process.env.PLAYWRIGHT_SANDBOX_LIBS;
    if (!libs) return;
    process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH
        ? `${libs}:${process.env.LD_LIBRARY_PATH}`
        : libs;
    log(`[capture] LD_LIBRARY_PATH += ${libs}`);
};

const LAUNCH_ARGS = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--enable-unsafe-swiftshader",
    "--force-color-profile=srgb",
    "--hide-scrollbars",
    "--disable-lcd-text",
];

/** Frame timestamps are expressed as fractions of the measured animation length. */
const INJECT = () => {
    // Stretch JS timers so DOM-swapping components keep their nodes on screen while
    // frames are taken. CSS timing is not touched; frames come from seeking.
    const TIMER_SCALE = 50;
    const rawSetTimeout = window.setTimeout.bind(window);
    const rawSetInterval = window.setInterval.bind(window);
    window.setTimeout = (fn, delay, ...rest) =>
        rawSetTimeout(fn, typeof delay === "number" ? delay * TIMER_SCALE : delay, ...rest);
    window.setInterval = (fn, delay, ...rest) =>
        rawSetInterval(fn, typeof delay === "number" ? delay * TIMER_SCALE : delay, ...rest);

    // Pause every animation as it appears and remember it, but only once the harness
    // has armed itself.
    //
    // Pausing from page load is wrong: the app runs its own entrance animations and
    // transitions while it boots, the sweep pauses them mid-flight, and a paused
    // animation stays "relevant" forever, so it is still returned by
    // `document.getAnimations()` and still seeked. One of those stale transitions drove
    // the same rail property and rewound it to a value from several seconds earlier.
    // Arming right before the interaction under study leaves the app untouched until
    // then, so the only animations ever seeked are the ones the interaction started.
    let armed = false;
    const tracked = new Set();
    window.__motion = {
        animations: () => [...tracked],
        arm() {
            armed = true;
            tracked.clear();
        },
        disarm() {
            armed = false;
            tracked.clear();
        },
        seek(t) {
            for (const a of tracked) {
                try {
                    a.currentTime = t;
                } catch {
                    /* an animation can be cancelled between frames */
                }
            }
        },
        /** Longest duration among tracked animations, for building timestamps. */
        duration() {
            let max = 0;
            for (const a of tracked) {
                const timing = a.effect?.getComputedTiming?.();
                const d = Number(timing?.activeDuration ?? 0) + Number(timing?.delay ?? 0);
                if (Number.isFinite(d)) max = Math.max(max, d);
            }
            return max;
        },
        reset() {
            tracked.clear();
        },
    };
    const sweep = () => {
        if (armed) {
            for (const a of document.getAnimations()) {
                if (tracked.has(a)) continue;
                tracked.add(a);
                try {
                    a.pause();
                } catch {
                    /* already finished */
                }
            }
        }
        window.requestAnimationFrame(sweep);
    };
    window.requestAnimationFrame(sweep);
};

/** One capturable interaction. */
const CASES = [
    {
        name: "sidebar-toggle-peek",
        title: "Sidebar toggle: hover travels halfway, click commits",
        description:
            "The rail drives to the midpoint on hover and only completes on click. Frames are the real `--panel-rail-*` transition, seeked.",
        async run(page, shot) {
            const toggle = page.locator('[data-panel-toggle="sidebar"]:visible').last();
            await toggle.waitFor({ state: "visible" });
            const clip = pad(await toggle.boundingBox(), 14);
            await shot({ clip, label: "hover", steps: 10, act: () => toggle.hover() });
            await shot({ clip, label: "click", steps: 10, act: () => toggle.click() });
        },
    },
    {
        name: "workspace-toggle-peek",
        title: "Right panel toggle: same midpoint preview, committed on click",
        async run(page, shot) {
            const toggle = page.locator('[data-panel-toggle="workspace"]').first();
            await toggle.waitFor({ state: "visible" });
            const clip = pad(await toggle.boundingBox(), 14);
            await shot({ clip, label: "hover", steps: 10, act: () => toggle.hover() });
            await shot({ clip, label: "click", steps: 10, act: () => toggle.click() });
        },
    },
    {
        name: "workspace-toggle-commit",
        title: "Workspace toggle: the preview yields, so the commit is visible under the pointer",
        description:
            "Clicking used to leave the rail pinned at the preview until the pointer left. The measured column shows the rail travelling from 0.5 to 1 while the pointer stays on the button.",
        async run(page, shot) {
            const toggle = page.locator('[data-panel-toggle="workspace"]').first();
            await toggle.waitFor({ state: "visible" });
            const clip = pad(await toggle.boundingBox(), 14);
            const rail = '[data-panel-toggle="workspace"] .panel-glyph__hide';
            await shot({ clip, label: "hover", steps: 14, measure: rail, act: () => toggle.hover() });
            await shot({ clip, label: "commit", steps: 18, measure: rail, act: () => toggle.click() });
            // Pointer still resting on the button: the committed state must be showing.
            await shot({ clip, label: "settled", steps: 1, measure: rail });
        },
    },
    {
        name: "sidebar-toggle-commit",
        title: "Sidebar toggle: the departing icon retracts, the arriving one finishes the travel",
        description:
            "Closing the sidebar replaces the toggle with the title-bar peek toggle. The parenthesised pair is [departing, arriving]: the replacement mounts from the preview rather than appearing complete.",
        async run(page, shot) {
            const toggle = page.locator('[data-panel-toggle="sidebar"]:visible').last();
            await toggle.waitFor({ state: "visible" });
            const clip = pad(await toggle.boundingBox(), 12);
            const rail = '[data-panel-toggle="sidebar"] .panel-glyph__hide';
            await shot({ clip, label: "hover", steps: 14, measure: rail, act: () => toggle.hover() });
            await shot({ clip, label: "commit", steps: 18, measure: rail, act: () => toggle.click() });
        },
    },
    {
        name: "press-spring",
        title: "Press: squash on pointer-down, spring back on release",
        async run(page, shot) {
            const button = page.locator('[data-panel-toggle="workspace"]').first();
            await button.waitFor({ state: "visible" });
            const clip = pad(await button.boundingBox(), 10);
            const box = await button.boundingBox();
            await shot({ clip, label: "rest", steps: 6 });
            await shot({
                clip,
                label: "press",
                steps: 8,
                act: async () => {
                    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                    await page.mouse.down();
                },
            });
            await shot({ clip, label: "release", steps: 8, act: () => page.mouse.up() });
        },
    },
];

// ── image pipeline ─────────────────────────────────────────────────────────

/** Give a crop some breathing room and clamp it into the viewport. */
function pad(box, amount) {
    if (!box) return undefined;
    return {
        x: Math.max(0, Math.floor(box.x - amount)),
        y: Math.max(0, Math.floor(box.y - amount)),
        width: Math.ceil(box.width + amount * 2),
        height: Math.ceil(box.height + amount * 2),
    };
}

/** Assemble PNG frames into a GIF, looping twice with a beat at the end. */
function buildGif(framePaths, outPath) {
    const hold = framePaths.at(-1);
    const args = ["-delay", String(FRAME_DELAY_CS)];
    for (const p of framePaths) args.push(p);
    // A short hold on the final frame, then the same sequence again, so a looped
    // GIF reads as "before → after → before" instead of a strobe.
    args.push("-delay", "120", hold);
    args.push("-delay", String(FRAME_DELAY_CS));
    for (const p of framePaths) args.push(p);
    args.push("-delay", "120", hold);
    args.push("-loop", "0", "-layers", "Optimize", "-colors", "128", outPath);
    execFileSync(magick.convert(), args, { stdio: "pipe" });
}

/** Build a labelled contact sheet so the motion is also reviewable as one still. */
function buildSheet(framePaths, outPath, label, captions) {
    const cols = Math.min(framePaths.length, 6);
    const args = ["-background", "#0b0b0d", "-fill", "#e6e6e6", "-pointsize", "22"];
    framePaths.forEach((p, i) => args.push("-label", captions?.[i] ?? "", p));
    args.push("-tile", `${cols}x`, "-geometry", "+6+6", "-border", "8", outPath);
    execFileSync(magick.montage(), args, { stdio: "pipe" });
    if (label) log(`  sheet: ${outPath}`);
}

// ── main ───────────────────────────────────────────────────────────────────

// A typo in `--only` used to select no cases, write an empty manifest and exit 0.
const KNOWN = new Set(CASES.map((c) => c.name));
const UNKNOWN = ONLY.filter((name) => !KNOWN.has(name));
if (UNKNOWN.length) {
    console.error(`unknown case(s): ${UNKNOWN.join(", ")}\nknown cases: ${[...KNOWN].join(", ")}`);
    process.exit(1);
}

async function main() {
    if (LIST) {
        for (const c of CASES) log(`${c.name}\t${c.title}`);
        return;
    }

    let playwright;
    try {
        playwright = require("playwright");
    } catch {
        playwright = require("@playwright/test").chromium ? require("playwright-core") : null;
    }
    const { chromium } = playwright;
    const { default: sparticuz } = require("@sparticuz/chromium");
    applySandboxLibs();

    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (await sparticuz.executablePath());
    const browser = await chromium.launch({
        executablePath,
        args: [...LAUNCH_ARGS, ...sparticuz.args.filter((a) => !a.startsWith("--single-process"))],
    });

    mkdirSync(OUT, { recursive: true });

    const selected = CASES.filter((c) => !ONLY.length || ONLY.includes(c.name));
    // Only clear what this run is about to rewrite, so a targeted `--only` capture
    // does not delete the artifacts of the cases it is not touching.
    for (const spec of selected) rmSync(join(OUT, spec.name), { recursive: true, force: true });
    const manifest = [];

    for (const spec of selected) {
        log(`\n▶ ${spec.name}, ${spec.title}`);
        const context = await browser.newContext({
            viewport: { width: 1280, height: 760 },
            deviceScaleFactor: 2,
            colorScheme: "dark",
        });
        const page = await context.newPage();
        await page.addInitScript(INJECT);
        const url = `${BASE}/?seed=${spec.seed ?? "project"}`;
        await page.goto(url, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1400);

        const dir = join(OUT, spec.name);
        mkdirSync(dir, { recursive: true });
        const groups = new Map();

        /**
         * `measure` reads a numeric style value out of the page at every frame. It
         * turns the GIF into evidence with numbers behind it: "the rail travelled
         * from 0.5 to 1 across N frames" is checkable, whereas "the GIF looks right"
         * is not.
         *
         * `act` is the interaction that starts the motion, and the reset happens
         * *before* it. Resetting afterwards was wrong: the sweep pauses every
         * animation it sees, so a paused animation from earlier in the page's life
         * stays "relevant" and gets seeked along with the real one, and an already
         * finished transition cannot be seeked back without restoring a value that
         * has nothing to do with the interaction under study.
         */
        const shot = async ({ clip, label, steps, measure, act }) => {
            if (act) {
                await page.evaluate(() => window.__motion.arm());
                await act();
                // Let the interaction's animations register before measuring.
                await page.waitForTimeout(50);
            } else {
                // A still is a reading of the app as it is now, so the harness stops
                // clipping animations and lets them finish before the frame is taken.
                // Seeking without an interaction would rewind the very motion the
                // previous shot just completed.
                await page.evaluate(() => window.__motion.disarm());
                await page.waitForTimeout(500);
            }
            // No interaction, no motion to show: a single frame of the state as it is.
            const frameCount = act ? (steps ?? 10) : (steps ?? 1);
            const duration = await page.evaluate(() => window.__motion.duration());
            const total = duration > 0 ? duration : 200;
            const framesOver = act ? total : 0;
            const frames = [];
            const readings = [];
            for (let i = 0; i < frameCount; i++) {
                const t = frameCount > 1 ? Math.round((total / (frameCount - 1)) * i) : 0;
                if (act) await page.evaluate((ms) => window.__motion.seek(ms), t);
                const file = join(dir, `${label}-${String(i).padStart(2, "0")}.png`);
                await page.screenshot({ path: file, clip });
                frames.push(file);
                if (measure) {
                    readings.push(await page.evaluate((sel) => {
                        // Every match, in document order. A node that is off screen or
                        // inside a masked group can have a degenerate rect, so this
                        // deliberately does not filter by visibility.
                        return [...document.querySelectorAll(sel)].map((n) => {
                            const m = new DOMMatrixReadOnly(getComputedStyle(n).transform);
                            return +m.a.toFixed(3);
                        });
                    }, measure));
                }
            }
            log(`  ${label}: ${frameCount} frame(s)${act ? ` over ${framesOver}ms` : " (still)"}`);
            if (readings.length) {
                const flat = readings.map((r) => `[${r.join(",")}]`).join(" ");
                log(`  measure(${measure}): ${flat}`);
            }
            groups.set(label, { frames, readings, measure });
        };

        await spec.run(page, shot);

        for (const [label, group] of groups) {
            const { frames, readings, measure } = group;
            const gif = join(OUT, `${spec.name}--${label}.gif`);
            buildGif(frames, gif);
            // A contact sheet is only reviewable if a frame says what it is: the phase, the
            // frame's position in it, and the value the case reads out at that frame.
            const captions = frames.map((_, i) => {
                const read = readings[i];
                return read ? `${label} ${i}\n${measure} ${read.join(",")}` : `${label} ${i}`;
            });
            buildSheet(frames, join(OUT, `${spec.name}--${label}-sheet.png`), label, captions);
            manifest.push({ case: spec.name, group: label, gif, frames: frames.length });
            log(`  gif:  ${gif} (${(readdirSync(dir).length)} frames on disk)`);
        }
        await context.close();
    }

    writeFileSync(
        join(OUT, "manifest.json"),
        JSON.stringify({ capturedAt: new Date().toISOString(), cases: selected.map((c) => ({ name: c.name, title: c.title })), groups: manifest }, null, 2),
    );
    await browser.close();
    log(`\nDone. ${manifest.length} GIF(s) in ${OUT}`);
}

main().catch((error) => {
    process.stderr.write(String(error?.stack ?? error) + "\n");
    process.exit(1);
});
