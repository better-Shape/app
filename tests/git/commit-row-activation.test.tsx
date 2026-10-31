import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const backend = vi.hoisted(() => ({
    gitCommitFiles: vi.fn(async () => []),
    gitRemoteUrl: vi.fn(async () => null),
    openUrlExternal: vi.fn(async () => undefined),
}));

vi.mock("@/lib/backend", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/backend")>();
    return { ...actual, commands: { ...actual.commands, ...backend } };
});

vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: vi.fn(async () => true) }));

import { GraphCommitRow } from "@/features/git/ui/graph/commit-row";
import type { GitLogEntry, GraphNode } from "@/lib/backend/types";

const LOG: GitLogEntry = {
    hash: "abc1234",
    message: "fix: sample commit",
    author: "BetterShape-Agent",
    author_email: "agent@example.com",
    date: "2026-10-31T00:00:00Z",
    files_changed: 1,
    insertions: 2,
    deletions: 1,
    refs: [],
    parent_count: 1,
    parents: ["def5678"],
};

const NODE: GraphNode = { lane: 0, color: "#6ea8fe", isMerge: false, paths: [] };

let container: HTMLDivElement;
let root: Root;
let onSelect: Mock<(hash: string) => void>;
let onToggleExpand: Mock<(hash: string) => void>;

const render = (isExpanded = false, filesLoaded = false) => {
    act(() => {
        root.render(
            <GraphCommitRow
                log={LOG}
                node={NODE}
                repoPath="/repo"
                index={0}
                total={1}
                isExpanded={isExpanded}
                onToggleExpand={onToggleExpand}
                onShowCommitDiff={vi.fn()}
                onOpenFile={vi.fn()}
                onRefresh={vi.fn()}
                files={[]}
                filesLoaded={filesLoaded}
                onFilesLoaded={vi.fn()}
                onSelect={onSelect}
            />,
        );
    });
};

const row = () => container.querySelector<HTMLElement>('[data-hash="abc1234"] [role="button"]')!;

beforeEach(() => {
    backend.gitCommitFiles.mockClear();
    onSelect = vi.fn<(hash: string) => void>();
    onToggleExpand = vi.fn<(hash: string) => void>();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

describe("commit row activation", () => {
    it("exposes the row as a focusable button with its expansion state", () => {
        render();
        expect(row().tabIndex).toBe(0);
        expect(row().getAttribute("aria-expanded")).toBe("false");
    });

    it("activates on click, Enter and Space, loading files on first open", () => {
        render();
        act(() => row().dispatchEvent(new MouseEvent("click", { bubbles: true })));
        expect(onSelect).toHaveBeenCalledWith("abc1234");
        expect(onToggleExpand).toHaveBeenCalledWith("abc1234");
        expect(backend.gitCommitFiles).toHaveBeenCalledWith("/repo", "abc1234");

        for (const key of ["Enter", " "]) {
            onSelect.mockClear();
            onToggleExpand.mockClear();
            const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
            act(() => row().dispatchEvent(event));
            expect(event.defaultPrevented).toBe(true);
            expect(onSelect).toHaveBeenCalledWith("abc1234");
            expect(onToggleExpand).toHaveBeenCalledWith("abc1234");
        }
    });

    it("does not reload files for an already loaded commit", () => {
        render(false, true);
        act(() => row().dispatchEvent(new MouseEvent("click", { bubbles: true })));
        expect(onSelect).toHaveBeenCalledWith("abc1234");
        expect(backend.gitCommitFiles).not.toHaveBeenCalled();
    });

    it("ignores unrelated keys", () => {
        render();
        const event = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
        act(() => row().dispatchEvent(event));
        expect(event.defaultPrevented).toBe(false);
        expect(onSelect).not.toHaveBeenCalled();
    });
});
