import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
    gitListHunks: vi.fn(),
    gitStageHunk: vi.fn(),
    gitUnstageHunk: vi.fn(),
    gitRestoreHunk: vi.fn(),
}));

const dialog = vi.hoisted(() => ({ ask: vi.fn(async () => true) }));

vi.mock("@/lib/backend/commands", () => ({ commands: backend }));
vi.mock("@/features/notifications", () => ({ notify: { error: vi.fn() } }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: dialog.ask }));

import { HunkActions, useFileHunks, type HunkMode } from "@/features/git/ui/shared/hunk-actions";
import { notify } from "@/features/notifications";
import type { GitHunk } from "@/lib/backend/types";

const hunk = (index: number): GitHunk => ({
    index,
    header: `@@ -${index},1 +${index},1 @@`,
    oldStart: index,
    oldLines: 1,
    newStart: index,
    newLines: 1,
    lines: [],
});

const hunkList = (...indexes: number[]) => ({
    path: "a.ts",
    staged: false,
    hunks: indexes.map(hunk),
});

type Api = ReturnType<typeof useFileHunks>;
type Props = { repoPath: string | null; filePath: string; mode?: HunkMode; onApi: (api: Api) => void };

let api: Api;
let root: Root | null = null;
let host: HTMLDivElement;

const Harness = ({ repoPath, filePath, mode = "unstaged", onApi }: Props) => {
    const value = useFileHunks(repoPath, filePath, mode);
    // Publishing from an effect keeps the render pure and still runs inside act().
    useEffect(() => {
        onApi(value);
    });
    return null;
}

const mount = async (props: Omit<Props, "onApi">) => {
    await act(async () => {
        root?.render(<Harness {...props} onApi={(value) => { api = value; }} />);
    });
}

describe("hunk actions", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dialog.ask.mockResolvedValue(true);
        backend.gitStageHunk.mockResolvedValue(undefined);
        backend.gitUnstageHunk.mockResolvedValue(undefined);
        backend.gitRestoreHunk.mockResolvedValue(undefined);
        host = document.createElement("div");
        document.body.append(host);
        root = createRoot(host);
    });

    afterEach(() => {
        act(() => root?.unmount());
        root = null;
        host.remove();
    });

    it("stages, unstages and restores the hunk that is on screen", async () => {
        backend.gitListHunks.mockResolvedValue(hunkList(3, 7));
        await mount({ repoPath: "/repo", filePath: "a.ts" });
        expect(api.hunks).toHaveLength(2);

        act(() => api.step(1));
        expect(api.index).toBe(1);

        await act(async () => {
            await api.apply("stage");
        });
        expect(backend.gitStageHunk).toHaveBeenCalledWith("/repo", "a.ts", 7);

        await act(async () => {
            await api.apply("unstage");
        });
        expect(backend.gitUnstageHunk).toHaveBeenCalledWith("/repo", "a.ts", 7);

        await act(async () => {
            await api.apply("restore");
        });
        expect(backend.gitRestoreHunk).toHaveBeenCalledWith("/repo", "a.ts", 7);
    });

    it("asks before it throws a hunk's changes away, and listens to the answer", async () => {
        backend.gitListHunks.mockResolvedValue(hunkList(3));
        await mount({ repoPath: "/repo", filePath: "a.ts" });

        dialog.ask.mockResolvedValueOnce(false);
        await act(async () => {
            await api.apply("restore");
        });
        expect(dialog.ask).toHaveBeenCalledTimes(1);
        expect(backend.gitRestoreHunk).not.toHaveBeenCalled();

        dialog.ask.mockResolvedValueOnce(true);
        await act(async () => {
            await api.apply("restore");
        });
        expect(backend.gitRestoreHunk).toHaveBeenCalledWith("/repo", "a.ts", 3);
    });

    it("keeps a stage from asking, since a second press reverses it", async () => {
        backend.gitListHunks.mockResolvedValue(hunkList(3));
        await mount({ repoPath: "/repo", filePath: "a.ts" });

        await act(async () => {
            await api.apply("stage");
        });

        expect(dialog.ask).not.toHaveBeenCalled();
        expect(backend.gitStageHunk).toHaveBeenCalledWith("/repo", "a.ts", 3);
    });

    it("blocks actions until the list after a mutation has arrived", async () => {
        let resolveRefresh = () => {};
        backend.gitListHunks
            .mockResolvedValueOnce(hunkList(3, 7))
            .mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = () => resolve(hunkList(7)); }));
        await mount({ repoPath: "/repo", filePath: "a.ts" });
        expect(api.hunks).toHaveLength(2);

        await act(async () => {
            await api.apply("stage");
        });
        // The old list is still on screen, but its indexes no longer address it.
        expect(api.loading).toBe(true);
        act(() => api.step(1));
        await act(async () => {
            await api.apply("stage");
        });
        expect(backend.gitStageHunk).toHaveBeenCalledTimes(1);

        await act(async () => {
            resolveRefresh();
            // Let the resolved list reach the state update before asserting.
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(api.loading).toBe(false);
    });

    it("refuses a restore whose hunk list reloaded while the dialog was open", async () => {
        let answer = () => {};
        dialog.ask.mockImplementationOnce(
            () => new Promise<boolean>((resolve) => { answer = () => resolve(true); }),
        );
        backend.gitListHunks.mockResolvedValue(hunkList(3, 7));
        await mount({ repoPath: "/repo", filePath: "a.ts" });
        act(() => api.step(1));
        expect(api.index).toBe(1);

        let restore: Promise<void> = Promise.resolve();
        await act(async () => {
            restore = api.apply("restore");
            await Promise.resolve();
        });

        // Another pane's refresh lands while the question is still up, and the
        // change at position 1 is now a different hunk.
        backend.gitListHunks.mockResolvedValue(hunkList(9, 11));
        await act(async () => {
            window.dispatchEvent(new Event("bettershape-git-refresh"));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        await act(async () => {
            answer();
            await restore;
        });

        // The captured index would have thrown away a hunk the dialog never named.
        expect(backend.gitRestoreHunk).not.toHaveBeenCalled();
        expect(notify.error).toHaveBeenCalled();
    });

    it("refuses a restore when a different change took the same index", async () => {
        // Same position, same range, different lines: a reloaded diff where the
        // only thing that changed is what the hunk holds.
        const withBody = (index: number, content: string): GitHunk => ({
            ...hunk(index),
            lines: [{ type: "add", content }],
        });
        let answer = () => {};
        dialog.ask.mockImplementationOnce(
            () => new Promise<boolean>((resolve) => { answer = () => resolve(true); }),
        );
        backend.gitListHunks.mockResolvedValue({ path: "a.ts", staged: false, hunks: [withBody(3, "new line")] });
        await mount({ repoPath: "/repo", filePath: "a.ts" });

        let restore: Promise<void> = Promise.resolve();
        await act(async () => {
            restore = api.apply("restore");
            await Promise.resolve();
        });
        backend.gitListHunks.mockResolvedValue({ path: "a.ts", staged: false, hunks: [withBody(3, "other line")] });
        await act(async () => {
            window.dispatchEvent(new Event("bettershape-git-refresh"));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        await act(async () => {
            answer();
            await restore;
        });

        expect(backend.gitRestoreHunk).not.toHaveBeenCalled();
        expect(notify.error).toHaveBeenCalled();
    });

    it("never shows or acts on a hunk list read for another file", async () => {
        backend.gitListHunks.mockImplementation((_repo: string, filePath: string) =>
            filePath === "a.ts" ? Promise.resolve(hunkList(3)) : new Promise(() => {}),
        );
        await mount({ repoPath: "/repo", filePath: "a.ts" });
        expect(api.hunks).toHaveLength(1);

        await mount({ repoPath: "/repo", filePath: "b.ts" });
        // The previous file's index would address a different diff here.
        expect(api.hunks).toHaveLength(0);
        expect(api.loading).toBe(true);

        await act(async () => {
            await api.apply("stage");
        });
        expect(backend.gitStageHunk).not.toHaveBeenCalled();
    });
});

describe("hunk keyboard shortcuts", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        backend.gitStageHunk.mockResolvedValue(undefined);
        backend.gitListHunks.mockResolvedValue(hunkList(1, 2));
        host = document.createElement("div");
        document.body.append(host);
        root = createRoot(host);
    });

    afterEach(() => {
        act(() => root?.unmount());
        root = null;
        host.remove();
    });

    const press = (key: string, target: EventTarget, shift = false) =>
        act(() => {
            target.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: true, shiftKey: shift, bubbles: true }));
        });

    it("stages the hunk on screen for Ctrl+Y", async () => {
        await act(async () => {
            root?.render(<HunkActions repoPath="/repo" filePath="a.ts" mode="unstaged" active />);
        });
        await act(async () => {
            await Promise.resolve();
        });
        press("y", document.body);
        await act(async () => {
            await Promise.resolve();
        });
        expect(backend.gitStageHunk).toHaveBeenCalledWith("/repo", "a.ts", 1);
    });

    it("leaves a redo inside a text field alone", async () => {
        await act(async () => {
            root?.render(<HunkActions repoPath="/repo" filePath="a.ts" mode="unstaged" active />);
        });
        await act(async () => {
            await Promise.resolve();
        });
        // The handler listens on the window, so a Ctrl+Y typed in an input has to
        // stay that input's redo.
        const field = document.createElement("input");
        document.body.append(field);
        try {
            press("y", field);
            await act(async () => {
                await Promise.resolve();
            });
            expect(backend.gitStageHunk).not.toHaveBeenCalled();
        } finally {
            field.remove();
        }
    });
});
