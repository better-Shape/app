export type MarkdownHrefKind =
    | { kind: "external"; href: string }
    | { kind: "anchor"; href: string }
    | { kind: "workspace"; path: string }
    | { kind: "blocked" };

const EXTERNAL_SCHEME_RE = /^(?:https?:\/\/|mailto:)/i;
const GENERIC_URI_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+._-]*:/;
const WINDOWS_DRIVE_PATH_RE = /^[a-zA-Z]:[\\/]/;

/**
 * Classifies a Markdown link target with a strict URI scheme allowlist so untrusted
 * schemes (`javascript:`, `data:`, `vbscript:`, `file:`, `http_evil:`) never reach
 * `<a href>` or `openProjectFile`.
 */
export const classifyMarkdownHref = (rawHref: string | undefined | null): MarkdownHrefKind => {
    const trimmed = (rawHref ?? "").trim();
    if (!trimmed) return { kind: "blocked" };

    if (trimmed.startsWith("#")) {
        return { kind: "anchor", href: trimmed };
    }

    if (EXTERNAL_SCHEME_RE.test(trimmed)) {
        return { kind: "external", href: trimmed };
    }

    // Protocol-relative URLs (`//evil.example`) or any non-allowlisted URI scheme
    // (`javascript:`, `data:`, `vbscript:`, `file:`, `blob:`, `http_evil:`) are blocked,
    // while Windows drive paths (`C:\repo\file.ts`) remain valid workspace paths.
    if (trimmed.startsWith("//")) {
        return { kind: "blocked" };
    }
    if (GENERIC_URI_SCHEME_RE.test(trimmed) && !WINDOWS_DRIVE_PATH_RE.test(trimmed)) {
        return { kind: "blocked" };
    }

    const queryIdx = trimmed.indexOf("?");
    const hashIdx = trimmed.indexOf("#");
    const suffixStart =
        queryIdx === -1 ? hashIdx : hashIdx === -1 ? queryIdx : Math.min(queryIdx, hashIdx);
    const cleanPath = (suffixStart === -1 ? trimmed : trimmed.slice(0, suffixStart)).trim();
    if (!cleanPath) return { kind: "blocked" };

    return { kind: "workspace", path: cleanPath };
};
