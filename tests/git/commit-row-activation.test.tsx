import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const backend = vi.hoisted(() => ({
    gitCommitFiles: vi.fn<() => Promise<unknown>>(async () => []),
    gitRemoteUrl: vi.fn(async () => null),
    openUrlExternal: vi.fn(async () => undefined),
}));

vi.mock("@/lib/backend", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/backend")>();
    return { ...actual, commands: { ...actual.commands, ...backend } };
});

vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: vi.fn(async () => true) }));

import { GraphCommitRow } from "@/features/git/ui/graph/commit-row";
import type { RefInfo } from "@/features/git/ui/graph/ref-pill";
import type { GitFileParams, GitLogEntry, GraphNode } from "@/lib/backend/types";

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

type RenderOptions = {
    isExpanded?: boolean;
    filesLoaded?: boolean;
    log?: GitLogEntry;
    surface?: "panel" | "editor";
    onRefActivate?: (ref: RefInfo) => void;
    onFilesLoaded?: (hash: string, files: GitFileParams[]) => void;
};

let container: HTMLDivElement;
let root: Root;
let onSelect: Mock<(hash: string) => void>;
let onToggleExpand: Mock<(hash: string) => void>;

const renderRow = (options: RenderOptions = {}) => {
    act(() => {
        root.render(
            <GraphCommitRow
                log={options.log ?? LOG}
                node={NODE}
                repoPath="/repo"
                index={0}
                total={1}
                isExpanded={options.isExpanded ?? false}
                onToggleExpand={onToggleExpand}
                onShowCommitDiff={vi.fn()}
                onOpenFile={vi.fn()}
                onRefresh={vi.fn()}
                files={[]}
                filesLoaded={options.filesLoaded ?? false}
                onFilesLoaded={options.onFilesLoaded ?? vi.fn()}
                onSelect={onSelect}
                surface={options.surface}
                onRefActivate={options.onRefActivate}
            />,
        );
    });
};

const rowTrigger = (): HTMLButtonElement => {
    const trigger = container.querySelector<HTMLButtonElement>(
        '[data-hash="abc1234"] button[data-commit-row-trigger]',
    );
    if (!trigger) throw new Error("Missing commit row trigger button");
    return trigger;
};

beforeEach(() => {
    backend.gitCommitFiles.mockReset();
    backend.gitCommitFiles.mockResolvedValue([]);
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
    it("exposes the row as a focusable native button with its expansion state", () => {
        renderRow();
        expect(rowTrigger().tagName).toBe("BUTTON");
        expect(rowTrigger().tabIndex).toBe(0);
        expect(rowTrigger().getAttribute("aria-expanded")).toBe("false");
    });

    it("activates on click, Enter and Space, loading files on first open", () => {
        renderRow();
        act(() => {
            rowTrigger().dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(onSelect).toHaveBeenCalledWith("abc1234");
        expect(onToggleExpand).toHaveBeenCalledWith("abc1234");
        expect(backend.gitCommitFiles).toHaveBeenCalledWith("/repo", "abc1234");

        for (const key of ["Enter", " "]) {
            onSelect.mockClear();
            onToggleExpand.mockClear();
            const event = new KeyboardEvent("keydown", {
                key,
                bubbles: true,
                cancelable: true,
            });
            act(() => {
                rowTrigger().dispatchEvent(event);
            });
            expect(event.defaultPrevented).toBe(true);
            expect(onSelect).toHaveBeenCalledWith("abc1234");
            expect(onToggleExpand).toHaveBeenCalledWith("abc1234");
        }
    });

    it("keeps branch filter and hash buttons as siblings of the row button", () => {
        const onRefActivate = vi.fn<(ref: RefInfo) => void>();
        renderRow({
            log: { ...LOG, refs: ["HEAD -> main", "feature"] },
            surface: "editor",
            onRefActivate,
        });

        expect(rowTrigger().querySelectorAll('button, [role="button"]')).toHaveLength(0);

        const refButton = container.querySelector<HTMLButtonElement>(
            'button[aria-label="Filter graph to Branch: feature"]',
        );
        if (!refButton) throw new Error("Missing branch filter button");

        const enterEvent = new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
        });
        act(() => {
            refButton.dispatchEvent(enterEvent);
            refButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });

        expect(enterEvent.defaultPrevented).toBe(false);
        expect(onRefActivate).toHaveBeenCalledTimes(1);
        expect(onSelect).not.toHaveBeenCalled();
        expect(onToggleExpand).not.toHaveBeenCalled();
    });

    it("skips reload when already loaded and normalizes null IPC payloads", async () => {
        renderRow({ filesLoaded: true });
        act(() => {
            rowTrigger().dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(onSelect).toHaveBeenCalledWith("abc1234");
        expect(backend.gitCommitFiles).not.toHaveBeenCalled();

        const onFilesLoaded = vi.fn<(hash: string, files: GitFileParams[]) => void>();
        backend.gitCommitFiles.mockResolvedValueOnce(null);
        renderRow({ filesLoaded: false, onFilesLoaded });
        await act(async () => {
            rowTrigger().dispatchEvent(new MouseEvent("click", { bubbles: true }));
            await Promise.resolve();
        });
        expect(onFilesLoaded).toHaveBeenCalledWith("abc1234", []);
    });

    it("ignores unrelated keys", () => {
        renderRow();
        const event = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
        act(() => {
            rowTrigger().dispatchEvent(event);
        });
        expect(event.defaultPrevented).toBe(false);
        expect(onSelect).not.toHaveBeenCalled();
    });
});
