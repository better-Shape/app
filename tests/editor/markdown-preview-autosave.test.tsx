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

const live = vi.hoisted(() => ({ onchange: null as null | ((next: string) => void) }));

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
    MarkdownLiveEditor: ({ onChange }: { onChange: (next: string) => void }) => {
        live.onchange = onChange;
        return null;
    },
}));
vi.mock("@/features/editor/ui/markdown/markdown", () => ({ MarkdownPreview: () => null }));
vi.mock("@/features/panels", () => ({ Panel: () => null }));
vi.mock("@/lib/workspace/dirty-buffers", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/workspace/dirty-buffers")>();
    return { ...actual, stageDirtyBuffer: () => undefined, saveDirtyBuffer: () => undefined };
});

import FileViewer from "@/features/editor/ui/main/editor";
import { updateSettingSection } from "@/lib/settings";

let host: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
    live.onchange = null;
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
