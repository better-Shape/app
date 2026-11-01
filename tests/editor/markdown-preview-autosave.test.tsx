/**
 * The Markdown preview schedules an autosave after an edit. The viewer stays
 * mounted while the file path changes, so a delay that had not elapsed used to
 * drop the timer and leave the text only in recovery.
 */
import { act, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
    saveFile: vi.fn(async () => undefined),
    readFile: vi.fn(async () => ""),
    markFileDirty: vi.fn(async () => undefined),
    gitBlameFile: vi.fn(async () => []),
    getCachedFileContent: vi.fn(async (path: string) => (path === "/repo/notes.md" ? "preview notes" : "other")),
    invalidateFileCache: vi.fn(),
    invalidateAllFileCaches: vi.fn(),
}));

const live = vi.hoisted(() => ({
    onchange: null as null | ((next: string) => void),
    content: "" as string,
}));

vi.mock("@/lib/backend", () => ({
    commands: backend,
    useProjectState: () => ({ project_path: "/repo", active_file: null, open_files: [] }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => undefined }));
vi.mock("@/lib/settings", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/settings")>();
    return { ...actual, useSettings: () => actual.getSettings() };
});
vi.mock("@/core/providers/editor", () => ({
    useEditorView: () => ({
        getBufferVersion: () => 0,
        subscribeBuffer: () => () => undefined,
        setViewMode: () => undefined,
        getViewMode: () => "preview",
        isViewModeSubscribed: false,
    }),
}));
vi.mock("@/features/editor/ui/main/ui/breadcrumb", () => ({ Breadcrumbs: () => null }));
vi.mock("@/features/editor/ui/main/ui/plan-editor-header", () => ({
    MarkdownViewSwitch: () => null,
    PlanEditorHeader: () => null,
}));
vi.mock("@/features/editor/ui/local-history-picker", () => ({ LocalHistoryPicker: () => null }));
vi.mock("@/features/editor/ui/markdown/live-editor", () => ({
    MarkdownLiveEditor: ({ content, onChange }: { content: string; onChange: (next: string) => void }) => {
        live.onchange = onChange;
        live.content = content;
        // Focusable, so a test can put the caret in the document editor.
        return <div data-testid="md-live" tabIndex={0} />;
    },
}));
vi.mock("@/features/editor/ui/markdown/markdown", () => ({ MarkdownPreview: () => null }));
vi.mock("@/features/panels", () => ({ Panel: () => null }));

import FileViewer from "@/features/editor/ui/main/editor";
import { updateSettingSection } from "@/lib/settings";
import { clearDirtyBuffer, saveDirtyBuffer } from "@/lib/workspace/dirty-buffers";
import { getActiveEditorSurface } from "@/lib/editor/editor-surface";

let host: HTMLDivElement;
let root: Root | undefined;
/** Unmounts through the same path the app uses, so the owner release runs. */
const harnessRelease = () => {
    act(() => root?.unmount());
    root = undefined;
};

beforeEach(() => {
    live.onchange = null;
    live.content = "";
    backend.saveFile.mockClear();
    updateSettingSection("editor", { autoSave: "afterDelay", autoSaveDelay: 5000 });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root?.unmount());
    host.remove();
    vi.clearAllMocks();
});

const render = async (path: string) => {
    await act(async () => {
        root?.render(
            <Suspense fallback={null}>
                <FileViewer path={path} />
            </Suspense>,
        );
    });
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
    });
};

it("writes a pending preview edit when the viewer switches files", async () => {
    await render("/repo/notes.md");
    if (!live.onchange) throw new Error("markdown editor did not mount");
    await act(async () => {
        live.onchange?.("edited before the switch");
    });
    // The 5 second delay has not elapsed when the path changes.
    await render("/repo/other.md");
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
    });
    const written = backend.saveFile.mock.calls.map((call) => call as unknown as [string, string]);
    const forNotes = written.find(([path]) => path === "/repo/notes.md");
    expect(forNotes?.[1]).toContain("edited before the switch");
});

it("adopts the text a menu save wrote over the preview buffer", async () => {
    await render("/repo/notes.md");
    if (!live.onchange) throw new Error("markdown editor did not mount");
    await act(async () => {
        live.onchange?.("typed text");
    });
    await act(async () => {
        window.dispatchEvent(
            new CustomEvent("bettershape-buffer-saved", {
                detail: { path: "/repo/notes.md", submitted: "typed text", content: "typed text\n" },
            }),
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
    });
    // Save All ran the pipeline over exactly this text, so the preview shows what
    // reached the disk instead of staying dirty against it.
    expect(live.content).toBe("typed text\n");
});

it("writes a dirty preview when the window loses focus and Auto Save is set to that", async () => {
    updateSettingSection("editor", { autoSave: "onFocusChange" });
    await render("/repo/notes.md");
    if (!live.onchange) throw new Error("markdown editor did not mount");
    await act(async () => {
        live.onchange?.("edited then blurred");
    });
    await act(async () => {
        window.dispatchEvent(new Event("blur"));
        await new Promise((resolve) => setTimeout(resolve, 100));
    });
    const written = backend.saveFile.mock.calls.map((call) => call as unknown as [string, string]);
    const forNotes = written.find(([path]) => path === "/repo/notes.md");
    expect(forNotes?.[1]).toContain("edited then blurred");
});

it("writes a dirty preview when focus leaves it for another control in the window", async () => {
    updateSettingSection("editor", { autoSave: "onFocusChange" });
    await render("/repo/notes.md");
    if (!live.onchange) throw new Error("markdown editor did not mount");
    await act(async () => {
        live.onchange?.("edited then moved focus");
    });
    const inner = host.querySelector('[data-testid="md-live"]');
    if (!(inner instanceof HTMLElement)) throw new Error("document editor did not mount");
    // The code editor saves from CodeMirror's blur facet, which fires when the
    // caret moves to any other control; the preview answered only the window's.
    const away = document.createElement("button");
    document.body.appendChild(away);
    await act(async () => {
        inner.focus();
        away.focus();
        await new Promise((resolve) => setTimeout(resolve, 100));
    });
    away.remove();
    const written = backend.saveFile.mock.calls.map((call) => call as unknown as [string, string]);
    const forNotes = written.find(([path]) => path === "/repo/notes.md");
    expect(forNotes?.[1]).toContain("edited then moved focus");
});

it("keeps the pending edit when Auto Save is switched off before the switch", async () => {
    await render("/repo/notes.md");
    if (!live.onchange) throw new Error("markdown editor did not mount");
    await act(async () => {
        live.onchange?.("edited before the switch");
    });
    updateSettingSection("editor", { autoSave: "off" });
    await render("/repo/other.md");
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
    });
    const written = backend.saveFile.mock.calls.map((call) => call as unknown as [string, string]);
    expect(written.some(([path]) => path === "/repo/notes.md")).toBe(false);
});

it("does not clear a newer buffer's dirty marker when the unmounted write lands", async () => {
    await render("/repo/notes.md");
    if (!live.onchange) throw new Error("markdown editor did not mount");
    await act(async () => {
        live.onchange?.("edited before closing");
    });
    let settle!: () => void;
    const write = new Promise<undefined>((resolve) => {
        settle = () => resolve(undefined);
    });
    backend.saveFile.mockReturnValueOnce(write);
    await act(async () => {
        root?.unmount();
        root = undefined;
    });
    // The file came back and was edited again while the write was in flight.
    saveDirtyBuffer("/repo/notes.md", "newer text", "edited before closing");
    await act(async () => {
        settle();
        await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(backend.markFileDirty).not.toHaveBeenCalledWith("/repo/notes.md", false);
    clearDirtyBuffer("/repo/notes.md");
});

it("claims the document surface when the document editor takes focus", async () => {
    await render("/repo/notes.md");
    const inner = host.querySelector('[data-testid="md-live"]');
    if (!(inner instanceof HTMLElement)) throw new Error("document editor did not mount");
    await act(async () => {
        inner.focus();
    });
    // The command palette asks this before it offers a file-editor command.
    expect(getActiveEditorSurface()).toBe("document");
    // The viewer releases on unmount, so nothing is left claimed for another pane.
    harnessRelease();
    expect(getActiveEditorSurface()).toBeNull();
});
