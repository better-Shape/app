import type { Mock } from "vitest";

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

/**
 * Serve `commands.lsDir` / `commands.readFileFromDisk` (and optionally
 * `homeDir`) from a virtual tree of absolute paths.
 *
 * Keys are files; directories are inferred from the paths, so
 * `{ "/proj/.claude/skills/pdf/SKILL.md": "…" }` exposes a `pdf` folder inside
 * `/proj/.claude/skills`. Reads outside the tree reject, as the real backend does.
 */
export function serveSkillFs(mocks: SkillFsMocks, files: Record<string, string>, options: SkillFsOptions = {}) {
    const splitRootAndRest = (forward: string): { root: string; rest: string } => {
        const unc = /^\/\/[^/]+\/[^/]+/.exec(forward);
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
        return normalize(`${parent}/${rawTo}`);
    };

    const isWindowsPath = (canonical: string): boolean =>
        /^[A-Za-z]:/.test(canonical) || canonical.startsWith("//");
    const pathCompareKey = (canonical: string): string =>
        isWindowsPath(canonical) ? canonical.toLowerCase() : canonical;

    const links = new Map(
        Object.entries(options.symlinks ?? {}).map(([from, to]) => {
            const normFrom = normalize(from);
            return [pathCompareKey(normFrom), { from: normFrom, to: resolveLinkTarget(normFrom, to) }];
        }),
    );
    const canonicalize = (rawPath: string): string => {
        let current = normalize(rawPath);
        for (let depth = 0; depth < 8; depth += 1) {
            let replaced = false;
            const currentKey = pathCompareKey(current);
            for (const [fromKey, link] of links.entries()) {
                if (currentKey === fromKey) {
                    current = link.to;
                    replaced = true;
                    break;
                }
                if (currentKey.startsWith(`${fromKey}/`)) {
                    current = `${link.to}${current.slice(link.from.length)}`;
                    replaced = true;
                    break;
                }
            }
            if (!replaced) break;
        }
        return current;
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
    for (const link of links.values()) {
        const parts = link.from.split("/");
        for (let index = 1; index <= parts.length; index += 1) {
            directories.add(parts.slice(0, index).join("/") || "/");
        }
    }
    const directoryKeys = new Map(
        [...directories].map((dir) => [pathCompareKey(dir), dir]),
    );

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
        for (const candidate of [...normalized.keys(), ...directories]) {
            const candidateKey = pathCompareKey(candidate);
            if (!candidateKey.startsWith(prefixKey) || candidateKey === dirKey) continue;
            const rest = candidate.slice(prefixKey.length);
            if (!rest) continue;
            const [name, ...tail] = rest.split("/");
            if (names.has(name)) continue;
            names.add(name);
            const targetEntry = canonicalize(`${requestedPrefix}${name}`);
            const isDir = tail.length > 0 || directoryKeys.has(pathCompareKey(targetEntry));
            entries.push({ name, path: `${requestedPrefix}${name}`, is_dir: isDir });
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
        return file === root || file.startsWith(`${root}/`);
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
