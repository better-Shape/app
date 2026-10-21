/**
 * Dev-only performance overlay.
 *
 * Kept out of `perf-hud.ts` on purpose: production components import the store
 * for commit counting, and this module carries the DOM markup and copy that
 * only a development session needs. `app/client-layout.tsx` imports it from a
 * `process.env.NODE_ENV` guarded effect.
 */

import { isPerfHudEnabled, perfHud } from "./perf-hud";

let unmountHud: (() => void) | null = null;

/** Secondary text: 7.4:1 on the opaque panel background, so it clears AA at 11px. */
const MUTED = "#a1a1aa";
/** Primary text: the measured values. */
const PRIMARY = "#d4d4d8";

/**
 * One shared style for the two header buttons: a 24px square is axe's minimum
 * target size, and the panel is audited by `e2e/audit.spec.ts` in dev where it
 * is mounted.
 */
const BUTTON_STYLE = [
    "display:inline-flex",
    "align-items:center",
    "justify-content:center",
    "min-width:24px",
    "min-height:24px",
    "padding:0 4px",
    "margin:0",
    "border:0",
    "border-radius:3px",
    "background:none",
    "color:" + PRIMARY,
    "font:inherit",
    "cursor:pointer",
].join(";");

type Row = { label: string; value: HTMLElement };

export function mountPerfHud(): () => void {
    if (typeof document === "undefined" || !isPerfHudEnabled()) return () => undefined;
    if (unmountHud) return unmountHud;

    const root = document.createElement("div");
    root.setAttribute("data-perf-hud", "true");
    // A landmark with a name: it is a real region of the dev UI, not decoration
    // a screen reader should have to guess at.
    root.setAttribute("role", "complementary");
    root.setAttribute("aria-label", "Performance HUD");
    root.style.cssText = [
        "position:fixed",
        "right:8px",
        "bottom:8px",
        "z-index:9999",
        "width:264px",
        "padding:6px 8px 8px",
        "border-radius:6px",
        "border:1px solid rgba(255,255,255,0.15)",
        // Opaque on purpose: axe cannot composite a translucent panel over an
        // unknown backdrop, and a legible panel does not depend on what is
        // behind it. It also stops the app showing through the readout.
        "background:#111113",
        "color:" + PRIMARY,
        "font:11px/16px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
        "box-shadow:0 8px 24px rgba(0,0,0,0.45)",
        // The readout never takes a click; only the header strip does, so a
        // HUD parked over the terminal or the status bar cannot eat input.
        "pointer-events:none",
        "user-select:none",
    ].join(";");

    const header = document.createElement("div");
    header.style.cssText = [
        "display:flex",
        "align-items:center",
        "justify-content:space-between",
        "gap:8px",
        "min-height:24px",
        "margin-bottom:2px",
        "color:" + MUTED,
        "pointer-events:auto",
    ].join(";");
    const title = document.createElement("span");
    title.textContent = "perf";
    title.style.cssText = "color:#6ee7b7;font-weight:600";
    const actions = document.createElement("span");
    actions.style.cssText = "display:flex;gap:4px";
    const resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.textContent = "reset";
    resetButton.setAttribute("aria-label", "Reset performance counters");
    resetButton.style.cssText = BUTTON_STYLE;
    const collapseButton = document.createElement("button");
    collapseButton.type = "button";
    collapseButton.textContent = "–";
    collapseButton.setAttribute("aria-label", "Collapse performance HUD");
    collapseButton.style.cssText = BUTTON_STYLE;
    actions.append(resetButton, collapseButton);
    header.append(title, actions);

    const body = document.createElement("div");

    const makeRow = (label: string): Row => {
        const line = document.createElement("div");
        line.style.cssText = "display:flex;justify-content:space-between;gap:8px";
        const name = document.createElement("span");
        name.textContent = label;
        name.style.cssText = "flex:0 0 auto;color:" + MUTED;
        const value = document.createElement("span");
        value.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
        line.append(name, value);
        body.append(line);
        return { label, value };
    };

    const fps = makeRow("fps");
    const long = makeRow("long");
    const ipc = makeRow("ipc");
    const slowest = makeRow("");
    const renders = document.createElement("div");
    renders.style.cssText =
        "margin-top:4px;padding-top:4px;border-top:1px solid rgba(255,255,255,0.1);color:" + MUTED;
    body.append(renders);

    root.append(header, body);
    document.body.append(root);

    const render = () => {
        const frames = perfHud.frames();
        const longTasks = perfHud.longTaskStats();
        const invokes = perfHud.invokeStats();
        const report = perfHud.renderReport();

        fps.value.textContent = `${frames.fps} fps · avg ${frames.avgMs}ms · worst ${frames.worstMs}ms`;
        long.value.textContent = `${longTasks.count} ≥50ms · ${longTasks.totalMs}ms`;
        ipc.value.textContent = invokes.count
            ? `${invokes.count}× · avg ${invokes.avgMs} · p95 ${invokes.p95Ms}ms`
            : "idle";
        slowest.value.textContent = invokes.slowest
            ? `max ${invokes.slowest.command} ${invokes.slowest.ms}ms`
            : "";
        slowest.value.style.color = MUTED;

        renders.replaceChildren(
            ...report.map((entry) => {
                const line = document.createElement("div");
                line.style.cssText = "display:flex;justify-content:space-between;gap:8px";
                const name = document.createElement("span");
                name.textContent = entry.id;
                name.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
                const count = document.createElement("span");
                count.textContent = String(entry.count);
                count.style.cssText = "font-variant-numeric:tabular-nums";
                line.append(name, count);
                return line;
            }),
        );
    };

    let collapsed = false;
    const setCollapsed = (next: boolean) => {
        collapsed = next;
        body.style.display = collapsed ? "none" : "";
        root.style.width = collapsed ? "auto" : "264px";
        collapseButton.textContent = collapsed ? "+" : "–";
        collapseButton.setAttribute("aria-label", collapsed ? "Expand performance HUD" : "Collapse performance HUD");
        if (collapsed) {
            title.textContent = `${perfHud.frames().fps} fps`;
        } else {
            title.textContent = "perf";
        }
    };

    resetButton.addEventListener("click", () => {
        perfHud.reset();
        render();
    });
    collapseButton.addEventListener("click", () => {
        setCollapsed(!collapsed);
        render();
    });

    const unsubscribe = perfHud.subscribe(render);
    render();

    unmountHud = () => {
        unsubscribe();
        root.remove();
        unmountHud = null;
    };
    return unmountHud;
}

