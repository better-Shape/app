import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitListSkeleton } from "@/features/git/ui/shared/skeletons";
import { GIT_ROW, GIT_ROW_TEXT, type GitRowVariant } from "@/features/git/ui/shared/row-shell";

/**
 * A skeleton earns its place only by occupying the space the real row will take.
 * The placeholder used to be a fixed `h-4 + gap-1.5 + h-3` block, which measured
 * around 40px against a live job row's ~50px, an eight-row list jumped ~80px the
 * moment data landed, so the wait the skeleton replaced flashed *worse* than an
 * empty pane. These tests hold the two sides to one geometry.
 */

const VARIANTS: GitRowVariant[] = ["job", "run", "release", "dense"];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

function render(element: React.ReactElement) {
    act(() => root.render(element));
}

describe("git list skeleton geometry", () => {
    it.each(VARIANTS)("uses the %s shell the loaded rows use", (variant) => {
        render(<GitListSkeleton rows={3} variant={variant} />);
        const rows = [...container.querySelectorAll("li")];
        expect(rows).toHaveLength(3);
        for (const row of rows) {
            for (const token of GIT_ROW[variant].split(" ")) {
                expect(row.className).toContain(token);
            }
        }
    });

    it.each(VARIANTS)("takes its line heights from %s's own type classes", (variant) => {
        render(<GitListSkeleton rows={1} variant={variant} />);
        const lines = [...container.querySelectorAll("li span")];
        expect(lines.length).toBeGreaterThan(0);
        const all = lines.map((l) => l.className).join(" | ");
        for (const token of GIT_ROW_TEXT[variant].title.split(" ")) {
            expect(all).toContain(token);
        }
        // The height is the line box of that text, never a hard-coded `h-*`.
        for (const line of lines) expect(line.className).not.toMatch(/\bh-\d/);
    });

    it("draws two lines for a two-line row and one for a dense row", () => {
        render(<GitListSkeleton rows={1} variant="job" />);
        expect(container.querySelectorAll("li span")).toHaveLength(2);
        render(<GitListSkeleton rows={1} variant="dense" />);
        expect(container.querySelectorAll("li span")).toHaveLength(1);
    });

    it("keeps the announcing attributes while it is a placeholder", () => {
        render(<GitListSkeleton rows={2} variant="run" />);
        const list = container.querySelector("ul");
        expect(list?.getAttribute("aria-busy")).not.toBeNull();
        expect(list?.getAttribute("aria-label")).toBe("Loading");
        // The bars carry no text for a screen reader to read out.
        for (const line of container.querySelectorAll("li span")) {
            expect(line.getAttribute("aria-hidden")).not.toBeNull();
        }
    });
});

describe("git list row recipes are shared", () => {
    const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

    it.each([
        ["features/git/ui/actions/jobs-panel.tsx", "job"],
        ["features/git/ui/actions/runs-list.tsx", "run"],
        ["features/git/ui/github/releases-page.tsx", "release"],
    ])("%s renders rows through GIT_ROW.%s", (file, variant) => {
        const source = read(file);
        expect(source).toContain(`GIT_ROW.${variant}`);
        // The literal must not be inlined again, or the skeleton can drift from it
        // without anything failing.
        expect(source).not.toContain(GIT_ROW[variant as GitRowVariant]);
    });
});
