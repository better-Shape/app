"use client";

import { emit } from "@tauri-apps/api/event";
import { confirm } from "@tauri-apps/plugin-dialog";

import { commands } from "@/lib/backend";
import { notify } from "@/features/notifications";
import type { BranchItem } from "./data";

/**
 * Tells the rest of the app that refs moved.
 *
 * The Tauri event is the real channel; the DOM event is the same news for the browser build,
 * where no IPC exists. A failing emit is the browser case and not an error.
 */
export const notifyGitRefresh = async () => {
    try {
        await emit("bettershape-git-refresh", {});
    } catch {
        window.dispatchEvent(new Event("bettershape-git-refresh"));
    }
};

/**
 * Starts a git action and answers its rejection.
 *
 * Every action here reports failure through `notify`, which is the surface the user is
 * looking at, so a rejection has nothing left to say. The actions stay void-returning, which
 * is what lets a button take one as its `onClick` without the call site discarding a promise.
 */
export const startWork = (work: () => Promise<void>) => {
    work().catch(() => undefined);
};

/** `git@github.com:owner/repo.git` and `https://…/repo.git` both open as a browsing URL. */
const browseUrl = (remoteUrl: string) =>
    remoteUrl.replace(/^git@([^:]+):/, "https://$1/").replace(/\.git$/, "");

/**
 * The branch the remote URL should open.
 *
 * A selected remote row names itself, because that row's name is the ref on the other side of
 * the remote. A local row names its own branch, and with nothing selected the answer is HEAD,
 * which is what the button beside the list means before a selection is made.
 */
const remoteBranchFor = (item: BranchItem | null, current: string) => {
    if (item?.kind === "remote") return item.displayName;
    return item?.name ?? current;
};

export type BranchActionDeps = {
    projectPath: string | null;
    currentBranch: string;
    selectedItem: BranchItem | null;
    selectedName: string | null;
    setSelectedName: (name: string | null) => void;
    refresh: () => Promise<void>;
};

/**
 * The branch panel's write actions, each one already answering its own failure.
 *
 * Built as a factory rather than a hook because the actions read the window's state at the
 * moment they run and never subscribe to it: a hook would add a dependency array for nothing,
 * and the panel would still pass the same five values in.
 */
export const createBranchActions = (deps: BranchActionDeps) => {
    const { projectPath, currentBranch, selectedName, setSelectedName, refresh } = deps;

    /** Switch, re-read every list, then tell the app: the reload is what shows the new HEAD. */
    const switchTo = (name: string) => {
        startWork(async () => {
            if (!projectPath) return;
            try {
                await commands.gitSwitchBranch(projectPath, name);
                await refresh();
                await notifyGitRefresh();
                notify.success("Git", `Switched to ${name}`);
            } catch (error) {
                notify.gitError(error);
            }
        });
    };

    /** Create from HEAD and switch onto it in one press, which is what a new branch means. */
    const create = (rawName: string) => {
        startWork(async () => {
            const name = rawName.trim();
            if (!projectPath || !name) return;
            try {
                await commands.gitCreateBranch(projectPath, name);
                await commands.gitSwitchBranch(projectPath, name);
                await refresh();
                await notifyGitRefresh();
                notify.success("Git", `Created and switched to ${name}`);
            } catch (error) {
                notify.gitError(error);
            }
        });
    };

    /** Deletes a branch the user has already confirmed, and reports the outcome. */
    const deleteConfirmed = async (path: string, name: string) => {
        try {
            await commands.gitDeleteBranch(path, name);
            if (selectedName === name) setSelectedName(currentBranch || null);
            await refresh();
            await notifyGitRefresh();
            notify.success("Git", `Deleted branch ${name}`);
        } catch (error) {
            notify.gitError(error);
        }
    };

    /**
     * Delete after a confirmation, and refuse the current branch first.
     *
     * git refuses to delete the checked-out branch anyway, and asking for a confirmation
     * before saying no would be the worse order.
     */
    const remove = (name: string) => {
        startWork(async () => {
            if (!projectPath) return;
            if (name === currentBranch) {
                notify.error("Git", "Cannot delete the current branch.");
                return;
            }
            const confirmed = await confirm(`Delete branch "${name}"?`, {
                title: "Delete branch",
                kind: "warning",
                okLabel: "Delete",
                cancelLabel: "Cancel",
            });
            if (!confirmed) return;
            await deleteConfirmed(projectPath, name);
        });
    };

    /** Rename, then follow it with the selection: the old name no longer exists. */
    const rename = (target: string, rawNext: string) => {
        startWork(async () => {
            const next = rawNext.trim();
            if (!projectPath || !next || next === target) return;
            try {
                await commands.gitRenameBranch(projectPath, target, next);
                setSelectedName(next);
                await refresh();
                await notifyGitRefresh();
                notify.success("Git", `Renamed ${target} to ${next}`);
            } catch (error) {
                notify.gitError(error);
            }
        });
    };

    /** Point a local branch at an upstream, which is what makes push and pull unambiguous. */
    const setUpstream = (target: string, rawUpstream: string) => {
        startWork(async () => {
            const upstream = rawUpstream.trim();
            if (!projectPath || !upstream) return;
            try {
                await commands.gitSetUpstream(projectPath, target, upstream);
                await refresh();
                await notifyGitRefresh();
                notify.success("Git", `Upstream set to ${upstream}`);
            } catch (error) {
                notify.gitError(error);
            }
        });
    };

    /** Fetch, then re-read: the fetch moves the remote-tracking refs the rows report. */
    const fetch = () => {
        startWork(async () => {
            if (!projectPath) return;
            await commands.gitFetch(projectPath);
            await refresh();
        });
    };

    /** Pull, then re-read, for the same reason a fetch re-reads. */
    const pull = () => {
        startWork(async () => {
            if (!projectPath) return;
            await commands.gitPull(projectPath);
            await refresh();
        });
    };

    /**
     * Push the current branch.
     *
     * The rejection is reported rather than answered with a read: a push refused for being
     * behind leaves the local state unchanged, so a refresh would only re-paint it.
     */
    const push = () => {
        startWork(async () => {
            if (!projectPath) return;
            try {
                await commands.gitPush(projectPath);
            } catch (error) {
                notify.gitError(error);
            }
        });
    };

    /**
     * Open the selected branch on the remote's web host.
     *
     * The branch comes from the selection when there is one and from HEAD otherwise, because
     * the button lives beside branches the user may not have selected yet.
     */
    const openRemote = () => {
        startWork(async () => {
            if (!projectPath) return;
            try {
                const url = await commands.gitRemoteUrl(projectPath);
                if (!url) {
                    notify.error("Git", "No remote URL found");
                    return;
                }
                const branch = remoteBranchFor(deps.selectedItem, currentBranch);
                await commands.openUrlExternal(`${browseUrl(url)}/tree/${encodeURIComponent(branch)}`);
            } catch (error) {
                notify.error("Git", `Could not open the remote: ${String(error)}`);
            }
        });
    };

    return { switchTo, create, remove, rename, setUpstream, fetch, pull, push, openRemote };
};

/**
 * The set of write actions, named for the panel that passes them down.
 *
 * Declared below the factory it describes: a `typeof` reference above a module-scope const is
 * what JS-0357 reads as a use before definition.
 */
export type BranchActions = ReturnType<typeof createBranchActions>;
