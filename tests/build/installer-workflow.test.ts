import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { JSON_SCHEMA, load } from "js-yaml";
type InstallerWorkflow = {
    on: { pull_request?: unknown; workflow_dispatch?: unknown; push: { branches: string[] } };
    permissions: { contents: string };
    concurrency: { group: string; "cancel-in-progress": boolean };
    jobs: { build: { strategy: { matrix: { include: { os: string; arch: string }[] } } } };
};
const workflow = load(readFileSync(".github/workflows/build-installers.yml", "utf8"), { schema: JSON_SCHEMA }) as InstallerWorkflow;
describe("native installer scheduling", () => {
    it("retains the complete read-only PR matrix without duplicate feature-branch push builds", () => {
        expect(Object.hasOwn(workflow.on, "pull_request")).toBe(true);
        expect(Object.hasOwn(workflow.on, "workflow_dispatch")).toBe(true);
        expect(workflow.on.push.branches).toContain("draft/**");
        expect(workflow.on.push.branches).not.toContain("arena/**");
        expect(workflow.permissions).toEqual({ contents: "read" });
        expect(workflow.jobs.build.strategy.matrix.include.map((row: { os: string; arch: string }) => `${row.os}-${row.arch}`).sort()).toEqual([
            "linux-aarch64", "linux-x86_64", "macos-aarch64", "macos-x86_64", "windows-aarch64", "windows-x86_64",
        ]);
    });
    it("finishes active native builds while coalescing pending runs per PR identity", () => {
        expect(workflow.concurrency["cancel-in-progress"]).toBe(false);
        expect(workflow.concurrency.group).toContain("github.event.pull_request.number || github.ref");
    });
});
