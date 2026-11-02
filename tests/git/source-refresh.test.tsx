/**
 * The Source panel's status refresh. Two refreshes for the same repository
 * overlap whenever a command answers while a status read is in flight, and the
 * panel used to accept whichever answered last, so an older answer could put
 * pre-command status back on screen.
 */
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
    gitStatus: vi.fn(),
    gitCurrentBranch: vi.fn(async () => "main"),
    gitHasRemote: vi.fn(async () => true),
    gitLog: vi.fn(async () => []),
    gitSyncStatus: vi.fn(async () => ({ ahead: 0, behind: 0 })),
}));

const notifications = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), success: vi.fn() }));

vi.mock("@/lib/backend", () => ({ commands: backend }));
vi.mock("@/features/notifications", () => ({ notify: notifications }));

import { useGitStatusRefresh } from "@/features/git/ui/source/use-git-status-refresh";
import type { GitFileParams } from "@/lib/backend/types";
import { statusProgress } from "@/lib/ui/status-progress";

type Refresh = ReturnType<typeof useGitStatusRefresh>;
type Setters = {
    changes: GitFileParams[];
    branch: string;
    lastCommit: unknown;
    isGitRepo: boolean;
};

let root: Root | null = null;
let host: HTMLDivElement;
let refresh: Refresh;
let setters: Setters;
let repoKeyRef: { current: string };

const file = (path: string): GitFileParams => ({ path, status: "M", staged: false });

/**
 * Mounts the hook over real React state, so the predicates it reads (`isGitRepo`,
 * `changeCount`, `hasLastCommit`) are the values the panel would have, and
 * mirrors the current state into `setters` for the assertions.
 */
const Harness = ({
    projectPath,
    scmRepoPath,
    repoKey,
    initiallyStaged,
    onRefresh,
}: {
    projectPath: string | null;
    scmRepoPath: string | null;
    repoKey: string;
    initiallyStaged?: GitFileParams[];
    onRefresh: (refresh: Refresh) => void;
}) => {
    const [changes, setChanges] = useState<GitFileParams[]>(initiallyStaged ?? []);
    const [branch, setBranch] = useState("");
    const [lastCommit, setLastCommit] = useState<unknown>(null);
    const [isGitRepo, setIsGitRepo] = useState((initiallyStaged?.length ?? 0) > 0);
    const value = useGitStatusRefresh({
        projectPath,
        scmRepoPath,
        repoKey,
        reposCount: 1,
        reposLoading: false,
        startLoading: () => undefined,
        stopLoading: () => undefined,
        setChanges,
        setCurrentBranch: setBranch,
        setHasRemote: () => undefined,
        setLastCommit,
        setNeedsSync: () => undefined,
        setIsGitRepo,
        // The panel keeps this ref equal to `repoKey` and blanks it on switch;
        // the test owns it so it can move the panel to another repository while
        // a read is still in flight.
        latestRepoKeyRef: repoKeyRef,
        isGitRepo,
        changeCount: changes.length,
        hasLastCommit: lastCommit !== null,
    });
    useEffect(() => {
        setters = { changes, branch, lastCommit, isGitRepo };
        onRefresh(value);
    });
    return null;
};

const mount = async (props: {
    projectPath: string | null;
    scmRepoPath: string | null;
    repoKey: string;
    initiallyStaged?: GitFileParams[];
}) => {
    repoKeyRef.current = props.repoKey;
    await act(async () => {
        root?.render(<Harness {...props} onRefresh={(next) => { refresh = next; }} />);
    });
};

/** A status call the test resolves by hand. */
const deferred = () => {
    let resolve!: (files: GitFileParams[]) => void;
    const promise = new Promise<GitFileParams[]>((done) => {
        resolve = done;
    });
    return { promise, resolve };
};

beforeEach(() => {
    vi.clearAllMocks();
    repoKeyRef = { current: "" };
    setters = { changes: [], branch: "", lastCommit: null, isGitRepo: false };
    backend.gitCurrentBranch.mockResolvedValue("main");
    backend.gitHasRemote.mockResolvedValue(true);
    backend.gitLog.mockResolvedValue([]);
    backend.gitSyncStatus.mockResolvedValue({ ahead: 0, behind: 0 });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host.remove();
});

describe("source status refresh", () => {
    it("keeps the newest result when an older refresh answers last", async () => {
        const older = deferred();
        const newer = deferred();
        backend.gitStatus.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
        await mount({ projectPath: "/repo", scmRepoPath: "/repo", repoKey: "/repo\n" });

        let first: Promise<void> = Promise.resolve();
        let second: Promise<void> = Promise.resolve();
        await act(async () => {
            first = refresh({ track: false });
            second = refresh({ track: false });
            await Promise.resolve();
        });

        // The newer read answers first with the status after the command ran.
        await act(async () => {
            newer.resolve([file("after.ts")]);
            await second;
        });
        expect(setters.changes).toEqual([file("after.ts")]);

        // The older read answers last. Its list predates the command.
        await act(async () => {
            older.resolve([file("before.ts")]);
            await first;
        });
        expect(setters.changes).toEqual([file("after.ts")]);
    });

    it("drops a refresh whose repository was switched while it ran", async () => {
        const pending = deferred();
        backend.gitStatus.mockReturnValueOnce(pending.promise);
        await mount({ projectPath: "/repo", scmRepoPath: "/repo", repoKey: "/repo\n" });

        let call: Promise<void> = Promise.resolve();
        await act(async () => {
            call = refresh({ track: false });
            await Promise.resolve();
        });
        // The panel moved to another repository before the answer arrived.
        repoKeyRef.current = "/other\n";
        await act(async () => {
            pending.resolve([file("from-old-repo.ts")]);
            await call;
        });
        expect(setters.changes).toEqual([]);
    });

    it("keeps the status message while a newer refresh is still running", async () => {
        const older = deferred();
        const newer = deferred();
        backend.gitStatus.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
        await mount({ projectPath: "/repo", scmRepoPath: "/repo", repoKey: "/repo\n" });

        let first: Promise<void> = Promise.resolve();
        let second: Promise<void> = Promise.resolve();
        await act(async () => {
            first = refresh({ track: false });
            second = refresh({ track: false });
            await Promise.resolve();
        });

        // The older read settles first. The newer one is still asking the backend.
        await act(async () => {
            older.resolve([file("before.ts")]);
            await first;
        });
        expect(statusProgress.getMessage()).toBe("Refreshing git status...");

        await act(async () => {
            newer.resolve([file("after.ts")]);
            await second;
        });
        expect(statusProgress.getMessage()).toBeNull();
    });

    it("takes away the status message when the newest refresh finds no repository", async () => {
        // An earlier refresh left the entry, and this one has no repository to read.
        statusProgress.push("git-refresh", "Refreshing git status...");
        await mount({ projectPath: "/plain-folder", scmRepoPath: null, repoKey: "/plain-folder\n" });
        await act(async () => {
            await refresh({ track: false });
        });
        // Nothing in flight, so nothing should still be claiming a refresh.
        expect(statusProgress.getMessage()).toBeNull();
    });

    it("clears status only once discovery has finished with no repository", async () => {
        // The panel still shows a repository's files while discovery reports none.
        await mount({
            projectPath: "/plain-folder",
            scmRepoPath: null,
            repoKey: "/plain-folder\n",
            initiallyStaged: [file("stale.ts")],
        });
        expect(setters.changes).toEqual([file("stale.ts")]);
        await act(async () => {
            await refresh({ track: false });
        });
        expect(setters.changes).toEqual([]);
        expect(setters.isGitRepo).toBe(false);
    });

    it("reports a real failure instead of clearing the list", async () => {
        backend.gitStatus.mockRejectedValueOnce(new Error("permission denied"));
        await mount({ projectPath: "/repo", scmRepoPath: "/repo", repoKey: "/repo\n" });
        await act(async () => {
            await refresh({ track: false });
        });
        expect(notifications.error).toHaveBeenCalledWith("Source Control Error", expect.stringContaining("permission denied"));
        expect(setters.changes).toEqual([]);
    });
});
