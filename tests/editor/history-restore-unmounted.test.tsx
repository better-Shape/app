/**
 * A history restore that lands after the editor unmounted for a view change:
 * the picker answered a promise the old editor started, so there is no view to
 * dispatch into. The text still has to reach the file.
 */
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createEditorHarness, type EditorHarness } from "../helpers/editor-harness";
import { resetSettings } from "@/lib/settings";
import { clearDirtyBuffer, loadDirtyBuffer, stageDirtyBuffer } from "@/lib/workspace/dirty-buffers";

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

const picker = vi.hoisted(() => ({ restore: null as null | ((next: string) => void) }));

vi.mock("@/features/editor/ui/local-history-picker", () => ({
    LocalHistoryPicker: ({ onRestore }: { onRestore: (next: string) => void }) => {
        picker.restore = onRestore;
        return null;
    },
}));

let harness: EditorHarness;

beforeEach(() => {
    resetSettings();
    picker.restore = null;
    backend.saveFile.mockClear();
    harness = createEditorHarness();
});

afterEach(() => {
    harness.unmount();
    clearDirtyBuffer("/repo/file.txt");
    resetSettings();
});

it("writes a restore that arrives after the editor unmounted", async () => {
    await harness.mount("current text", "current text");
    if (!picker.restore) throw new Error("history picker did not mount");
    harness.unmount();
    // The revision list resolved after the view went away.
    await act(async () => {
        picker.restore?.("restored text");
        await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const written = backend.saveFile.mock.calls.map((call) => call as unknown as [string, string]);
    expect(written.at(-1)).toEqual(["/repo/file.txt", "restored text\n"]);
});

it("keeps a newer recovery draft when the restore lands unmounted", async () => {
    await harness.mount("current text", "current text");
    if (!picker.restore) throw new Error("history picker did not mount");
    // The closing editor left unsaved edits in recovery; the restore must not
    // replace them, or a failed write costs those edits on reopen.
    stageDirtyBuffer("/repo/file.txt", "newer unsaved edit", "current text");
    harness.unmount();
    await act(async () => {
        picker.restore?.("restored text");
        await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(loadDirtyBuffer("/repo/file.txt")?.content).toBe("newer unsaved edit");
});
