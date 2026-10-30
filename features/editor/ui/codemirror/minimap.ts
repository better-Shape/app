"use client";

import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/** Narrowest sensible gutter: below this the bars stop telling lines apart. */
const MINIMAP_WIDTH = 76;
/** A line is drawn as one bar; tall documents are sampled, not truncated. */
const MAX_DRAWN_ROWS = 240;
const BAR_HEIGHT = 2;
const BAR_GAP = 1;
const PADDING = 6;

export type MinimapRow = { indent: number; length: number };

/**
 * The shape of the document as the minimap needs it: how deep each line starts
 * and how much text it carries. Pure so the geometry can be tested without a
 * canvas, and sampling keeps a 50k-line file from costing 50k bars.
 */
export function minimapRows(text: string, maxRows = MAX_DRAWN_ROWS): MinimapRow[] {
    const lines = text.split("\n");
    const stride = Math.max(1, Math.ceil(lines.length / maxRows));
    const rows: MinimapRow[] = [];
    for (let index = 0; index < lines.length; index += stride) {
        const line = lines[index] ?? "";
        const body = line.trimStart();
        rows.push({ indent: line.length - body.length, length: body.length });
    }
    return rows;
}

/** Canvas colours come from the theme, not from constants in this file. */
function readColours(view: EditorView) {
    const styles = getComputedStyle(view.dom);
    const muted = styles.getPropertyValue("--text-muted").trim() || "rgba(255,255,255,0.3)";
    const accent = styles.getPropertyValue("--accent-text").trim() || muted;
    return { bar: muted, viewport: accent };
}

export type MinimapBand = { top: number; height: number };

/**
 * Where the visible window sits in the map, or `null` when the document fits on
 * screen. Measured in lines rather than pixels: the scroller is always at least
 * a viewport tall, so a pixel ratio would draw a window around a two-line file.
 */
export function minimapBand({
    scrollTop,
    scrollHeight,
    clientHeight,
    height,
    lineHeight,
    totalLines,
}: {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
    height: number;
    lineHeight: number;
    totalLines: number;
}): MinimapBand | null {
    const visibleLines = Math.ceil(clientHeight / Math.max(lineHeight, 1));
    if (totalLines <= visibleLines) return null;
    const bandHeight = Math.max(6, (Math.min(visibleLines, totalLines) / totalLines) * height);
    const range = Math.max(1, scrollHeight - clientHeight);
    const progress = Math.min(1, Math.max(0, scrollTop / range));
    return { top: progress * Math.max(0, height - bandHeight), height: bandHeight };
}

function draw(canvas: HTMLCanvasElement, view: EditorView) {
    const context = canvas.getContext("2d");
    if (!context) return;
    const ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    const height = canvas.clientHeight || view.dom.clientHeight;
    const width = MINIMAP_WIDTH;
    if (height <= 0) return;
    // Keep the map off the scrollbar: an overlaid gutter must not swallow it.
    const scrollbar = Math.max(0, view.scrollDOM.offsetWidth - view.scrollDOM.clientWidth);
    canvas.style.right = `${scrollbar}px`;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const rows = minimapRows(view.state.doc.toString());
    const rowHeight = BAR_HEIGHT + BAR_GAP;
    const slots = Math.max(1, Math.floor(Math.max(1, height - PADDING * 2) / rowHeight));
    // Sampling keeps a long document inside the gutter; a short one keeps its
    // real line height instead of being stretched to the full pane.
    const stride = Math.max(1, Math.ceil(rows.length / slots));
    const colours = readColours(view);

    context.fillStyle = colours.bar;
    rows.forEach((row, index) => {
        if (index % stride !== 0) return;
        const slot = index / stride;
        if (slot >= slots) return;
        const x = PADDING / 2 + Math.min(row.indent, 24) * 0.6;
        const y = PADDING + slot * rowHeight;
        const barWidth = Math.max(2, Math.min(row.length, 80) * 0.75);
        context.fillRect(x, y, barWidth, BAR_HEIGHT);
    });

    const band = minimapBand({
        scrollTop: view.scrollDOM.scrollTop,
        scrollHeight: view.scrollDOM.scrollHeight,
        clientHeight: view.scrollDOM.clientHeight,
        height,
        lineHeight: view.defaultLineHeight || 20,
        totalLines: view.state.doc.lines,
    });
    if (!band) return;
    context.fillStyle = colours.viewport;
    context.globalAlpha = 0.12;
    context.fillRect(0, band.top, width, band.height);
    context.globalAlpha = 1;
    context.strokeStyle = colours.viewport;
    context.lineWidth = 1;
    context.strokeRect(0.5, band.top + 0.5, width - 1, band.height - 1);
}

/** Scrolls the editor to the line the minimap was clicked at. */
function scrollToY(view: EditorView, y: number, canvasHeight: number) {
    const ratio = Math.min(1, Math.max(0, y / Math.max(canvasHeight, 1)));
    const line = Math.min(view.state.doc.lines, Math.max(1, Math.round(ratio * view.state.doc.lines)));
    const target = view.state.doc.line(line).from;
    view.dispatch({
        selection: { anchor: target },
        effects: EditorView.scrollIntoView(target, { y: "center" }),
    });
}

/**
 * Settings -> Editor -> Minimap.
 *
 * A gutter drawn from the document itself rather than a second copy of the
 * text: every line is one bar, indented by its own indentation, with the
 * viewport marked. It was a switch with no renderer before this.
 *
 * The reserved width is a declarative editor attribute and theme rule rather
 * than a class toggled by the plugin: CodeMirror builds the replacement plugin
 * before destroying the old one, so an imperative class would be removed again
 * by the outgoing instance.
 */
export function minimap() {
    const plugin = ViewPlugin.fromClass(
        class {
            canvas: HTMLCanvasElement;
            frame = 0;

            constructor(readonly view: EditorView) {
                this.canvas = document.createElement("canvas");
                this.canvas.className = "cm-minimap";
                this.canvas.setAttribute("aria-hidden", "true");
                this.canvas.style.cssText = [
                    "position:absolute",
                    "top:0",
                    "right:0",
                    `width:${MINIMAP_WIDTH}px`,
                    "height:100%",
                    "pointer-events:auto",
                    "cursor:pointer",
                ].join(";");
                view.dom.appendChild(this.canvas);
                this.canvas.addEventListener("pointerdown", this.onPointerDown);
                draw(this.canvas, view);
            }

            onPointerDown = (event: PointerEvent) => {
                const bounds = this.canvas.getBoundingClientRect();
                scrollToY(this.view, event.clientY - bounds.top, bounds.height);
            };

            update(update: ViewUpdate) {
                if (
                    !update.docChanged &&
                    !update.viewportChanged &&
                    !update.geometryChanged &&
                    !update.heightChanged
                ) {
                    return;
                }
                if (this.frame || typeof requestAnimationFrame !== "function") return;
                this.frame = requestAnimationFrame(() => {
                    this.frame = 0;
                    draw(this.canvas, this.view);
                });
            }

            destroy() {
                if (this.frame) cancelAnimationFrame(this.frame);
                this.canvas.removeEventListener("pointerdown", this.onPointerDown);
                this.canvas.remove();
            }
        },
    );

    const layout = [
        EditorView.editorAttributes.of({ class: "cm-has-minimap" }),
        EditorView.theme({
            "&.cm-has-minimap .cm-content": { paddingRight: `${MINIMAP_WIDTH}px` },
        }),
    ];

    return [plugin, layout];
}
