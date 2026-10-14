import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import { expect, it } from "vitest";

type Step = { env?: Record<string, string>; "timeout-minutes"?: number; name?: string; run?: string; if?: string; uses?: string; with?: { path?: string } };
type Workflow = { jobs: Record<string, { steps?: Step[] }> };
const workflow = (name: string) => load(readFileSync(`.github/workflows/${name}.yml`, "utf8")) as Workflow;
const steps = (name: string) => Object.values(workflow(name).jobs).flatMap((job) => job.steps ?? []);

it("validates release assets on Unix as well as Windows before upload", () => {
    const release = steps("release");
    const prepare = release.find((step) => step.name === "Prepare release assets")!;
    expect(prepare).toBeDefined();
    expect(prepare.if).toBeUndefined();
    expect(prepare.run).toContain("node scripts/release/assets.mjs");
    expect(prepare.run).toContain('--target "${{ matrix.target }}"');
    const upload = release.findIndex((step) => step.uses?.startsWith("actions/upload-artifact@"));
    expect(upload).toBeGreaterThan(release.indexOf(prepare));
});

it("uploads only strictly collected nightly installers while retaining explicit placeholders", () => {
    const nightly = steps("nightly");
    const verify = nightly.find((step) => step.name === "Verify build output exists")!;
    expect(verify.run).toContain('node scripts/build/collect-installers.mjs "$BUNDLE_DIR" dist/nightly-install "${{ matrix.bundles }}"');
    const upload = nightly.find((step) => step.name === "Upload nightly artifact")!;
    expect(upload.with?.path).toContain("dist/nightly-install/*");
    expect(upload.with?.path).toContain("dist/nightly-placeholder/");
    expect(upload.with?.path).not.toContain("/bundle/");
    expect(nightly.indexOf(upload)).toBeGreaterThan(nightly.indexOf(verify));
});

it("bounds dependency installation and reports failures including step timeouts", () => {
    const installers = steps("build-installers");
    const install = installers.find((step) => step.name === "Install locked dependencies")!;
    expect(install["timeout-minutes"]).toBe(25);
    expect(install.run).toContain("npm ci --ignore-scripts");
    expect(install.run).toContain("set -euo pipefail");
    const report = installers.find((step) => step.name === "Report native build failure")!;
    expect(report.if).toBe("failure()");
    expect(report.run).toContain('node scripts/build/report-failure.mjs < "$RUNNER_TEMP/tauri-build.log"');
});

it("scans the real PR base/head instead of main and does not hide diff errors", () => {
    const check = steps("pr").find((step) => step.name === "Check for accidentally committed secrets patterns")!;
    expect(check.env?.BASE_SHA).toBe("${{ github.event.pull_request.base.sha }}");
    expect(check.env?.HEAD_SHA).toBe("${{ github.event.pull_request.head.sha }}");
    expect(check.run).toContain('DIFF=$(git diff "$BASE_SHA...$HEAD_SHA" --unified=0)');
    expect(check.run).not.toContain("origin/main");
    expect(check.run).not.toContain("git diff HEAD~1");
    expect(check.run?.match(/> \/dev\/null; then/g)).toHaveLength(2);
});

it("keeps dispatch tag input out of generated shell source, including comments", () => {
    const validate = steps("release").find((step) => step.name === "Assert tag matches package.json")!;
    expect(validate.env?.INPUT_TAG).toBe("${{ inputs.tag }}");
    expect(validate.run).not.toContain("${{ inputs.tag }}");
    expect(validate.run).toContain('"${INPUT_TAG:-}"');
});
