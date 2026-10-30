import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
    gitListHunks: vi.fn(),
    gitStageHunk: vi.fn(),
    gitUnstageHunk: vi.fn(),
    gitRestoreHunk: vi.fn(),
}));

vi.mock("@/lib/backend/commands", () => ({ commands: backend }));
vi.mock("@/features/notifications", () => ({ notify: { error: vi.fn() } }));

import { useFileHunks, type HunkMode } from "@/features/git/ui/shared/hunk-actions";
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

function Harness({ repoPath, filePath, mode = "unstaged", onApi }: Props) {
    const value = useFileHooks(repoPath, filePath, mode);
    // Publishing from an effect keeps the render pure and still runs inside act().
    useEffect(() => {
        onApi(value);
    });
    return null;
}

const useFileHooks = (repoPath: string | null, filePath: string, mode: HunkMode) =>
    useFileHunks(repoPath, filePath, mode);

async function mount(props: Omit<Props, "onApi">) {
    await act(async () => {
        root?.render(<Harness {...props} onApi={(value) => { api = value; }} />);
    });
}

describe("hunk actions", () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
