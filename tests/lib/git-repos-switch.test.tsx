/**
 * Regression: the Git panel showed the previous project's repositories after a project
 * switch, for one render and until the new discovery finished. `useGitRepos` now tags its
 * state with the workspace root it was computed for, and never shows another root's state.
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const discover = vi.hoisted(() => ({
    pending: new Map<string, (repos: unknown[]) => void>(),
}));

vi.mock("@/lib/backend/commands", () => ({
    commands: {
        gitDiscoverRepos: vi.fn(
            (root: string) => new Promise<unknown[]>((resolve) => discover.pending.set(root, resolve)),
        ),
    },
}));

import { invalidateGitRepoCache, useGitRepos } from "@/lib/git/repos";

type Seen = { root: string; repos: string[]; loading: boolean };

let host: HTMLDivElement;
let root: Root;
let seen: Seen[];

function Probe({ workspaceRoot }: { workspaceRoot: string }) {
    const r = useGitRepos(workspaceRoot);
    // Recorded during render, so every committed-or-not frame is visible to the assertions.
    seen.push({ root: workspaceRoot, repos: r.repos.map((x) => x.path), loading: r.loading });
    return null;
}

function render(workspaceRoot: string) {
    act(() => {
        root.render(React.createElement(Probe, { workspaceRoot }));
    });
}

async function settle() {
    for (let i = 0; i < 4; i++) {
        await act(async () => {
            await new Promise((r) => setTimeout(r, 0));
        });
    }
}

function answerDiscover(workspaceRoot: string, paths: string[]) {
    const resolve = discover.pending.get(workspaceRoot);
    if (!resolve) throw new Error(`no pending discover for ${workspaceRoot}`);
    discover.pending.delete(workspaceRoot);
    return act(async () => {
        resolve(paths.map((path) => ({ path, name: path.split("/").pop() })));
    });
}

beforeEach(() => {
    invalidateGitRepoCache();
    sessionStorage.clear();
    discover.pending.clear();
    seen = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
});

describe("useGitRepos across a project switch", () => {
    it("never shows the previous project's repos, not even for one render", async () => {
        render("/work/alpha");
        await answerDiscover("/work/alpha", ["/work/alpha"]);
        await settle();
        expect(seen.at(-1)).toMatchObject({ repos: ["/work/alpha"], loading: false });

        seen = [];
        render("/work/beta");
        // Every frame for beta, including the first one, is free of alpha's repos.
        expect(seen.length).toBeGreaterThan(0);
        for (const frame of seen) {
            expect(frame.repos).not.toContain("/work/alpha");
        }
        expect(seen[0]).toMatchObject({ root: "/work/beta", repos: [], loading: true });

        await answerDiscover("/work/beta", ["/work/beta/app"]);
        await settle();
        expect(seen.at(-1)).toMatchObject({ repos: ["/work/beta/app"], loading: false });
    });

    it("ignores a late discovery for the project that was left", async () => {
        render("/late/one");
        render("/late/two");
        await answerDiscover("/late/two", ["/late/two"]);
        await settle();
        // The first project's discovery finishes last and must not overwrite the second.
        await answerDiscover("/late/one", ["/late/one"]);
        await settle();
        expect(seen.at(-1)).toMatchObject({ root: "/late/two", repos: ["/late/two"], loading: false });
    });
});
