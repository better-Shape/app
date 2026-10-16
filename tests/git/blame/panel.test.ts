import { createElement, type ReactElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { BlamePanel, type BlameCommitTarget } from "@/features/git/ui/blame/panel";
import { blameState, type BlameState } from "@/features/git/ui/blame/model";
import type { BlameLine } from "@/lib/backend";

function raw(overrides: Partial<BlameLine> & { line: number; commit: string }): BlameLine {
    return { line_count: 1, author: "Ada", date: "1700000000", summary: "Add the parser", ...overrides };
}

const LINES: BlameLine[] = [
    raw({ line: 1, line_count: 1, commit: "aaa1111", summary: "Add the parser" }),
    raw({ line: 2, line_count: 3, commit: "aaa1111", summary: "Add the parser" }),
    raw({ line: 5, line_count: 1, commit: "bbb2222", author: "Grace", summary: "Fix the off-by-one", date: "1700086400" }),
];

const NOW_SECONDS = Math.floor(Date.now() / 1000);

function mount(node: ReactElement) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
        root.render(node);
    });
    return { host, root };
}

function unmount(root: Root, host: HTMLElement) {
    act(() => root.unmount());
    host.remove();
}

function readyState(lines: BlameLine[]): BlameState {
    return blameState({
        projectPath: "/repo",
        filePath: "/repo/src/a.ts",
        status: "loaded",
        message: null,
        lines,
    });
}

function panel(props: Partial<Parameters<typeof BlamePanel>[0]> = {}) {
    return createElement(BlamePanel, {
        state: readyState(LINES),
        busy: false,
        showAll: false,
        nowSeconds: NOW_SECONDS,
        onRefresh: () => {},
        onShowAll: () => {},
        onOpenCommit: () => {},
        ...props,
    } as Parameters<typeof BlamePanel>[0]);
}

describe("blame panel", () => {
    it("renders one row per merged run, with the file, the count and the authors", () => {
        const { host, root } = mount(panel());
        try {
            const text = host.textContent ?? "";
            expect(text).toContain("src/a.ts");
            expect(text).toContain("3 regions");
            expect(text).toContain("2 commits");
            expect(text).toContain("2 authors");
            expect(text).toContain("file lines");
            expect(text).toContain("Ada");
            expect(text).toContain("Grace");
            expect(text).toContain("Add the parser");
            expect(text).toContain("Fix the off-by-one");
        } finally {
            unmount(root, host);
        }
    });

    it("shows the file-line span a group covers, ending on the last line", () => {
        const { host, root } = mount(panel());
        try {
            const text = host.textContent ?? "";
            // Lines 1 and 2-4 are one commit, so the row must read 1-4. A span
            // built from start lines alone would read 1-2 and lose two lines.
            expect(text).toContain("1-4");
            expect(text).toContain("5");
        } finally {
            unmount(root, host);
        }
    });

    it("renders a one-line group without a dash", () => {
        const { host, root } = mount(panel());
        try {
            const spans = Array.from(host.querySelectorAll("span[title='File lines this commit is responsible for']")).map(
                (el) => el.textContent,
            );
            expect(spans).toEqual(["1-4", "5"]);
        } finally {
            unmount(root, host);
        }
    });

    it("shortens a full commit hash to seven characters", () => {
        const long = raw({
            line: 1,
            commit: "1a2b3c4d5e6f70819a2b3c4d5e6f70819a2b3c4d",
            summary: "Add the parser",
        });
        const { host, root } = mount(panel({ state: readyState([long]) }));
        try {
            const text = host.textContent ?? "";
            expect(text).toContain("1a2b3c4");
            expect(text).not.toContain("1a2b3c4d5e6f70819a2b3c4d5e6f70819a2b3c4d");
        } finally {
            unmount(root, host);
        }
    });

    it("names the author, summary and hash in the control's label so colour and shape are not the only cues", () => {
        const { host, root } = mount(panel());
        try {
            const labels = Array.from(host.querySelectorAll("button[aria-label]")).map((el) =>
                el.getAttribute("aria-label") ?? "",
            );
            const commitLabels = labels.filter((label) => label.startsWith("Open the diff for "));
            expect(commitLabels).toHaveLength(2);
            expect(commitLabels[0]).toContain("Ada");
            expect(commitLabels[0]).toContain("Add the parser");
            expect(commitLabels[0]).toContain("aaa1111");
            expect(commitLabels[0]).toContain("lines 1-4");
        } finally {
            unmount(root, host);
        }
    });

    it("hands the clicked group's commit to the opener", () => {
        const opened: BlameCommitTarget[] = [];
        const { host, root } = mount(panel({ onOpenCommit: (target: BlameCommitTarget) => opened.push(target) }));
        try {
            const button = host.querySelector<HTMLButtonElement>(
                "button[aria-label*='Fix the off-by-one']",
            );
            expect(button).toBeTruthy();
            act(() => button?.click());
            expect(opened).toEqual([
                {
                    commit: "bbb2222",
                    author: "Grace",
                    summary: "Fix the off-by-one",
                    from: 5,
                    to: 5,
                },
            ]);
        } finally {
            unmount(root, host);
        }
    });

    it("says nothing to blame when git returned no regions", () => {
        const { host, root } = mount(panel({ state: readyState([]) }));
        try {
            const text = host.textContent ?? "";
            expect(text).toContain("Nothing to blame");
            expect(text).not.toContain("Git blame did not run");
        } finally {
            unmount(root, host);
        }
    });

    it("shows git's failure rather than an empty blame", () => {
        const { host, root } = mount(
            panel({
                state: {
                    kind: "failed",
                    message: "Git error: object not found - no match for id 1a2b3c",
                },
            }),
        );
        try {
            const text = host.textContent ?? "";
            expect(text).toContain("Git blame did not run");
            expect(text).toContain("object not found");
            expect(text).not.toContain("Nothing to blame");
        } finally {
            unmount(root, host);
        }
    });

    it("distinguishes a file it refuses to blame from one git failed on", () => {
        const { host, root } = mount(
            panel({
                state: {
                    kind: "blocked",
                    reason: "This file sits outside the project folder, so git has no path for it",
                },
            }),
        );
        try {
            const text = host.textContent ?? "";
            expect(text).toContain("No file to blame");
            expect(text).toContain("outside the project folder");
            expect(text).not.toContain("Git blame did not run");
        } finally {
            unmount(root, host);
        }
    });

    it("loads while git is running rather than claiming there is no blame", () => {
        const { host, root } = mount(panel({ state: { kind: "loading" } }));
        try {
            const text = host.textContent ?? "";
            expect(text).toContain("Running git blame");
            expect(text).not.toContain("Nothing to blame");
        } finally {
            unmount(root, host);
        }
    });

    it("offers the rest of a long file instead of rendering every region at once", () => {
        const many = Array.from({ length: 260 }, (_, index) =>
            raw({ line: index + 1, commit: `commit-${index}` }),
        );
        const { host, root } = mount(panel({ state: readyState(many) }));
        try {
            const button = host.querySelector<HTMLButtonElement>("button[aria-label='Show every blame region']");
            expect(button).toBeTruthy();
            expect(button?.textContent).toContain("200 of 260 shown");
            expect(host.querySelectorAll("li").length).toBe(200);
        } finally {
            unmount(root, host);
        }
    });

    it("renders every region once the cap is lifted", () => {
        const many = Array.from({ length: 260 }, (_, index) =>
            raw({ line: index + 1, commit: `commit-${index}` }),
        );
        const { host, root } = mount(panel({ state: readyState(many), showAll: true }));
        try {
            expect(host.querySelectorAll("li").length).toBe(260);
            expect(host.querySelector("button[aria-label='Show every blame region']")).toBeNull();
        } finally {
            unmount(root, host);
        }
    });
});