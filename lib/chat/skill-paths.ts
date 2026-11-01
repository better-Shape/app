/**
 * Path manipulation for agent skill roots and prompt citations.
 * Runs in the renderer without Node's `path` module and handles both POSIX and Windows paths.
 */

import { isWindows } from "@/lib/platform";

type SepPredicate = (char: string) => boolean;

const isForwardSep: SepPredicate = (char) => char === "/";
const isAnyPathSep: SepPredicate = (char) => char === "/" || char === "\\";

const DRIVE_SPECIFIER_RE = /^[A-Za-z]:$/;
const WINDOWS_DRIVE_PREFIX_RE = /^[A-Za-z]:/;
const UNC_FORWARD_PREFIX_RE = /^\/\/[^/\\]/;
const POSIX_EXACT_DOUBLE_SLASH_RE = /^\/\/(?!\/)/;
const VERBATIM_BACKSLASH_UNC_RE = /^\\\\\?\\UNC\\/i;
const VERBATIM_BACKSLASH_DRIVE_RE = /^\\\\\?\\[A-Za-z]:/;
const VERBATIM_FORWARD_UNC_RE = /^\/\/\?\/UNC\//i;
const VERBATIM_FORWARD_DRIVE_RE = /^\/\/\?\/[A-Za-z]:/;

const isDriveSpecifier = (value: string): boolean => DRIVE_SPECIFIER_RE.test(value);

/** Strips backslash-prefixed Windows extended-length verbatim paths (`\\?\` and `\\?\UNC\`). */
const stripBackslashVerbatimPrefix = (raw: string): string | null => {
    if (VERBATIM_BACKSLASH_UNC_RE.test(raw)) return `\\\\${raw.slice(8)}`;
    return VERBATIM_BACKSLASH_DRIVE_RE.test(raw) ? raw.slice(4) : null;
};

/** Strips forward-slash `//?/` verbatim prefixes on Windows hosts. */
const stripForwardVerbatimPrefix = (raw: string): string => {
    if (VERBATIM_FORWARD_UNC_RE.test(raw)) return `//${raw.slice(8)}`;
    return VERBATIM_FORWARD_DRIVE_RE.test(raw) ? raw.slice(4) : raw;
};

/** Strips Windows extended-length verbatim prefixes emitted by Rust `std::fs::canonicalize`. */
const stripWindowsVerbatimPrefix = (raw: string): string => {
    const strippedBackslash = stripBackslashVerbatimPrefix(raw);
    if (strippedBackslash !== null) return strippedBackslash;
    return isWindows() ? stripForwardVerbatimPrefix(raw) : raw;
};

/**
 * True when `path` uses Windows drive/backslash syntax or is a `//server` UNC path on Windows.
 * Leading `//` on POSIX remains case-sensitive per POSIX.1-2017 §4.13.
 */
export function isCaseInsensitiveSkillPath(path: string): boolean {
    const stripped = stripWindowsVerbatimPrefix(path);
    if (UNC_FORWARD_PREFIX_RE.test(stripped)) return isWindows();
    if (stripped.startsWith("/")) return false;
    return WINDOWS_DRIVE_PREFIX_RE.test(stripped) || stripped.includes("\\");
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

/** Preserves exact two-separator roots (`//` / `\\`) while collapsing 3+ separators to one. */
const formatAllSeparatorRoot = (raw: string, sep: "\\" | "/"): string =>
    raw.length === 2 ? `${sep}${sep}` : sep;

/** Trims trailing separators while preserving `/`, `//`, and `X:/` root prefixes. */
const trimRootAwareTrailingSeparators = (
    raw: string,
    sep: "\\" | "/",
    isSep: SepPredicate,
): string => {
    if (!raw) return "";
    const trimmed = trimTrailingSeparators(raw, isSep);
    if (!trimmed) return formatAllSeparatorRoot(raw, sep);
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

const collapsePosixLeadingSlashes = (forward: string): string => {
    if (!forward.startsWith("///")) return forward;
    const rest = trimLeadingSeparators(forward, isForwardSep);
    return rest ? `/${rest}` : "/";
};

const collapseInternalSlashes = (value: string): string => {
    const prefix = POSIX_EXACT_DOUBLE_SLASH_RE.test(value) ? "//" : "";
    const body = collapseSeparators(value.slice(prefix.length), "/", isForwardSep);
    return `${prefix}${body}`;
};

/**
 * Normalize Windows verbatim/backslash separators to forward slashes, collapse duplicate `/`
 * runs (and 3+ leading POSIX slashes to `/`), and drop trailing separators while preserving
 * POSIX literal backslashes, exact two-slash `//`, and `X:/`.
 */
export function normalizeSkillPath(path: string): string {
    const stripped = stripWindowsVerbatimPrefix(path);
    const forward = isCaseInsensitiveSkillPath(stripped)
        ? stripped.replaceAll("\\", "/")
        : stripped;
    const trimmed = trimRootAwareTrailingSeparators(forward, "/", isForwardSep);
    return collapseInternalSlashes(collapsePosixLeadingSlashes(trimmed));
}

const usesWindowsBackslashSep = (dir: string): boolean => {
    const stripped = stripWindowsVerbatimPrefix(dir);
    if (stripped.startsWith("/")) return false;
    return (
        stripped.includes("\\") ||
        (WINDOWS_DRIVE_PREFIX_RE.test(stripped) && !stripped.includes("/"))
    );
};

/**
 * Return the path separator already used by `dir` (`\` on Windows backslash/drive paths,
 * `/` otherwise).
 */
export function skillPathSep(dir: string): "\\" | "/" {
    return usesWindowsBackslashSep(dir) ? "\\" : "/";
}

const needsJoinSeparator = (base: string, sep: "\\" | "/"): boolean =>
    Boolean(base) && !base.endsWith(sep) && !isDriveSpecifier(base);

/**
 * Join `dir` and `relativePath` using `dir`'s separator while preserving POSIX literal
 * backslashes and `X:` drive-relative prefixes.
 */
export function joinSkillPath(dir: string, relativePath: string): string {
    const cleanDir = stripWindowsVerbatimPrefix(dir);
    const sep = skillPathSep(cleanDir);
    const isSep = isCaseInsensitiveSkillPath(cleanDir) ? isAnyPathSep : isForwardSep;
    const relative = collapseSeparators(trimLeadingSeparators(relativePath, isSep), sep, isSep);
    const base = trimRootAwareTrailingSeparators(cleanDir, sep, isSep);
    if (!relative) return base;
    return needsJoinSeparator(base, sep) ? `${base}${sep}${relative}` : `${base}${relative}`;
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
 * Checks strict descendant containment while keeping bare `X:` disjoint from `X:/` and
 * POSIX `//` disjoint from `/`.
 */
const isStrictDescendantKey = (childKey: string, parentKey: string): boolean => {
    if (isDriveSpecifier(parentKey)) {
        return childKey.startsWith(parentKey) && !childKey.startsWith(`${parentKey}/`);
    }
    if (parentKey === "/") {
        return childKey.startsWith("/") && !childKey.startsWith("//");
    }
    return childKey.startsWith(withTrailingSlash(parentKey));
};

/**
 * Containment check for skill paths: preserves case on POSIX paths while folding case on
 * Windows paths, and handles `/`, `X:/`, and bare `X:` drive-relative prefixes cleanly.
 */
export function isInsideSkillPath(child: string, parent: string): boolean {
    const { childKey, parentKey } = toContainmentPair(child, parent);
    if (!childKey || !parentKey) return false;
    return childKey === parentKey || isStrictDescendantKey(childKey, parentKey);
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
