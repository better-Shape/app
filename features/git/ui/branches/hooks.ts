"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { commands } from "@/lib/backend";
import type { GitBranchDetail, GitFileParams, ProjectState } from "@/lib/backend/types";
import { notify } from "@/features/notifications";
import { startWork } from "./actions";
import { compareName, indexBranchDetails } from "./data";

/**
 * Stops a subscription whose registration is still in flight.
 *
 * `listen` resolves with the unlisten function after the effect that asked for it may already
 * have been cleaned up, so the cleanup has to answer both orders. A listener that is never
 * removed would keep writing the workspace root after the panel is gone.
 */
const stopListening = (pending: Promise<UnlistenFn>) => {
    pending
        .then((unlisten) => {
            unlisten();
        })
        .catch(() => undefined);
};

/**
 * The project the panel reads from: the window's own, then the repository root when the
 * project sits inside one.
 *
 * Read once on mount and kept current by the project-state event, because the manager can be
 * switched to another repository while the panel stays mounted.
 */
export const useWorkspaceRoot = () => {
    const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);

    useEffect(() => {
        /** The project the window opened with; every later change arrives as the event. */
        const readInitialRoot = async () => {
            const state = await commands.getProjectState();
            setWorkspaceRoot(state.project_path ?? null);
        };
        readInitialRoot().catch(() => undefined);

        const listening = listen<ProjectState>("project-state-update", (event) => {
            setWorkspaceRoot(event.payload.project_path ?? null);
        });
        return () => {
            stopListening(listening);
        };
    }, []);

    return workspaceRoot;
};

/** The selection after a reload: kept while the name still exists, empty when it is gone. */
const survivingSelection = (
    previous: string | null,
    locals: readonly string[],
    remotes: readonly string[],
) => {
    if (previous == null) return null;
    const stillExists = locals.includes(previous) || remotes.includes(previous);
    return stillExists ? previous : null;
};

/** Everything one read of the repository produces, published together. */
type BranchSnapshot = {
    locals: string[];
    remotes: string[];
    current: string;
    details: GitBranchDetail[];
};

/**
 * Reads every list the panel shows: two cheap ref lists, the checked-out name, then one
 * `for-each-ref` for the details of all of them.
 *
 * The details are one read rather than one per row, because the per-row shape is hundreds of
 * round trips for data a single call already returns.
 */
const readBranchLists = async (path: string): Promise<BranchSnapshot> => {
    const [locals, remotes, current] = await Promise.all([
        commands.gitBranches(path),
        commands.gitRemoteBranches(path),
        commands.gitCurrentBranch(path),
    ]);
    const details = await commands.gitBranchDetails(path, current, true);
    return { locals, remotes, current, details };
};

/**
 * The branch names, the detail for each, and the read that refreshes them.
 *
 * The details are their own state rather than derived: one `for-each-ref` answers for every
 * row at once, and a per-row query would be hundreds of round trips for the same data.
 */
export const useBranchLists = (projectPath: string | null) => {
    const [localNames, setLocalNames] = useState<string[]>([]);
    const [remoteNames, setRemoteNames] = useState<string[]>([]);
    const [details, setDetails] = useState<GitBranchDetail[]>([]);
    const [currentBranch, setCurrentBranch] = useState("");
    const [loading, setLoading] = useState(false);
    const [selectedName, setSelectedName] = useState<string | null>(null);

    /** Publishes one snapshot in a pass, so no frame shows a list beside another one's name. */
    const publish = useCallback((snapshot: BranchSnapshot) => {
        setLocalNames(snapshot.locals);
        setRemoteNames(snapshot.remotes);
        setCurrentBranch(snapshot.current);
        setDetails(snapshot.details);
        setSelectedName((previous) =>
            survivingSelection(previous, snapshot.locals, snapshot.remotes),
        );
    }, []);

    /**
     * The mount read and the read after a project switch.
     *
     * It publishes when the read returns instead of raising the loading flag first. Nothing in
     * the list is interactive before the first snapshot lands, and the flag is what disables
     * the toolbar's own actions, which are the ones a second press could double up.
     */
    useEffect(() => {
        if (!projectPath) return;
        readBranchLists(projectPath).then(publish).catch((error) => {
            notify.gitError(error);
        });
    }, [projectPath, publish]);

    /** The read behind a button, which raises the flag for as long as its own read runs. */
    const refresh = useCallback(async () => {
        if (!projectPath) return;
        setLoading(true);
        try {
            publish(await readBranchLists(projectPath));
        } catch (error) {
            notify.gitError(error);
        } finally {
            setLoading(false);
        }
    }, [projectPath, publish]);

    const detailByName = useMemo(() => indexBranchDetails(details), [details]);

    return {
        localNames,
        remoteNames,
        currentBranch,
        loading,
        refresh,
        detailByName,
        selectedName,
        setSelectedName,
    };
};



/**
 * The comparison against the checked-out branch: which files differ, and the diff of the one
 * on screen.
 *
 * The comparison belongs to the selection, so it is cleared whenever the selection moves to
 * another branch; a diff left on screen under a new branch's name is the defect this prevents.
 */
export const useCompareSession = ({
    projectPath,
    currentBranch,
    selectedName,
    setSelectedName,
}: {
    projectPath: string | null;
    currentBranch: string;
    selectedName: string | null;
    setSelectedName: (name: string | null) => void;
}) => {
    const [files, setFiles] = useState<GitFileParams[]>([]);
    const [loading, setLoading] = useState(false);
    const [file, setFile] = useState<GitFileParams | null>(null);
    const [original, setOriginal] = useState("");
    const [modified, setModified] = useState("");
    const [diffLoading, setDiffLoading] = useState(false);
    const [sideBySide, setSideBySide] = useState(false);

    const clear = useCallback(() => {
        setFiles([]);
        setFile(null);
        setOriginal("");
        setModified("");
        setLoading(false);
        setDiffLoading(false);
    }, []);

    /** Reads the files that differ between the checked-out branch and another ref. */
    const readChangedFiles = async (path: string, against: string, branch: string) => {
        try {
            const changed = await commands.gitDiffNameStatus(path, against, branch);
            setFiles(changed);
            if (changed.length === 0) {
                notify.info("Git Compare", `No differences vs ${against}`);
            }
        } catch (error) {
            setFiles([]);
            notify.gitError(error, "Compare failed");
        } finally {
            setLoading(false);
        }
    };

    /** Diffs a branch against the checked-out one, refusing a comparison with itself. */
    const compareWith = (branch: string) => {
        startWork(async () => {
            if (!projectPath || !currentBranch) return;
            if (compareName(branch) === currentBranch) {
                notify.info("Git", "Select a different branch to compare.");
                return;
            }
            setSelectedName(branch);
            setFile(null);
            setOriginal("");
            setModified("");
            setLoading(true);
            await readChangedFiles(projectPath, currentBranch, branch);
        });
    };

    /**
     * Reads one file at one ref, treating "not at this ref" as empty content.
     *
     * A file added on one side of the comparison does not exist on the other, and git answers
     * that with a failure rather than an empty string. An empty side is the correct rendering
     * of it: the diff then reads as the whole file being added or removed.
     */
    const readSide = (repo: string, ref: string, file: string) =>
        commands.gitGetFileAtRef(repo, ref, file).catch(() => "");

    /** Reads one file's two sides, at the compared branch and at HEAD. */
    const openFile = (target: GitFileParams) => {
        startWork(async () => {
            if (!projectPath || !currentBranch || !selectedName) return;
            setFile(target);
            setDiffLoading(true);
            try {
                const [before, after] = await Promise.all([
                    readSide(projectPath, currentBranch, target.path),
                    readSide(projectPath, selectedName, target.path),
                ]);
                setOriginal(before);
                setModified(after);
            } catch (error) {
                setOriginal("");
                setModified("");
                notify.gitError(error, "Failed to load file diff");
            } finally {
                setDiffLoading(false);
            }
        });
    };

    /** The diff's own layout, which is a preference for this comparison only. */
    const toggleLayout = () => setSideBySide((current) => !current);

    return {
        files,
        loading,
        file,
        original,
        modified,
        diffLoading,
        sideBySide,
        clear,
        compareWith,
        openFile,
        toggleLayout,
    };
};

/**
 * The hook's shape, named for the window that consumes it.
 *
 * Declared below the hook it describes, because a `typeof` reference to a module-scope const
 * above the const is what JS-0357 reads as a use before definition, whether or not the
 * reference sits in a type.
 */
export type BranchLists = ReturnType<typeof useBranchLists>;

/** The comparison hook's shape, named the same way and for the same reason. */
export type CompareSession = ReturnType<typeof useCompareSession>;
