/**
 * Path manipulation for agent skill roots and prompt citations.
 * Runs in the renderer without Node's `path` module and handles both POSIX and Windows paths.
 */

const isPathSep = (char: string): boolean => char === "/" || char === "\\";

const trimLeadingSeparators = (value: string): string => {
    let start = 0;
    while (start < value.length && isPathSep(value[start])) start += 1;
    return value.slice(start);
};

const trimTrailingSeparators = (value: string): string => {
    let end = value.length;
    while (end > 0 && isPathSep(value[end - 1])) end -= 1;
    return value.slice(0, end);
};

const collapseSeparators = (value: string, sep: "\\" | "/"): string => {
    let out = "";
    let prevSep = false;
    for (const char of value) {
        if (isPathSep(char)) {
            if (!prevSep) out += sep;
            prevSep = true;
        } else {
            out += char;
            prevSep = false;
        }
    }
    return out;
};

/** Normalize separators to forward slashes and drop trailing slashes while preserving `/`. */
export function normalizeSkillPath(path: string): string {
    const forward = path.replaceAll("\\", "/");
    if (!forward) return "";
    const trimmed = trimTrailingSeparators(forward);
    return trimmed === "" ? "/" : trimmed;
}

/** Return the path separator already used by `dir` (`\` on Windows paths, `/` otherwise). */
export function skillPathSep(dir: string): "\\" | "/" {
    return dir.includes("\\") ? "\\" : "/";
}

/** Join `dir` and `relativePath` using `dir`'s separator without duplicating slashes. */
export function joinSkillPath(dir: string, relativePath: string): string {
    const sep = skillPathSep(dir);
    const relative = collapseSeparators(trimLeadingSeparators(relativePath), sep);
    const base = trimTrailingSeparators(dir);
    if (!base && dir.length > 0) return `${sep}${relative}`;
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
    return trimLeadingSeparators(normalizedFull.slice(normalizedParent.length));
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
