import { createElement, type ReactElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listenCustomEvent } from "../../helpers/events";
import { mockInvoke } from "../../helpers/tauri";

const projectState = vi.hoisted(() => ({
    current: {
        project_path: "/repo" as string | null,
        active_file: "/repo/src/a.ts" as string | null,
    },
}));

vi.mock("@/lib/backend", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/backend")>();
    return { ...actual, useProjectState: () => projectState.current };
});

import { BlameTab } from "@/features/agent/workspace/blame-tab";
import type { BlameLine } from "@/lib/backend";

function raw(overrides: Partial<BlameLine> & { line: number; commit: string }): BlameLine {
    return { line_count: 1, author: "Ada", date: "1700000000", summary: "Add the parser", ...overrides };
}

const LINES: BlameLine[] = [
    raw({ line: 1, commit: "aaa1111" }),
    raw({ line: 2, commit: "aaa1111" }),
    raw({ line: 3, commit: "bbb2222", author: "Grace", summary: "Fix the off-by-one" }),
];

type Call = { cmd: string; args: Record<string, unknown> };

function mount(node: ReactElement) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
        root.render(node);
    });
    return { host, root };
}

function unmount(root: Root, host: HTMLElement) {
    act(() => root.unmount());
    host.remove();
}

async function pause(ms: number) {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
    });
}

async function waitFor(host: HTMLElement, needle: string, timeoutMs = 4000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (host.textContent?.includes(needle)) return;
        await pause(25);
    }
    throw new Error(`Timed out waiting for "${needle}". Saw: ${host.textContent}`);
}

describe("blame tab", () => {
    let calls: Call[];
    let result: BlameLine[] | string;

    beforeEach(() => {
        calls = [];
        result = LINES;
        projectState.current = { project_path: "/repo", active_file: "/repo/src/a.ts" };
        mockInvoke((cmd, args) => {
            calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
            if (cmd === "git_blame_file") {
                return typeof result === "string" ? Promise.reject(result) : result;
            }
            return undefined;
        });
    });

    afterEach(() => {
        projectState.current = { project_path: null, active_file: null };
    });

    it("asks git for the open file and renders what came back", async () => {
        const { host, root } = mount(createElement(BlameTab));
        try {
            await waitFor(host, "3 regions");
            const call = calls.find((entry) => entry.cmd === "git_blame_file");
            expect(call?.args).toEqual({ repoPath: "/repo", filePath: "/repo/src/a.ts" });
            const text = host.textContent ?? "";
            expect(text).toContain("src/a.ts");
            expect(text).toContain("Ada");
            expect(text).toContain("Grace");
            expect(text).toContain("1-2");
        } finally {
            unmount(root, host);
        }
    });

    it("shows git's reason instead of an empty blame when the command fails", async () => {
        result = "Git error: object not found - no match for id 1a2b3c";
        const { host, root } = mount(createElement(BlameTab));
        try {
            await waitFor(host, "Git blame did not run");
            const text = host.textContent ?? "";
            expect(text).toContain("object not found");
            expect(text).not.toContain("Nothing to blame");
        } finally {
            unmount(root, host);
        }
    });

    it("does not call git for a browser tab", async () => {
        projectState.current = { project_path: "/repo", active_file: "bettershape://browser" };
        const { host, root } = mount(createElement(BlameTab));
        try {
            await waitFor(host, "No file to blame");
            expect(host.textContent).toContain("browser tab");
            expect(calls.filter((entry) => entry.cmd === "git_blame_file")).toHaveLength(0);
        } finally {
            unmount(root, host);
        }
    });

    it("does not call git for a file outside the project, which git would resolve by name alone", async () => {
        projectState.current = { project_path: "/repo", active_file: "/elsewhere/README.md" };
        const { host, root } = mount(createElement(BlameTab));
        try {
            await waitFor(host, "outside the project folder");
            expect(calls.filter((entry) => entry.cmd === "git_blame_file")).toHaveLength(0);
        } finally {
            unmount(root, host);
        }
    });

    it("re-runs blame for the toolbar refresh", async () => {
        const { host, root } = mount(createElement(BlameTab));
        try {
            await waitFor(host, "3 regions");
            act(() => host.querySelector<HTMLButtonElement>("button[aria-label='Re-run git blame']")?.click());
            await pause(80);
            expect(calls.filter((entry) => entry.cmd === "git_blame_file")).toHaveLength(2);
        } finally {
            unmount(root, host);
        }
    });

    it("opens the existing commit diff tab for the group that was clicked", async () => {
        const diffs = listenCustomEvent<{
            id: string;
            path: string;
            repo: string;
            commit: string;
        }>("bettershape-open-file-diff");
        const { host, root } = mount(createElement(BlameTab));
        try {
            await waitFor(host, "Fix the off-by-one");
            act(() =>
                host
                    .querySelector<HTMLButtonElement>("button[aria-label*='Fix the off-by-one']")
                    ?.click(),
            );
            expect(diffs.events).toHaveLength(1);
            expect(diffs.events[0]?.detail).toEqual({
                id: "diff:c:bbb2222:src/a.ts",
                path: "src/a.ts",
                status: "",
                staged: false,
                repo: "/repo",
                commit: "bbb2222",
            });
        } finally {
            diffs.off();
            unmount(root, host);
        }
    });
});