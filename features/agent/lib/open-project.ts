import { commands, getProjectSnapshot } from "@/lib/backend";
import { clearExtraWorkspaceFolders } from "@/lib/workspace/folders";
import { ensureWorkspaceTrust, notifyWorkspaceOpened } from "@/lib/workspace/trust";

const isWinPath = (p: string) => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\");

export function normalizeProjectPath(path: string): string {
    if (!path.trim()) return "";
    const t = path.startsWith("/") ? path : path.trim();
    if (!isWinPath(t)) return t.replace(/\/+$/, "") || "/";
    const s = t.replace(/[\\/]+$/, "");
    return /^[a-zA-Z]:$/.test(s) ? `${s}\\` : s.replace(/\//g, "\\");
}

export function projectPathsEqual(
    a: string | null | undefined,
    b: string | null | undefined,
): boolean {
    if (!a || !b) return false;
    const [na, nb] = [normalizeProjectPath(a), normalizeProjectPath(b)];
    return isWinPath(na) || isWinPath(nb) ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

export function projectLeaf(path: string | null | undefined): string {
    if (!path) return "Project";
    const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
    return parts[parts.length - 1] || path;
}

/** Always-safe project switch — owned by the Agent View host, not Home. */
export async function openProject(path: string, options?: { promptTrust?: boolean }): Promise<boolean> {
    const normalized = normalizeProjectPath(path);
    if (!normalized) return false;

    const current = getProjectSnapshot().project_path;
    if (projectPathsEqual(current, normalized)) {
        if (options?.promptTrust !== false) await ensureWorkspaceTrust(normalized);
        return true;
    }

    commands.invalidateAllFileCaches();
    await commands.setProjectPath(normalized);
    await clearExtraWorkspaceFolders();
    if (options?.promptTrust !== false) await ensureWorkspaceTrust(normalized);
    notifyWorkspaceOpened(normalized);
    return true;
}
