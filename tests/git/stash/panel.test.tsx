import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    list: vi.fn(),
    show: vi.fn(),
    save: vi.fn(),
    apply: vi.fn(),
    pop: vi.fn(),
    drop: vi.fn(),
    confirm: vi.fn(),
    project: "/repo" as string | null,
    scmRepoPath: "/repo" as string | null,
    query: "",
    notify: { info: vi.fn(), success: vi.fn(), gitError: vi.fn() },
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: mocks.confirm }));
vi.mock("@/features/notifications", () => ({ notify: mocks.notify }));
vi.mock("@/lib/backend", () => ({
    commands: {
        gitStashList: mocks.list,
        gitStashShow: mocks.show,
        gitStashSave: mocks.save,
        gitStashApply: mocks.apply,
        gitStashPop: mocks.pop,
        gitStashDrop: mocks.drop,
    },
    useProjectState: () => ({ project_path: mocks.project }),
}));
vi.mock("@/lib/git/repos", () => ({ useGitRepos: () => ({ scmRepoPath: mocks.scmRepoPath }) }));
vi.mock("@/features/git/ui/manager/filter-context", () => ({
    useFilter: () => ({ query: mocks.query }),
}));

import { StashPanel } from "@/features/git/ui/stash/panel";
import type { GitStashEntry } from "@/lib/backend/types";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("ResizeObserver", class {
        observe() {}
        unobserve() {}
        disconnect() {}
    });
    mocks.project = "/repo";
    mocks.scmRepoPath = "/repo";
    mocks.query = "";
    mocks.list.mockResolvedValue([]);
    mocks.show.mockResolvedValue("");
    mocks.save.mockResolvedValue(undefined);
    mocks.apply.mockResolvedValue(undefined);
    mocks.pop.mockResolvedValue(undefined);
    mocks.drop.mockResolvedValue(undefined);
    mocks.confirm.mockResolvedValue(true);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function ago(seconds: number): string {
    return String(Math.floor(Date.now() / 1000) - seconds);
}

/** The three rows every index-mapping test works from, in the order git prints them. */
function threeStashes(): GitStashEntry[] {
    return [
        { index: 0, message: "On main: parser rewrite", date: ago(90) },
        { index: 1, message: "On feature/login: add oauth", date: ago(3 * 3600) },
        { index: 2, message: "WIP on main: 1a2b3c4d Drop the temp table", date: ago(26 * 3600) },
    ];
}

const PATCH = [
    "diff --git a/src/parser.ts b/src/parser.ts",
    "--- a/src/parser.ts",
    "+++ b/src/parser.ts",
    "@@ -0,0 +1,2 @@",
    "+const a = 1;",
    "+const b = 2;",
    "",
].join("\n");

function buttons(): HTMLButtonElement[] {
    return Array.from(host.querySelectorAll("button"));
}

function maybeButton(label: string): HTMLButtonElement | undefined {
    return buttons().find((element) => (element.textContent ?? "").trim() === label);
}

function button(label: string): HTMLButtonElement {
    const found = maybeButton(label);
    if (!found) {
        throw new Error(
            `No button labelled "${label}". Saw: ${buttons().map((b) => b.textContent).join(" | ")}`,
        );
    }
    return found;
}

/** Rows are the only buttons that open a stash preview, and each one carries aria-expanded. */
function rowButtons(): HTMLButtonElement[] {
    return buttons().filter((element) => element.hasAttribute("aria-expanded"));
}

async function flush(times = 4): Promise<void> {
    for (let i = 0; i < times; i += 1) {
        await act(async () => {
            await Promise.resolve();
        });
    }
}

async function render(): Promise<void> {
    await act(async () => {
        root.render(<StashPanel />);
    });
    await flush();
}

async function click(element: HTMLElement): Promise<void> {
    await act(async () => {
        element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
}

describe("stash panel rows", () => {
    it("renders one row per entry with its message, ref, branch and relative time", async () => {
        mocks.list.mockResolvedValue(threeStashes());
        await render();

        const rows = rowButtons();
        expect(rows).toHaveLength(3);
        expect(rows.map((row) => row.textContent)).toEqual([
            "parser rewritestash@{0} · main · 1m ago",
            "add oauthstash@{1} · feature/login · 3h ago",
            // The message and the ref line are two block-level spans, so textContent
            // joins them with no space while the panel renders them on two lines.
            "Drop the temp tablestash@{2} · main · 1d ago",
        ]);
    });

    it("reads the rows straight off the payload the backend sent", async () => {
        mocks.list.mockResolvedValue([
            { index: 5, message: "On release/9.9: cut the release", date: ago(90) },
            { index: 6, message: "On main: unrelated", date: ago(26 * 3600) },
        ]);
        await render();

        expect(rowButtons().map((row) => row.textContent)).toEqual([
            "cut the releasestash@{5} · release/9.9 · 1m ago",
            "unrelatedstash@{6} · main · 1d ago",
        ]);
    });

    it("filters the rows by the manager search box", async () => {
        mocks.list.mockResolvedValue(threeStashes());
        mocks.query = "oauth";
        await render();

        const rows = rowButtons();
        expect(rows).toHaveLength(1);
        expect(rows[0].textContent).toContain("stash@{1}");
    });

    it("says the search matched nothing instead of claiming there are no stashes", async () => {
        mocks.list.mockResolvedValue(threeStashes());
        mocks.query = "nothing-matches-this";
        await render();

        expect(host.textContent).toContain("No stash matches the search.");
        expect(host.textContent).not.toContain("No stashes");
    });
});

describe("stash panel index mapping", () => {
    it("applies the stash whose ref the row shows, not the row's position on screen", async () => {
        // git's reflog order and the commit times disagree. Sorting puts stash@{2} first
        // on screen, and the preview and the apply must still address 2.
        mocks.list.mockResolvedValue([
            { index: 0, message: "On main: recorded first", date: ago(26 * 3600) },
            { index: 1, message: "On main: recorded second", date: ago(5 * 3600) },
            { index: 2, message: "On main: newest by clock", date: ago(90) },
        ]);
        mocks.show.mockResolvedValue(PATCH);
        await render();

        expect(rowButtons()[0].textContent).toContain("stash@{2}");

        await click(rowButtons()[0]);
        expect(mocks.show).toHaveBeenCalledWith("/repo", 2);

        await click(button("Apply"));
        expect(mocks.apply).toHaveBeenCalledTimes(1);
        expect(mocks.apply).toHaveBeenCalledWith("/repo", 2);
    });

    it("pops the stash the middle row names", async () => {
        mocks.list.mockResolvedValue(threeStashes());
        mocks.show.mockResolvedValue(PATCH);
        await render();

        await click(rowButtons()[1]);
        await click(button("Pop"));

        expect(mocks.pop).toHaveBeenCalledTimes(1);
        expect(mocks.pop).toHaveBeenCalledWith("/repo", 1);
    });

    it("drops the stash the last row names", async () => {
        mocks.list.mockResolvedValue(threeStashes());
        mocks.show.mockResolvedValue(PATCH);
        await render();

        await click(rowButtons()[2]);
        await click(button("Drop"));

        expect(mocks.drop).toHaveBeenCalledTimes(1);
        expect(mocks.drop).toHaveBeenCalledWith("/repo", 2);
    });

    it("refuses to act on a row whose ref git could not name", async () => {
        mocks.list.mockResolvedValue([
            { index: Number.NaN, message: "On main: broken selector", date: ago(90) },
        ]);
        await render();

        const row = rowButtons()[0];
        expect(row.disabled).toBe(true);
        expect(row.textContent).toContain("stash@{unknown}");

        await click(row);
        expect(mocks.show).not.toHaveBeenCalled();
    });
});

describe("stash panel preview", () => {
    it("does not offer Apply until the row's contents have been shown", async () => {
        mocks.list.mockResolvedValue(threeStashes());
        await render();

        expect(maybeButton("Apply")).toBeUndefined();

        await click(rowButtons()[0]);

        expect(mocks.show).toHaveBeenCalledWith("/repo", 0);
        expect(maybeButton("Apply")).toBeDefined();
    });

    it("renders the file list and counts git returned for the previewed stash", async () => {
        mocks.list.mockResolvedValue(threeStashes());
        mocks.show.mockResolvedValue(PATCH);
        await render();

        await click(rowButtons()[0]);

        expect(host.textContent).toContain("src/parser.ts");
        expect(host.textContent).toContain("1 file, +2, -0");
    });

    it("reports a preview git could not produce without dropping the row", async () => {
        mocks.list.mockResolvedValue(threeStashes());
        mocks.show.mockRejectedValue(new Error("fatal: log for 'stash@{0}' unavailable"));
        await render();

        await click(rowButtons()[0]);

        expect(host.textContent).toContain("unavailable");
        expect(maybeButton("Apply")).toBeUndefined();
        expect(rowButtons()).toHaveLength(3);
    });

    it("closes the preview when the same row is clicked again", async () => {
        mocks.list.mockResolvedValue(threeStashes());
        mocks.show.mockResolvedValue(PATCH);
        await render();

        await click(rowButtons()[0]);
        expect(maybeButton("Apply")).toBeDefined();

        await click(rowButtons()[0]);
        expect(maybeButton("Apply")).toBeUndefined();
        expect(mocks.show).toHaveBeenCalledTimes(1);
    });

    it("shows the second row's preview when the first row's is still loading", async () => {
        mocks.list.mockResolvedValue(threeStashes());
        let releaseFirst!: (value: string) => void;
        mocks.show.mockImplementation((_repo: string, index: number) => {
            if (index === 0) {
                return new Promise<string>((done) => {
                    releaseFirst = done;
                });
            }
            return Promise.resolve(PATCH);
        });
        await render();

        await click(rowButtons()[0]);
        await click(rowButtons()[1]);
        expect(host.textContent).toContain("src/parser.ts");

        // The slow first response must not replace the second row's diff.
        await act(async () => {
            releaseFirst(PATCH);
        });
        await flush();

        expect(rowButtons()[1].getAttribute("aria-expanded")).toBe("true");
        expect(maybeButton("Apply")).toBeDefined();
    });
});

describe("stash panel confirmation", () => {
    it("drops nothing when the confirmation is declined", async () => {
        mocks.list.mockResolvedValue(threeStashes());
        mocks.show.mockResolvedValue(PATCH);
        mocks.confirm.mockResolvedValue(false);
        await render();

        await click(rowButtons()[0]);
        await click(button("Drop"));

        expect(mocks.confirm).toHaveBeenCalledTimes(1);
        expect(String(mocks.confirm.mock.calls[0][0])).toContain("stash@{0}");
        expect(mocks.drop).not.toHaveBeenCalled();
    });

    it("confirms a pop before it runs", async () => {
        mocks.list.mockResolvedValue(threeStashes());
        mocks.show.mockResolvedValue(PATCH);
        await render();

        await click(rowButtons()[0]);
        await click(button("Pop"));

        expect(mocks.confirm).toHaveBeenCalledTimes(1);
        expect(mocks.pop).toHaveBeenCalledWith("/repo", 0);
    });

    it("confirms an apply before it runs", async () => {
        mocks.list.mockResolvedValue(threeStashes());
        mocks.show.mockResolvedValue(PATCH);
        await render();

        await click(rowButtons()[0]);
        await click(button("Apply"));

        expect(mocks.confirm).toHaveBeenCalledTimes(1);
        expect(mocks.apply).toHaveBeenCalledWith("/repo", 0);
    });
});

describe("stash panel refresh", () => {
    it("re-reads the list after a drop", async () => {
        mocks.list.mockResolvedValue(threeStashes());
        mocks.show.mockResolvedValue(PATCH);
        await render();
        const before = mocks.list.mock.calls.length;

        await click(rowButtons()[0]);
        await click(button("Drop"));

        expect(mocks.list.mock.calls.length).toBeGreaterThan(before);
    });

    it("re-reads the list when the rest of the git panel asks for a refresh", async () => {
        mocks.list.mockResolvedValue(threeStashes());
        await render();
        const before = mocks.list.mock.calls.length;

        await act(async () => {
            window.dispatchEvent(new Event("bettershape-git-refresh"));
        });
        await flush();

        expect(mocks.list.mock.calls.length).toBeGreaterThan(before);
    });

    it("picks up a stash another surface created", async () => {
        mocks.list.mockResolvedValue(threeStashes());
        await render();
        expect(host.textContent).toContain("3 stashes");

        mocks.list.mockResolvedValue([
            { index: 0, message: "On main: pushed from source control", date: ago(30) },
            ...threeStashes().slice(1),
        ]);
        await act(async () => {
            window.dispatchEvent(new Event("bettershape-git-refresh"));
        });
        await flush();

        expect(host.textContent).toContain("pushed from source control");
        expect(rowButtons()[0].textContent).toContain("stash@{0}");
    });
});

describe("stash panel save", () => {
    it("saves with the typed message and the untracked toggle off", async () => {
        mocks.list.mockResolvedValue(threeStashes());
        await render();

        const input = host.querySelector("input");
        if (!input) throw new Error("No stash message input rendered");
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                "value",
            )?.set;
            setter?.call(input, "  parser rewrite  ");
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });

        const toggle = host.querySelector('[role="switch"]') as HTMLButtonElement | null;
        if (!toggle) throw new Error("No include-untracked toggle rendered");
        expect(toggle.getAttribute("aria-checked")).toBe("true");
        await click(toggle);

        await click(button("Save stash"));

        expect(mocks.save).toHaveBeenCalledWith("/repo", "parser rewrite", false);
    });

    it("reports that a clean tree had nothing to stash instead of claiming success", async () => {
        mocks.list.mockResolvedValue([]);
        await render();

        await click(button("Save stash"));

        expect(mocks.notify.info).toHaveBeenCalledWith(
            "Git",
            "Nothing to stash. The working tree has no changes git can save.",
        );
        expect(mocks.notify.success).not.toHaveBeenCalled();
    });

    it("reports a real stash and clears the message box", async () => {
        const stashed: GitStashEntry[] = [
            { index: 0, message: "On main: parser rewrite", date: ago(30) },
        ];
        // The panel reads the list before and after the save and only calls it a stash
        // when those two reads differ, so the list may only grow once the save ran.
        let saved = false;
        mocks.save.mockImplementation(async () => {
            saved = true;
        });
        mocks.list.mockImplementation(async () => (saved ? stashed : []));

        await render();

        const input = host.querySelector("input");
        if (!input) throw new Error("No stash message input rendered");
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                "value",
            )?.set;
            setter?.call(input, "parser rewrite");
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(input.value).toBe("parser rewrite");

        await click(button("Save stash"));

        expect(mocks.save).toHaveBeenCalledWith("/repo", "parser rewrite", true);
        expect(mocks.notify.success).toHaveBeenCalledWith("Git", "Changes stashed.");
        expect((host.querySelector("input") as HTMLInputElement).value).toBe("");
        expect(host.textContent).toContain("parser rewrite");
        expect(host.textContent).toContain("1 stash");
    });

    it("surfaces a failed save through the shared git error helper and keeps the rows", async () => {
        mocks.list.mockResolvedValue(threeStashes());
        mocks.save.mockRejectedValue(new Error("fatal: Unable to create temporary file"));
        await render();

        await click(button("Save stash"));

        expect(mocks.notify.gitError).toHaveBeenCalledWith(expect.anything(), "Stash failed");
        expect(rowButtons()).toHaveLength(3);
    });
});

describe("stash panel states", () => {
    it("says the list is empty when git returned no stashes", async () => {
        mocks.list.mockResolvedValue([]);
        await render();

        expect(host.textContent).toContain("No stashes");
        expect(host.textContent).not.toContain("Reading stashes");
    });

    it("shows an unreadable list as a failure with a retry, not as an empty list", async () => {
        mocks.list.mockRejectedValue(new Error("fatal: not a git repository"));
        await render();

        expect(host.textContent).toContain("Stashes didn't load");
        expect(host.textContent).toContain("not a git repository");
        expect(host.textContent).not.toContain("No stashes");

        mocks.list.mockResolvedValue(threeStashes());
        await click(button("Try again"));

        expect(host.textContent).toContain("parser rewrite");
    });

    it("says no project is open rather than reporting no stashes", async () => {
        mocks.project = null;
        mocks.scmRepoPath = null;
        await render();

        expect(host.textContent).toContain("No project open");
        expect(host.textContent).not.toContain("No stashes");
        expect(host.querySelector("input")).toBeNull();
    });

    it("disables the other action buttons while one is running", async () => {
        mocks.list.mockResolvedValue(threeStashes());
        mocks.show.mockResolvedValue(PATCH);
        let release!: () => void;
        mocks.apply.mockImplementation(
            () =>
                new Promise<void>((done) => {
                    release = done;
                }),
        );
        await render();

        await click(rowButtons()[0]);
        await act(async () => {
            button("Apply").dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        await flush();

        // The shared Button disables itself with aria-disabled, not the native attribute.
        expect(button("Pop").getAttribute("aria-disabled")).toBe("true");
        expect(button("Drop").getAttribute("aria-disabled")).toBe("true");

        await act(async () => {
            release();
        });
        await flush();
        expect(mocks.apply).toHaveBeenCalledTimes(1);
    });
});