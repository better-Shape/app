/**
 * Which chat a plan was created in. Remembered per plan file so that the editor's Build
 * button (which sits outside any chat) can send to that chat. Stored in localStorage so it
 * survives a reload. The first chat that showed the plan is kept: reopening the plan from
 * another chat must not move its Build target.
 */

const STORAGE_KEY = "bettershape-plan-origins";
/** Bounded so the map cannot grow without limit. Oldest entries are dropped first. */
const MAX_ENTRIES = 200;

/** One key per file, whatever separators or doubled slashes the caller used. */
export function planOriginKey(planPath: string): string {
    return planPath.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
}

/** Absolute path of a plan file: relative paths are taken from the project root. */
export function resolveProjectPlanPath(filePath: string, projectPath: string | null | undefined): string {
    // Drive paths (C:\..., C:/...), POSIX absolute paths, and Windows UNC paths (\\server\share)
    // are already absolute and must not be joined onto the project.
    if (/^[a-zA-Z]:[\\/]/.test(filePath) || /^[\\/]{2}/.test(filePath) || filePath.startsWith("/")) {
        return filePath;
    }
    if (!projectPath) return filePath;
    const joined = `${projectPath.replace(/\\/g, "/")}/${filePath.replace(/\\/g, "/")}`;
    // Keep a UNC prefix (//server/share) intact; collapse separators everywhere else.
    const uncPrefix = joined.startsWith("//") ? "//" : "";
    return uncPrefix + joined.slice(uncPrefix.length).replace(/\/+/g, "/");
}

function readAll(): Record<string, string> {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const out: Record<string, string> = {};
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof value === "string" && value) out[key] = value;
        }
        return out;
    } catch {
        return {};
    }
}

function writeAll(map: Record<string, string>): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch {
        /* storage full or unavailable: the Build button then falls back to the active chat */
    }
}

/** The chat the plan was created in, or `null` when it is unknown. */
export function getPlanOrigin(planPath: string): string | null {
    const key = planOriginKey(planPath);
    if (!key) return null;
    return readAll()[key] ?? null;
}

/**
 * Record `conversationId` as the plan's origin, if none is recorded yet. A null id (the
 * unsaved draft) records nothing, so a later real chat can still claim the plan.
 */
export function recordPlanOrigin(planPath: string, conversationId: string | null | undefined): void {
    const key = planOriginKey(planPath);
    if (!key || !conversationId) return;
    const map = readAll();
    if (map[key]) return;
    map[key] = conversationId;
    const keys = Object.keys(map);
    if (keys.length > MAX_ENTRIES) {
        for (const old of keys.slice(0, keys.length - MAX_ENTRIES)) delete map[old];
    }
    writeAll(map);
}
