import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

type NativeTarget = { os: string; arch: string; runner: string; target: string };
type Job = {
    "runs-on": string;
    strategy?: { matrix: { include: NativeTarget[] } };
};
type Workflow = { jobs: Record<string, Job> };

function readWorkflow(name: string): Workflow {
    return load(readFileSync(`.github/workflows/${name}.yml`, "utf8")) as Workflow;
}

describe("macOS runner selection", () => {
    it("pins static checks to the supported Apple Silicon image", () => {
        expect(readWorkflow("ci").jobs["static-macos"]?.["runs-on"]).toBe("macos-26");
    });

    it.each([
        ["build-installers", "build"],
        ["nightly", "build-check"],
        ["release", "build"],
    ])("keeps native macOS architectures aligned in %s", (name, jobName) => {
        const job = readWorkflow(name).jobs[jobName];
        expect(job?.["runs-on"]).toBe("${{ matrix.runner }}");
        expect(job?.strategy?.matrix.include.filter((row) => row.os === "macos")).toEqual([
            expect.objectContaining({
                arch: "aarch64", runner: "macos-26", target: "aarch64-apple-darwin",
            }),
            expect.objectContaining({
                arch: "x86_64", runner: "macos-26-intel", target: "x86_64-apple-darwin",
            }),
        ]);
    });
});
