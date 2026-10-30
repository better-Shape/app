import { act, Suspense } from "react";
import { EditorView } from "@codemirror/view";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodeMirrorEditor } from "@/features/editor/ui/codemirror/editor";
import { updateSettingSection } from "@/lib/settings";

const backend = vi.hoisted(() => ({
    gitBlameFile: vi.fn(async () => []),
    markFileDirty: vi.fn(async () => undefined),
    saveFile: vi.fn(async () => undefined),
    readFile: vi.fn(async () => ""),
}));

vi.mock("@/lib/backend", () => ({
    commands: backend,
    getProjectPath: () => "/repo",
}));
vi.mock("@/features/editor/ui/codemirror/syntax-lint", () => ({ betterShapeSyntaxLinter: () => [] }));

const SOURCE = ["function a() {", "  if (x) {", "    return 1;", "  }", "}"].join("\n");
const saved = { current: SOURCE };
const dirty = { current: false };
const version = { current: 0 };

let host: HTMLDivElement;
let root: Root | undefined;
let events: Array<{ spaces?: number; insertSpaces?: boolean }> = [];

const listen = (event: Event) => {
    const detail = (event as CustomEvent<{ spaces?: number; insertSpaces?: boolean }>).detail;
    if (typeof detail?.spaces === "number") events.push({ spaces: detail.spaces, insertSpaces: detail.insertSpaces });
};

beforeEach(() => {
    events = [];
    window.addEventListener("bettershape-editor-status", listen);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
});

afterEach(() => {
    window.removeEventListener("bettershape-editor-status", listen);
    act(() => root?.unmount());
    host.remove();
    updateSettingSection("editor", { detectIndentation: true, tabSize: 4, insertSpaces: true });
});

async function mount() {
    await act(async () => {
        root?.render(
            <Suspense fallback={null}>
                <CodeMirrorEditor
                    path="/repo/a.ts"
                    content={SOURCE}
                    setContent={() => undefined}
                    savedContentRef={saved}
                    isDirtyRef={dirty}
                    bufferVersionRef={version}
                />
            </Suspense>,
        );
    });
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
    });
    const element = host.querySelector(".cm-editor");
    if (!(element instanceof HTMLElement)) throw new Error("Editor did not mount");
    const view = EditorView.findFromDOM(element);
    if (!view) throw new Error("Editor view is missing");
    // The status report is published on focus (and on every update while the
    // editor has focus), so a headless test has to say it has focus.
    await act(async () => {
        view.dom.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
}

describe("editor indentation", () => {
    it("matches the buffer when Detect indentation is on", async () => {
        updateSettingSection("editor", { detectIndentation: true, tabSize: 4, insertSpaces: true });
        await mount();
        expect(host.querySelector(".cm-editor"), "editor did not mount").not.toBeNull();
        expect(events.at(-1)).toEqual({ spaces: 2, insertSpaces: true });
    });

    it("keeps the configured tab size when Detect indentation is off", async () => {
        updateSettingSection("editor", { detectIndentation: false, tabSize: 4, insertSpaces: true });
        await mount();
        expect(events.at(-1)).toEqual({ spaces: 4, insertSpaces: true });
    });
});
