import { act, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodeMirrorEditor } from "@/features/editor/ui/codemirror/editor";
import { updateSettingSection } from "@/lib/settings";

const backend = vi.hoisted(() => ({
    gitBlameFile: vi.fn(),
    markFileDirty: vi.fn(async () => undefined),
    saveFile: vi.fn(async () => undefined),
    readFile: vi.fn(async () => ""),
}));

vi.mock("@/lib/backend", () => ({
    commands: backend,
    getProjectPath: () => "/repo",
}));
vi.mock("@/features/editor/ui/codemirror/syntax-lint", () => ({ betterShapeSyntaxLinter: () => [] }));

let host: HTMLDivElement;
let root: Root | undefined;
const saved = { current: "a\nb\nc\n" };
const dirty = { current: false };
const version = { current: 0 };

beforeEach(() => {
    vi.clearAllMocks();
    backend.gitBlameFile.mockResolvedValue([
        { line: 1, line_count: 1, commit: "c1", author: "Grace", date: "1600000000", summary: "first" },
        { line: 2, line_count: 2, commit: "c2", author: "Ada", date: "1700000000", summary: "second" },
    ]);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root?.unmount());
    host.remove();
    // Inline blame is opt-in, so every test starts from the shipped default.
    updateSettingSection("git", { blame: { enabled: false } });
});

async function mountEditor() {
    await act(async () => {
        root?.render(
            <Suspense fallback={null}>
                <CodeMirrorEditor
                    path="/repo/a.ts"
                    content={"a\nb\nc\n"}
                    setContent={() => undefined}
                    savedContentRef={saved}
                    isDirtyRef={dirty}
                    bufferVersionRef={version}
                />
            </Suspense>,
        );
    });
    const element = host.querySelector(".cm-editor");
    if (!(element instanceof HTMLElement)) throw new Error("Editor did not mount");
    const view = EditorView.findFromDOM(element);
    if (!view) throw new Error("Editor view is missing");
    return view;
}

/** Lets the 150 ms fetch debounce fire and the promise chain settle. */
async function settle() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
    });
}

describe("inline blame in the editor", () => {
    it("shows the commit for the caret line once git answers", async () => {
        updateSettingSection("git", { blame: { enabled: true } });
        const view = await mountEditor();
        await settle();
        expect(backend.gitBlameFile).toHaveBeenCalledWith("/repo", "/repo/a.ts");
        // Caret starts on line 1, which belongs to Grace.
        expect(host.querySelector(".cm-inline-blame")?.textContent).toContain("Grace");
        act(() => {
            view.dispatch({ selection: { anchor: view.state.doc.line(2).to } });
        });
        expect(host.querySelector(".cm-inline-blame")?.textContent).toContain("Ada");
    });

    // The dock is narrower than most lines, so the in-document row is not
    // always on screen. The status bar carries the same label and is the copy a
    // reader can rely on, which makes the published detail part of the contract.
    it("publishes the caret line's blame to the status bar", async () => {
        updateSettingSection("git", { blame: { enabled: true } });
        const published: string[] = [];
        const listen = (event: Event) => {
            const detail = (event as CustomEvent<{ blame?: string }>).detail;
            if (typeof detail?.blame === "string") published.push(detail.blame);
        };
        window.addEventListener("bettershape-editor-status", listen);
        try {
            const view = await mountEditor();
            await settle();
            expect(published.at(-1)).toContain("Grace");
            act(() => {
                view.dispatch({ selection: { anchor: view.state.doc.line(3).to } });
            });
            expect(published.at(-1)).toContain("Ada");
        } finally {
            window.removeEventListener("bettershape-editor-status", listen);
        }
    });

    it("clears the status label when the setting is switched off", async () => {
        updateSettingSection("git", { blame: { enabled: true } });
        const published: string[] = [];
        const listen = (event: Event) => {
            const detail = (event as CustomEvent<{ blame?: string }>).detail;
            if (typeof detail?.blame === "string") published.push(detail.blame);
        };
        window.addEventListener("bettershape-editor-status", listen);
        try {
            await mountEditor();
            await settle();
            expect(published.at(-1)).toContain("Grace");
            act(() => updateSettingSection("git", { blame: { enabled: false } }));
            expect(published.at(-1)).toBe("");
        } finally {
            window.removeEventListener("bettershape-editor-status", listen);
        }
    });

    // `git_blame_file` reads the file on disk, so blaming a dirty buffer would
    // annotate shifted lines. The annotation waits for the save instead.
    it("waits for a save before blaming a buffer with unsaved edits", async () => {
        updateSettingSection("git", { blame: { enabled: true } });
        dirty.current = true;
        try {
            await mountEditor();
            await settle();
            expect(backend.gitBlameFile).not.toHaveBeenCalled();
            expect(host.querySelector(".cm-inline-blame")).toBeNull();

            dirty.current = false;
            act(() => {
                window.dispatchEvent(new CustomEvent("bettershape-file-saved", { detail: { path: "/repo/a.ts" } }));
            });
            await settle();
            expect(backend.gitBlameFile).toHaveBeenCalledTimes(1);
            expect(host.querySelector(".cm-inline-blame")?.textContent).toContain("Grace");
        } finally {
            dirty.current = false;
        }
    });

    it("keeps the published label through an unrelated settings change", async () => {
        updateSettingSection("git", { blame: { enabled: true } });
        const published: string[] = [];
        const listen = (event: Event) => {
            const detail = (event as CustomEvent<{ blame?: string }>).detail;
            if (typeof detail?.blame === "string") published.push(detail.blame);
        };
        window.addEventListener("bettershape-editor-status", listen);
        try {
            await mountEditor();
            await settle();
            expect(published.at(-1)).toContain("Grace");
            const before = published.length;
            // Rebuilding the reporter would blank the segment and refetch.
            act(() => updateSettingSection("editor", { tabSize: 2 }));
            expect(published.slice(before)).not.toContain("");
        } finally {
            window.removeEventListener("bettershape-editor-status", listen);
        }
    });

    it("stays out of the way when the setting is off", async () => {
        await mountEditor();
        await settle();
        expect(backend.gitBlameFile).not.toHaveBeenCalled();
        expect(host.querySelector(".cm-inline-blame")).toBeNull();
    });
});
