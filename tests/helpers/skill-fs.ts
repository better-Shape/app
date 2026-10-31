import type { Mock } from "vitest";
import { isWindows } from "@/lib/platform";

export type SkillFsMocks = {
    lsDir: Mock;
    readFileFromDisk: Mock;
    readFileWithin?: Mock;
    ensurePathWithin?: Mock;
    homeDir?: Mock;
};

export type SkillFsOptions = {
    /** Directory treated as the user's home (`~`). */
    homeDir?: string | null;
    /** Directory symlinks (`linkPath -> targetPath`) resolved during canonical checks. */
    symlinks?: Record<string, string>;
};

const UNC_SHARE_RE = /^\/\/[^/\\]+\/[^/\\]+/;
const POSIX_DOUBLE_SLASH_RE = /^\/\/(?=[^/])/;

/** True when `raw` uses backslash UNC syntax or `//server/share` on a Windows host. */
const isRawUncCandidate = (raw: string): boolean =>
    raw.startsWith("\\\\") || (isWindows() && raw.startsWith("//"));

/** Extracts the lowercase `//server/share` root when `raw` is a UNC path. */
const extractUncShareKey = (raw: string): string | null => {
    if (!isRawUncCandidate(raw)) return null;
    const match = UNC_SHARE_RE.exec(raw.replaceAll("\\", "/"));
    return match ? match[0].toLowerCase() : null;
};

/** Collects configured virtual paths across `files`, `symlinks`, and `homeDir`. */
const collectConfiguredPaths = (
    files: Record<string, string>,
    options: SkillFsOptions,
): string[] => {
    const symlinks = options.symlinks ?? {};
    const paths = [
        ...Object.keys(files),
        ...Object.keys(symlinks),
        ...Object.values(symlinks),
    ];
    if (options.homeDir) paths.push(options.homeDir);
    return paths;
};

/** Builds the set of lowercase `//server/share` UNC roots declared in the fixture. */
const collectUncShareKeys = (
    files: Record<string, string>,
    options: SkillFsOptions,
): Set<string> => {
    const keys = new Set<string>();
    for (const raw of collectConfiguredPaths(files, options)) {
        const shareKey = extractUncShareKey(raw);
        if (shareKey) keys.add(shareKey);
    }
    return keys;
};

/** Converts Windows backslashes to `/` while preserving POSIX literal backslashes. */
const toForwardPath = (raw: string): string => {
    if (isRawUncCandidate(raw)) return raw.replaceAll("\\", "/");
    return raw.startsWith("/") ? raw : raw.replaceAll("\\", "/");
};

/** Splits non-UNC slash-rooted or relative paths while keeping POSIX `//` distinct from `/`. */
const splitSlashRoot = (forward: string): { root: string; rest: string } => {
    if (POSIX_DOUBLE_SLASH_RE.test(forward)) {
        return { root: "//", rest: forward.slice(2) };
    }
    return forward.startsWith("/")
        ? { root: "/", rest: forward.slice(1) }
        : { root: "", rest: forward };
};

/** Joins a parsed root prefix (`""`, `"/"`, `"//"`, `"X:"`, or `"//server/share"`) and segments. */
const joinRootAndStack = (root: string, stack: string[]): string => {
    if (!root) return stack.join("/");
    if (root.endsWith("/")) return `${root}${stack.join("/")}`;
    return stack.length > 0 ? `${root}/${stack.join("/")}` : root;
};

/**
 * Serve `commands.lsDir` / `commands.readFileFromDisk` (and optionally
 * `homeDir`) from a virtual tree of absolute paths.
 *
 * Keys are files; directories are inferred from the paths, so
 * `{ "/proj/.claude/skills/pdf/SKILL.md": "…" }` exposes a `pdf` folder inside
 * `/proj/.claude/skills`. Reads outside the tree reject, as the real backend does.
 */
export function serveSkillFs(
    mocks: SkillFsMocks,
    files: Record<string, string>,
    options: SkillFsOptions = {},
) {
    const uncShareKeys = collectUncShareKeys(files, options);

    const matchUncShareRoot = (forward: string): string | null => {
        const match = UNC_SHARE_RE.exec(forward);
        if (!match) return null;
        return uncShareKeys.has(match[0].toLowerCase()) ? match[0] : null;
    };

    const splitRootAndRest = (forward: string): { root: string; rest: string } => {
        const uncRoot = matchUncShareRoot(forward);
        if (uncRoot) return { root: uncRoot, rest: forward.slice(uncRoot.length) };
        const drive = /^[A-Za-z]:/.exec(forward);
        if (drive) return { root: drive[0], rest: forward.slice(2) };
        return splitSlashRoot(forward);
    };

    const normalize = (path: string): string => {
        const { root, rest } = splitRootAndRest(toForwardPath(path));
        const stack: string[] = [];
        for (const part of rest.split("/")) {
            if (!part || part === ".") continue;
            if (part === "..") stack.pop();
            else stack.push(part);
        }
        return joinRootAndStack(root, stack);
    };

    const isAbsolute = (raw: string): boolean => {
        const forward = toForwardPath(raw);
        return forward.startsWith("/") || /^[A-Za-z]:/.test(forward);
    };

    const resolveLinkParent = (normFrom: string): string => {
        const { root, rest } = splitRootAndRest(normFrom);
        const segments = rest.split("/").filter(Boolean);
        segments.pop();
        return joinRootAndStack(root, segments) || "/";
    };

    const resolveLinkTarget = (normFrom: string, rawTo: string): string => {
        if (isAbsolute(rawTo)) return normalize(rawTo);
        const parent = resolveLinkParent(normFrom);
        const joined = parent.endsWith("/") ? `${parent}${rawTo}` : `${parent}/${rawTo}`;
        return normalize(joined);
    };

    const isWindowsPath = (canonical: string): boolean =>
        /^[A-Za-z]:/.test(canonical) || matchUncShareRoot(canonical) !== null;
    const pathCompareKey = (canonical: string): string =>
        isWindowsPath(canonical) ? canonical.toLowerCase() : canonical;

    const links = new Map(
        Object.entries(options.symlinks ?? {}).map(([from, to]) => {
            const normFrom = normalize(from);
            const target = resolveLinkTarget(normFrom, to);
            return [pathCompareKey(normFrom), { from: normFrom, to: target }];
        }),
    );
    const appendNormalizedSuffix = (base: string, suffix: string): string =>
        normalize(base.endsWith("/") ? `${base}${suffix}` : `${base}/${suffix}`);

    const stepSymlinkSubstitution = (current: string): string | null => {
        const { root, rest } = splitRootAndRest(current);
        const segments = rest.split("/").filter(Boolean);
        if (segments.length === 0) {
            return links.get(pathCompareKey(current))?.to ?? null;
        }
        let prefix = "";
        for (let index = 0; index < segments.length; index += 1) {
            const firstPrefix = root.endsWith("/")
                ? `${root}${segments[0]}`
                : `${root}/${segments[0]}`;
            prefix = index === 0 ? firstPrefix : `${prefix}/${segments[index]}`;
            const link = links.get(pathCompareKey(prefix));
            if (link) {
                const suffix = segments.slice(index + 1).join("/");
                return suffix ? appendNormalizedSuffix(link.to, suffix) : link.to;
            }
        }
        return null;
    };

    const MAX_SYMLINK_HOPS = 40;
    const canonicalize = (rawPath: string): string => {
        let current = normalize(rawPath);
        for (let hops = 0; hops < MAX_SYMLINK_HOPS; hops += 1) {
            const next = stepSymlinkSubstitution(current);
            if (next === null) return current;
            current = next;
        }
        if (stepSymlinkSubstitution(current) === null) return current;
        throw new Error(`too many levels of symbolic links: ${rawPath}`);
    };

    const normalized = new Map(
        Object.entries(files).map(([path, body]) => [normalize(path), body]),
    );
    const filesByKey = new Map(
        [...normalized.entries()].map(([path, body]) => [pathCompareKey(path), body]),
    );
    const directories = new Set<string>();
    const addAncestorDirectories = (path: string): void => {
        const { root, rest } = splitRootAndRest(path);
        if (root) directories.add(root);
        const segments = rest.split("/").filter(Boolean);
        for (let index = 1; index < segments.length; index += 1) {
            directories.add(joinRootAndStack(root, segments.slice(0, index)));
        }
    };
    for (const path of normalized.keys()) addAncestorDirectories(path);
    const linkPaths = [...links.values()].map((link) => link.from);
    for (const linkPath of linkPaths) addAncestorDirectories(linkPath);
    const directoryKeys = new Map(
        [...directories].map((dir) => [pathCompareKey(dir), dir]),
    );

    const resolveEntryIsDir = (entryPath: string, hasNestedSegments: boolean): boolean => {
        if (hasNestedSegments) return true;
        try {
            const targetEntry = canonicalize(entryPath);
            return directoryKeys.has(pathCompareKey(targetEntry));
        } catch {
            return false;
        }
    };

    mocks.lsDir.mockImplementation(async (path: string) => {
        const requestedDir = normalize(path);
        const canonicalDir = canonicalize(requestedDir);
        const dir = directoryKeys.get(pathCompareKey(canonicalDir));
        if (!dir) throw new Error(`no such directory: ${path}`);
        const prefixKey = pathCompareKey(dir.endsWith("/") ? dir : `${dir}/`);
        const dirKey = pathCompareKey(dir);
        const requestedPrefix = requestedDir.endsWith("/") ? requestedDir : `${requestedDir}/`;
        const names = new Set<string>();
        const entries: { name: string; path: string; is_dir: boolean }[] = [];
        for (const candidate of [...normalized.keys(), ...directories, ...linkPaths]) {
            const candidateKey = pathCompareKey(candidate);
            if (dirKey === "/" && candidateKey.startsWith("//")) continue;
            if (!candidateKey.startsWith(prefixKey) || candidateKey === dirKey) continue;
            const rest = candidate.slice(prefixKey.length);
            if (!rest) continue;
            const [name, ...tail] = rest.split("/");
            if (names.has(name)) continue;
            names.add(name);
            const entryPath = `${requestedPrefix}${name}`;
            const isDir = resolveEntryIsDir(entryPath, tail.length > 0);
            entries.push({ name, path: entryPath, is_dir: isDir });
        }
        return entries.sort((a, b) => a.name.localeCompare(b.name));
    });

    const read = async (path: string) => {
        const body = filesByKey.get(pathCompareKey(canonicalize(path)));
        if (body === undefined) throw new Error(`no such file: ${path}`);
        return body;
    };

    mocks.readFileFromDisk.mockImplementation(read);

    const inside = (child: string, parent: string) => {
        const file = pathCompareKey(canonicalize(child));
        const root = pathCompareKey(canonicalize(parent));
        if (file === root) return true;
        if (root === "/") return file.startsWith("/") && !file.startsWith("//");
        const prefix = root.endsWith("/") ? root : `${root}/`;
        return file.startsWith(prefix);
    };

    mocks.readFileWithin?.mockImplementation(async (path: string, root: string) => {
        if (!inside(path, root)) throw new Error(`outside root: ${path}`);
        return read(path);
    });

    mocks.ensurePathWithin?.mockImplementation(async (path: string, root: string) => {
        if (!inside(path, root)) throw new Error(`outside root: ${path}`);
        return canonicalize(path);
    });

    if (mocks.homeDir) {
        mocks.homeDir.mockImplementation(async () => options.homeDir ?? null);
    }
}
