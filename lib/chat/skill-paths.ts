/**
 * Path manipulation for agent skill roots and prompt citations.
 * Runs in the renderer without Node's `path` module and handles both POSIX and Windows paths.
 */

type SepPredicate = (char: string) => boolean;

const isForwardSep: SepPredicate = (char) => char === "/";
const isAnyPathSep: SepPredicate = (char) => char === "/" || char === "\\";

const DRIVE_SPECIFIER_RE = /^[A-Za-z]:$/;
const WINDOWS_DRIVE_PREFIX_RE = /^[A-Za-z]:/;
const UNC_FORWARD_PREFIX_RE = /^\/\/[^/\\]/;

const isDriveSpecifier = (value: string): boolean => DRIVE_SPECIFIER_RE.test(value);

/** True when `path` is a Windows drive, backslash, or `//server` UNC path rather than POSIX `/...`. */
export function isCaseInsensitiveSkillPath(path: string): boolean {
    if (UNC_FORWARD_PREFIX_RE.test(path)) return true;
    if (path.startsWith("/")) return false;
    return WINDOWS_DRIVE_PREFIX_RE.test(path) || path.includes("\\");
}

const trimLeadingSeparators = (value: string, isSep: SepPredicate): string => {
    let start = 0;
    while (start < value.length && isSep(value[start])) start += 1;
    return value.slice(start);
};

const trimTrailingSeparators = (value: string, isSep: SepPredicate): string => {
    let end = value.length;
    while (end > 0 && isSep(value[end - 1])) end -= 1;
    return value.slice(0, end);
};

const isTrimmedDriveRoot = (raw: string, trimmed: string): boolean =>
    raw.length > 2 && isDriveSpecifier(trimmed);

const trimRootAwareTrailingSeparators = (
    raw: string,
    sep: "\\" | "/",
    isSep: SepPredicate,
): string => {
    if (!raw) return "";
    const trimmed = trimTrailingSeparators(raw, isSep);
    if (!trimmed) return sep;
    return isTrimmedDriveRoot(raw, trimmed) ? `${trimmed}${sep}` : trimmed;
};

const collapseSeparators = (
    value: string,
    sep: "\\" | "/",
    isSep: SepPredicate,
): string => {
    let out = "";
    let prevSep = false;
    for (const char of value) {
        if (isSep(char)) {
            if (!prevSep) out += sep;
            prevSep = true;
        } else {
            out += char;
            prevSep = false;
        }
    }
    return out;
};

const withTrailingSlash = (normalizedPath: string): string =>
    normalizedPath.endsWith("/") ? normalizedPath : `${normalizedPath}/`;

/**
 * Normalize Windows separators to forward slashes and drop trailing separators while preserving
 * POSIX literal backslashes, `/`, and `X:/` drive roots.
 */
export function normalizeSkillPath(path: string): string {
    const forward = isCaseInsensitiveSkillPath(path) ? path.replaceAll("\\", "/") : path;
    return trimRootAwareTrailingSeparators(forward, "/", isForwardSep);
}

/** Return the path separator already used by `dir` (`\` on Windows backslash paths, `/` otherwise). */
export function skillPathSep(dir: string): "\\" | "/" {
    return !dir.startsWith("/") && dir.includes("\\") ? "\\" : "/";
}

/** Join `dir` and `relativePath` using `dir`'s separator while preserving POSIX literal backslashes. */
export function joinSkillPath(dir: string, relativePath: string): string {
    const sep = skillPathSep(dir);
    const isSep = isCaseInsensitiveSkillPath(dir) ? isAnyPathSep : isForwardSep;
    const relative = collapseSeparators(trimLeadingSeparators(relativePath, isSep), sep, isSep);
    const base = trimRootAwareTrailingSeparators(dir, sep, isSep);
    if (!relative) return base;
    return base.endsWith(sep) ? `${base}${relative}` : `${base}${sep}${relative}`;
}

const toContainmentPair = (
    child: string,
    parent: string,
): { childKey: string; parentKey: string } => {
    const normalizedChild = normalizeSkillPath(child);
    const normalizedParent = normalizeSkillPath(parent);
    if (isCaseInsensitiveSkillPath(child) || isCaseInsensitiveSkillPath(parent)) {
        return {
            childKey: normalizedChild.toLowerCase(),
            parentKey: normalizedParent.toLowerCase(),
        };
    }
    return { childKey: normalizedChild, parentKey: normalizedParent };
};

/**
 * Containment check for skill paths: preserves case on POSIX paths while folding case on
 * Windows paths, and handles `/` and `X:/` roots without false prefix matches.
 */
export function isInsideSkillPath(child: string, parent: string): boolean {
    const { childKey, parentKey } = toContainmentPair(child, parent);
    if (!childKey || !parentKey) return false;
    return childKey === parentKey || childKey.startsWith(withTrailingSlash(parentKey));
}

const stripParentPrefix = (fullPath: string, rawParent: string): string => {
    const normalizedFull = normalizeSkillPath(fullPath);
    const normalizedParent = normalizeSkillPath(rawParent);
    return trimLeadingSeparators(normalizedFull.slice(normalizedParent.length), isForwardSep);
};

const tryFormatRelative = (
    fullPath: string,
    rawParent: string | null,
    rootFallback: string,
    prefix: string,
): string | null => {
    if (!rawParent || !isInsideSkillPath(fullPath, rawParent)) return null;
    const relative = stripParentPrefix(fullPath, rawParent);
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
    return (
        tryFormatRelative(fullPath, projectPath, ".", "") ??
        tryFormatRelative(fullPath, homeDir, "~", "~/") ??
        normalizeSkillPath(fullPath)
    );
}
