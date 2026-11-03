/**
 * The all-changes view has three outcomes: loading, a read that failed, and a
 * clean tree. A failure used to render as "No local changes", which told the
 * user their working tree was clean when nothing had been read.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({ gitStatus: vi.fn() }));
const repos = vi.hoisted(() => ({ discoverGitRepos: vi.fn(), pickDefaultRepo: vi.fn() }));

vi.mock("@/lib/backend", () => ({ commands: backend, getProjectPath: () => "/repo" }));
vi.mock("@/lib/git/repos", () => repos);
vi.mock("@/features/editor/ui/diff/diff-view", () => ({ DiffView: () => null }));

import { MultiDiffEditor } from "@/features/agent/workspace/multi-diff";

let host: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
    // The file rows only render a diff once they scroll into view, which jsdom
    // does not model.
    vi.stubGlobal(
        "IntersectionObserver",
        class {
            observe() {}
            unobserve() {}
            disconnect() {}
            takeRecords() {
                return [];
            }
        },
    );
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    repos.discoverGitRepos.mockResolvedValue(["/repo"]);
    repos.pickDefaultRepo.mockReturnValue("/repo");
    backend.gitStatus.mockReset();
});

afterEach(() => {
    act(() => root?.unmount());
    host.remove();
    vi.clearAllMocks();
});

const render = async () => {
    await act(async () => {
        root?.render(<MultiDiffEditor projectPath="/repo" />);
    });
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
    });
};

it("shows the failure with a retry instead of claiming the tree is clean", async () => {
    backend.gitStatus.mockRejectedValueOnce(new Error("not a git repository"));
    await render();
    expect(host.textContent).toContain("Could not read changes");
    expect(host.textContent).toContain("not a git repository");
    expect(host.textContent).not.toContain("No local changes");
    expect(host.textContent).toContain("Retry");
});

it("recovers on retry", async () => {
    backend.gitStatus.mockRejectedValueOnce(new Error("index.lock"));
    await render();
    backend.gitStatus.mockResolvedValueOnce([{ path: "src/App.tsx", status: "M", staged: false }]);
    const retry = Array.from(host.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("Retry"),
    );
    if (!retry) throw new Error("retry button missing");
    await act(async () => {
        retry.click();
        await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(host.textContent).not.toContain("Could not read changes");
});

it("keeps the empty state for a repository with nothing to commit", async () => {
    backend.gitStatus.mockResolvedValueOnce([]);
    await render();
    expect(host.textContent).toContain("No local changes");
});
