/**
 * Shared cross-platform Windows verbatim-prefix (`\\?\`, `\\?\UNC\`, `//?/`) and
 * root-aware forward-slash normalization primitives used by skill discovery,
 * terminal session cwd keys, and welcome-screen display paths.
 */

export type WindowsVerbatimKind = "unc" | "drive" | null;

const POSIX_EXACT_DOUBLE_SLASH_RE = /^\/\/(?!\/)/;
const DRIVE_ROOT_PREFIX_RE = /^[A-Za-z]:\//;
const VERBATIM_BACKSLASH_UNC_RE = /^\\\\\?\\UNC\\/i;
const VERBATIM_BACKSLASH_DRIVE_RE = /^\\\\\?\\[A-Za-z]:/;
const VERBATIM_FORWARD_UNC_RE = /^\/\/\?\/UNC\//i;
const VERBATIM_FORWARD_DRIVE_RE = /^\/\/\?\/[A-Za-z]:/;

/** Classifies backslash-prefixed Windows verbatim paths (`\\?\` and `\\?\UNC\`). */
const detectBackslashVerbatimKind = (raw: string): WindowsVerbatimKind => {
    if (VERBATIM_BACKSLASH_UNC_RE.test(raw)) return "unc";
    return VERBATIM_BACKSLASH_DRIVE_RE.test(raw) ? "drive" : null;
};

/** Classifies forward-slash `//?/` verbatim prefixes on Windows hosts. */
const detectForwardVerbatimKind = (raw: string): WindowsVerbatimKind => {
    if (VERBATIM_FORWARD_UNC_RE.test(raw)) return "unc";
    return VERBATIM_FORWARD_DRIVE_RE.test(raw) ? "drive" : null;
};

/**
 * Detects whether `raw` carries a Windows extended-length verbatim prefix (`\\?\` or `\\?\UNC\`,
 * plus `//?/` when `allowForwardPrefix` is true on a Windows host).
 */
export const detectWindowsVerbatimKind = (
    raw: string,
    allowForwardPrefix: boolean,
): WindowsVerbatimKind => {
    const backslashKind = detectBackslashVerbatimKind(raw);
    if (backslashKind !== null) return backslashKind;
    return allowForwardPrefix ? detectForwardVerbatimKind(raw) : null;
};

const stripVerbatimByKind = (
    raw: string,
    kind: Exclude<WindowsVerbatimKind, null>,
): string => (kind === "unc" ? `\\\\${raw.slice(8)}` : raw.slice(4));

/** Strips Windows extended-length verbatim prefixes emitted by Rust `std::fs::canonicalize`. */
export const stripWindowsVerbatim = (raw: string, allowForwardPrefix: boolean): string => {
    const kind = detectWindowsVerbatimKind(raw, allowForwardPrefix);
    if (kind === null) return raw;
    const stripped = stripVerbatimByKind(raw, kind);
    return raw.startsWith("//") ? stripped.replaceAll("\\", "/") : stripped;
};

const trimLeadingAnySeparators = (value: string): string => {
    let start = 0;
    while (start < value.length && (value[start] === "/" || value[start] === "\\")) {
        start += 1;
    }
    return value.slice(start);
};

/** Reattaches a Windows extended-length prefix onto a backslash-joined filesystem path. */
export const reattachWindowsVerbatim = (joined: string, kind: WindowsVerbatimKind): string => {
    if (kind === null || !joined) return joined;
    if (kind === "unc") return `\\\\?\\UNC\\${trimLeadingAnySeparators(joined)}`;
    return `\\\\?\\${joined}`;
};

/** Collapses consecutive `/` characters into a single `/`. */
export const collapseForwardSlashRuns = (value: string): string => {
    let out = "";
    let prevSlash = false;
    for (const char of value) {
        if (char === "/") {
            if (!prevSlash) out += "/";
            prevSlash = true;
        } else {
            out += char;
            prevSlash = false;
        }
    }
    return out;
};

/**
 * Collapses duplicate `/` runs while preserving an exact two-slash `//` prefix and
 * collapsing 3+ leading slashes (`///...`) to `/`.
 */
export const collapseRootAwareForwardSlashes = (forward: string): string => {
    const prefix = POSIX_EXACT_DOUBLE_SLASH_RE.test(forward) ? "//" : "";
    return `${prefix}${collapseForwardSlashRuns(forward.slice(prefix.length))}`;
};

const resolveMinForwardRootLength = (collapsed: string): number => {
    if (DRIVE_ROOT_PREFIX_RE.test(collapsed)) return 3;
    return collapsed.startsWith("//") ? 2 : 1;
};

/** Trims trailing `/` characters while preserving `/`, `//`, and `X:/` roots. */
export const trimRootTrailingForwardSlashes = (collapsed: string): string => {
    const minLength = resolveMinForwardRootLength(collapsed);
    let end = collapsed.length;
    while (end > minLength && collapsed.charCodeAt(end - 1) === 47) end -= 1;
    return collapsed.slice(0, end);
};
