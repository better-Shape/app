"use client";

import React, {
    createContext,
    useContext,
    useReducer,
    useCallback,
    useEffect,
    useMemo,
    useRef,
} from "react";
import { useProjectState, commands } from "@/lib/backend";

export type EditorGroupId = "left" | "right";

interface EditorGroup {
    tabs: string[];
    active: string | null;
}

interface SplitLayout {
    left: EditorGroup;
    right: EditorGroup;
    focused: EditorGroupId;
}

interface EditorGroupsState {
    split: SplitLayout | null;
}

type Action =
    | { type: "SPLIT_RIGHT"; activePath: string; allPaths: string[] }
    | { type: "CLOSE_SPLIT" }
    | { type: "SET_FOCUSED"; group: EditorGroupId }
    | { type: "SET_GROUP_ACTIVE"; group: EditorGroupId; path: string }
    | { type: "SYNC_OPEN_FILES"; paths: string[]; backendActive: string | null }
    | { type: "OPEN_IN_FOCUSED"; path: string };

/** Tab that takes focus when `active` leaves: the next tab, else the previous, else the first. */
const pickNeighbor = (active: string, tabs: string[]): string | null => {
    if (tabs.length === 0) return null;
    const idx = tabs.indexOf(active);
    if (idx === -1) return tabs[0];
    if (idx + 1 < tabs.length) return tabs[idx + 1];
    if (idx - 1 >= 0) return tabs[idx - 1];
    return tabs[0];
}

/** The two editor groups after removing closed tabs and repairing the active tab. */
const pruneGroups = (
    split: SplitLayout,
    open: Set<string>,
): { left: EditorGroup; right: EditorGroup } => {
    /** Drop closed tabs from a group and repair its active tab. */
    const prune = (group: EditorGroup): EditorGroup => {
        const tabs = group.tabs.filter((p) => open.has(p));
        const active = group.active && open.has(group.active) ? group.active : (tabs[0] ?? null);
        return { tabs, active };
    };
    return { left: prune(split.left), right: prune(split.right) };
};

/** Whether a pruned group still matches its pre-sync tabs and active tab. */
const isGroupUnchanged = (next: EditorGroup, current: EditorGroup): boolean =>
    next.tabs.length === current.tabs.length &&
    next.tabs.every((t, i) => t === current.tabs[i]) &&
    next.active === current.active;

/** Paths opened since the last sync: in neither group yet. */
const findAddedPaths = (split: SplitLayout, paths: string[]): string[] =>
    paths.filter((p) => !split.left.tabs.includes(p) && !split.right.tabs.includes(p));

/** Open `path` in the focused group, appending a tab only when it is new. */
const openInFocusedGroup = (state: EditorGroupsState, path: string): EditorGroupsState => {
    if (!state.split) return state;
    const groupId = state.split.focused;
    const tabs = state.split[groupId].tabs.includes(path)
        ? state.split[groupId].tabs
        : [...state.split[groupId].tabs, path];
    return {
        split: {
            ...state.split,
            [groupId]: { tabs, active: path },
        },
    };
};

/** Append newly opened paths to the focused group after a sync. */
const appendToFocusedGroup = (
    state: EditorGroupsState,
    groups: { left: EditorGroup; right: EditorGroup },
    added: string[],
): EditorGroupsState => {
    const split = state.split;
    if (!split) return state;
    const groupId = split.focused;
    const target = groupId === "left" ? groups.left : groups.right;
    const withNew = {
        tabs: [...target.tabs, ...added.filter((p) => !target.tabs.includes(p))],
        active: added[added.length - 1],
    };
    return {
        split: {
            ...split,
            left: groupId === "left" ? withNew : groups.left,
            right: groupId === "right" ? withNew : groups.right,
        },
    };
};

/** Whether both pruned groups still match the pre-sync groups. */
const areGroupsUnchanged = (
    groups: { left: EditorGroup; right: EditorGroup },
    split: SplitLayout,
): boolean =>
    isGroupUnchanged(groups.left, split.left) && isGroupUnchanged(groups.right, split.right);

/** SYNC_OPEN_FILES: prune closed tabs, then route newly opened paths. */
const syncOpenFiles = (
    state: EditorGroupsState,
    action: Extract<Action, { type: "SYNC_OPEN_FILES" }>,
): EditorGroupsState => {
    if (!state.split) return state;
    const open = new Set(action.paths);
    const { left, right } = pruneGroups(state.split, open);
    if (right.tabs.length === 0) return { split: null };
    const added = findAddedPaths(state.split, action.paths);
    if (added.length > 0) {
        return appendToFocusedGroup(state, { left, right }, added);
    }
    if (areGroupsUnchanged({ left, right }, state.split)) return state;
    return { split: { ...state.split, left, right } };
};

/** SET_GROUP_ACTIVE: focus a group, make `path` its active tab, mirror left to the backend. */
const setGroupActive = (
    state: EditorGroupsState,
    action: Extract<Action, { type: "SET_GROUP_ACTIVE" }>,
): EditorGroupsState => {
    if (!state.split) return state;
    const group = action.group;
    const next = {
        ...state.split,
        focused: group,
        [group]: {
            ...state.split[group],
            active: action.path,
        },
    };
    if (group === "left") commands.setActiveFile(action.path);
    return { split: next };
};

/** SPLIT_RIGHT: move the active tab into a new right-hand group. */
const applySplitRight = (
    state: EditorGroupsState,
    action: Extract<Action, { type: "SPLIT_RIGHT" }>,
): EditorGroupsState => {
    const { activePath, allPaths } = action;
    if (!activePath) return state;
    const remaining = allPaths.filter((p) => p !== activePath);
    const leftActive = pickNeighbor(activePath, remaining);
    return {
        split: {
            left: { tabs: remaining, active: leftActive },
            right: { tabs: [activePath], active: activePath },
            focused: "right",
        },
    };
};

/** CLOSE_SPLIT: collapse back to a single editor group. */
const applyCloseSplit = (): EditorGroupsState => ({ split: null });

/** SET_FOCUSED: focus one group when focus actually changes. */
const applySetFocused = (
    state: EditorGroupsState,
    action: Extract<Action, { type: "SET_FOCUSED" }>,
): EditorGroupsState => {
    if (!state.split) return state;
    if (state.split.focused === action.group) return state;
    return { split: { ...state.split, focused: action.group } };
};

/** OPEN_IN_FOCUSED: route a newly opened path to the focused group. */
const applyOpenInFocused = (
    state: EditorGroupsState,
    action: Extract<Action, { type: "OPEN_IN_FOCUSED" }>,
): EditorGroupsState => openInFocusedGroup(state, action.path);

/** Backend active path when present, otherwise the first open path. */
const preferredActivePath = (activeFile: string | null, openPaths: string[]): string | null =>
    activeFile ?? openPaths[0] ?? null;

/** Focus target after a split closes: the focused group tab, then any surviving tab. */
const closeSplitFocusPath = (split: SplitLayout, openPaths: string[]): string | null =>
    split[split.focused].active ?? split.left.active ?? split.right.active ?? openPaths[0] ?? null;

/** Active tab for one group, falling back to its first tab. */
const groupActivePath = (group: EditorGroup): string | null => group.active ?? group.tabs[0] ?? null;

/** Reducer handlers indexed by action type. */
const actionHandlers: {
    [K in Action["type"]]: (
        state: EditorGroupsState,
        action: Extract<Action, { type: K }>,
    ) => EditorGroupsState;
} = {
    SPLIT_RIGHT: applySplitRight,
    CLOSE_SPLIT: applyCloseSplit,
    SET_FOCUSED: applySetFocused,
    SET_GROUP_ACTIVE: setGroupActive,
    OPEN_IN_FOCUSED: applyOpenInFocused,
    SYNC_OPEN_FILES: syncOpenFiles,
};

/** Split layout state machine: create and close splits, focus groups, sync open files. */
const reducer = (state: EditorGroupsState, action: Action): EditorGroupsState => {
    const handler = actionHandlers[action.type] as
        | ((state: EditorGroupsState, action: Action) => EditorGroupsState)
        | undefined;
    return handler ? handler(state, action) : state;
};

interface EditorGroupsContextType {
    splitEnabled: boolean;
    focusedGroup: EditorGroupId;
    splitRight: () => void;
    closeSplit: () => void;
    setFocusedGroup: (group: EditorGroupId) => void;
    setGroupActiveFile: (group: EditorGroupId, path: string) => void;
    getGroupActiveFile: (group: EditorGroupId) => string | null;
    getGroupTabs: (group: EditorGroupId) => string[];
}

const EditorGroupsContext = createContext<EditorGroupsContextType | undefined>(undefined);

/** Provides the two-group editor split state for the workbench. */
export const EditorSplitProvider = ({ children }: { children: React.ReactNode }) => {
    const { active_file, open_files } = useProjectState();
    const openPaths = useMemo(() => open_files.map((f) => f.path), [open_files]);
    const [{ split }, dispatch] = useReducer(reducer, { split: null });
    const prevPathsRef = useRef<string[]>([]);

    /** Move the active tab into a new right-hand group. */
    const splitRight = useCallback(() => {
        if (split) return;
        const activePath = preferredActivePath(active_file, openPaths);
        if (!activePath) return;
        dispatch({ type: "SPLIT_RIGHT", activePath, allPaths: openPaths });
        const remaining = openPaths.filter((p) => p !== activePath);
        const leftActive = pickNeighbor(activePath, remaining);
        if (leftActive) commands.setActiveFile(leftActive);
    }, [active_file, openPaths, split]);

    /** Close the split and return backend focus to the surviving tab. */
    const closeSplit = useCallback(() => {
        if (!split) return;
        const focus = closeSplitFocusPath(split, openPaths);
        dispatch({ type: "CLOSE_SPLIT" });
        if (focus) commands.setActiveFile(focus);
    }, [split, openPaths]);

    /** Focus one editor group without changing its active tab. */
    const setFocusedGroup = useCallback((group: EditorGroupId) => {
        dispatch({ type: "SET_FOCUSED", group });
    }, []);

    /** Activate a tab in one group, or the backend file when unsplit. */
    const setGroupActiveFile = useCallback((group: EditorGroupId, path: string) => {
        if (!split) {
            commands.setActiveFile(path);
            return;
        }
        dispatch({ type: "SET_GROUP_ACTIVE", group, path });
    }, [split]);

    /** Tabs owned by one group, or every open tab when unsplit. */
    const getGroupTabs = useCallback(
        (group: EditorGroupId): string[] => {
            if (!split) return openPaths;
            return split[group].tabs;
        },
        [split, openPaths]
    );

    /** Active tab for one group, falling back to its first tab or the backend file. */
    const getGroupActiveFile = useCallback(
        (group: EditorGroupId): string | null => {
            if (!split) return preferredActivePath(active_file, openPaths);
            return groupActivePath(split[group]);
        },
        [split, active_file, openPaths]
    );

    // Keep split groups in sync when tabs close/open (not on every focus change)
    useEffect(() => {
        if (!split) {
            prevPathsRef.current = openPaths;
            return;
        }
        const prevKey = prevPathsRef.current.join("\0");
        const nextKey = openPaths.join("\0");
        if (prevKey === nextKey) return;
        prevPathsRef.current = openPaths;
        dispatch({ type: "SYNC_OPEN_FILES", paths: openPaths, backendActive: active_file });
    }, [openPaths, split, active_file]);

    useEffect(() => {
        /** Route `bettershape-editor-split` window events to the split actions. */
        const handleSplit = (e: Event) => {
            const action = (e as CustomEvent<{ action?: string }>).detail?.action;
            if (action === "close") closeSplit();
            else if (action === "right") splitRight();
        };
        window.addEventListener("bettershape-editor-split", handleSplit as EventListener);
        return () => window.removeEventListener("bettershape-editor-split", handleSplit as EventListener);
    }, [splitRight, closeSplit]);

    const value = useMemo(
        (): EditorGroupsContextType => ({
            splitEnabled: split !== null,
            focusedGroup: split?.focused ?? "left",
            splitRight,
            closeSplit,
            setFocusedGroup,
            setGroupActiveFile,
            getGroupActiveFile,
            getGroupTabs,
        }),
        [split, splitRight, closeSplit, setFocusedGroup, setGroupActiveFile, getGroupActiveFile, getGroupTabs]
    );

    return (
        <EditorGroupsContext.Provider value={value}>
            {children}
        </EditorGroupsContext.Provider>
    );
}

/** Split state for editor surfaces; throws outside the provider (see the optional variant). */
export const useEditorSplit = () => {
    const ctx = useContext(EditorGroupsContext);
    if (!ctx) throw new Error("useEditorSplit must be used within EditorSplitProvider");
    return ctx;
}

/**
 * Non-throwing variant for app chrome that renders outside the editor's
 * file tab (e.g. the workbench Status bar, which is mounted whenever a
 * project is open, including when the active workspace tab is a chat).
 * Returns null when no split provider is mounted; callers then fall back
 * to the backend's active file.
 */
export const useEditorSplitOptional = () => useContext(EditorGroupsContext) ?? null;
