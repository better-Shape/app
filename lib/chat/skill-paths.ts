/**
 * Path manipulation for agent skill roots and prompt citations.
 * Runs in the renderer without Node's `path` module and handles both POSIX and Windows paths.
 */

import {
    collapseRootAwareForwardSlashes,
    detectWindowsVerbatimKind,
    reattachWindowsVerbatim,
    stripWindowsVerbatim,
    trimRootTrailingForwardSlashes,
    type WindowsVerbatimKind,
} from "@/lib/path/verbatim";
import { isWindows } from "@/lib/platform";

type SepPredicate = (char: string) => boolean;

const isForwardSep: SepPredicate = (char) => char === "/";
const isAnyPathSep: SepPredicate = (char) => char === "/" || char === "\\";

const DRIVE_SPECIFIER_RE = /^[A-Za-z]:$/;
const WINDOWS_DRIVE_PREFIX_RE = /^[A-Za-z]:/;
const UNC_FORWARD_PREFIX_RE = /^\/\/[^/\\]/;

const isDriveSpecifier = (value: string): boolean => DRIVE_SPECIFIER_RE.test(value);

/**
 * True when `path` uses Windows drive/backslash syntax or is a `//server` UNC path on Windows.
 * Leading `//` on POSIX remains case-sensitive per POSIX.1-2017 §4.13.
 */
export function isCaseInsensitiveSkillPath(path: string): boolean {
    const stripped = stripWindowsVerbatim(path, isWindows());
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

/**
 * Normalize Windows verbatim/backslash separators to forward slashes, collapse duplicate `/`
 * runs (and 3+ leading POSIX slashes to `/`), and drop trailing separators while preserving
 * POSIX literal backslashes, exact two-slash `//`, and `X:/`.
 */
export function normalizeSkillPath(path: string): string {
    const stripped = stripWindowsVerbatim(path, isWindows());
    const forward = isCaseInsensitiveSkillPath(stripped)
        ? stripped.replaceAll("\\", "/")
        : stripped;
    return trimRootTrailingForwardSlashes(collapseRootAwareForwardSlashes(forward));
}

const hasDriveWithoutForwardSep = (stripped: string): boolean =>
    WINDOWS_DRIVE_PREFIX_RE.test(stripped) && !stripped.includes("/");

const usesWindowsBackslashSep = (dir: string): boolean => {
    const windowsHost = isWindows();
    if (detectWindowsVerbatimKind(dir, windowsHost) !== null) return true;
    const stripped = stripWindowsVerbatim(dir, windowsHost);
    if (stripped.startsWith("/")) return false;
    return stripped.includes("\\") || hasDriveWithoutForwardSep(stripped);
};

/**
 * Return the path separator already used by `dir` (`\` on Windows backslash/drive/verbatim paths,
 * `/` otherwise).
 */
export function skillPathSep(dir: string): "\\" | "/" {
    return usesWindowsBackslashSep(dir) ? "\\" : "/";
}

const needsJoinSeparator = (base: string, sep: "\\" | "/"): boolean =>
    Boolean(base) && !base.endsWith(sep) && !isDriveSpecifier(base);

const appendJoinedSegment = (base: string, relative: string, sep: "\\" | "/"): string => {
    if (!relative) return base;
    return needsJoinSeparator(base, sep) ? `${base}${sep}${relative}` : `${base}${relative}`;
};

const prepareJoinDir = (dir: string, verbatimKind: WindowsVerbatimKind): string => {
    const stripped = stripWindowsVerbatim(dir, isWindows());
    return verbatimKind === null ? stripped : stripped.replaceAll("/", "\\");
};

/**
 * Join `dir` and `relativePath` using `dir`'s separator while preserving Windows
 * extended-length verbatim prefixes (`\\?\` / `\\?\UNC\`), POSIX literal backslashes,
 * and `X:` drive-relative paths.
 */
export function joinSkillPath(dir: string, relativePath: string): string {
    const verbatimKind = detectWindowsVerbatimKind(dir, isWindows());
    const cleanDir = prepareJoinDir(dir, verbatimKind);
    const sep = skillPathSep(dir);
    const isSep = isCaseInsensitiveSkillPath(cleanDir) ? isAnyPathSep : isForwardSep;
    const relative = collapseSeparators(trimLeadingSeparators(relativePath, isSep), sep, isSep);
    const base = trimRootAwareTrailingSeparators(cleanDir, sep, isSep);
    return reattachWindowsVerbatim(appendJoinedSegment(base, relative, sep), verbatimKind);
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

const isDriveRelativeDescendant = (childKey: string, driveParent: string): boolean =>
    childKey.startsWith(driveParent) && !childKey.startsWith(`${driveParent}/`);

const isPosixRootDescendant = (childKey: string): boolean =>
    childKey.startsWith("/") && !childKey.startsWith("//");

/** Builds the slash-bounded prefix for non-`/` normalized parents (`//`, `X:/`, `/dir`). */
const resolveDescendantPrefix = (parentKey: string): string =>
    parentKey === "//" || parentKey.endsWith("/") ? parentKey : `${parentKey}/`;

/**
 * Checks strict descendant containment while keeping bare `X:` disjoint from `X:/` and
 * POSIX `//` disjoint from `/`.
 */
const isStrictDescendantKey = (childKey: string, parentKey: string): boolean => {
    if (isDriveSpecifier(parentKey)) return isDriveRelativeDescendant(childKey, parentKey);
    if (parentKey === "/") return isPosixRootDescendant(childKey);
    return childKey.startsWith(resolveDescendantPrefix(parentKey));
};

/**
 * Containment check for skill paths: preserves case on POSIX paths while folding case on
 * Windows paths, and handles `/`, `//`, `X:/`, and bare `X:` drive-relative prefixes cleanly.
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
