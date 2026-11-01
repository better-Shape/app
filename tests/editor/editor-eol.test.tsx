/**
 * A save must keep the line ending the file already had. The editor used to seed
 * its line ending from the Settings default alone, so a CRLF file saved under the
 * LF default was rewritten with LF on every line.
 */
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createEditorHarness, type EditorHarness } from "../helpers/editor-harness";
import { resetSettings, updateSettingSection } from "@/lib/settings";

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

let harness: EditorHarness;
let reported: Array<{ eol?: string }> = [];

const listen = (event: Event) => {
    const detail = (event as CustomEvent<{ eol?: string }>).detail;
    if (detail?.eol) reported.push({ eol: detail.eol });
};

beforeEach(() => {
    resetSettings();
    reported = [];
    window.addEventListener("bettershape-editor-status", listen);
    harness = createEditorHarness();
});

afterEach(() => {
    window.removeEventListener("bettershape-editor-status", listen);
    harness.unmount();
    resetSettings();
});

it("reports the CRLF the file was loaded with, not the LF default", async () => {
    updateSettingSection("files", { defaultEol: "LF" });
    const view = await harness.mount("one\ntwo", "one\r\ntwo");
    expect(view.state.lineBreak).toBe("\r\n");
    expect(reported.at(-1)).toEqual({ eol: "CRLF" });
});

it("takes the ending of a file that loads after the editor opened", async () => {
    updateSettingSection("files", { defaultEol: "LF" });
    // The first open starts empty; the read lands afterwards.
    await harness.mount("", "");
    const view = harness.view();
    await act(async () => {
        await harness.render("one\r\ntwo", "one\r\ntwo");
    });
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        view.dom.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(view.state.lineBreak).toBe("\r\n");
    expect(reported.at(-1)).toEqual({ eol: "CRLF" });
});

it("reports LF for an LF file even when the default is CRLF", async () => {
    updateSettingSection("files", { defaultEol: "CRLF" });
    const view = await harness.mount("one\ntwo", "one\ntwo");
    expect(view.state.lineBreak).toBe("\n");
    expect(reported.at(-1)).toEqual({ eol: "LF" });
});

it("takes the ending of a refreshed file whose text is otherwise unchanged", async () => {
    await harness.mount("one\ntwo", "one\ntwo");
    await act(async () => {
        // The file was rewritten on disk with CRLF while the buffer kept LF.
        await harness.render("one\r\ntwo", "one\r\ntwo");
        await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(harness.view().state.lineBreak).toBe("\r\n");
});

it("marks a clean file unsaved when the ending is changed", async () => {
    await harness.mount("one\ntwo", "one\ntwo");
    expect(harness.refs.dirty.current).toBe(false);
    await act(async () => {
        window.dispatchEvent(
            new CustomEvent("bettershape-editor-action", { detail: { action: "setEol", value: "CRLF" } }),
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
    // The conversion only reaches the disk through a save, so the file is dirty.
    expect(harness.refs.dirty.current).toBe(true);
    expect(backend.markFileDirty).toHaveBeenCalledWith("/repo/file.txt", true);
});

it("keeps an ending the user picked before the file finished loading", async () => {
    updateSettingSection("files", { defaultEol: "LF" });
    // Pick the ending that already matches the provisional default, while the
    // buffer is still empty and the read is in flight.
    await harness.mount("", "");
    await act(async () => {
        window.dispatchEvent(
            new CustomEvent("bettershape-editor-action", { detail: { action: "setEol", value: "LF" } }),
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await act(async () => {
        await harness.render("one\r\ntwo", "one\r\ntwo");
        await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const view = harness.view();
    // The explicit choice wins over the ending the file turned out to have.
    expect(view.state.lineBreak).toBe("\n");
});

it("writes the file's own ending on a save and keeps it in the baseline", async () => {
    const view = await harness.mount("one\ntwo", "one\r\ntwo");
    harness.refs.dirty.current = true;
    await act(async () => {
        view.contentDOM.dispatchEvent(
            new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }),
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(backend.saveFile).toHaveBeenCalledWith("/repo/file.txt", "one\r\ntwo\r\n");
    // The preview reads its ending from this ref, so it has to keep the disk one.
    expect(harness.refs.saved.current).toBe("one\r\ntwo\r\n");
});

it("takes the ending a menu save used, not the one the picker holds now", async () => {
    updateSettingSection("files", { defaultEol: "LF" });
    await harness.mount("one\ntwo", "one\ntwo");
    // An outside save wrote CRLF bytes while this editor is on LF: the file and
    // the picker disagree, so the buffer stays dirty for a rewrite in LF.
    await act(async () => {
        window.dispatchEvent(
            new CustomEvent("bettershape-buffer-saved", {
                detail: { path: "/repo/file.txt", submitted: "one\ntwo", content: "one\ntwo", eol: "CRLF" },
            }),
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
    // The baseline has to be the bytes the disk got, or the next save compares
    // against an ending the file never had.
    expect(harness.refs.saved.current).toBe("one\r\ntwo");
    expect(harness.refs.dirty.current).toBe(true);
});

it("clears the buffer when a menu save used the ending it holds", async () => {
    updateSettingSection("files", { defaultEol: "LF" });
    await harness.mount("one\ntwo", "one\ntwo");
    await act(async () => {
        window.dispatchEvent(
            new CustomEvent("bettershape-buffer-saved", {
                detail: { path: "/repo/file.txt", submitted: "one\ntwo", content: "one\ntwo", eol: "LF" },
            }),
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(harness.refs.saved.current).toBe("one\ntwo");
    expect(harness.refs.dirty.current).toBe(false);
});

it("keeps the buffer dirty when the ending changes while its save is in flight", async () => {
    updateSettingSection("files", { defaultEol: "CRLF" });
    updateSettingSection("editor", { autoSave: "afterDelay", autoSaveDelay: 0 });
    const view = await harness.mount("one\r\ntwo", "one\r\ntwo");
    let release!: () => void;
    // The editor never autosaves sooner than 250 ms, so this waits past that
    // instead of guessing, and clears the history so an earlier test's write
    // cannot stand in for this one.
    backend.saveFile.mockClear();
    backend.saveFile.mockReturnValueOnce(
        new Promise<undefined>((resolve) => {
            release = () => resolve(undefined);
        }),
    );
    await act(async () => {
        view.dispatch({ changes: { from: 0, insert: "x" } });
        await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(backend.saveFile).toHaveBeenCalledTimes(1);
    expect((backend.saveFile.mock.calls[0] as unknown as [string, string])[1]).toContain("\r\n");
    // The write is in flight when the picker switches the file to LF.
    await act(async () => {
        window.dispatchEvent(
            new CustomEvent("bettershape-editor-action", { detail: { action: "setEol", value: "LF" } }),
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await act(async () => {
        release();
        await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(view.state.lineBreak).toBe("\n");
    // The disk got CRLF bytes for older text: the LF buffer is not saved over them.
    expect(harness.refs.saved.current).toContain("\r\n");
    expect(harness.refs.dirty.current).toBe(true);
    updateSettingSection("editor", { autoSave: "off" });
});

it("marks the file dirty when a chosen ending and a late load disagree", async () => {
    updateSettingSection("files", { defaultEol: "LF" });
    await harness.mount("", "");
    await act(async () => {
        window.dispatchEvent(
            new CustomEvent("bettershape-editor-action", { detail: { action: "setEol", value: "LF" } }),
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
    backend.markFileDirty.mockClear();
    // The file turns out to be CRLF. The chosen LF has to reach the disk, which
    // starts with the buffer reading as dirty against the CRLF bytes on it.
    await act(async () => {
        await harness.render("one\r\ntwo", "one\r\ntwo");
        await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(harness.refs.dirty.current).toBe(true);
    expect(backend.markFileDirty).toHaveBeenCalledWith("/repo/file.txt", true);
});
