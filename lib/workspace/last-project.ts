const LAST_PROJECT_KEY = "bettershape:last-project";
/** Pre-rename key; read once so an existing install keeps its last project. */
const LEGACY_LAST_PROJECT_KEY = "shape:last-project";

/** Path restored when BetterShape is reopened (not when New Window is used). */
export function loadLastProject(): string | null {
    if (typeof window === "undefined") return null;
    try {
        const path = window.localStorage.getItem(LAST_PROJECT_KEY);
        if (path && path.trim()) return path;
        const legacy = window.localStorage.getItem(LEGACY_LAST_PROJECT_KEY);
        if (legacy && legacy.trim()) {
            saveLastProject(legacy);
            window.localStorage.removeItem(LEGACY_LAST_PROJECT_KEY);
            return legacy.trim().replace(/(?<![\\/])[\\/]+$/, "");
        }
        return null;
    } catch {
        return null;
    }
}

export function saveLastProject(path: string | null) {
    if (typeof window === "undefined") return;
    try {
        if (!path?.trim()) {
            window.localStorage.removeItem(LAST_PROJECT_KEY);
            return;
        }
        window.localStorage.setItem(LAST_PROJECT_KEY, path.trim().replace(/(?<![\\/])[\\/]+$/, ""));
    } catch {
        /* ignore quota / private mode */
    }
}
