import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import { expect, it } from "vitest";

type Step = { name?: string; run?: string; if?: string; uses?: string; with?: { path?: string } };
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
