import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
    setExtraWorkspaceFolders: vi.fn(async (_folders: string[]) => undefined),
}));

vi.mock("@/lib/backend", () => ({ commands: backend }));

const STORAGE_KEY = "bettershape-workspace-folders";

async function loadModule() {
    // The module reads `localStorage` at call time, so a fresh import per test
    // keeps the module-level `initialSynced` flag from leaking between them.
    vi.resetModules();
    return import("@/lib/workspace/folders");
}

beforeEach(() => {
    localStorage.clear();
    backend.setExtraWorkspaceFolders.mockClear();
    backend.setExtraWorkspaceFolders.mockResolvedValue(undefined);
});

afterEach(() => {
    localStorage.clear();
});

describe("workspace folders", () => {
    it("normalises separators and trailing slashes on write", async () => {
        const { setExtraWorkspaceFolders } = await loadModule();
        setExtraWorkspaceFolders(["C:\\work\\shared\\", "/home/me/lib//"]);

        expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")).toEqual([
            "C:/work/shared",
            "/home/me/lib",
        ]);
    });

    it("stores each folder once even when it is added twice", async () => {
        const { addWorkspaceFolder, getExtraWorkspaceFolders } = await loadModule();
        addWorkspaceFolder("/home/me/lib");
        addWorkspaceFolder("/home/me/lib/");

        expect(getExtraWorkspaceFolders()).toEqual(["/home/me/lib"]);
    });

    it("puts the primary project first and never repeats it", async () => {
        const { getWorkspaceRoots, setExtraWorkspaceFolders } = await loadModule();
        setExtraWorkspaceFolders(["/home/me/lib", "/repo/"]);

        expect(getWorkspaceRoots("/repo")).toEqual(["/repo", "/home/me/lib"]);
    });

    it("reports no roots when there is no project", async () => {
        const { getWorkspaceRoots, setExtraWorkspaceFolders } = await loadModule();
        setExtraWorkspaceFolders([]);

        expect(getWorkspaceRoots(null)).toEqual([]);
    });

    it("removes only the folder that was asked for", async () => {
        const { removeWorkspaceFolder, setExtraWorkspaceFolders, getExtraWorkspaceFolders } =
            await loadModule();
        setExtraWorkspaceFolders(["/a", "/b"]);

        removeWorkspaceFolder("/b/");

        expect(getExtraWorkspaceFolders()).toEqual(["/a"]);
    });

    it("keeps a folder when the stored list is corrupt", async () => {
        localStorage.setItem(STORAGE_KEY, "{not json");
        const { getExtraWorkspaceFolders } = await loadModule();

        expect(getExtraWorkspaceFolders()).toEqual([]);
    });

    it("drops non-string entries from the stored list", async () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(["/a", 42, null, ""]));
        const { getExtraWorkspaceFolders } = await loadModule();

        expect(getExtraWorkspaceFolders()).toEqual(["/a"]);
    });

    it("tells the backend about the stored folders on the first read", async () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(["/a"]));
        const { getExtraWorkspaceFolders } = await loadModule();

        getExtraWorkspaceFolders();

        // The first read hands the stored list to the backend so the paths are
        // already granted when a file is opened from a second root.
        await vi.waitFor(() => {
            expect(backend.setExtraWorkspaceFolders).toHaveBeenCalledWith(["/a"]);
        });
    });

    it("labels a folder by its last segment on either separator", async () => {
        const { workspaceFolderLabel } = await loadModule();

        expect(workspaceFolderLabel("/home/me/lib/")).toBe("lib");
        expect(workspaceFolderLabel("C:\\work\\shared")).toBe("shared");
        expect(workspaceFolderLabel("/")).toBe("/");
    });

    it("compares two paths the way the platform stores them", async () => {
        const { isSameWorkspacePath } = await loadModule();

        expect(isSameWorkspacePath("/repo/", "/repo")).toBe(true);
        expect(isSameWorkspacePath("C:\\Work\\Repo", "c:/work/repo")).toBe(true);
        expect(isSameWorkspacePath("/repo", "/repo-2")).toBe(false);
        expect(isSameWorkspacePath("", "")).toBe(false);
        // Linux keeps the two apart; only a Windows path folds case.
        expect(isSameWorkspacePath("/repo", "/Repo")).toBe(false);
        expect(isSameWorkspacePath("/Repo/", "/Repo")).toBe(true);
    });
});
