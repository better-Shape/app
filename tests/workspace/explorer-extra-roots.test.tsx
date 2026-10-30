import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileTree } from "@/features/agent/workspace/tree";

const FOLDERS_KEY = "bettershape-workspace-folders";

const backend = vi.hoisted(() => ({
    lsDir: vi.fn(async (path: string) => {
        if (path === "/repo") {
            return [{ name: "src", path: "/repo/src", is_dir: true, is_symlink: false }];
        }
        return [{ name: "shared.ts", path: "/shared/shared.ts", is_dir: false, is_symlink: false }];
    }),
    gitStatus: vi.fn(async () => []),
    readFile: vi.fn(async () => ""),
    writeFile: vi.fn(async () => undefined),
    createFile: vi.fn(async () => undefined),
    createDir: vi.fn(async () => undefined),
    renamePath: vi.fn(async () => undefined),
    deletePath: vi.fn(async () => undefined),
}));

vi.mock("@/lib/backend", () => ({ commands: backend }));

let host: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
    localStorage.clear();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root?.unmount());
    host.remove();
    localStorage.clear();
});

async function renderTree() {
    await act(async () => {
        root?.render(<FileTree projectPath="/repo" activePath={null} onOpenFile={() => undefined} />);
    });
    await act(async () => {
        await Promise.resolve();
    });
}

describe("explorer extra workspace roots", () => {
    it("lists a folder added to the workspace, and its files", async () => {
        localStorage.setItem(FOLDERS_KEY, JSON.stringify(["/shared"]));
        await renderTree();

        expect(backend.lsDir).toHaveBeenCalledWith("/shared");
        expect(host.textContent).toContain("shared");
        expect(host.textContent).toContain("shared.ts");
        // The primary project still renders alongside it.
        expect(host.textContent).toContain("src");
    });

    it("drops the row when the folder is removed", async () => {
        localStorage.setItem(FOLDERS_KEY, JSON.stringify(["/shared"]));
        await renderTree();

        const remove = host.querySelector<HTMLButtonElement>(
            'button[aria-label="Remove shared from the workspace"]',
        );
        expect(remove).not.toBeNull();
        await act(async () => {
            remove?.click();
        });
        await act(async () => {
            await Promise.resolve();
        });

        expect(JSON.parse(localStorage.getItem(FOLDERS_KEY) ?? "[]")).toEqual([]);
        expect(host.textContent).not.toContain("shared.ts");
    });

    it("shows the reason a folder could not be read instead of failing the tree", async () => {
        localStorage.setItem(FOLDERS_KEY, JSON.stringify(["/broken"]));
        backend.lsDir.mockImplementationOnce(async (path: string) => {
            if (path === "/broken") throw new Error("Permission denied");
            return [{ name: "src", path: "/repo/src", is_dir: true, is_symlink: false }];
        });
        await renderTree();
        expect(host.textContent).toContain("Permission denied");
        expect(host.textContent).toContain("src");
    });
});
