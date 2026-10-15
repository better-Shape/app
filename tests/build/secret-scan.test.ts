import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const scanner = resolve("scripts/ci/check-secrets.mjs");
const token = ["gh", "p_", "a".repeat(36)].join("");

function scan(lines: string[], prefix = "+") {
    const input = [
        "diff --git a/example.yml b/example.yml",
        "--- a/example.yml",
        "+++ b/example.yml",
        "@@ -1,0 +1,1 @@",
        ...lines.map(line => `${prefix}${line}`),
        "",
    ].join("\n");
    return spawnSync(process.execPath, [scanner], { input, encoding: "utf8" });
}

describe("PR added-line credential scanner", () => {
    it.each([
        ["GitHub", token],
        ["Anthropic", ["sk-", "ant-", "x".repeat(25)].join("")],
        ["OpenAI project", ["sk-", "proj-", "x".repeat(25)].join("")],
        ["AWS access ID", ["AK", "IA", "A".repeat(16)].join("")],
        ["AWS secret", `aws_secret_access_key = '${"a".repeat(40)}'`],
        ["PEM", ["-----BEGIN ", "PRIVATE KEY-----"].join("")],
        ["OpenSSH", ["-----BEGIN OPENSSH ", "PRIVATE KEY-----"].join("")],
    ])("rejects an added %s value without logging it", (_kind, value) => {
        const result = scan([value]);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("::error::Potential secret value");
        expect(result.stdout + result.stderr).not.toContain(value);
    });

    it.each([
        `const sample = '${token}'; // test fixture`,
        `// example dummy placeholder: ${token}`,
        `GITHUB_TOKEN: ${token}`,
        `token: \${{ secrets.API_KEY }} ${token}`,
        `+++${token}`,
    ])("does not exempt credentials based on surrounding text", (line) => {
        expect(scan([line]).status).toBe(1);
    });

    it("allows exact GitHub secret references and ordinary source", () => {
        expect(scan([
            "token: ${{ secrets.GITHUB_TOKEN }}",
            "token: ${{secrets.API_KEY}}",
            "const sample = 'not-a-credential';",
        ]).status).toBe(0);
    });

    it.each(["-", " "])("ignores removed and context lines with prefix %s", (prefix) => {
        expect(scan([token], prefix).status).toBe(0);
    });

    it("ignores file headers and resumes scanning each file's hunks", () => {
        const header = `diff --git a/${token} b/${token}\n--- a/${token}\n+++ b/${token}\n`;
        const first = `${header}@@ -0,0 +1 @@\n+ordinary content\n`;
        const safe = spawnSync(process.execPath, [scanner], { input: first + header, encoding: "utf8" });
        expect(safe.status).toBe(0);
        const unsafe = spawnSync(process.execPath, [scanner], {
            input: `${first}${header}@@ -0,0 +1 @@\n+${token}\n`, encoding: "utf8",
        });
        expect(unsafe.status).toBe(1);
    });

    it("accepts an empty diff", () => {
        expect(spawnSync(process.execPath, [scanner], { input: "", encoding: "utf8" }).status).toBe(0);
    });
});
