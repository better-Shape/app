/**
 * Path manipulation for agent skill roots and prompt citations.
 * Runs in the renderer without Node's `path` module and handles both POSIX and Windows paths.
 */

/** Normalize separators to forward slashes and drop trailing slashes while preserving `/`. */
export function normalizeSkillPath(path: string): string {
    const forward = path.replaceAll("\\", "/");
    if (/^\/+$/.test(forward)) return "/";
    return forward.replace(/\/+$/, "");
}

/** Return the path separator already used by `dir` (`\` on Windows paths, `/` otherwise). */
export function skillPathSep(dir: string): "\\" | "/" {
    return dir.includes("\\") ? "\\" : "/";
}

/** Join `dir` and `relativePath` using `dir`'s separator without duplicating slashes. */
export function joinSkillPath(dir: string, relativePath: string): string {
    const sep = skillPathSep(dir);
    const relative = relativePath.replace(/^[\\/]+/, "").replaceAll(/[\\/]+/g, sep);
    if (/^[\\/]+$/.test(dir)) return `${sep}${relative}`;
    const base = dir.replace(/[\\/]+$/, "");
    return relative ? `${base}${sep}${relative}` : base;
}

/** Case-insensitive containment check for skill display paths, including `/` as parent. */
export function isInsideSkillPath(child: string, parent: string): boolean {
    const normalizedChild = normalizeSkillPath(child).toLowerCase();
    const normalizedParent = normalizeSkillPath(parent).toLowerCase();
    if (!normalizedChild || !normalizedParent) return false;
    const prefix = normalizedParent === "/" ? "/" : `${normalizedParent}/`;
    return normalizedChild === normalizedParent || normalizedChild.startsWith(prefix);
}

const stripParentPrefix = (normalizedFull: string, rawParent: string): string => {
    const normalizedParent = normalizeSkillPath(rawParent);
    return normalizedFull.slice(normalizedParent.length).replace(/^\/+/, "");
};

const tryFormatRelative = (
    normalizedFull: string,
    rawParent: string | null,
    rootFallback: string,
    prefix: string,
): string | null => {
    if (!rawParent || !isInsideSkillPath(normalizedFull, rawParent)) return null;
    const relative = stripParentPrefix(normalizedFull, rawParent);
    return relative ? `${prefix}${relative}` : rootFallback;
};

/**
 * Format a `SKILL.md` path for prompt citations and UI labels: project-relative inside
 * `projectPath`, `~/...` inside `homeDir`, and the normalized path everywhere else.
 */
export function displaySkillPath(
    fullPath: string,
    projectPath: string | null,
    homeDir: string | null,
): string {
    const normalized = normalizeSkillPath(fullPath);
    return (
        tryFormatRelative(normalized, projectPath, ".", "") ??
        tryFormatRelative(normalized, homeDir, "~", "~/") ??
        normalized
    );
}
