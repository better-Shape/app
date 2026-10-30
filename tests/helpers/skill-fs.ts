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
    const normalize = (path: string) => {
        const forward = path.replaceAll("\\", "/");
        let end = forward.length;
        while (end > 1 && forward.charCodeAt(end - 1) === 47) end -= 1;
        return forward.slice(0, end);
    };
    const links = new Map(
        Object.entries(options.symlinks ?? {}).map(([from, to]) => [normalize(from), normalize(to)]),
    );
    const canonicalize = (rawPath: string): string => {
        let current = normalize(rawPath);
        for (let depth = 0; depth < 8; depth += 1) {
            let replaced = false;
            for (const [linkFrom, linkTo] of links.entries()) {
                if (current === linkFrom) {
                    current = linkTo;
                    replaced = true;
                    break;
                }
                if (current.startsWith(`${linkFrom}/`)) {
                    current = `${linkTo}${current.slice(linkFrom.length)}`;
                    replaced = true;
                    break;
                }
            }
            if (!replaced) break;
        }
        return current;
    };

    const normalized = new Map(Object.entries(files).map(([path, body]) => [normalize(path), body]));
    const directories = new Set<string>();
    for (const path of normalized.keys()) {
        const parts = path.split("/");
        for (let index = 1; index < parts.length; index += 1) {
            directories.add(parts.slice(0, index).join("/") || "/");
        }
    }
    for (const linkFrom of links.keys()) {
        const parts = linkFrom.split("/");
        for (let index = 1; index <= parts.length; index += 1) {
            directories.add(parts.slice(0, index).join("/") || "/");
        }
    }

    mocks.lsDir.mockImplementation(async (path: string) => {
        const requestedDir = normalize(path);
        const dir = canonicalize(requestedDir);
        if (!directories.has(dir)) throw new Error(`no such directory: ${path}`);
        const prefix = dir === "/" ? "/" : `${dir}/`;
        const requestedPrefix = requestedDir === "/" ? "/" : `${requestedDir}/`;
        const names = new Set<string>();
        const entries: { name: string; path: string; is_dir: boolean }[] = [];
        for (const candidate of [...normalized.keys(), ...directories]) {
            if (!candidate.startsWith(prefix) || candidate === dir) continue;
            const rest = candidate.slice(prefix.length);
            if (!rest) continue;
            const [name, ...tail] = rest.split("/");
            if (names.has(name)) continue;
            names.add(name);
            const isDir = tail.length > 0 || links.has(`${requestedPrefix}${name}`) || directories.has(`${prefix}${name}`);
            entries.push({ name, path: `${requestedPrefix}${name}`, is_dir: isDir });
        }
        return entries.sort((a, b) => a.name.localeCompare(b.name));
    });

    const read = async (path: string) => {
        const body = normalized.get(canonicalize(path));
        if (body === undefined) throw new Error(`no such file: ${path}`);
        return body;
    };

    mocks.readFileFromDisk.mockImplementation(read);

    const inside = (child: string, parent: string) => {
        const file = canonicalize(child).toLowerCase();
        const root = canonicalize(parent).toLowerCase();
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
