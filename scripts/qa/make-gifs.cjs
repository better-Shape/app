#!/usr/bin/env node
/**
 * Records each interaction and writes an annotated GIF.
 *
 * A claim that "the rail previews at the midpoint" is an assertion; a GIF with a drawn
 * pointer, an arrow along the travel, a live readout of the animated value and a caption
 * is the same claim, checkable in two seconds without opening the app.
 *
 * Playwright screenshots at a fixed cadence while the interaction is driven from JS, so
 * the recording is deterministic. Frames become a GIF through ImageMagick, with the
 * palette taken from one middle frame because per-frame quantisation bands a dark UI.
 *
 *   node scripts/qa/make-gifs.cjs --list
 *   node scripts/qa/make-gifs.cjs [--only=panel-peek] [--keep-frames]
 *
 * Needs the dev server and the sandbox libs:
 *   PLAYWRIGHT_SANDBOX_LIBS=/tmp/sandboxlibs/lib node scripts/qa/make-gifs.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const magick = require("./imagemagick.cjs");
const { chromium } = require("playwright");
const { default: sparticuz } = require("@sparticuz/chromium");

const { applySandboxLibs } = require("./sandbox-libs.cjs");
const { log, warn } = require("./log.cjs");
const ROOT = path.resolve(__dirname, "../..");
const OUT = process.env.GIF_OUT ?? path.join(ROOT, ".dump/app/qa/gifs");
const URL = process.env.PROBE_URL ?? "http://127.0.0.1:48921/?seed=project";
const FRAME_MS = 40; // 25fps: GIF cannot do better without ballooning, and motion reads fine
const MAX_WIDTH = 900;

// The browser-side toolkit: pointer, arrows, labels, live readouts. Injected once per
// page and driven by name from the cases below, so a case only has to say WHAT to show.
const KIT = () => {
    if (window.__gifkit) return;
    const kit = { pointer: null, layer: null, caption: null, readout: null, marks: [] };
    let captionHeight = 72;

    const el = (tag, style, html) => {
        const node = document.createElement(tag);
        node.setAttribute("style", style);
        if (html !== undefined) node.innerHTML = html;
        document.body.append(node);
        return node;
    };

    kit.install = (opts) => {
        const { caption, hint } = opts ?? {};
        if (kit.layer) return;
        kit.layer = el(
            "div",
            "position:fixed;inset:0;z-index:2147483000;pointer-events:none;font-family:ui-sans-serif,-apple-system,'Segoe UI',sans-serif",
        );
        kit.caption = el(
            "div",
            "position:fixed;left:50%;transform:translateX(-50%);bottom:18px;z-index:2147483001;pointer-events:none;" +
                "display:flex;flex-direction:column;gap:3px;padding:10px 16px;border-radius:12px;max-width:min(720px,80vw);" +
                "background:rgba(12,12,14,.92);border:1px solid #2a2a31;box-shadow:0 8px 28px rgba(0,0,0,.55);color:#e8e8ea;" +
                "font-size:13px;line-height:1.35;text-align:center;backdrop-filter:blur(6px)",
            `<span style="font-weight:600">${caption}</span>` +
                (hint ? `<span style="color:#9a9aa2;font-size:11.5px">${hint}</span>` : ""),
        );
        captionHeight = kit.caption.getBoundingClientRect().height + 30;
        kit.pointer = el(
            "div",
            "position:fixed;left:0;top:0;z-index:2147483002;pointer-events:none;width:22px;height:22px;" +
                "transition:transform 40ms linear;will-change:transform",
            // A real cursor silhouette, so the viewer reads it as "the mouse is here".
            `<svg width="22" height="22" viewBox="0 0 24 24" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.8))">
                <path d="M5.5 3.2 19 12.4l-5.9.9 3.1 6.2-2.6 1.2-3-6.2-4.3 3.2z"
                      fill="#fff" stroke="#0b0b0d" stroke-width="1.4" stroke-linejoin="round"/>
             </svg>`,
        );
        kit.readout = el(
            "div",
            "position:fixed;z-index:2147483001;pointer-events:none;padding:5px 9px;border-radius:8px;" +
                "background:rgba(12,12,14,.95);border:1px solid #2a2a31;color:#fff;font:600 12px/1 ui-monospace,monospace;" +
                "white-space:nowrap;display:none",
        );
    };

    /** Move the drawn pointer to a viewport point, pressing or not. */
    kit.move = ({ x, y, pressed }) => {
        kit.pointer.style.transform = `translate(${x}px, ${y}px)${pressed ? " scale(0.86)" : ""}`;
    };

    /** A labelled arrow along the travel, from (x1,y1) to (x2,y2). */
    kit.arrow = (a) => {
        const { x1, y1, x2, y2, label, colour = "#f05252" } = a;
        const svg = el(
            "svg",
            `position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147483000;pointer-events:none;overflow:visible`,
        );
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        const horiz = Math.abs(x2 - x1) > Math.abs(y2 - y1);
        const labelBox = horiz
            ? `left:${midX}px;top:${midY - 26}px;transform:translateX(-50%)`
            : `left:${midX + 14}px;top:${midY}px;transform:translateY(-50%)`;
        svg.innerHTML = `
            <defs><marker id="gifhead" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0 0 L6 3 L0 6z" fill="${colour}"/></marker></defs>
            <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${colour}" stroke-width="2.5"
                  stroke-dasharray="7 5" marker-end="url(#gifhead)" opacity="0.95"/>`;
        el(
            "div",
            `position:fixed;${labelBox};z-index:2147483001;pointer-events:none;padding:3px 7px;border-radius:6px;` +
                `background:${colour};color:#fff;font:600 10.5px/1.3 ui-monospace,monospace;white-space:nowrap`,
            label,
        );
        kit.marks.push(svg);
    };

    /** A live numeric readout pinned beside a point, updated as the animation runs. */
    kit.show = ({ x, y, t: text }) => {
        kit.readout.style.display = "block";
        kit.readout.textContent = text;
        // `x === "center"` parks it just above the caption bar, which is the one band of
        // the window this toolkit already owns and therefore never covers the UI.
        if (x === "center") {
            kit.readout.style.left = "50%";
            kit.readout.style.top = "auto";
            kit.readout.style.bottom = `${captionHeight}px`;
            kit.readout.style.transform = "translateX(-50%)";
        } else {
            kit.readout.style.left = `${x}px`;
            kit.readout.style.top = `${y}px`;
            kit.readout.style.bottom = "auto";
            kit.readout.style.transform = "none";
        }
    };
    kit.hide = () => {
        kit.readout.style.display = "none";
    };
    kit.clear = () => {
        for (const m of kit.marks) m.remove();
        kit.marks = [];
        kit.hide();
    };
    window.__gifkit = kit;
};

// Cases. Each one: where to point, what to annotate, when to click, what to read out.
/**
 * Node-side facade over the injected toolkit. Every case talks to the page through
 * this, so a case never has to hold a JSHandle or remember an `evaluate` signature.
 */
const makeKit = (page) => {
    const call = (fn, arg) => page.evaluate(([f, a]) => window.__gifkit[f](a), [fn, arg]);
    return {
        install: (opts) => call("install", opts),
        // A drawn cursor does not raise `:hover`, so a case that only moved the picture
        // recorded a UI that never reacted. Moving the pointer is part of this call now,
        // and no case has to remember the real half.
        move: async (x, y, pressed) => {
            await page.mouse.move(x, y, { steps: 6 });
            await call("move", { x, y, pressed });
        },
        arrow: (opts) => call("arrow", opts),
        show: (x, y, text) => call("show", { x, y, t: text }),
        hide: () => call("hide"),
        clear: () => call("clear"),
    };
};

const CASES = {
    "panel-peek": {
        caption: "Panel rail: hover previews the midpoint, the click commits the rest",
        hint: "Sidebar toggle, top left. The rail travels half way on hover and returns when the pointer leaves, the preview is reversible until you commit.",
        settle: 700,
        frames: 58,
        async run({ page, kit, track }) {
            const toggle = page.locator('[data-panel-toggle="sidebar"]').first();
            const box = await toggle.boundingBox();
            const cx = box.x + box.width / 2;
            const cy = box.y + box.height / 2;
            const railVal = () =>
                page
                    .locator('[data-panel-toggle="sidebar"] .panel-glyph__hide')
                    .first()
                    .evaluate((el) => {
                        const m = getComputedStyle(el).transform.match(/matrix\(([^)]+)\)/);
                        return m ? +(+m[1].split(",")[0]).toFixed(2) : 0;
                    });

            await track({ frames: 10, label: "at rest", read: async () => `rail ${(await railVal()).toFixed(2)}` });
            await kit.move(cx, cy);
            await kit.arrow({ x1: box.x + 6, y1: cy + 26, x2: box.x + box.width - 6, y2: cy + 26, label: "scaleX 0 → 0.5 on hover" });
            await track({ frames: 22, label: "hovering: travelling to the midpoint", read: async () => `rail ${(await railVal()).toFixed(2)}  (midpoint = 0.50)` });
            await kit.move(640, 520);
            await track({ frames: 16, label: "pointer left: the preview is released", read: async () => `rail ${(await railVal()).toFixed(2)}` });
        },
    },

    "panel-commit": {
        caption: "Panel rail: the preview yields to the click",
        hint: "The click commits the full travel and the rail holds it, even with the pointer still on the button. Hovering again previews again.",
        settle: 900,
        frames: 76,
        async run({ page, kit, track }) {
            const toggle = page.locator('[data-panel-toggle="sidebar"]').first();
            let box = await toggle.boundingBox();
            const cx = box.x + box.width / 2;
            const cy = box.y + box.height / 2;
            const railVal = () =>
                page.locator("[data-panel-toggle='sidebar'] .panel-glyph__hide").first().evaluate((el) => {
                    const m = getComputedStyle(el).transform.match(/matrix\(([^)]+)\)/);
                    return m ? +(+m[1].split(",")[0]).toFixed(2) : 0;
                });
            const width = () => page.locator("aside").first().evaluate((el) => Math.round(el.getBoundingClientRect().width));

            await kit.move(cx, cy);
            await page.waitForTimeout(320);
            await track({ frames: 8, label: "hovering: rail at the midpoint", read: async () => `rail ${(await railVal()).toFixed(2)}` });

            await page.mouse.click(cx, cy);
            await track({ frames: 26, label: "clicked: the rail finishes the travel", read: async () => `rail ${(await railVal()).toFixed(2)}   panel ${await width()}px` });
            await track({ frames: 14, label: "committed: it holds, pointer still on the button", read: async () => `rail ${(await railVal()).toFixed(2)}   panel ${await width()}px` });

            box = await toggle.boundingBox();
            await kit.move(640, 520);
            await track({ frames: 18, label: "pointer left, then hovering again → preview returns", read: async () => `rail ${(await railVal()).toFixed(2)}` });
        },
    },

    "sidebar-ladder": {
        caption: "Sidebar rows: hover fills half way to the committed state",
        hint: "Hovering 'New Chat' fills it with the midpoint tone (4%). The selected chat row below is the committed tone (8%) and steps up to 10% when pointed at.",
        settle: 600,
        frames: 50,
        async run({ page, kit, track }) {
            const row = page.locator('button:has-text("New Chat")').first();
            const sel = page.locator('button[class*="row-selected"]').first();
            const box = await row.boundingBox();
            const alpha = (sel) =>
                page.locator(sel).first().evaluate((el) => {
                    const m = String(getComputedStyle(el).backgroundColor).match(/rgba\(([^)]+)\)/);
                    const p = m ? m[1].split(",").map(Number) : [];
                    return p.length === 4 ? Math.round(p[3] * 100) : 0;
                });

            await track({ frames: 10, label: "at rest", read: async () => `row ${await alpha('button:has-text("New Chat")')}%   selected ${await alpha('button[class*="row-selected"]')}%` });
            await kit.arrow({ x1: box.x + 30, y1: box.y + box.height + 12, x2: box.x + box.width - 30, y2: box.y + box.height + 12, label: "0% → 4% on hover (= half of the 8% committed)", colour: "#4f7cff" });
            await kit.move(box.x + box.width / 2, box.y + box.height / 2);
            await track({ frames: 18, label: "unselected row hovered: the midpoint", read: async () => `hovered row ${await alpha('button:has-text("New Chat")')}%   selected row ${await alpha('button[class*="row-selected"]')}%` });
            const sbox = await sel.boundingBox();
            await kit.move(sbox.x + sbox.width / 2, sbox.y + sbox.height / 2);
            await track({ frames: 18, label: "committed row hovered: it steps up, it does not go inert", read: async () => `committed row ${await alpha('button[class*="row-selected"]')}%   (was 8%)` });
        },
    },

    "sessions-icons": {
        caption: "Sessions cluster: a button's hover asks for more than a row's",
        hint: "Search, Filter, Sessions actions, New chat. Each is a 28px toolbar icon button and now takes an 8% fill, Material 3's button state layer, and macOS's own value for a toolbar icon (its list rows get 0.04). Compare with the sidebar chat row below, which stays at 4%.",
        settle: 600,
        frames: 54,
        async run({ page, kit, track }) {
            const names = ["Search", "Filter", "Sessions actions", "New chat"];
            const fill = (n) =>
                page.locator(`button[aria-label="${n}"]`).first().evaluate((el) => {
                    const m = String(getComputedStyle(el).backgroundColor).match(/rgba?\(([^)]+)\)/);
                    const p = m ? m[1].split(",").map(Number) : [];
                    return p.length === 4 ? `${Math.round(p[3] * 100)}%` : "0%";
                });

            await track({ frames: 8, label: "at rest", read: async () => `Search ${await fill("Search")}   Filter ${await fill("Filter")}` });
            for (const n of names) {
                const box = await page.locator(`button[aria-label="${n}"]`).first().boundingBox();
                await kit.move(box.x + box.width / 2, box.y + box.height / 2);
                await track({ frames: 11, label: `hovering ${n}`, read: async () => `${n} fill ${await fill(n)}  (row tone)   others ${await fill(names.find((x) => x !== n))}` });
            }
        },
    },

    "terminal-peek": {
        caption: "Terminal toggle: its rail travels on the vertical axis",
        hint: "Bottom-right of the chat title bar. Same preview contract as the side panels, but the rail is the bottom strip, so it scales on Y.",
        settle: 700,
        frames: 54,
        async run({ page, kit, track }) {
            const toggle = page.locator('[data-panel-toggle="terminal"]').first();
            const box = await toggle.boundingBox();
            const cx = box.x + box.width / 2;
            const cy = box.y + box.height / 2;
            const railVal = () =>
                page.locator("[data-panel-toggle='terminal'] .panel-glyph__hide").first().evaluate((el) => {
                    // scaleY lands in `d` of the matrix; at rest the transform is `none`
                    // or a 3d matrix, so fall back to reading the resolved scale.
                    const cs = getComputedStyle(el);
                    const m = cs.transform.match(/matrix\(([^)]+)\)/);
                    if (m) {
                        const parts = m[1].split(",").map(Number);
                        if (Number.isFinite(parts[3])) return +parts[3].toFixed(2);
                    }
                    const m3 = cs.transform.match(/matrix3d\(([^)]+)\)/);
                    if (m3) {
                        const parts = m3[1].split(",").map(Number);
                        if (Number.isFinite(parts[5])) return +parts[5].toFixed(2);
                    }
                    return 1;
                });

            await track({ frames: 10, label: "at rest", read: async () => `rail scaleY ${(await railVal()).toFixed(2)}` });
            await kit.move(cx, cy);
            await kit.arrow({ x1: cx - 44, y1: box.y + box.height - 2, x2: cx - 44, y2: box.y + 4, label: "scaleY 0 → 0.5", colour: "#4f7cff" });
            await track({ frames: 22, label: "hovering: the rail rises to the midpoint", read: async () => `rail scaleY ${(await railVal()).toFixed(2)}  (midpoint = 0.50)` });
            await kit.move(640, 400);
            await track({ frames: 16, label: "released", read: async () => `rail scaleY ${(await railVal()).toFixed(2)}` });
        },
    },
};

const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith("--only=")) ?? "").slice(7);
if (args.includes("--list")) {
    for (const [name, c] of Object.entries(CASES)) log(`${name.padEnd(16)} ${c.caption}`);
    process.exit(0);
}

const selected = only ? Object.entries(CASES).filter(([n]) => n === only) : Object.entries(CASES);
if (!selected.length) {
    warn(`no case named "${only}". Try --list`);
    process.exit(1);
}

(async () => {
    applySandboxLibs();
    fs.mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch({
        executablePath: await sparticuz.executablePath(),
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"],
    });
    const manifest = [];

    for (const [name, spec] of selected) {
        const dir = path.join(OUT, name);
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });

        const page = await browser.newPage({ viewport: { width: 1280, height: 780 }, deviceScaleFactor: 2 });
        await page.goto(URL, { waitUntil: "commit", timeout: 120_000 });
        await page.waitForLoadState("domcontentloaded", { timeout: 120_000 }).catch(() => {});
        await page.waitForTimeout(3000);
        // The Next.js dev overlay is not part of the product.
        await page.addStyleTag({ content: "nextjs-portal{display:none !important}" });
        await page.evaluate(KIT);


        let frameNo = 0;
        /**
         * Screenshot N frames while re-reading a live value on each one, so the readout in
         * the GIF is the value at that frame and not a caption written in advance.
         */
        const kit = makeKit(page);
        await kit.install({ caption: spec.caption, hint: spec.hint });
        const track = async ({ frames, label, read }) => {
            for (let i = 0; i < frames; i++) {
                const value = read ? await read() : null;
                if (value !== null && value !== undefined) await kit.show("center", 0, value);
                if (label && i === 0) log(`    · ${label}`);
                await page.screenshot({ path: path.join(dir, `f${String(frameNo++).padStart(4, "0")}.png`) });
                await page.waitForTimeout(FRAME_MS);
            }
        };

        log(`\n${name}: ${spec.caption}`);
        await spec.run({ page, kit: makeKit(page), track, pageWait: (ms) => page.waitForTimeout(ms) });
        await page.screenshot({ path: path.join(dir, `f${String(frameNo++).padStart(4, "0")}.png`) });
        await page.close();

        const gif = path.join(OUT, `${name}.gif`);
        const frames = fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
        if (!frames.length) {
            warn(`  no frames captured for ${name}`);
            continue;
        }
        // Palette from the middle frame: dark UIs band when each frame is quantised alone.
        const mid = path.join(dir, frames[Math.floor(frames.length / 2)]);
        const palette = path.join(dir, "palette.png");
        try {
            execFileSync(magick.convert(), [mid, "-resize", `${MAX_WIDTH}x`, "-colors", "140", palette]);
            execFileSync(
                magick.convert(),
                [
                "-limit", "memory", "1GiB",
                "-limit", "map", "1GiB",
                "-delay", String(Math.max(2, Math.round(FRAME_MS / 10))),
                "-loop", "0",
                ...frames.flatMap((f) => ["-resize", `${MAX_WIDTH}x`, path.join(dir, f)]),
                "-remap", palette,
                "-layers", "Optimize",
                gif,
            ], { maxBuffer: 1 << 28 });
        } catch (error) {
            warn(`  imagemagick failed: ${error.message}`);
            continue;
        }
        const size = fs.statSync(gif).size;
        manifest.push({ name, gif: path.relative(ROOT, gif), frames: frames.length, bytes: size, caption: spec.caption, hint: spec.hint });
        log(`  → ${path.relative(ROOT, gif)}  ${frames.length} frames, ${(size / 1024).toFixed(0)} kB`);
        if (!args.includes("--keep-frames")) fs.rmSync(dir, { recursive: true, force: true });
    }

    fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
    log(`\nmanifest: ${path.relative(ROOT, path.join(OUT, "manifest.json"))}`);
    await browser.close();
})().catch((error) => {
    process.stderr.write(String(error?.stack ?? error) + "\n");
    process.exit(1);
});
