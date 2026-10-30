import { describe, expect, it } from "vitest";
import {
    createPreviewInvokeHandler,
    MODELED_PLUGIN_COMMANDS,
    PREVIEW_PROJECT_PATH,
} from "@/lib/preview/tauri-mock";

/**
 * The Browser Preview IPC handler is the fake backend every Playwright spec
 * (and every deployed PR preview) runs against, pin its contract here so a
 * mock regression fails fast in Vitest instead of in a browser.
 */
describe("preview invoke handler", () => {
    it("welcome seed starts with no project open", () => {
        const { handle } = createPreviewInvokeHandler("welcome");
        expect(handle("get_project_state")).toEqual({
            project_path: null,
            open_files: [],
            active_file: null,
        });
    });

    it("project seed opens the fake project with README active", () => {
        const { handle } = createPreviewInvokeHandler("project");
        const state = handle("get_project_state") as {
            project_path: string;
            open_files: Array<{ name: string }>;
            active_file: string;
        };
        expect(state.project_path).toBe(PREVIEW_PROJECT_PATH);
        expect(state.open_files.map((f) => f.name)).toEqual(["README.md"]);
        expect(state.active_file).toBe(`${PREVIEW_PROJECT_PATH}/README.md`);
    });

    it("set_project_path / open_file mutate observable project state", () => {
        const { handle, projectState } = createPreviewInvokeHandler("welcome");
        handle("set_project_path", { path: PREVIEW_PROJECT_PATH });
        handle("open_file", { path: `${PREVIEW_PROJECT_PATH}/src/App.tsx`, name: "App.tsx" });
        expect(projectState().project_path).toBe(PREVIEW_PROJECT_PATH);
        expect(projectState().active_file).toBe(`${PREVIEW_PROJECT_PATH}/src/App.tsx`);
        handle("close_all_files");
        expect(projectState().open_files).toEqual([]);
    });

    it("serves the seeded file tree and contents", () => {
        const { handle } = createPreviewInvokeHandler("project");
        const entries = handle("ls_dir", { path: PREVIEW_PROJECT_PATH }) as Array<{ name: string }>;
        expect(entries.map((e) => e.name)).toContain("src");
        expect(handle("read_file", { path: `${PREVIEW_PROJECT_PATH}/README.md` })).toContain(
            "preview fixture",
        );
    });

    it("serves seeded git state", () => {
        const { handle } = createPreviewInvokeHandler("project");
        expect(handle("git_branches", { path: PREVIEW_PROJECT_PATH })).toContain("main");
        expect(handle("git_current_branch", { path: PREVIEW_PROJECT_PATH })).toBe("main");
        const log = handle("git_log", { path: PREVIEW_PROJECT_PATH }) as Array<{ hash: string }>;
        expect(log.length).toBeGreaterThan(0);
        expect(log[0].hash).toContain("preview");
        // Status codes must match the Rust backend (single letters); the Git
        // UI keys colors and glyphs off them and renders the code itself.
        const status = handle("git_status", { path: PREVIEW_PROJECT_PATH }) as Array<{ status: string }>;
        expect(status.length).toBeGreaterThan(0);
        for (const file of status) expect(file.status).toMatch(/^[MACDUR?!]$/);
    });

    it("blames a fixture file with the author the git log shows", () => {
        const { handle } = createPreviewInvokeHandler("project");
        const regions = handle("git_blame_file", {
            projectPath: PREVIEW_PROJECT_PATH,
            filePath: `${PREVIEW_PROJECT_PATH}/README.md`,
        }) as Array<{ line: number; line_count: number; author: string; summary: string }>;
        expect(regions).toHaveLength(1);
        expect(regions[0].line).toBe(1);
        expect(regions[0].line_count).toBeGreaterThan(1);
        expect(regions[0].author).toBe("Preview Fixture");
        expect(regions[0].summary.length).toBeGreaterThan(0);
    });

    // Settings used to be answered from module memory that reset on every
    // navigation, so a switch flipped in Settings was gone after a reload and
    // every settings-gated feature looked broken in the preview.
    it("writes settings through to a snapshot the next page can read", () => {
        const { handle } = createPreviewInvokeHandler("project");
        expect(handle("read_settings_file", { file: "preferences" })).toEqual({
            record: null,
            revision: "missing",
        });
        const revision = handle("write_settings_file", {
            file: "preferences",
            settings: { git: { blame: { enabled: true } } },
            expected: "missing",
        }) as string;
        expect(revision).not.toBe("missing");
        const snapshot = handle("read_settings_file", { file: "preferences" }) as {
            record: { settings: { git: { blame: { enabled: boolean } } } };
            revision: string;
        };
        expect(snapshot.revision).toBe(revision);
        // The file wraps preferences under `settings`; storing the bare object
        // made the loader read a present-but-empty record and skip hydration.
        expect(snapshot.record.settings.git.blame.enabled).toBe(true);
    });

    it("reloads the last written settings from session storage", () => {
        const { handle } = createPreviewInvokeHandler("project");
        handle("write_settings_file", {
            file: "preferences",
            settings: { editor: { fontSize: 21 } },
            expected: "missing",
        });
        const reopened = createPreviewInvokeHandler("project");
        const snapshot = reopened.handle("read_settings_file", { file: "preferences" }) as {
            record: { settings: { editor: { fontSize: number } } } | null;
        };
        expect(snapshot.record?.settings.editor.fontSize).toBe(21);
        window.sessionStorage.clear();
    });

    it("never throws for unmocked commands, safe defaults by shape", () => {
        const { handle } = createPreviewInvokeHandler("welcome");
        expect(handle("get_unmocked_items")).toEqual([]);
        expect(handle("get_something_unmocked")).toBeNull();
        expect(handle("is_something_unmocked")).toBe(false);
        expect(handle("do_something_unmocked")).toBeNull();
        expect(handle("plugin:app|version")).toBe("1.0.3-preview");
        expect(typeof handle("plugin:event|listen", { event: "x", handler: 1 })).toBe("number");
    });
});

describe("git log date contract", () => {
    it("emits Unix seconds, matching the Rust GitLogEntry string", () => {
        const { handle } = createPreviewInvokeHandler("project");
        const log = handle("git_log", { path: PREVIEW_PROJECT_PATH }) as Array<{ date: string }>;
        for (const entry of log) {
            // graph.tsx / commit-row.tsx render `new Date(parseInt(date) * 1000)`.
            // Seconds, not milliseconds and not ISO text.
            expect(entry.date).toMatch(/^\d{10}$/);
            expect(parseInt(entry.date, 10)).toBeGreaterThan(1_700_000_000);
        }
    });
});

describe("git log streaming per caller", () => {
    it("interleaved callerIds page independently (Rust STREAMERS parity)", () => {
        const { handle } = createPreviewInvokeHandler("project");
        handle("git_log_stream_start", { path: PREVIEW_PROJECT_PATH, callerId: "graph" });
        handle("git_log_stream_start", { path: PREVIEW_PROJECT_PATH, callerId: "source" });
        const graphPage1 = handle("git_log_stream_next", { callerId: "graph", limit: 2 }) as Array<{ hash: string }>;
        expect(graphPage1).toHaveLength(2);
        const sourcePage1 = handle("git_log_stream_next", { callerId: "source", limit: 2 }) as Array<{ hash: string }>;
        // The second caller starts from the top, not from graph's offset.
        expect(sourcePage1.map((e) => e.hash)).toEqual(graphPage1.map((e) => e.hash));
        const graphPage2 = handle("git_log_stream_next", { callerId: "graph", limit: 2 }) as Array<{ hash: string }>;
        expect(graphPage2).toHaveLength(1);
        expect(graphPage2[0].hash).not.toBe(graphPage1[0].hash);
        const again = handle("git_log_stream_next", { callerId: "never-started", limit: 2 }) as Array<{ hash: string }>;
        expect(again).toHaveLength(2);
        handle("git_log_stream_stop", { callerId: "graph" });
        const afterStop = handle("git_log_stream_next", { callerId: "graph", limit: 2 }) as Array<{ hash: string }>;
        expect(afterStop).toHaveLength(2);
    });
});

describe("seeded conversation gating", () => {
    it("welcome seed exposes no seeded conversation", () => {
        const { handle } = createPreviewInvokeHandler("welcome");
        expect(handle("get_conversations", { projectPath: PREVIEW_PROJECT_PATH })).toEqual([]);
        expect(handle("get_current_conversation_id")).toBeNull();
    });

    it("project seed exposes the seeded conversation", () => {
        const { handle } = createPreviewInvokeHandler("project");
        const conversations = handle("get_conversations", { projectPath: PREVIEW_PROJECT_PATH }) as Array<{ id: string }>;
        expect(conversations.map((c) => c.id)).toEqual(["preview-conversation"]);
        expect(handle("get_current_conversation_id")).toBe("preview-conversation");
    });

    it("opening the fake project after a welcome seed unlocks the conversation", () => {
        const { handle } = createPreviewInvokeHandler("welcome");
        handle("set_project_path", { path: PREVIEW_PROJECT_PATH });
        const conversations = handle("get_conversations", { projectPath: PREVIEW_PROJECT_PATH }) as Array<{ id: string }>;
        expect(conversations.map((c) => c.id)).toEqual(["preview-conversation"]);
        expect(handle("get_current_conversation_id")).toBe("preview-conversation");
    });
});

describe("conversation message scoping", () => {
    it("serves messages only for the seeded conversation", () => {
        const { handle } = createPreviewInvokeHandler("project");
        const known = handle("get_conversation_messages", { id: "preview-conversation" }) as unknown[];
        expect(known.length).toBeGreaterThan(0);
        const conversations = handle("get_conversations", { projectPath: PREVIEW_PROJECT_PATH }) as Array<{ history: unknown[] }>;
        expect(conversations[0].history).toEqual(known);
        expect(handle("get_conversation_messages", { id: "some-other-chat" })).toEqual([]);
    });
});

describe("file mutations", () => {
    const lsRoot = (handle: (cmd: string, args?: Record<string, unknown>) => unknown) =>
        (handle("ls_dir", { path: PREVIEW_PROJECT_PATH }) as Array<{ name: string }>).map((e) => e.name);

    it("delete_path removes the entry from listings and closes its tab", () => {
        const { handle, projectState } = createPreviewInvokeHandler("project");
        expect(lsRoot(handle)).toContain("README.md");
        handle("delete_path", { path: `${PREVIEW_PROJECT_PATH}/README.md` });
        expect(lsRoot(handle)).not.toContain("README.md");
        const state = projectState() as { open_files: unknown[]; active_file: string | null };
        expect(state.open_files).toEqual([]);
        expect(state.active_file).toBeNull();
    });

    it("deleting a directory closes tabs on its descendants", () => {
        const { handle, projectState } = createPreviewInvokeHandler("project");
        handle("open_file", { path: `${PREVIEW_PROJECT_PATH}/src/App.tsx`, name: "App.tsx" });
        handle("delete_path", { path: `${PREVIEW_PROJECT_PATH}/src` });
        const state = projectState() as { open_files: Array<{ path: string }>; active_file: string | null };
        expect(state.open_files.map((f) => f.path)).not.toContain(`${PREVIEW_PROJECT_PATH}/src/App.tsx`);
        expect(state.active_file).toBe(`${PREVIEW_PROJECT_PATH}/README.md`);
    });

    it("rename_path moves content and retargets the open tab", () => {
        const { handle, projectState } = createPreviewInvokeHandler("project");
        handle("rename_path", {
            oldPath: `${PREVIEW_PROJECT_PATH}/README.md`,
            newPath: `${PREVIEW_PROJECT_PATH}/GUIDE.md`,
        });
        expect(lsRoot(handle)).toContain("GUIDE.md");
        expect(lsRoot(handle)).not.toContain("README.md");
        expect(handle("read_file", { path: `${PREVIEW_PROJECT_PATH}/GUIDE.md` })).toContain("preview fixture");
        const state = projectState() as { active_file: string | null };
        expect(state.active_file).toBe(`${PREVIEW_PROJECT_PATH}/GUIDE.md`);
    });

    it("renaming a directory retargets tabs on its descendants", () => {
        const { handle, projectState } = createPreviewInvokeHandler("project");
        handle("open_file", { path: `${PREVIEW_PROJECT_PATH}/src/App.tsx`, name: "App.tsx" });
        handle("rename_path", {
            oldPath: `${PREVIEW_PROJECT_PATH}/src`,
            newPath: `${PREVIEW_PROJECT_PATH}/app`,
        });
        const state = projectState() as {
            open_files: Array<{ path: string }>;
            active_file: string | null;
        };
        expect(state.open_files.map((f) => f.path)).toContain(`${PREVIEW_PROJECT_PATH}/app/App.tsx`);
        expect(state.active_file).toBe(`${PREVIEW_PROJECT_PATH}/app/App.tsx`);
        expect(handle("read_file", { path: `${PREVIEW_PROJECT_PATH}/app/App.tsx` })).toContain("preview fixture");
    });

    it("copy_path duplicates content and keeps the original", () => {
        const { handle } = createPreviewInvokeHandler("project");
        handle("copy_path", {
            oldPath: `${PREVIEW_PROJECT_PATH}/README.md`,
            newPath: `${PREVIEW_PROJECT_PATH}/README-copy.md`,
        });
        expect(lsRoot(handle)).toContain("README.md");
        expect(lsRoot(handle)).toContain("README-copy.md");
        expect(handle("read_file", { path: `${PREVIEW_PROJECT_PATH}/README-copy.md` })).toContain("preview fixture");
    });
});

describe("plugin fallback modeling", () => {
    it("modeled plugin commands are known; unmodeled ones stay visible as fidelity gaps", () => {
        const { handle, commands } = createPreviewInvokeHandler("welcome");
        const known = new Set([...commands, ...MODELED_PLUGIN_COMMANDS]);
        const isKnownInvoke = (cmd: string): boolean => known.has(cmd);
        expect(handle("plugin:app|version")).toBe("1.0.3-preview");
        expect(isKnownInvoke("plugin:app|version")).toBe(true);
        expect(isKnownInvoke("plugin:event|listen")).toBe(true);
        expect(isKnownInvoke("plugin:dialog|message")).toBe(true);
        expect(isKnownInvoke("plugin:dialog|messag")).toBe(false);
        // Not modeled: returns a safe default AND is flagged unknown.
        expect(handle("plugin:opener|open")).toBeNull();
        expect(isKnownInvoke("plugin:opener|open")).toBe(false);
    });
});

describe("backend-parity state transitions", () => {
    it("switching projects directly closes the previous project's tabs", () => {
        const { handle, projectState } = createPreviewInvokeHandler("project");
        const stateOf = () => projectState() as {
            project_path: string | null;
            open_files: Array<{ path: string }>;
            active_file: string | null;
        };
        handle("open_file", { path: "/tmp/other.ts", name: "other.ts" });
        handle("set_project_path", { path: "/tmp/project-b" });
        expect(stateOf().project_path).toBe("/tmp/project-b");
        expect(stateOf().open_files).toEqual([]);
        expect(stateOf().active_file).toBeNull();
        handle("set_project_path", {});
        expect(stateOf().project_path).toBeNull();
    });

    it("closing the active tab activates the last remaining file (Rust close_file)", () => {
        const { handle, projectState } = createPreviewInvokeHandler("project");
        const activeOf = () => (projectState() as { active_file: string | null }).active_file;
        handle("open_file", { path: "/tmp/a.ts", name: "a.ts" });
        handle("open_file", { path: "/tmp/b.ts", name: "b.ts" });
        // active = b.ts (most recently opened); closing it → last remaining
        handle("close_file", { path: "/tmp/b.ts" });
        expect(activeOf()).toBe("/tmp/a.ts");
        handle("close_file", { path: "/tmp/a.ts" });
        expect(activeOf()).toBe(`${PREVIEW_PROJECT_PATH}/README.md`);
    });
});

describe("event delivery", () => {
    it("plugin:event|emit reaches tracked listeners; unlisten stops it", () => {
        const delivered: Array<{ event: string; payload: unknown }> = [];
        const { handle, emit } = createPreviewInvokeHandler("welcome");
        // Callback id and subscription id deliberately differ.
        const subscriptionId = handle("plugin:event|listen", {
            event: "project-state-update",
            handler: 7,
        }) as number;
        expect(typeof subscriptionId).toBe("number");
        expect(subscriptionId).not.toBe(7);
        const internals = (
            window as unknown as { __TAURI_INTERNALS__: { runCallback: (id: number, e: unknown) => void } }
        ).__TAURI_INTERNALS__;
        const original = internals.runCallback;
        internals.runCallback = (id: number, e: unknown) => {
            if (id === 7) delivered.push(e as { event: string; payload: unknown });
        };
        try {
            handle("plugin:event|emit", { event: "project-state-update", payload: { ok: 1 } });
            expect(delivered).toEqual([{ event: "project-state-update", id: expect.any(Number), payload: { ok: 1 } }]);
            delivered.length = 0;
            handle("plugin:event|unlisten", {
                event: "project-state-update",
                eventId: subscriptionId,
            });
            emit("project-state-update", { ok: 2 });
            expect(delivered).toEqual([]);
        } finally {
            internals.runCallback = original;
        }
    });
});

describe("mock fidelity", () => {
    it("dirty flag follows mark_file_dirty and clears on save_file", () => {
        const { handle, projectState } = createPreviewInvokeHandler("project");
        const readme = `${PREVIEW_PROJECT_PATH}/README.md`;
        const dirtyOf = () =>
            (projectState() as { open_files: Array<{ path: string; is_dirty: boolean }> })
                .open_files.find((f) => f.path === readme)?.is_dirty;
        handle("mark_file_dirty", { path: readme, dirty: true });
        expect(dirtyOf()).toBe(true);
        handle("save_file", { path: readme, content: "# saved\n" });
        expect(dirtyOf()).toBe(false);
        expect(handle("read_file", { path: readme })).toBe("# saved\n");
    });

    it("created files and folders appear in directory listings", () => {
        const { handle } = createPreviewInvokeHandler("project");
        handle("create_dir", { path: `${PREVIEW_PROJECT_PATH}/docs` });
        handle("create_file", { path: `${PREVIEW_PROJECT_PATH}/docs/guide.md` });
        const root = handle("ls_dir", { path: PREVIEW_PROJECT_PATH }) as Array<{ name: string; is_dir: boolean }>;
        expect(root.map((e) => [e.name, e.is_dir])).toContainEqual(["docs", true]);
        const docs = handle("ls_dir", { path: `${PREVIEW_PROJECT_PATH}/docs` }) as Array<{ name: string }>;
        expect(docs.map((e) => e.name)).toContain("guide.md");
    });

    it("branch create/switch updates branch state", () => {
        const { handle } = createPreviewInvokeHandler("project");
        handle("git_create_branch", { repoPath: PREVIEW_PROJECT_PATH, branchName: "feature/qa" });
        expect(handle("git_branches")).toContain("feature/qa");
        handle("git_switch_branch", { repoPath: PREVIEW_PROJECT_PATH, branchName: "feature/qa" });
        expect(handle("git_current_branch")).toBe("feature/qa");
    });

    it("conversations are filtered by requested project; package info honours its contract", () => {
        const { handle } = createPreviewInvokeHandler("project");
        expect(handle("get_conversations", { projectPath: "/someone/else" })).toEqual([]);
        expect(handle("get_conversations", { projectPath: PREVIEW_PROJECT_PATH })).toHaveLength(1);
        const info = handle("get_package_info", { projectPath: PREVIEW_PROJECT_PATH }) as {
            dependencies: unknown[];
            dev_dependencies: unknown[];
        };
        expect(info.dependencies).toEqual([]);
        expect(info.dev_dependencies).toEqual([]);
    });
});

describe("git log streaming", () => {
    it("pages advance without duplicating commits", () => {
        const { handle } = createPreviewInvokeHandler("project");
        handle("git_log_stream_start", { path: PREVIEW_PROJECT_PATH, callerId: "graph" });
        const first = handle("git_log_stream_next", { callerId: "graph", limit: 2 }) as Array<{ hash: string }>;
        const second = handle("git_log_stream_next", { callerId: "graph", limit: 2 }) as Array<{ hash: string }>;
        const third = handle("git_log_stream_next", { callerId: "graph", limit: 2 }) as Array<{ hash: string }>;
        expect(first).toHaveLength(2);
        expect(second).toHaveLength(1);
        expect(third).toEqual([]);
        const hashes = [...first, ...second].map((e) => e.hash);
        expect(new Set(hashes).size).toBe(hashes.length);
    });
});

describe("window and turn-journal preview commands", () => {
    it("models get_open_turn_journals, ensure_path_within, and plugin:window geometry queries", () => {
        const { handle, commands } = createPreviewInvokeHandler("project");
        expect(commands).toContain("get_open_turn_journals");
        expect(handle("get_open_turn_journals")).toEqual([]);
        expect(handle("ensure_path_within", { path: `${PREVIEW_PROJECT_PATH}/.claude/skills` })).toBe(
            `${PREVIEW_PROJECT_PATH}/.claude/skills`,
        );
        expect(MODELED_PLUGIN_COMMANDS).toContain("plugin:window|inner_size");
        expect(MODELED_PLUGIN_COMMANDS).toContain("plugin:window|scale_factor");
        expect(MODELED_PLUGIN_COMMANDS).toContain("plugin:window|set_min_size");
        expect(handle("plugin:window|inner_size")).toEqual({ width: 1440, height: 900 });
        expect(handle("plugin:window|scale_factor")).toBe(1);
    });
});
