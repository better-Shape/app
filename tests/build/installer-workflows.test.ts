import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import { expect, it } from "vitest";

type Step = {
    env?: Record<string, string>;
    "timeout-minutes"?: number;
    name?: string;
    run?: string;
    if?: string;
    uses?: string;
    with?: { path?: string };
};
type Workflow = {
    on?: { push?: { branches?: string[] } };
    concurrency?: { group?: string };
    jobs: Record<string, { if?: string; steps?: Step[] }>;
};
const workflow = (name: string) => load(readFileSync(`.github/workflows/${name}.yml`, "utf8")) as Workflow;
const steps = (name: string) => Object.values(workflow(name).jobs).flatMap((job) => job.steps ?? []);
const requireStep = (list: Step[], name: string): Step => {
    const found = list.find((step) => step.name === name);
    expect(found).toBeDefined();
    return found ?? {};
};

it("validates release assets on Unix as well as Windows before upload", () => {
    const release = steps("release");
    const prepare = requireStep(release, "Prepare release assets");
    expect(prepare.if).toBeUndefined();
    expect(prepare.run).toContain("node scripts/release/assets.mjs");
    expect(prepare.run).toContain('--target "${{ matrix.target }}"');
    const upload = release.findIndex((step) => step.uses?.startsWith("actions/upload-artifact@"));
    expect(upload).toBeGreaterThan(release.indexOf(prepare));
});

it("uploads only strictly collected nightly installers while retaining explicit placeholders", () => {
    const nightly = steps("nightly");
    const verify = requireStep(nightly, "Verify build output exists");
    expect(verify.run).toContain('node scripts/build/collect-installers.mjs "$BUNDLE_DIR" dist/nightly-install "${{ matrix.bundles }}"');
    const upload = requireStep(nightly, "Upload nightly artifact");
    expect(upload.with?.path).toContain("dist/nightly-install/*");
    expect(upload.with?.path).toContain("dist/nightly-placeholder/");
    expect(upload.with?.path).not.toContain("/bundle/");
    expect(nightly.indexOf(upload)).toBeGreaterThan(nightly.indexOf(verify));
});

it("bounds dependency installation and reports failures including step timeouts", () => {
    const installers = steps("build-installers");
    const install = requireStep(installers, "Install locked dependencies");
    expect(install["timeout-minutes"]).toBe(25);
    expect(install.run).toContain("npm ci --ignore-scripts");
    expect(install.run).toContain("set -euo pipefail");
    const report = requireStep(installers, "Report native build failure");
    expect(report.if).toBe("failure()");
    expect(report.run).toContain('node scripts/build/report-failure.mjs < "$RUNNER_TEMP/tauri-build.log"');
});

it("scans the real PR base/head instead of main and does not hide diff errors", () => {
    const check = requireStep(steps("pr"), "Check for accidentally committed secrets patterns");
    expect(check.env?.BASE_SHA).toBe("${{ github.event.pull_request.base.sha }}");
    expect(check.env?.HEAD_SHA).toBe("${{ github.event.pull_request.head.sha }}");
    expect(check.run).toContain('set -euo pipefail');
    expect(check.run).toContain('git diff "$BASE_SHA...$HEAD_SHA" --unified=0 | node scripts/ci/check-secrets.mjs');
    expect(check.run).not.toContain("origin/main");
    expect(check.run).not.toContain("git diff HEAD~1");
    expect(check.run).not.toContain("grep -v");
});

it("keeps dispatch tag input out of generated shell source, including comments", () => {
    const validate = requireStep(steps("release"), "Assert tag matches package.json");
    expect(validate.env?.INPUT_TAG).toBe("${{ inputs.tag }}");
    expect(validate.run).not.toContain("${{ inputs.tag }}");
    expect(validate.run).toContain('"${INPUT_TAG:-}"');
});

it("isolates workflow cancellation by PR identity, not fork branch name", () => {
    for (const name of ["build-installers", "pr"]) {
        expect(workflow(name).concurrency?.group).toContain("github.event.pull_request.number || github.ref");
        expect(workflow(name).concurrency?.group).not.toContain("github.head_ref");
    }
});

it("runs CI, Security, Preview, and Build Installers on pushes to mega/absorb-all while keeping Scorecard on default branch", () => {
    for (const name of ["ci", "security", "preview", "build-installers"]) {
        expect(workflow(name).on?.push?.branches).toContain("mega/absorb-all");
    }
    expect(workflow("security").jobs.scorecard?.if).toContain("github.event.repository.default_branch");
});
