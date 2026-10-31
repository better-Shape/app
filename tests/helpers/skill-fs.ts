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

/** True when `raw` is a backslash UNC path or a Windows-host `//server/share` UNC path. */
const isUncRootPath = (raw: string): boolean => {
    if (raw.startsWith("\\\\")) return true;
    return isWindows() && UNC_SHARE_RE.test(raw);
};

/** Collects configured virtual paths so UNC detection covers files, symlinks, and homeDir. */
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

/**
 * Serve `commands.lsDir` / `commands.readFileFromDisk` (and optionally
 * `homeDir`) from a virtual tree of absolute paths.
 *
 * Keys are files; directories are inferred from the paths, so
 * `{ "/proj/.claude/skills/pdf/SKILL.md": "…" }` exposes a `pdf` folder inside
 * `/proj/.claude/skills`. Reads outside the tree reject, as the real backend does.
 */
export function serveSkillFs(mocks: SkillFsMocks, files: Record<string, string>, options: SkillFsOptions = {}) {
    const hasUncRoots = collectConfiguredPaths(files, options).some(isUncRootPath);

    const splitRootAndRest = (forward: string): { root: string; rest: string } => {
        const unc = hasUncRoots ? /^\/\/[^/]+\/[^/]+/.exec(forward) : null;
        if (unc) return { root: unc[0], rest: forward.slice(unc[0].length) };
        const drive = /^[A-Za-z]:/.exec(forward);
        if (drive) return { root: drive[0], rest: forward.slice(2) };
        return forward.startsWith("/")
            ? { root: "/", rest: forward.slice(1) }
            : { root: "", rest: forward };
    };

    const joinRootAndStack = (root: string, stack: string[]): string => {
        if (!root) return stack.join("/");
        if (root === "/") return `/${stack.join("/")}`;
        return stack.length > 0 ? `${root}/${stack.join("/")}` : root;
    };

    const normalize = (path: string): string => {
        const forward = path.replaceAll("\\", "/");
        const { root, rest } = splitRootAndRest(forward);
        const stack: string[] = [];
        for (const part of rest.split("/")) {
            if (!part || part === ".") continue;
            if (part === "..") stack.pop();
            else stack.push(part);
        }
        return joinRootAndStack(root, stack);
    };

    const isAbsolute = (raw: string): boolean => {
        const forward = raw.replaceAll("\\", "/");
        return forward.startsWith("/") || /^[A-Za-z]:/.test(forward);
    };

    const resolveLinkTarget = (normFrom: string, rawTo: string): string => {
        if (isAbsolute(rawTo)) return normalize(rawTo);
        const slash = normFrom.lastIndexOf("/");
        const parent = slash <= 0 ? "/" : normFrom.slice(0, slash);
        const joined = parent === "/" ? `/${rawTo}` : `${parent}/${rawTo}`;
        return normalize(joined);
    };

    const isWindowsPath = (canonical: string): boolean =>
        /^[A-Za-z]:/.test(canonical) || (hasUncRoots && canonical.startsWith("//"));
    const pathCompareKey = (canonical: string): string =>
        isWindowsPath(canonical) ? canonical.toLowerCase() : canonical;

    const links = new Map(
        Object.entries(options.symlinks ?? {}).map(([from, to]) => {
            const normFrom = normalize(from);
            return [pathCompareKey(normFrom), { from: normFrom, to: resolveLinkTarget(normFrom, to) }];
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
            const firstPrefix = root === "/" ? `/${segments[0]}` : `${root}/${segments[0]}`;
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

    const normalized = new Map(Object.entries(files).map(([path, body]) => [normalize(path), body]));
    const filesByKey = new Map(
        [...normalized.entries()].map(([path, body]) => [pathCompareKey(path), body]),
    );
    const directories = new Set<string>();
    for (const path of normalized.keys()) {
        const parts = path.split("/");
        for (let index = 1; index < parts.length; index += 1) {
            directories.add(parts.slice(0, index).join("/") || "/");
        }
    }
    const linkPaths = [...links.values()].map((link) => link.from);
    for (const linkPath of linkPaths) {
        const parts = linkPath.split("/");
        for (let index = 1; index < parts.length; index += 1) {
            directories.add(parts.slice(0, index).join("/") || "/");
        }
    }
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
        const prefixKey = pathCompareKey(dir === "/" ? "/" : `${dir}/`);
        const dirKey = pathCompareKey(dir);
        const requestedPrefix = requestedDir === "/" ? "/" : `${requestedDir}/`;
        const names = new Set<string>();
        const entries: { name: string; path: string; is_dir: boolean }[] = [];
        for (const candidate of [...normalized.keys(), ...directories, ...linkPaths]) {
            const candidateKey = pathCompareKey(candidate);
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
        const prefix = root === "/" ? "/" : `${root}/`;
        return file === root || file.startsWith(prefix);
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
