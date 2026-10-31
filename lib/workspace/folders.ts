import { isCaseInsensitivePath } from "@/lib/path/utils";

const STORAGE_KEY = "bettershape-workspace-folders";
let initialSynced = false;
let syncQueue = Promise.resolve();

function normalizePath(path: string): string {
    return path.replace(/\\/g, "/").replace(/(?<!\/)\/+$/, "");
}

export function getExtraWorkspaceFolders(): string[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];
        const list = parsed.filter((p): p is string => typeof p === "string" && p.length > 0);
        if (!initialSynced) { initialSynced = true; if (list.length > 0) void syncRustExtraFolders(list).catch(() => { initialSynced = false; }); }
        return list;
    } catch {
        return [];
    }
}

export function syncRustExtraFolders(folders = getExtraWorkspaceFolders()): Promise<void> {
    const run = syncQueue.then(() => import("@/lib/backend").then(({ commands }) => commands.setExtraWorkspaceFolders(folders).then(() => undefined)));
    syncQueue = run.catch(() => {});
    return run;
}

export function setExtraWorkspaceFolders(folders: string[]): void {
    const unique = [...new Set(folders.map(normalizePath))];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(unique));
    initialSynced = true;
    void syncRustExtraFolders(unique).catch(() => {});
    window.dispatchEvent(new Event("bettershape-workspace-folders-changed"));
}

export function clearExtraWorkspaceFolders(): Promise<void> {
    if (typeof window === "undefined") return Promise.resolve();
    localStorage.removeItem(STORAGE_KEY);
    initialSynced = true;
    const p = syncRustExtraFolders([]).catch(() => {});
    window.dispatchEvent(new Event("bettershape-workspace-folders-changed"));
    return p;
}

export function addWorkspaceFolder(path: string): void {
    const normalized = normalizePath(path);
    const existing = getExtraWorkspaceFolders();
    if (!existing.includes(normalized)) {
        setExtraWorkspaceFolders([...existing, normalized]);
    }
}

export function removeWorkspaceFolder(path: string): void {
    const normalized = normalizePath(path);
    setExtraWorkspaceFolders(getExtraWorkspaceFolders().filter((p) => p !== normalized));
}

/** All roots in a multi-root workspace (primary project first). */
export function getWorkspaceRoots(primaryPath: string | null): string[] {
    const roots: string[] = [];
    if (primaryPath) {
        roots.push(normalizePath(primaryPath));
    }
    for (const folder of getExtraWorkspaceFolders()) {
        if (!roots.includes(folder)) {
            roots.push(folder);
        }
    }
    return roots;
}

/**
 * True when two paths point at the same folder, ignoring separators and
 * trailing slashes. Case is folded only on a case-insensitive filesystem:
 * `/repo` and `/Repo` are two folders on Linux.
 */
export function isSameWorkspacePath(a: string, b: string): boolean {
    const left = normalizePath(a);
    const right = normalizePath(b);
    if (!left || !right) return false;
    return foldCase(left) === foldCase(right);
}

function foldCase(path: string): string {
    return isCaseInsensitivePath(path) ? path.toLowerCase() : path;
}

export function workspaceFolderLabel(path: string): string {
    const parts = normalizePath(path).split("/").filter(Boolean);
    return parts[parts.length - 1] || path;
}
