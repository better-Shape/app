import { describe, expect, it, vi } from "vitest";

import {
    displaySkillPath,
    isCaseInsensitiveSkillPath,
    isInsideSkillPath,
    joinSkillPath,
    normalizeSkillPath,
    skillPathSep,
} from "@/lib/chat/skill-paths";
import { listSkillRoots } from "@/lib/chat/skill-roots";

describe("skill-paths: normalizeSkillPath", () => {
    it("converts backslashes and drops trailing separators", () => {
        expect(normalizeSkillPath("C:\\Users\\dev\\skills\\")).toBe("C:/Users/dev/skills");
        expect(normalizeSkillPath("/home/dev/skills///")).toBe("/home/dev/skills");
    });

    it("leaves an already-normalized path alone and preserves POSIX literal backslashes", () => {
        expect(normalizeSkillPath("/home/dev/.claude/skills")).toBe("/home/dev/.claude/skills");
        expect(normalizeSkillPath("/home/dev/dir\\name/")).toBe("/home/dev/dir\\name");
        expect(normalizeSkillPath("/home/dev/trailing\\")).toBe("/home/dev/trailing\\");
        expect(isCaseInsensitiveSkillPath("/home/dev/dir\\name")).toBe(false);
        expect(isCaseInsensitiveSkillPath("\\\\Server\\Share\\Demo")).toBe(true);
        const uaSpy = vi.spyOn(window.navigator, "userAgent", "get");
        try {
            uaSpy.mockReturnValue("Mozilla/5.0 (X11; Linux x86_64)");
            expect(isCaseInsensitiveSkillPath("//opt/Skills/Demo")).toBe(false);
            uaSpy.mockReturnValue("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
            expect(isCaseInsensitiveSkillPath("//Server/Share/Demo")).toBe(true);
        } finally {
            uaSpy.mockRestore();
        }
    });

    it("preserves POSIX and Windows drive roots without collapsing C:\\ to drive-relative C:", () => {
        expect(normalizeSkillPath("/")).toBe("/");
        expect(normalizeSkillPath("//")).toBe("//");
        expect(normalizeSkillPath("///")).toBe("/");
        expect(normalizeSkillPath("C:\\")).toBe("C:/");
        expect(normalizeSkillPath("C:\\\\")).toBe("C:/");
        expect(normalizeSkillPath("d:/")).toBe("d:/");
        expect(normalizeSkillPath("C:")).toBe("C:");
        const customRoots = listSkillRoots({
            projectPath: null,
            homeDir: null,
            customFolders: ["C:\\"],
        });
        expect(customRoots.map((root) => root.path)).toEqual(["C:/", "C:/"]);
        const doubleSlashRoots = listSkillRoots({
            projectPath: "//",
            homeDir: null,
            customFolders: ["//"],
        });
        expect(doubleSlashRoots.map((root) => root.path)).toEqual([
            "//.claude/skills",
            "//.agents/skills",
            "//.github/skills",
            "//.bettershape/skills",
            "//.agents",
            "//.claude",
            "//",
            "//",
        ]);
    });
});

describe("skill-paths: skillPathSep / joinSkillPath", () => {
    it("uses the separator the directory already uses", () => {
        expect(skillPathSep("/home/dev/project")).toBe("/");
        expect(skillPathSep("/home/dev/dir\\name")).toBe("/");
        expect(skillPathSep("C:\\Users\\dev\\project")).toBe("\\");
        expect(skillPathSep("C:")).toBe("\\");
        expect(skillPathSep("C:/Users/dev")).toBe("/");
    });

    it("joins with one separator even when both sides carry one", () => {
        expect(joinSkillPath("/home/dev/project/", "/.claude/skills")).toBe(
            "/home/dev/project/.claude/skills"
        );
        expect(joinSkillPath("/home/dev/dir\\name/", "/sub\\skill/SKILL.md")).toBe(
            "/home/dev/dir\\name/sub\\skill/SKILL.md"
        );
        expect(joinSkillPath("C:\\Users\\dev", "skills\\pdf")).toBe("C:\\Users\\dev\\skills\\pdf");
    });

    it("normalizes a relative path to the directory's separator", () => {
        expect(joinSkillPath("C:\\Users\\dev", "skills/pdf")).toBe("C:\\Users\\dev\\skills\\pdf");
        expect(joinSkillPath("/", ".claude/skills")).toBe("/.claude/skills");
        expect(joinSkillPath("//", ".claude/skills")).toBe("//.claude/skills");
        expect(joinSkillPath("//", "")).toBe("//");
        expect(joinSkillPath("///", "/.claude/skills")).toBe("/.claude/skills");
        expect(joinSkillPath("C:\\", ".claude/skills")).toBe("C:\\.claude\\skills");
        expect(joinSkillPath("C:\\\\", "")).toBe("C:\\");
        expect(joinSkillPath("C:/", ".claude/skills")).toBe("C:/.claude/skills");
        expect(joinSkillPath("C:", "skills")).toBe("C:skills");
        expect(joinSkillPath("C:", "/.claude/skills")).toBe("C:.claude\\skills");
        expect(joinSkillPath("C:work", "skills/pdf")).toBe("C:work\\skills\\pdf");
    });
});

describe("skill-paths: isInsideSkillPath", () => {
    it("is true for the folder itself and for its children", () => {
        expect(isInsideSkillPath("/home/dev/project", "/home/dev/project")).toBe(true);
        expect(isInsideSkillPath("/home/dev/project/.claude/skills", "/home/dev/project")).toBe(true);
        expect(isInsideSkillPath("/proj/.claude/skills/SKILL.md", "/")).toBe(true);
        expect(isInsideSkillPath("/", "/")).toBe(true);
        expect(isInsideSkillPath("C:\\proj\\SKILL.md", "/")).toBe(false);
        expect(isInsideSkillPath("C:\\proj\\SKILL.md", "C:\\")).toBe(true);
        expect(isInsideSkillPath("C:\\", "c:/")).toBe(true);
        expect(isInsideSkillPath("C:relative\\SKILL.md", "C:\\")).toBe(false);
        expect(isInsideSkillPath("D:\\proj\\SKILL.md", "C:\\")).toBe(false);
    });

    it("is false for parents, siblings, and prefix lookalikes", () => {
        expect(isInsideSkillPath("/home/dev", "/home/dev/project")).toBe(false);
        expect(isInsideSkillPath("/home/dev/project-two", "/home/dev/project")).toBe(false);
        expect(isInsideSkillPath("/home/dev/project/a", "/home/dev/project/b")).toBe(false);
    });

    it("ignores case on Windows paths while keeping POSIX paths case-sensitive", () => {
        expect(isInsideSkillPath("C:\\Users\\Dev\\Project\\.claude", "c:/users/dev/project")).toBe(
            true,
        );
        expect(isInsideSkillPath("/Home/Dev/Project/.claude", "/home/dev/project")).toBe(false);
        expect(isInsideSkillPath("C:skills/pdf/SKILL.md", "C:")).toBe(true);
        expect(isInsideSkillPath("C:/outside/SKILL.md", "C:")).toBe(false);
        expect(isInsideSkillPath("C:\\outside\\SKILL.md", "C:")).toBe(false);
        expect(isInsideSkillPath("C:skills/pdf/SKILL.md", "C:/")).toBe(false);
    });
});

describe("skill-paths: displaySkillPath", () => {
    it("returns a project-relative path for files inside the project", () => {
        expect(displaySkillPath("/home/dev/demo/.claude/skills/pdf/SKILL.md", "/home/dev/demo", "/home/dev")).toBe(
            ".claude/skills/pdf/SKILL.md"
        );
        expect(
            displaySkillPath(
                "/home/dev/Demo/.claude/skills/pdf/SKILL.md",
                "/home/dev/demo",
                "/home/dev",
            ),
        ).toBe("~/Demo/.claude/skills/pdf/SKILL.md");
    });

    it("returns a `~/…` path for files in the home directory", () => {
        expect(displaySkillPath("/home/dev/.agents/skills/commit/SKILL.md", "/home/dev/demo", "/home/dev")).toBe(
            "~/.agents/skills/commit/SKILL.md"
        );
        expect(displaySkillPath("/home/dev", "/home/dev/demo", "/home/dev")).toBe("~");
    });

    it("returns the absolute path for picked folders outside both roots", () => {
        expect(displaySkillPath("/mnt/team/review/SKILL.md", "/home/dev/demo", "/home/dev")).toBe(
            "/mnt/team/review/SKILL.md"
        );
    });

    it("falls back to the absolute path when there is no project or home directory", () => {
        expect(displaySkillPath("/home/dev/demo/.claude/skills/pdf/SKILL.md", null, null)).toBe(
            "/home/dev/demo/.claude/skills/pdf/SKILL.md"
        );
    });

    it("prefers the project label when the project lives inside the home directory", () => {
        expect(displaySkillPath("/home/dev/demo/.agents/guide.md", "/home/dev/demo", "/home/dev")).toBe(
            ".agents/guide.md"
        );
        expect(displaySkillPath("/.claude/skills/pdf/SKILL.md", "/", null)).toBe(
            ".claude/skills/pdf/SKILL.md"
        );
        expect(displaySkillPath("/", "/", null)).toBe(".");
        expect(displaySkillPath("C:\\.claude\\skills\\pdf\\SKILL.md", "C:\\", null)).toBe(
            ".claude/skills/pdf/SKILL.md"
        );
        expect(displaySkillPath("C:\\", "C:\\", null)).toBe(".");
        expect(displaySkillPath("C:skills/pdf/SKILL.md", "C:", null)).toBe("skills/pdf/SKILL.md");
        expect(displaySkillPath("C:/outside/SKILL.md", "C:", null)).toBe("C:/outside/SKILL.md");
        expect(isInsideSkillPath("//host/share/SKILL.md", "/")).toBe(false);
        expect(isInsideSkillPath("//", "/")).toBe(false);
        expect(isInsideSkillPath("//.claude/skills/pdf/SKILL.md", "//")).toBe(true);
        expect(isInsideSkillPath("/.claude/skills/pdf/SKILL.md", "//")).toBe(false);
        expect(displaySkillPath("//.claude/skills/pdf/SKILL.md", "//", null)).toBe(
            ".claude/skills/pdf/SKILL.md"
        );
        expect(displaySkillPath("//", "//", null)).toBe(".");
        expect(displaySkillPath("//host/share/SKILL.md", "/", "/")).toBe(
            "//host/share/SKILL.md"
        );
        expect(normalizeSkillPath("///etc/skills/pdf/SKILL.md")).toBe("/etc/skills/pdf/SKILL.md");
        expect(isInsideSkillPath("///etc/skills/pdf/SKILL.md", "/")).toBe(true);
        expect(displaySkillPath("///etc/skills/pdf/SKILL.md", "/", null)).toBe(
            "etc/skills/pdf/SKILL.md"
        );
    });

    it(
        "strips Windows verbatim prefixes and collapses internal duplicate separators",
        () => {
        expect(normalizeSkillPath("\\\\?\\C:\\Users\\Dev\\\\Project\\.claude\\")).toBe(
            "C:/Users/Dev/Project/.claude",
        );
        expect(normalizeSkillPath("\\\\?\\UNC\\Server\\Share\\\\Team\\SKILL.md")).toBe(
            "//Server/Share/Team/SKILL.md",
        );
        expect(
            isInsideSkillPath(
                "\\\\?\\C:\\Users\\Dev\\Project\\.claude\\skills\\pdf\\SKILL.md",
                "c:/users/dev/project",
            ),
        ).toBe(true);
        expect(
            isInsideSkillPath(
                "\\\\?\\UNC\\Server\\Share\\Skills\\pdf\\SKILL.md",
                "\\\\server\\share",
            ),
        ).toBe(true);
        expect(
            displaySkillPath(
                "\\\\?\\C:\\Users\\Dev\\Project\\.claude\\skills\\pdf\\SKILL.md",
                "C:\\Users\\Dev\\Project",
                "C:\\Users\\Dev",
            ),
        ).toBe(".claude/skills/pdf/SKILL.md");
        expect(normalizeSkillPath("/home/dev//demo///.agents/skills/")).toBe(
            "/home/dev/demo/.agents/skills",
        );
        expect(normalizeSkillPath("/Users/ada/my\\project//skills/")).toBe(
            "/Users/ada/my\\project/skills",
        );
        expect(normalizeSkillPath("//opt//bin///")).toBe("//opt/bin");
    });
});

