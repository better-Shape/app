import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";
import { commands } from "@/lib/backend/commands";
import { ProjectState } from "@/lib/backend/types";

const initialState: ProjectState = {
    project_path: null,
    open_files: [],
    active_file: null,
};

type ProjectStateStore = {
    currentState: ProjectState;
    subscribers: Set<() => void>;
    initialized: boolean;
    eventRevision: number;
};

/**
 * Survive Next.js HMR. Module-level `let` resets on Fast Refresh, which wiped
 * project_path → welcome flash → last-project restore (felt like random reloads
 * and GET / spam while stuck on the previous folder).
 */
function getStore(): ProjectStateStore {
    const g = globalThis as typeof globalThis & {
        __bettershapeProjectState?: ProjectStateStore;
    };
    if (!g.__bettershapeProjectState) {
        g.__bettershapeProjectState = {
            currentState: initialState,
            subscribers: new Set(),
            initialized: false,
            eventRevision: 0,
        };
    }
    return g.__bettershapeProjectState;
}

function emitState() {
    const { subscribers } = getStore();
    subscribers.forEach((listener) => listener());
}

function pathsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    const [na, nb] = [a.replace(/\\/g, "/").replace(/(?<!\/)\/+$/, ""), b.replace(/\\/g, "/").replace(/(?<!\/)\/+$/, "")];
    return /^[a-zA-Z]:[\\/]/.test(a) || a.includes("\\") || /^[a-zA-Z]:[\\/]/.test(b) || b.includes("\\") ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

function initializeStateBridge() {
    const store = getStore();
    if (store.initialized || typeof window === "undefined") return;
    store.initialized = true;
    const snapshotRevision = store.eventRevision;

    commands
        .getProjectState()
        .then((next) => {
            if (store.eventRevision !== snapshotRevision) return;
            store.currentState = next;
            emitState();
        })
        .catch(() => undefined);

    try {
        listen<string[]>("bettershape-files-changed", (event) => {
            commands.invalidateAllFileCaches();
            window.dispatchEvent(new CustomEvent("bettershape-files-changed", { detail: Array.isArray(event.payload) ? event.payload : [] }));
        }).catch(() => undefined);
    } catch {
        /* outside Tauri event bridge */
    }

    try {
        listen<ProjectState>("project-state-update", (event) => {
            store.eventRevision += 1;
            const next = event.payload;
            const current = store.currentState;

            let changed = false;
            if (!pathsEqual(current.project_path, next.project_path)) changed = true;
            if (current.active_file !== next.active_file) changed = true;

            const openFilesChanged =
                JSON.stringify(current.open_files) !== JSON.stringify(next.open_files);

            if (changed || openFilesChanged) {
                store.currentState = {
                    project_path: next.project_path,
                    active_file: next.active_file,
                    open_files: openFilesChanged ? next.open_files : current.open_files,
                };
                emitState();
            }
        }).catch(() => undefined);
    } catch {
        /* outside Tauri event bridge */
    }
}

function subscribe(listener: () => void) {
    initializeStateBridge();
    const { subscribers } = getStore();
    subscribers.add(listener);
    return () => {
        subscribers.delete(listener);
    };
}

function getSnapshot() {
    return getStore().currentState;
}

export function useProjectState() {
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Sync getter for use outside React components (e.g. click handlers in renderers). */
export function getProjectPath(): string | null {
    initializeStateBridge();
    return getStore().currentState.project_path;
}

export function getProjectSnapshot(): ProjectState {
    initializeStateBridge();
    return getStore().currentState;
}

/** Subscribe to project state changes outside React. */
export function subscribeProjectState(listener: () => void): () => void {
    return subscribe(listener);
}
