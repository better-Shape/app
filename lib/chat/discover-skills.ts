"use client";

import { commands } from "@/lib/backend/commands";
import { getProjectPath } from "@/lib/backend/project-state";
import { getHomeDir, listCustomSkillFolders } from "@/lib/chat/skill-folders";
import { parseSkillDocument } from "@/lib/chat/skill-frontmatter";
import {
    displaySkillPath,
    isCaseInsensitiveSkillPath,
    joinSkillPath,
    normalizeSkillPath,
} from "@/lib/chat/skill-paths";
import { SKILL_FILE_NAME, listSkillRoots, type SkillRoot, type SkillRootScope } from "@/lib/chat/skill-roots";
import { listSkills, skillIdFromName, skillTitle, type Skill } from "@/lib/chat/skills";

export type DiscoveredSkill = {
    /** Frontmatter name, or the folder/file name when the skill has no frontmatter. */
    name: string;
    /** Frontmatter description; empty for loose markdown files. */
    description: string;
    body: string;
    fileName: string;
    /** Folder the skill lives in — the base for relative `scripts/` and `references/` paths. */
    folder: string;
    /** Root that advertised this file. Later reads must stay inside it. */
    rootPath: string;
    /**
     * Stable identity for React keys, dismissal storage, and list removal:
     * project-relative (`.claude/skills/pdf/SKILL.md`), `~/…` for user-level
     * skills, or absolute for folders the user picked.
     */
    relPath: string;
    /** Project the file was found in — dismissals are stored per project. */
    projectPath: string;
    /** Which root produced this row. */
    scope: SkillRootScope;
    /** Root label for the UI, e.g. `.claude/skills` or `~/.claude/skills`. */
    rootLabel: string;
    /** "new" — no saved skill uses this slug; "changed" — a saved skill differs from disk. */
    status: "new" | "changed";
    /** Other roots that also provide this skill ID (lower precedence, shadowed). */
    shadowed: string[];
};

/** One scan's findings together with the project they were read from. */
export type SkillScan = {
    /** Project the scan read, or null when no project was open. */
    projectPath: string | null;
    items: DiscoveredSkill[];
};

/** Prefix for the per-project localStorage key holding dismissed files. */
const DISMISSED_KEY_PREFIX = "bettershape-dismissed-discovered:";

/**
 * LocalStorage key storing dismissed paths for one project. The path keeps its
 * case everywhere except case-insensitive filesystems, so `/home/dev/Repo` and
 * `/home/dev/repo` do not share dismissals on Linux.
 */
function dismissedKey(projectPath: string): string {
    const scoped = normalizeSkillPath(projectPath);
    const folded = isCaseInsensitiveSkillPath(projectPath) ? scoped.toLowerCase() : scoped;
    return DISMISSED_KEY_PREFIX + folded;
}

/** True when `fileName` ends with one of `extensions`, ignoring case. */
function hasExtension(fileName: string, extensions: readonly string[]): boolean {
    const lower = fileName.toLowerCase();
    return extensions.some((extension) => lower.endsWith(extension));
}

/** Read a dismissed-path set from a specific localStorage key. */
function dismissedFilesFromKey(key: string): Set<string> {
    try {
        const raw = window.localStorage.getItem(key);
        return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
        return new Set();
    }
}

const isLegacyCaseVariantKey = (
    candidate: string | null,
    primaryKey: string,
): candidate is string =>
    candidate !== null && candidate !== primaryKey && candidate.toLowerCase() === primaryKey;

/** Collect legacy mixed-case localStorage keys matching `primaryKey`. */
function collectCaseVariantKeys(primaryKey: string): string[] {
    const extras: string[] = [];
    for (let idx = 0; idx < window.localStorage.length; idx += 1) {
        const candidate = window.localStorage.key(idx);
        if (isLegacyCaseVariantKey(candidate, primaryKey)) extras.push(candidate);
    }
    return extras;
}

/** Return the canonical dismissal key plus any legacy mixed-case keys for `projectPath`. */
function matchingDismissedKeys(projectPath: string): [string, ...string[]] {
    const primaryKey = dismissedKey(projectPath);
    if (!isCaseInsensitiveSkillPath(projectPath)) return [primaryKey];
    return [primaryKey, ...collectCaseVariantKeys(primaryKey)];
}

/**
 * Paths dismissed in a project. Dismissing `.claude/skills/guide/SKILL.md`
 * leaves every other skill file visible; also reads any legacy mixed-case UNC key.
 */
function dismissedFiles(projectPath: string): Set<string> {
    if (typeof window === "undefined") return new Set();
    const set = new Set<string>();
    for (const key of matchingDismissedKeys(projectPath)) {
        for (const entry of dismissedFilesFromKey(key)) set.add(entry);
    }
    return set;
}

/** Dismiss a discovered file for the project it was shown in. */
export function dismissDiscoveredFile(projectPath: string, relPath: string) {
    if (typeof window === "undefined") return;
    const [primaryKey, ...legacyKeys] = matchingDismissedKeys(projectPath);
    const set = dismissedFiles(projectPath);
    set.add(relPath);
    window.localStorage.setItem(primaryKey, JSON.stringify([...set]));
    for (const legacyKey of legacyKeys) window.localStorage.removeItem(legacyKey);
}

/** How many files the user dismissed in this project. */
export function countDismissedFiles(projectPath: string): number {
    return dismissedFiles(projectPath).size;
}

/** Bring every dismissed file back into the Discovered list. */
export function restoreDismissedFiles(projectPath: string): void {
    if (typeof window === "undefined") return;
    for (const key of matchingDismissedKeys(projectPath)) {
        window.localStorage.removeItem(key);
    }
}

/** Candidate skill files under one root, as `{ fileName, filePath, folder }`. */
type SkillFile = { fileName: string; filePath: string; folder: string };

/** Loose files directly inside a flat root (`.agents/*.md`, `.claude/*.mdc`). */
async function listFlatFiles(root: SkillRoot): Promise<SkillFile[]> {
    const extensions = root.extensions ?? [".md"];
    const entries = await commands.lsDir(root.path);
    return entries
        .filter((entry) => !entry.is_dir && hasExtension(entry.name, extensions))
        .map((entry) => ({
            fileName: entry.name,
            filePath: joinSkillPath(root.path, entry.name),
            folder: root.path,
        }));
}

/**
 * Skill folders inside a skills root: `<root>/SKILL.md` for the root itself and
 * `<root>/<name>/SKILL.md` for every skill folder directly inside it.
 */
async function listSkillDirFiles(root: SkillRoot): Promise<SkillFile[]> {
    const files: SkillFile[] = [];
    const rootFile = joinSkillPath(root.path, SKILL_FILE_NAME);
    let entries;
    try {
        entries = await commands.lsDir(root.path);
    } catch {
        return files;
    }

    if (entries.some((entry) => !entry.is_dir && entry.name === SKILL_FILE_NAME)) {
        files.push({ fileName: SKILL_FILE_NAME, filePath: rootFile, folder: root.path });
    }

    const dirs = entries
        .filter((entry) => entry.is_dir)
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));

    for (const dir of dirs) {
        const folder = joinSkillPath(root.path, dir);
        let children;
        try {
            children = await commands.lsDir(folder);
        } catch {
            continue; // unreadable folder
        }
        if (!children.some((entry) => !entry.is_dir && entry.name === SKILL_FILE_NAME)) continue;
        files.push({ fileName: SKILL_FILE_NAME, filePath: joinSkillPath(folder, SKILL_FILE_NAME), folder });
    }

    return files;
}

let nextScanGen = 0; // generation counter to discard stale concurrent scans

/** True when a newer scan has started, so this one must not report results. */
function isSuperseded(scanGen: number): boolean {
    return scanGen !== nextScanGen;
}

/** Whether a file was already dismissed for the project being scanned. */
function isDismissed(dismissed: Set<string>, relPath: string): boolean {
    return dismissed.has(relPath);
}

/** True when `path` or its originating `contextPath` belongs to a case-insensitive root. */
function isCaseInsensitiveContext(path: string, contextPath?: string | null): boolean {
    if (isCaseInsensitiveSkillPath(path)) return true;
    return contextPath ? isCaseInsensitiveSkillPath(contextPath) : false;
}

/** Case-aware comparison key for canonicalized filesystem paths. */
function canonicalPathKey(path: string, contextPath?: string | null): string {
    const normalized = normalizeSkillPath(path);
    return isCaseInsensitiveContext(path, contextPath) ? normalized.toLowerCase() : normalized;
}

/** Checks directory containment using a trailing slash so sibling stems never match. */
const isKeyWithinBase = (folderKey: string, baseKey: string): boolean => {
    const basePrefix = baseKey.endsWith("/") ? baseKey : `${baseKey}/`;
    return folderKey === baseKey || folderKey.startsWith(basePrefix);
};

/**
 * Chooses the confinement root passed to `readFileWithin`. When a skill subfolder
 * inside the project is a verified symlink to another project directory (such as
 * `shared/pdf-skill`), confine reads to that resolved subfolder rather than the
 * outer `.claude/skills` directory.
 */
function resolveSkillReadRoot(
    rootPath: string,
    canonicalRoot: string | null,
    fileFolder: string,
    canonicalFolder: string,
): string {
    if (fileFolder === rootPath || canonicalFolder === fileFolder) return rootPath;
    const baseKey = canonicalPathKey(canonicalRoot ?? rootPath, rootPath);
    return isKeyWithinBase(canonicalPathKey(canonicalFolder, rootPath), baseKey)
        ? rootPath
        : canonicalFolder;
}

/**
 * Confirms `dirPath` canonicalizes inside `projectPath` and returns that canonical
 * path (falling back to `dirPath` when a test stub returns void). Returns `null`
 * when the symlink target leaves `projectPath`.
 */
async function resolveProjectCanonicalDir(
    dirPath: string,
    projectPath: string,
): Promise<string | null> {
    try {
        const resolved = await commands.ensurePathWithin(dirPath, projectPath);
        return typeof resolved === "string" && resolved.length > 0 ? resolved : dirPath;
    } catch {
        return null;
    }
}

/**
 * Scan every known skill location — the project's `.claude/skills`,
 * `.agents/skills`, `.github/skills` and `.bettershape/skills` folders, the loose
 * `.agents/*.md` / `.claude/*.mdc` files, the folders the user picked in
 * Settings, and the user-level `~/.claude/skills` and `~/.agents/skills`
 * folders — for skills that are new or changed since import.
 *
 * Dismissed files are skipped. Files are matched to saved skills by the same
 * slug `addSkill` persists, so a file that would replace an existing skill is
 * reported as "changed" instead of being offered as a fresh import. The result
 * carries the project that was read, so callers never show one project's files
 * as another's.
 */
export async function discoverSkills(
    options: { ignoreDismissals?: boolean; includeUnchanged?: boolean; supersede?: boolean } = {}
): Promise<SkillScan> {
    // Only panel refreshes opt into supersession. A mention lookup must not
    // discard the refresh that is already reading, or be discarded by one.
    const tracked = options.supersede === true;
    const scanGen = tracked ? ++nextScanGen : nextScanGen;
    const superseded = () => tracked && isSuperseded(scanGen);

    const projectPath = getProjectPath();
    const homeDir = await getHomeDir();
    // A project is not required: user-level and picked folders are still useful.
    const roots = listSkillRoots({
        projectPath,
        homeDir,
        customFolders: listCustomSkillFolders(),
    });

    const savedBySkillId = new Map<string, string>();
    for (const skill of listSkills()) {
        savedBySkillId.set(skill.id, skill.body);
    }

    // Dismissals live under the same key whether or not a project is open, so a
    // file dismissed while no project was open stays dismissed.
    const dismissed = options.ignoreDismissals ? new Set<string>() : dismissedFiles(projectPath ?? "");
    const discovered: DiscoveredSkill[] = [];
    /** Highest-precedence row per skill ID, used to note shadowed duplicates. */
    const bySkillId = new Map<string, DiscoveredSkill>();
    const seenCanonicalRoots = new Set<string>();
    const seenPaths = new Set<string>();

    for (const root of roots) {
        if (superseded()) return { projectPath, items: [] };

        let files: SkillFile[];
        try {
            files = root.kind === "flat" ? await listFlatFiles(root) : await listSkillDirFiles(root);
        } catch {
            continue; // root doesn't exist or is unreadable
        }

        let canonicalRoot: string | null = null;
        if (root.scope === "project" && projectPath) {
            canonicalRoot = await resolveProjectCanonicalDir(root.path, projectPath);
            if (!canonicalRoot) continue;
            const rootKey = canonicalPathKey(canonicalRoot, projectPath);
            if (seenCanonicalRoots.has(rootKey)) continue;
            seenCanonicalRoots.add(rootKey);
        }

        for (const file of files) {
            if (superseded()) return { projectPath, items: [] };

            let canonicalFolder = canonicalRoot !== null && file.folder === root.path
                ? canonicalRoot
                : file.folder;
            if (root.scope === "project" && projectPath && file.folder !== root.path) {
                const resolvedSubdir = await resolveProjectCanonicalDir(file.folder, projectPath);
                if (!resolvedSubdir) continue;
                canonicalFolder = resolvedSubdir;
            }

            const relPath = displaySkillPath(file.filePath, projectPath, homeDir);
            const canonicalFile =
                canonicalFolder !== file.folder
                    ? joinSkillPath(canonicalFolder, file.fileName)
                    : file.filePath;
            const fileKey = canonicalPathKey(canonicalFile, root.path);
            if (seenPaths.has(fileKey)) continue;
            seenPaths.add(fileKey);
            if (isDismissed(dismissed, relPath)) continue;

            const readRoot = resolveSkillReadRoot(
                root.path,
                canonicalRoot,
                file.folder,
                canonicalFolder,
            );

            let raw: string;
            try {
                raw = await commands.readFileWithin(file.filePath, readRoot);
            } catch {
                continue; // unreadable, or a symlink that leaves this root
            }

            const fallbackName = skillTitle(
                root.kind === "skills-dir" ? file.folder.split(/[\\/]/).pop() || file.fileName : file.fileName
            );
            const parsed = parseSkillDocument(raw, fallbackName);
            if (!parsed.body) continue;

            const skillId = skillIdFromName(parsed.name);
            const existingBody = savedBySkillId.get(skillId);

            // Two files with the same slug in one scope are separate skills that
            // would replace each other on import, so both stay visible (the panel
            // offers the second as an update once the first is imported). A file
            // from a lower-precedence scope is shadowed instead.
            const winner = bySkillId.get(skillId);
            if (winner && winner.scope !== root.scope) {
                winner.shadowed.push(relPath);
                continue;
            }

            if (existingBody === parsed.body && !options.includeUnchanged) continue;

            const row: DiscoveredSkill = {
                name: parsed.name,
                description: parsed.description,
                body: parsed.body,
                fileName: file.fileName,
                folder: file.folder,
                rootPath: readRoot,
                relPath,
                projectPath: projectPath ?? "",
                scope: root.scope,
                rootLabel: root.label,
                status: existingBody === undefined ? "new" : "changed",
                shadowed: [],
            };
            if (!winner) bySkillId.set(skillId, row);
            discovered.push(row);
        }
    }

    // The last read may have resolved after a newer scan started.
    if (superseded()) return { projectPath, items: [] };

    return { projectPath, items: discovered };
}

/**
 * Rows left after importing one of them: the imported row is gone, and rows
 * that share its skill ID become updates (or disappear when they already match
 * the body that was just saved), matching what a rescan would report.
 */
export function reconcileImportedRow(
    items: DiscoveredSkill[],
    relPath: string,
    saved: Pick<Skill, "id" | "body">
): DiscoveredSkill[] {
    return items.flatMap((item) => {
        if (item.relPath === relPath) return [];
        if (skillIdFromName(item.name) !== saved.id) return [item];
        return item.body === saved.body ? [] : [{ ...item, status: "changed" as const }];
    });
}
