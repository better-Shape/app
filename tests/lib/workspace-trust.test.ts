import { describe, expect, it, beforeEach, vi } from "vitest";
import {
    isWorkspaceTrusted,
    listTrustedWorkspaces,
    normalizeWorkspacePath,
    trustWorkspace,
    untrustWorkspace,
} from "@/lib/workspace/trust";
import { commands } from "@/lib/backend";
import { normalizeProjectPath, projectPathsEqual } from "@/features/agent/lib/open-project";

vi.mock("@/lib/backend", () => ({ commands: { setWorkspaceTrusted: vi.fn(async () => undefined) } }));

describe("workspace-trust", () => {
    beforeEach(() => {
        localStorage.clear();
        vi.stubGlobal("window", {
            dispatchEvent: vi.fn(),
        });
    });

    it("normalizes paths for comparison", () => {
        expect(normalizeWorkspacePath("C:\\Projects\\App\\")).toBe("c:/projects/app");
    });

    it("tracks trusted workspaces", () => {
        expect(isWorkspaceTrusted("C:/foo")).toBe(false);
        trustWorkspace("C:/foo");
        expect(isWorkspaceTrusted("C:/foo")).toBe(true);
        expect(listTrustedWorkspaces()).toContain("c:/foo");
        untrustWorkspace("C:/foo");
        expect(isWorkspaceTrusted("C:/foo")).toBe(false);
    });

    it("matches trusted paths regardless of slash style", () => {
        trustWorkspace("C:\\repo\\shape");
        expect(isWorkspaceTrusted("C:/repo/shape")).toBe(true);
    });

    it("preserves POSIX case and syncs trust to Rust", async () => {
        expect(normalizeWorkspacePath("/home/U/A/")).toBe("/home/U/A");
        trustWorkspace("/home/U/A");
        expect([isWorkspaceTrusted("/home/U/A"), isWorkspaceTrusted("/home/u/a")]).toEqual([true, false]);
        await vi.waitFor(() => expect(commands.setWorkspaceTrusted).toHaveBeenCalledWith("/home/U/A", true));
        untrustWorkspace("/home/U/A");
        await vi.waitFor(() => expect(commands.setWorkspaceTrusted).toHaveBeenCalledWith("/home/U/A", false));
        expect([normalizeProjectPath("/home/U/R/"), projectPathsEqual("/home/U/R", "/home/u/r"), projectPathsEqual("C:/D/R", "c:\\d\\r\\")]).toEqual(["/home/U/R", false, true]);
    });
});
