import { beforeEach, describe, expect, it, vi } from "vitest";
import { serveSkillFs } from "../helpers/skill-fs";

const mocks = vi.hoisted(() => ({
    lsDir: vi.fn(),
    readFileFromDisk: vi.fn(),
    readFileWithin: vi.fn(),
    ensurePathWithin: vi.fn(),
    homeDir: vi.fn(),
    getProjectPath: vi.fn(),
    listCustomSkillFolders: vi.fn(),
}));

vi.mock("@/lib/backend/commands", () => ({
    commands: {
        lsDir: mocks.lsDir,
        readFileFromDisk: mocks.readFileFromDisk,
        readFileWithin: mocks.readFileWithin,
        ensurePathWithin: mocks.ensurePathWithin,
    },
}));

vi.mock("@/lib/backend/project-state", () => ({ getProjectPath: mocks.getProjectPath }));

vi.mock("@/lib/chat/skill-folders", () => ({
    getHomeDir: mocks.homeDir,
    listCustomSkillFolders: mocks.listCustomSkillFolders,
}));

import {
    countDismissedFiles,
    dismissDiscoveredFile,
    discoverSkills,
    reconcileImportedRow,
    restoreDismissedFiles,
} from "@/lib/chat/discover-skills";
import { addSkill, listSkills } from "@/lib/chat/skills";

const PROJECT = "/home/dev/demo";
const HOME = "/home/dev";
const SKILLS_KEY = "bettershape-skills";

/** A SKILL.md body with frontmatter. */
function skillFile(name: string, description: string, body: string): string {
    return ["---", `name: ${name}`, `description: ${description}`, "---", "", body].join("\n");
}

/** Rows from a scan of the default project. */
async function discoverItems() {
    return (await discoverSkills()).items;
}

function serve(files: Record<string, string>) {
    serveSkillFs(mocks, files, { homeDir: HOME });
}

beforeEach(() => {
    mocks.lsDir.mockReset();
    mocks.readFileFromDisk.mockReset();
    mocks.readFileWithin.mockReset();
    mocks.ensurePathWithin.mockReset();
    mocks.homeDir.mockReset();
    mocks.getProjectPath.mockReset();
    mocks.listCustomSkillFolders.mockReset();
    mocks.getProjectPath.mockReturnValue(PROJECT);
    mocks.homeDir.mockResolvedValue(HOME);
    mocks.listCustomSkillFolders.mockReturnValue([]);
});

describe("discoverSkills", () => {
    it("discovers SKILL.md folders in every project skill location", async () => {
        serve({
            [`${PROJECT}/.claude/skills/pdf/SKILL.md`]: skillFile("pdf-processing", "Work with PDFs.", "# PDF\n\nSteps."),
            [`${PROJECT}/.agents/skills/release/SKILL.md`]: skillFile("release-notes", "Draft release notes.", "Body."),
            [`${PROJECT}/.github/skills/triage/SKILL.md`]: skillFile("triage", "Triage issues.", "Body."),
            [`${PROJECT}/.bettershape/skills/onboarding/SKILL.md`]: skillFile("onboarding", "Onboard a repo.", "Body."),
        });

        const items = await discoverItems();

        expect(items.map((item) => item.relPath)).toEqual([
            ".claude/skills/pdf/SKILL.md",
            ".agents/skills/release/SKILL.md",
            ".github/skills/triage/SKILL.md",
            ".bettershape/skills/onboarding/SKILL.md",
        ]);
        expect(items[0]).toMatchObject({
            name: "pdf-processing",
            description: "Work with PDFs.",
            body: "# PDF\n\nSteps.",
            folder: `${PROJECT}/.claude/skills/pdf`,
            rootLabel: ".claude/skills",
            scope: "project",
            status: "new",
            shadowed: [],
        });
    });

    it("keeps scanning decoupled files in .agents and .claude", async () => {
        serve({
            [`${PROJECT}/.agents/guide.md`]: "# Guide\n\nBody",
            [`${PROJECT}/.claude/rules.mdc`]: "Rule body",
        });

        const items = await discoverItems();

        expect(items.map((item) => item.relPath)).toEqual([".agents/guide.md", ".claude/rules.mdc"]);
        expect(items[0]).toMatchObject({ name: "guide", description: "", status: "new", folder: `${PROJECT}/.agents` });
    });

    it("ignores extensions and folders outside the conventions", async () => {
        serve({
            [`${PROJECT}/.agents/skills/notes.txt`]: "notes",
            [`${PROJECT}/.agents/skills/readme/README.md`]: "not a skill",
            [`${PROJECT}/.claude/guide.md`]: "wrong extension for this folder",
        });

        await expect(discoverSkills()).resolves.toEqual({ projectPath: PROJECT, items: [] });
    });

    it("finds personal skills in the user's home directory", async () => {
        serve({
            [`${HOME}/.claude/skills/style/SKILL.md`]: skillFile("house-style", "Write in house style.", "Body."),
            [`${HOME}/.agents/skills/commit/SKILL.md`]: skillFile("commit-messages", "Write commits.", "Body."),
        });

        const items = await discoverItems();

        expect(items.map((item) => item.relPath)).toEqual(["~/.claude/skills/style/SKILL.md", "~/.agents/skills/commit/SKILL.md"]);
        expect(items[0]).toMatchObject({ scope: "user", rootLabel: "~/.claude/skills", name: "house-style" });
    });

    it("finds skills in folders the user picked, without a project open", async () => {
        mocks.getProjectPath.mockReturnValue(null);
        mocks.listCustomSkillFolders.mockReturnValue(["/mnt/team-skills"]);
        serve({ "/mnt/team-skills/review/SKILL.md": skillFile("team-review", "Team review rules.", "Body.") });

        const items = await discoverItems();

        expect(items.map((item) => item.relPath)).toEqual(["/mnt/team-skills/review/SKILL.md"]);
        expect(items[0]).toMatchObject({ scope: "custom", projectPath: "", name: "team-review" });
    });

    it("keeps the highest-precedence file when two roots provide the same skill", async () => {
        serve({
            [`${PROJECT}/.claude/skills/guide/SKILL.md`]: skillFile("guide", "Project guide.", "Project body."),
            [`${HOME}/.claude/skills/guide/SKILL.md`]: skillFile("guide", "Personal guide.", "Personal body."),
        });

        const items = await discoverItems();

        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ relPath: ".claude/skills/guide/SKILL.md", scope: "project", body: "Project body." });
        expect(items[0].shadowed).toEqual(["~/.claude/skills/guide/SKILL.md"]);
    });

    it("marks a file as changed when a saved skill with its slug differs", async () => {
        addSkill("guide", "old body");
        serve({ [`${PROJECT}/.agents/skills/guide/SKILL.md`]: skillFile("guide", "Guide.", "new body") });

        const items = await discoverItems();

        expect(items).toHaveLength(1);
        expect(items[0].status).toBe("changed");
    });

    it("skips files that already match the saved skill", async () => {
        addSkill("guide", "Body text");
        serve({ [`${PROJECT}/.agents/guide.md`]: "Body text\n" });

        await expect(discoverSkills()).resolves.toEqual({ projectPath: PROJECT, items: [] });
    });

    it("dismisses one file without hiding another with the same name", async () => {
        serve({
            [`${PROJECT}/.agents/guide.md`]: "agent body",
            [`${PROJECT}/.claude/guide.mdc`]: "claude body",
        });

        dismissDiscoveredFile(PROJECT, ".agents/guide.md");
        const items = await discoverItems();

        expect(items.map((item) => item.relPath)).toEqual([".claude/guide.mdc"]);
        expect(countDismissedFiles(PROJECT)).toBe(1);
    });

    it("restores dismissed files", async () => {
        serve({ [`${PROJECT}/.agents/guide.md`]: "agent body" });
        dismissDiscoveredFile(PROJECT, ".agents/guide.md");

        restoreDismissedFiles(PROJECT);

        expect(countDismissedFiles(PROJECT)).toBe(0);
        await expect(discoverItems()).resolves.toHaveLength(1);
    });

    it("can include dismissed files when a mention asks for them by name", async () => {
        serve({ [`${PROJECT}/.agents/guide.md`]: "agent body" });
        dismissDiscoveredFile(PROJECT, ".agents/guide.md");

        const scan = await discoverSkills({ ignoreDismissals: true });

        expect(scan.items.map((item) => item.relPath)).toEqual([".agents/guide.md"]);
    });

    it("keeps a dismissal when no project is open", async () => {
        mocks.getProjectPath.mockReturnValue(null);
        serve({ [`${HOME}/.claude/skills/style/SKILL.md`]: skillFile("house-style", "House style.", "Body.") });

        expect(await discoverItems()).toHaveLength(1);
        dismissDiscoveredFile("", "~/.claude/skills/style/SKILL.md");

        await expect(discoverItems()).resolves.toEqual([]);
        expect(countDismissedFiles("")).toBe(1);
    });

    it("keeps dismissals scoped to the project", async () => {
        serve({ [`${PROJECT}/.agents/guide.md`]: "agent body" });
        dismissDiscoveredFile("/home/dev/other", ".agents/guide.md");

        await expect(discoverItems()).resolves.toHaveLength(1);
    });

    it("keeps case-sensitive project paths apart in dismissal keys and display paths", async () => {
        mocks.listCustomSkillFolders.mockReturnValue(["/home/dev/DEMO"]);
        serve({
            [`${PROJECT}/.agents/guide.md`]: "agent body",
            "/home/dev/DEMO/extra.md": "external body",
        });
        dismissDiscoveredFile("/home/dev/DEMO", ".agents/guide.md");

        const items = await discoverItems();
        expect(items.map((item) => item.relPath)).toEqual([
            ".agents/guide.md",
            "~/DEMO/extra.md",
        ]);
    });

    it("treats Windows project paths case-insensitively for dismissals", async () => {
        mocks.getProjectPath.mockReturnValue("c:\\work\\demo");
        serve({ "c:\\work\\demo\\.agents\\guide.md": "agent body" });
        dismissDiscoveredFile("C:\\Work\\Demo", ".agents/guide.md");

        await expect(discoverItems()).resolves.toEqual([]);
    });

    it("skips unreadable and empty files, and folders without SKILL.md", async () => {
        serve({
            [`${PROJECT}/.agents/skills/empty/SKILL.md`]: "   \n",
            [`${PROJECT}/.agents/skills/locked/SKILL.md`]: "locked",
            [`${PROJECT}/.agents/skills/notes/readme.md`]: "no SKILL.md here",
        });
        mocks.readFileWithin.mockImplementation(async (path: string) => {
            if (path.includes("locked")) throw new Error("denied");
            return "   \n";
        });

        await expect(discoverSkills()).resolves.toEqual({ projectPath: PROJECT, items: [] });
    });

    it("discards results from a scan that was superseded", async () => {
        serve({ [`${PROJECT}/.agents/guide.md`]: "guide body" });
        const served = mocks.lsDir.getMockImplementation()!;
        // Park the first listing call (the stale scan's), let later ones through.
        let releaseStale: ((entries: { name: string; path: string; is_dir: boolean }[]) => void) | null = null;
        mocks.lsDir.mockImplementation(async (path: string) => {
            if (!releaseStale) {
                return new Promise<{ name: string; path: string; is_dir: boolean }[]>((resolve) => {
                    releaseStale = resolve;
                });
            }
            return served(path);
        });

        const stale = discoverSkills({ supersede: true });
        await new Promise((resolve) => setTimeout(resolve, 0)); // stale scan is parked
        const fresh = discoverSkills({ supersede: true });
        expect((await fresh).items).toHaveLength(1);

        releaseStale!([{ name: "guide.md", path: `${PROJECT}/.agents/guide.md`, is_dir: false }]);
        await expect(stale).resolves.toEqual({ projectPath: PROJECT, items: [] });
    });

    it("discards results when a newer scan starts during a file read", async () => {
        let releaseRead: (body: string) => void = () => {};
        let readStarted: () => void = () => {};
        const started = new Promise<void>((resolve) => {
            readStarted = resolve;
        });
        serve({ [`${PROJECT}/.agents/guide.md`]: "guide body" });
        mocks.readFileWithin.mockImplementation(
            () =>
                new Promise<string>((resolve) => {
                    releaseRead = resolve;
                    readStarted();
                })
        );

        const stale = discoverSkills({ supersede: true });
        await started;
        // Closing the project while the read is in flight supersedes the scan.
        mocks.getProjectPath.mockReturnValue(null);
        await expect(discoverSkills({ supersede: true })).resolves.toEqual({ projectPath: null, items: [] });
        releaseRead("guide body");

        await expect(stale).resolves.toEqual({ projectPath: PROJECT, items: [] });
    });

    it("does not let a mention lookup cancel another scan", async () => {
        serve({ [`${PROJECT}/.agents/guide.md`]: "guide body" });

        const [panel, lookup] = await Promise.all([
            discoverSkills({ supersede: true }),
            discoverSkills({ includeUnchanged: true }),
        ]);

        expect(panel.items).toHaveLength(1);
        expect(lookup.items).toHaveLength(1);
    });

    it("skips a project skill root that does not stay inside the project", async () => {
        serve({ [`${PROJECT}/.agents/guide.md`]: "agent body" });
        mocks.ensurePathWithin.mockRejectedValue(new Error("outside"));

        await expect(discoverItems()).resolves.toEqual([]);
    });

    it("shares dismissals across UNC case variants and still reads and restores legacy mixed-case UNC keys", async () => {
        const uncUpper = "\\\\Server\\Share\\Demo";
        const uncLower = "\\\\server\\share\\demo";
        mocks.getProjectPath.mockReturnValue(uncUpper);
        serveSkillFs(
            mocks,
            {
                [`${uncUpper}\\.agents\\guide.md`]: "guide body",
                [`${uncUpper}\\.agents\\legacy.md`]: "legacy body",
            },
            { homeDir: HOME },
        );
        localStorage.setItem(
            "bettershape-dismissed-discovered://Server/Share/Demo",
            JSON.stringify([".agents/legacy.md"]),
        );
        dismissDiscoveredFile(uncLower, ".agents/guide.md");

        await expect(discoverItems()).resolves.toEqual([]);
        expect(localStorage.getItem("bettershape-dismissed-discovered://Server/Share/Demo")).toBeNull();

        localStorage.setItem(
            "bettershape-dismissed-discovered://Server/Share/Demo",
            JSON.stringify([".agents/legacy.md"]),
        );
        restoreDismissedFiles(uncLower);
        await expect(discoverItems()).resolves.toHaveLength(2);

        // On POSIX, leading `//` paths remain case-sensitive and keep separate dismissals.
        const uaSpy = vi
            .spyOn(window.navigator, "userAgent", "get")
            .mockReturnValue("Mozilla/5.0 (X11; Linux x86_64)");
        try {
            dismissDiscoveredFile("//opt/Repo", ".agents/guide.md");
            mocks.getProjectPath.mockReturnValue("//opt/repo");
            serveSkillFs(
                mocks,
                { "//opt/repo/.agents/guide.md": "guide body" },
                { homeDir: HOME },
            );
            await expect(discoverItems()).resolves.toHaveLength(1);
        } finally {
            uaSpy.mockRestore();
        }
    });

    it("resolves multi-segment descendants through a symlink targeting POSIX root without misclassifying as UNC", async () => {
        serveSkillFs(
            mocks,
            { "/etc/secrets/token.txt": "top-secret" },
            {
                homeDir: HOME,
                symlinks: { [`${PROJECT}/root-link`]: "/" },
            },
        );
        await expect(
            mocks.readFileWithin(`${PROJECT}/root-link/etc/secrets/token.txt`, "/etc"),
        ).resolves.toBe("top-secret");
        await expect(
            mocks.readFileWithin(`${PROJECT}/root-link/etc/secrets/token.txt`, PROJECT),
        ).rejects.toThrow("outside root");
    });

    it("survives stored skills without a name", async () => {
        localStorage.setItem(SKILLS_KEY, JSON.stringify([{ id: "legacy", body: "body" }]));
        serve({ [`${PROJECT}/.agents/guide.md`]: "body" });

        await expect(discoverItems()).resolves.toHaveLength(1);
    });

    it("deduplicates symlinked project skill roots (.claude/skills -> .agents/skills)", async () => {
        serveSkillFs(
            mocks,
            {
                [`${PROJECT}/.agents/skills/pdf/SKILL.md`]: skillFile(
                    "pdf-processing",
                    "Work with PDFs.",
                    "# PDF\n\nSteps.",
                ),
            },
            {
                homeDir: HOME,
                symlinks: {
                    [`${PROJECT}/.claude/skills`]: `${PROJECT}/.agents/skills`,
                },
            },
        );

        const items = await discoverItems();
        expect(items).toHaveLength(1);
        expect(items[0].relPath).toBe(".claude/skills/pdf/SKILL.md");
        expect(items[0].name).toBe("pdf-processing");
    });

    it("deduplicates symlinked individual skill subfolders across roots", async () => {
        serveSkillFs(
            mocks,
            {
                [`${PROJECT}/.claude/skills/pdf/SKILL.md`]: skillFile(
                    "pdf-processing",
                    "Work with PDFs.",
                    "# PDF\n\nSteps.",
                ),
                [`${PROJECT}/.agents/skills/release/SKILL.md`]: skillFile(
                    "release-notes",
                    "Draft release notes.",
                    "Body.",
                ),
            },
            {
                homeDir: HOME,
                symlinks: {
                    [`${PROJECT}/.agents/skills/pdf`]: `${PROJECT}/.claude/skills/pdf`,
                },
            },
        );

        const items = await discoverItems();
        expect(items.map((item) => item.relPath)).toEqual([
            ".claude/skills/pdf/SKILL.md",
            ".agents/skills/release/SKILL.md",
        ]);
    });

    it("discovers symlinked skill subfolders pointing elsewhere inside the project and skips extensionless files", async () => {
        serveSkillFs(
            mocks,
            {
                [`${PROJECT}/.claude/skills/LICENSE`]: "MIT",
                [`${PROJECT}/.claude/skills/Makefile`]: "all:",
                [`${PROJECT}/shared/pdf-skill/SKILL.md`]: skillFile(
                    "pdf-processing",
                    "Work with PDFs.",
                    "# PDF\n\nSteps.",
                ),
            },
            {
                homeDir: HOME,
                symlinks: {
                    [`${PROJECT}/.claude/skills/pdf`]: `${PROJECT}/shared/pdf-skill`,
                },
            },
        );

        const items = await discoverItems();
        expect(items).toHaveLength(1);
        expect(items[0].relPath).toBe(".claude/skills/pdf/SKILL.md");
        expect(items[0].rootPath).toBe(`${PROJECT}/shared/pdf-skill`);
        const listedPaths = mocks.lsDir.mock.calls.map(([dir]) => dir);
        expect(listedPaths).not.toContain(`${PROJECT}/.claude/skills/LICENSE`);
        expect(listedPaths).not.toContain(`${PROJECT}/.claude/skills/Makefile`);
    });

    it("rejects POSIX sibling symlinks and relative parent-traversal symlinks escaping the project", async () => {
        serveSkillFs(
            mocks,
            {
                "/home/dev/DEMO/escape/SKILL.md": skillFile("escape", "Outside.", "Secret."),
                "/home/dev/outside/leak/SKILL.md": skillFile("leak", "Outside.", "Secret."),
            },
            {
                homeDir: HOME,
                symlinks: {
                    [`${PROJECT}/.claude/skills/escape`]: "/home/dev/DEMO/escape",
                    [`${PROJECT}/.agents/skills/leak`]: "../../../outside/leak",
                },
            },
        );

        await expect(discoverItems()).resolves.toEqual([]);
        expect(mocks.ensurePathWithin).toHaveBeenCalledWith(
            `${PROJECT}/.agents/skills/leak`,
            PROJECT,
        );
    });

    it("rejects deep symlink chains (>8 hops) and supports root-level '/' confinement", async () => {
        const symlinks: Record<string, string> = {};
        for (let hop = 0; hop < 10; hop += 1) {
            symlinks[`${PROJECT}/.claude/skills/hop-${hop}`] =
                hop < 9 ? `${PROJECT}/.claude/skills/hop-${hop + 1}` : "/home/dev/outside/secret";
        }
        serveSkillFs(
            mocks,
            {
                "/home/dev/outside/secret/SKILL.md": skillFile("secret", "Outside.", "Secret."),
            },
            { homeDir: HOME, symlinks },
        );

        await expect(discoverItems()).resolves.toEqual([]);
        await expect(
            mocks.ensurePathWithin(`${PROJECT}/.claude/skills/hop-0`, "/"),
        ).resolves.toBe("/home/dev/outside/secret");
    });

    it("resolves Windows symlinked skill folders case-insensitively", async () => {
        serveSkillFs(
            mocks,
            {
                "C:/Users/Ada/Demo/Shared/Pdf-Skill/SKILL.md": skillFile(
                    "pdf-win",
                    "Windows skill.",
                    "Steps.",
                ),
            },
            {
                homeDir: "C:/Users/Ada",
                symlinks: {
                    "C:/Users/Ada/Demo/.claude/skills/pdf": "C:/Users/Ada/Demo/Shared/Pdf-Skill",
                },
            },
        );

        mocks.getProjectPath.mockReturnValue("c:\\users\\ada\\demo");
        const result = await discoverSkills();
        expect(result.items).toHaveLength(1);
        expect(result.items[0].name).toBe("pdf-win");
    });

    it("resolves deep >8-hop symlink chains, enforces leftmost prefix precedence, and tolerates symlink cycles alongside valid skills", async () => {
        const symlinks: Record<string, string> = {};
        // 13-hop chain (escape-chain -> hop-1..hop-12 -> /outside) must resolve all 13 symlinks and be rejected.
        symlinks[`${PROJECT}/.claude/skills/escape-chain`] = `${PROJECT}/hops/hop-1`;
        for (let step = 1; step < 12; step += 1) {
            symlinks[`${PROJECT}/hops/hop-${step}`] = `${PROJECT}/hops/hop-${step + 1}`;
        }
        symlinks[`${PROJECT}/hops/hop-12`] = "/outside/stolen-skill";

        // 13-hop chain (safe-chain -> hop-1..hop-12 -> shared/deep-safe) must resolve all 13 symlinks and load.
        symlinks[`${PROJECT}/.claude/skills/safe-chain`] = `${PROJECT}/safe-hops/hop-1`;
        for (let step = 1; step < 12; step += 1) {
            symlinks[`${PROJECT}/safe-hops/hop-${step}`] = `${PROJECT}/safe-hops/hop-${step + 1}`;
        }
        symlinks[`${PROJECT}/safe-hops/hop-12`] = `${PROJECT}/shared/deep-safe`;

        // Adversarial insertion order: nested child inserted BEFORE outer parent symlink to /outside.
        symlinks[`${PROJECT}/.claude/skills/order-trap/sub`] = `${PROJECT}/shared/deep-safe`;
        symlinks[`${PROJECT}/.claude/skills/order-trap`] = "/outside";

        // Symlink cycle alongside valid skills -> must not crash lsDir for valid siblings.
        symlinks[`${PROJECT}/.claude/skills/loop-a`] = `${PROJECT}/.claude/skills/loop-b`;
        symlinks[`${PROJECT}/.claude/skills/loop-b`] = `${PROJECT}/.claude/skills/loop-a`;

        serveSkillFs(
            mocks,
            {
                "/outside/stolen-skill/SKILL.md": skillFile("stolen", "Outside.", "Body."),
                "/outside/sub/SKILL.md": skillFile("trap", "Outside trap.", "Body."),
                [`${PROJECT}/shared/deep-safe/SKILL.md`]: skillFile(
                    "deep-safe",
                    "Safe 13-hop skill.",
                    "Steps.",
                ),
            },
            { homeDir: "/Users/dev", symlinks },
        );

        const result = await discoverSkills();
        expect(result.items.map((item) => item.name)).toEqual(["deep-safe"]);
        await expect(
            mocks.ensurePathWithin(`${PROJECT}/.claude/skills/order-trap/sub`, PROJECT),
        ).rejects.toThrow("outside root");
    });

    it("resolves relative symlinks mounted directly under POSIX root without UNC misparsing", async () => {
        serveSkillFs(
            mocks,
            {
                "/real-claude/skills/root-tool/SKILL.md": skillFile(
                    "root-tool",
                    "Root relative symlink.",
                    "Body.",
                ),
            },
            {
                homeDir: null,
                symlinks: {
                    "/.claude": "real-claude",
                },
            },
        );

        mocks.getProjectPath.mockReturnValue("/");
        const result = await discoverSkills();
        expect(result.items.map((item) => item.name)).toEqual(["root-tool"]);
    });
});

describe("reconcileImportedRow", () => {
    /** A discovered row for `dir/file` with the given body. */
    const row = (relPath: string, body: string, status: "new" | "changed" = "new") => ({
        name: relPath.split("/")[1].replace(/\..*$/, ""),
        description: "",
        body,
        fileName: relPath.split("/")[1],
        folder: `${PROJECT}/${relPath.split("/")[0]}`,
        // `rootPath` bounds later reads to the root that advertised the file, so
        // a discovered row is never complete without it.
        rootPath: PROJECT,
        relPath,
        projectPath: PROJECT,
        scope: "project" as const,
        rootLabel: relPath.split("/")[0],
        status,
        shadowed: [],
    });

    it("drops the imported row and reclassifies files that share its skill ID", () => {
        const items = [
            row(".agents/guide.md", "imported body"),
            row(".claude/guide.mdc", "other body"),
            row(".agents/notes.md", "notes"),
        ];

        const remaining = reconcileImportedRow(items, ".agents/guide.md", { id: "guide", body: "imported body" });

        expect(remaining.map((item) => item.relPath)).toEqual([".claude/guide.mdc", ".agents/notes.md"]);
        expect(remaining[0].status).toBe("changed");
        expect(remaining[1].status).toBe("new");
    });

    it("drops files that already match the saved body", () => {
        const items = [row(".claude/guide.mdc", "imported body")];

        expect(reconcileImportedRow(items, ".agents/guide.md", { id: "guide", body: "imported body" })).toEqual([]);
    });
});

describe("listSkills", () => {
    it("ignores stored records without an ID, name, or body", () => {
        localStorage.setItem(
            SKILLS_KEY,
            JSON.stringify([
                { id: "good", name: "Good", body: "body" },
                { id: "no-name", body: "body" },
                { name: "No ID", body: "body" },
                { id: "no-body", name: "No Body" },
                null,
            ])
        );

        expect(listSkills().map((skill) => skill.id)).toEqual(["good"]);
    });
});
