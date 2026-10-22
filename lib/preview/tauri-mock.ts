/**
 * Browser Preview mocks for the Tauri IPC surface.
 *
 * BetterShape is a Tauri 2 desktop app: in a plain browser every
 * `invoke()` / `listen()` from `@tauri-apps/api` fails because there is no
 * `window.__TAURI_INTERNALS__`. This module installs the official
 * `@tauri-apps/api/mocks` IPC bridge with a deterministic, in-memory fake
 * backend (fake project, files, Git repo, conversations) so the full UI can
 * be launched, clicked through, screenshotted, and audited in any browser.
 * locally, in Playwright, and in deployed PR previews.
 *
 * Safety: installation is doubly gated.
 *   1. Build-time: `NEXT_PUBLIC_BROWSER_PREVIEW=1` must be set (only the
 *      `dev:browser` / `build:preview` scripts and preview CI do this).
 *   2. Runtime: if a real Tauri runtime is present (`__TAURI_INTERNALS__`
 *      already exists) installation is a no-op, so a desktop build can
 *      never be mocked even if the flag leaks into its environment.
 *
 * Test/debug surface: after install, `window.__BETTERSHAPE_PREVIEW__`
 * exposes `{ seed, invokes, unknownCommands(), clearInvokes() }` so
 * Playwright specs (and humans in devtools) can assert which IPC commands
 * the UI issued. It never exists in a real desktop build.
 */

import { mockConvertFileSrc, mockIPC, mockWindows } from "@tauri-apps/api/mocks";

export type PreviewSeedMode = "welcome" | "project";

export interface PreviewInvokeRecord {
    cmd: string;
    args: Record<string, unknown> | undefined;
    unknown: boolean;
    at: number;
}

export interface BrowserPreviewHandle {
    seed: PreviewSeedMode;
    invokes: PreviewInvokeRecord[];
    unknownCommands: () => string[];
    clearInvokes: () => void;
}

declare global {
    interface Window {
        __BETTERSHAPE_PREVIEW__?: BrowserPreviewHandle;
        __BETTERSHAPE_PREVIEW_SEED__?: string;
    }
}

/** Fake project used by the `project` seed. Obviously fake data only. */
export const PREVIEW_PROJECT_PATH = "/preview/bettershape-demo";

const PREVIEW_FILES: Record<string, string> = {
    [`${PREVIEW_PROJECT_PATH}/README.md`]: [
        "# bettershape-demo (preview fixture)",
        "",
        "This project does not exist on disk. It is seeded by",
        "`lib/preview/tauri-mock.ts` so the workbench can be exercised",
        "in a browser without the Tauri backend.",
        "",
    ].join("\n"),
    [`${PREVIEW_PROJECT_PATH}/package.json`]: `${JSON.stringify(
        { name: "bettershape-demo", version: "0.0.0-preview", private: true },
        null,
        2,
    )}\n`,
    [`${PREVIEW_PROJECT_PATH}/src/App.tsx`]: [
        "export default function App() {",
        '    return <main className="app">Hello from the preview fixture</main>;',
        "}",
        "",
    ].join("\n"),
    [`${PREVIEW_PROJECT_PATH}/src/main.ts`]: [
        'import App from "./App";',
        "",
        "export function boot() {",
        "    return App;",
        "}",
        "",
    ].join("\n"),
};

const PREVIEW_DIRS: Record<string, Array<{ name: string; is_dir: boolean }>> = {
    [PREVIEW_PROJECT_PATH]: [
        { name: "src", is_dir: true },
        { name: "README.md", is_dir: false },
        { name: "package.json", is_dir: false },
    ],
    [`${PREVIEW_PROJECT_PATH}/src`]: [
        { name: "App.tsx", is_dir: false },
        { name: "main.ts", is_dir: false },
    ],
};

/**
 * Committed (HEAD) bodies of the two seeded modified files. The diff view
 * asks for staged (index) and unstaged (worktree) contents separately;
 * without a distinct HEAD body both sides would render identical.
 */
const PREVIEW_HEAD_FILES: Record<string, string> = {
    [`${PREVIEW_PROJECT_PATH}/README.md`]: [
        "# bettershape-demo (preview fixture)",
        "",
        "This project does not exist on disk. It is seeded by",
        "the preview mock so the workbench can be exercised.",
        "",
    ].join("\n"),
    [`${PREVIEW_PROJECT_PATH}/src/App.tsx`]: [
        "export default function App() {",
        '    return <main className="app">Hello</main>;',
        "}",
        "",
    ].join("\n"),
};

/** Static plugin-command results (event listen/emit handled in fallback). */
export const PLUGIN_RESULTS: Record<string, unknown> = {
    "plugin:app|version": "1.0.3-preview",
    "plugin:app|name": "BetterShape (Browser Preview)",
    "plugin:store|load": 1,
    "plugin:store|get": null,
    "plugin:store|keys": [],
    "plugin:store|entries": [],
    "plugin:store|length": 0,
    "plugin:dialog|save": null,
    "plugin:dialog|message": "Ok",
    "plugin:dialog|confirm": false,
    "plugin:dialog|ask": false,
    "plugin:notification|is_permission_granted": false,
    "plugin:deep-link|get_current": null,
    // A browser window is neither fullscreen nor maximized, and asking it to
    // show itself is a no-op. Returning `undefined` instead left the window
    // chrome reading `undefined` as "state unknown" on every mount.
    "plugin:window|is_fullscreen": false,
    "plugin:window|is_maximized": false,
    "plugin:window|show": null,
};

/**
 * Plugin commands the fallback models deliberately (static results above,
 * the event bus, and the explicit dialog commands). Anything else is
 * reported as unknown so QA audits show the fidelity gaps.
 */
export const MODELED_PLUGIN_COMMANDS = [
    ...Object.keys(PLUGIN_RESULTS),
    "plugin:dialog|open",
    "plugin:event|listen",
    "plugin:event|emit",
    "plugin:event|unlisten",
];

/** Final segment of a slash-delimited preview path. */
const fileNameOf = (path: string): string => path.split("/").pop() ?? path;

/** Accept only the two supported preview seed modes. */
const asSeedMode = (value: string | null | undefined): PreviewSeedMode | null =>
    value === "project" || value === "welcome" ? value : null;

const PREVIEW_MESSAGES = [
    { role: "user", content: "What does this fixture do?", timestamp: Date.now() - 60_000 },
    { role: "assistant", content: "It seeds a deterministic project so the workbench can be audited in a browser.", timestamp: Date.now() - 59_000 },
];

/** Seeded Git history, newest first, in the backend's wire shape. */
const previewLogEntries = () => {
    const now = Date.now();
    return [3, 2, 1].map((n) => ({
        hash: `preview000${n}00000000000000000000000000`,
        message: ["preview: seeded commit history", "preview: wire browser QA fixtures", "preview: initial commit"][3 - n],
        author: "Preview Fixture",
        author_email: "preview@example.invalid",
        // Rust `GitLogEntry.date` is committer Unix seconds as a string;
        // the Git graph does `parseInt(log.date) * 1000`.
        date: String(Math.floor((now - (3 - n) * 86_400_000) / 1000)),
        files_changed: n,
        insertions: n * 12,
        deletions: n * 3,
        refs: n === 3 ? ["main"] : [],
        parent_count: n === 1 ? 0 : 1,
        parents: n === 1 ? [] : [`preview000${n - 1}00000000000000000000000000`],
    }));
};

/** Seed sources in priority order: Playwright init-script global, URL, storage. */
const SEED_CANDIDATES: Array<() => string | null | undefined> = [
    () => (typeof window === "undefined" ? null : window.__BETTERSHAPE_PREVIEW_SEED__),
    () => new URLSearchParams(window.location.search).get("seed"),
    () => window.localStorage.getItem("bettershape:preview-seed"),
];

/** Resolve the active seed from the candidate sources, defaulting to welcome. */
const resolveSeedMode = (): PreviewSeedMode => {
    if (typeof window === "undefined") return "welcome";
    for (const read of SEED_CANDIDATES) {
        try {
            const mode = asSeedMode(read());
            if (mode) return mode;
        } catch {
            /* source unavailable, try the next one */
        }
    }
    return "welcome";
};

/**
 * Pure IPC handler factory, exported separately from the installer so the
 * Vitest suite can exercise seed state transitions without a browser IPC
 * bridge. Returns a value (or throws) exactly like a Tauri command would.
 */
export const createPreviewInvokeHandler = (seed: PreviewSeedMode) => {
    const state = {
        projectPath: seed === "project" ? PREVIEW_PROJECT_PATH : null as string | null,
        openFiles: seed === "project"
            ? [{ path: `${PREVIEW_PROJECT_PATH}/README.md`, name: "README.md", is_dirty: false }]
            : [] as Array<{ path: string; name: string; is_dirty: boolean; is_pinned?: boolean }>,
        activeFile: seed === "project" ? `${PREVIEW_PROJECT_PATH}/README.md` : null as string | null,
        files: { ...PREVIEW_FILES },
        dirs: Object.fromEntries(
            Object.entries(PREVIEW_DIRS).map(([k, v]) => [k, v.map((e) => ({ ...e }))]),
        ) as typeof PREVIEW_DIRS,
        branch: "main",
        branches: ["main", "preview/browser-qa"],
        logEntries: previewLogEntries(),
        // Seeded working tree; stage/unstage/commit handlers mutate it so
        // the Git manager reflects actions taken in the preview.
        gitChanges: [
            { path: "src/App.tsx", status: "M", staged: false },
            { path: "README.md", status: "M", staged: true },
        ] as Array<{ path: string; status: string; staged: boolean }>,
        logStreamOffsets: new Map<string, number>(),
    };
    const listeners = new Map<string, Set<number>>();
    // `listen` records the callback id but returns a separate subscription
    // id; unlisten arrives with the latter. Map between them.
    const subscriptionCallbacks = new Map<number, number>();
    let nextEventId = 1;

    /** Current project state in the backend's event payload shape. */
    const projectState = () => ({
        project_path: state.projectPath,
        open_files: state.openFiles.map((f) => ({ ...f })),
        active_file: state.activeFile,
    });

    /** Deliver a Tauri event to callbacks registered via `listen()`. */
    const emit = (event: string, payload: unknown) => {
        const ids = listeners.get(event);
        if (!ids || typeof window === "undefined") return;
        const internals = (window as unknown as {
            __TAURI_INTERNALS__?: { runCallback: (id: number, event: unknown) => void };
        }).__TAURI_INTERNALS__;
        if (!internals?.runCallback) return;
        ids.forEach((id) => {
            try {
                internals.runCallback(id, { event, id: nextEventId, payload });
            } catch (err) {
                // Surface listener failures: silently swallowing them lets
                // QA pass while the UI missed a state update.
                console.error(`[preview] listener for "${event}" threw`, err);
            }
        });
    };

    /** Broadcast the current project state to tracked listeners. */
    const emitProjectState = () => emit("project-state-update", projectState());

    /** Open a file tab unless one exists (mirrors backend open semantics). */
    const ensureOpenFile = (path: string, name: string) => {
        if (state.openFiles.some((f) => f.path === path)) return;
        state.openFiles.push({ path, name, is_dirty: false });
    };

    /** Parent directory of a fake-tree path. */
    const parentDirOf = (path: string): string => {
        const lastSlash = path.lastIndexOf("/");
        return lastSlash >= 0 ? path.slice(0, lastSlash) || "/" : "/";
    };

    /** Copy of a fake-tree map without one key. */
    const withoutKey = <T,>(tree: Record<string, T>, key: string): Record<string, T> =>
        Object.fromEntries(Object.entries(tree).filter(([k]) => k !== key));

    /** Copy of a fake-tree map without the entries below `path/`. */
    const withoutDescendants = <T,>(tree: Record<string, T>, path: string): Record<string, T> =>
        Object.fromEntries(Object.entries(tree).filter(([k]) => !k.startsWith(`${path}/`)));

    /** Remove a path's entry from its parent directory listing. */
    const removeDirEntry = (path: string) => {
        const entries = state.dirs[parentDirOf(path)];
        if (!entries) return;
        const index = entries.findIndex((e) => e.name === fileNameOf(path));
        if (index >= 0) entries.splice(index, 1);
    };

    /** Close open tabs at or under a removed path and emit the new state. */
    const closeTabsAtOrUnder = (path: string) => {
        /** Whether a path is the removed path or one of its descendants. */
        const vanished = (p: string) => p === path || p.startsWith(`${path}/`);
        if (!state.openFiles.some((f) => vanished(f.path))) return;
        state.openFiles = state.openFiles.filter((f) => !vanished(f.path));
        if (state.activeFile && vanished(state.activeFile)) {
            state.activeFile = state.openFiles[state.openFiles.length - 1]?.path ?? null;
        }
        emitProjectState();
    };

    /** Register a created path in its parent directory listing. */
    const addDirEntry = (path: string, isDir: boolean) => {
        const entries = state.dirs[parentDirOf(path)];
        if (!entries) return;
        const name = fileNameOf(path);
        if (!entries.some((e) => e.name === name)) entries.push({ name, is_dir: isDir });
    };

    /** Remove a path (and its contents, for directories) from the fake tree. */
    const removeTree = (path: string) => {
        state.files = withoutDescendants(withoutKey(state.files, path), path);
        state.dirs = withoutDescendants(withoutKey(state.dirs, path), path);
        removeDirEntry(path);
    };

    /** Backend parity for delete/trash: open tabs at or under the removed path close. */
    const removePath = (path: string) => {
        if (!path) return;
        removeTree(path);
        closeTabsAtOrUnder(path);
    };

    /** Copy the entries at or under `oldPath` into a map keyed by the relocated paths. */
    const snapshotEntries = <T,>(
        tree: Record<string, T>,
        oldPath: string,
        newPath: string,
        copy: (value: T) => T,
    ): Map<string, T> => {
        const moved = new Map<string, T>();
        if (oldPath in tree) moved.set(newPath, copy(tree[oldPath]));
        for (const key of Object.keys(tree)) {
            if (key.startsWith(`${oldPath}/`)) {
                moved.set(`${newPath}${key.slice(oldPath.length)}`, copy(tree[key]));
            }
        }
        return moved;
    };

    /** Snapshot a fake-tree subtree (the path itself plus every descendant) for relocation. */
    const snapshotSubtree = (oldPath: string, newPath: string) => {
        // Snapshot the subtree first: removeTree below deletes the sources.
        const movedFiles = snapshotEntries(state.files, oldPath, newPath, (content) => content);
        const movedDirs = snapshotEntries(state.dirs, oldPath, newPath, (entries) => entries.map((e) => ({ ...e })));
        return { movedFiles, movedDirs };
    };

    /** Remap one open tab to the relocated path; returns whether the tab moved. */
    const remapOpenTab = (open: { path: string; name: string }, oldPath: string, newPath: string): boolean => {
        if (open.path === oldPath) {
            open.path = newPath;
            open.name = fileNameOf(newPath);
            return true;
        }
        if (open.path.startsWith(`${oldPath}/`)) {
            open.path = `${newPath}${open.path.slice(oldPath.length)}`;
            return true;
        }
        return false;
    };

    /** Remap the active file to the relocated path. */
    const remapActiveFile = (oldPath: string, newPath: string) => {
        if (state.activeFile === oldPath) {
            state.activeFile = newPath;
        } else if (state.activeFile?.startsWith(`${oldPath}/`)) {
            state.activeFile = `${newPath}${state.activeFile.slice(oldPath.length)}`;
        }
    };

    /** Point open tabs at the moved path, including tabs on moved descendants. */
    const remapOpenTabs = (oldPath: string, newPath: string) => {
        let tabsMoved = false;
        for (const open of state.openFiles) {
            if (remapOpenTab(open, oldPath, newPath)) tabsMoved = true;
        }
        remapActiveFile(oldPath, newPath);
        if (tabsMoved) emitProjectState();
    };

    /** Whether two paths are both set and different. */
    const distinctPaths = (a: string, b: string): boolean => a !== "" && b !== "" && a !== b;

    /** Whether a fake-tree path is a known file or directory. */
    const pathKnown = (path: string): boolean => path in state.dirs || path in state.files;

    /** Whether a copy or move between two fake-tree paths can proceed. */
    const canRelocate = (oldPath: string, newPath: string): boolean => {
        if (!distinctPaths(oldPath, newPath)) return false;
        if (!pathKnown(oldPath)) return false;
        // fs::rename fails when the destination parent does not exist; the
        // fake tree mirrors that instead of hiding the file in an unlisted
        // directory.
        return parentDirOf(newPath) in state.dirs;
    };

    /** Write a relocated subtree snapshot into the fake tree. */
    const writeSnapshot = (snapshot: {
        movedFiles: Map<string, string>;
        movedDirs: Map<string, Array<{ name: string; is_dir: boolean }>>;
    }) => {
        for (const [path, content] of snapshot.movedFiles) state.files[path] = content;
        for (const [path, entries] of snapshot.movedDirs) state.dirs[path] = entries;
    };

    /** Move or copy a fake-tree path, including directory children and open tabs. */
    const relocatePath = (oldPath: string, newPath: string, copy: boolean) => {
        if (!canRelocate(oldPath, newPath)) return;
        const isDir = oldPath in state.dirs;
        const snapshot = snapshotSubtree(oldPath, newPath);
        if (!copy) removeTree(oldPath);
        writeSnapshot(snapshot);
        addDirEntry(newPath, isDir);
        if (!copy) remapOpenTabs(oldPath, newPath);
    };

    /** Drop staged changes and prepend a commit entry, like a real commit. */
    const recordCommit = (message: string) => {
        const stagedCount = state.gitChanges.filter((c) => c.staged).length;
        state.gitChanges = state.gitChanges.filter((c) => !c.staged);
        const [first, ...rest] = state.logEntries;
        const parents = first ? [first.hash] : [];
        const entry = {
            hash: `preview${Date.now().toString(16)}0000000000000000000`.slice(0, 40),
            message: message.trim() || "preview: commit",
            author: "Preview Fixture",
            author_email: "preview@example.invalid",
            date: String(Math.floor(Date.now() / 1000)),
            files_changed: stagedCount,
            insertions: 0,
            deletions: 0,
            refs: [state.branch],
            parent_count: parents.length,
            parents,
        };
        state.logEntries = first ? [entry, { ...first, refs: [] }, ...rest] : [entry];
    };

    /** Rewrite the HEAD entry's message, like a real amend. */
    const recordAmend = (message: string) => {
        state.gitChanges = state.gitChanges.filter((c) => !c.staged);
        const [first, ...rest] = state.logEntries;
        if (!first) return;
        state.logEntries = [{ ...first, message: message.trim() || first.message }, ...rest];
    };

    /** Body stored under a fake-tree key, or empty when absent. */
    const bodyOf = (tree: Record<string, string>, key: string): string => tree[key] ?? "";

    /** Whether the seeded change list holds `rel` as staged. */
    const isStagedChange = (rel: string): boolean =>
        state.gitChanges.some((c) => c.path === rel && c.staged);

    /** File body for diff panes: HEAD body for staged reads, index body otherwise. */
    const itemContent = (args: Record<string, unknown>): string => {
        const rel = String(args.filePath ?? "");
        const key = `${PREVIEW_PROJECT_PATH}/${rel}`;
        const worktree = bodyOf(state.files, key);
        const head = PREVIEW_HEAD_FILES[key] ?? worktree;
        if (args.staged) return head;
        return isStagedChange(rel) ? worktree : head;
    };

    const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
        // ── settings files ───────────────────────────────────────────────
        // Mirrors src-tauri/src/commands/settings.rs: a file that is not on
        // disk reads as `{ record: null, revision: "missing" }`, which is what
        // `revision()` returns for `None`. The preview holds no settings files,
        // so every read reports that and every write is accepted against the
        // revision it was given. Returning nothing left the app unable to tell
        // "never saved" from "the backend failed", and the QA crawl listed the
        // command as unmodelled.
        read_settings_file: () => ({ record: null, revision: "missing" }),
        write_settings_file: (args) => (typeof args.expected === "string" ? args.expected : "missing"),

        // ── indexing toggles ─────────────────────────────────────────────
        // Both return `Result<(), AppError>` natively, so the preview accepts
        // the toggle and reports success without changing anything.
        set_chat_memory_enabled: () => null,
        set_index_embeddings: () => null,

        // ── project / files ──────────────────────────────────────────────
        get_project_state: () => projectState(),
        set_project_path: (args) => {
            // Backend parity: switching to a *different* project (or none)
            // closes all tabs on the first workspace change.
            const nextPath = typeof args.path === "string" ? args.path : null;
            if (nextPath !== state.projectPath) {
                state.projectPath = nextPath;
                state.openFiles = [];
                state.activeFile = null;
            }
            emitProjectState();
            return null;
        },
        set_extra_workspace_folders: () => null,
        grant_ipc_path: () => null,
        is_fresh_window: () => true,
        is_workspace_trusted: () => true,
        set_workspace_trusted: () => null,
        home_dir: () => "/preview/home",
        ls_dir: (args) => {
            const path = String(args.path ?? "");
            const entries = state.dirs[path] ?? [];
            return entries.map((e) => ({ name: e.name, path: `${path}/${e.name}`, is_dir: e.is_dir }));
        },
        read_file: (args) => state.files[String(args.path ?? "")] ?? "# Preview fixture\n\nNo seeded content for this path.\n",
        read_file_within: (args) => state.files[String(args.path ?? "")] ?? "",
        read_file_bytes: () => [],
        save_file: (args) => {
            if (typeof args.path === "string" && typeof args.content === "string") {
                state.files[args.path] = args.content;
                // Saving clears the tab's dirty flag, like the backend.
                const open = state.openFiles.find((f) => f.path === args.path);
                if (open) open.is_dirty = false;
                emitProjectState();
            }
            return null;
        },
        save_file_bytes: () => null,
        open_file: (args) => {
            const path = String(args.path ?? "");
            if (path) {
                ensureOpenFile(path, String(args.name ?? fileNameOf(path)));
                state.activeFile = path;
            }
            emitProjectState();
            return null;
        },
        close_file: (args) => {
            const path = String(args.path ?? "");
            state.openFiles = state.openFiles.filter((f) => f.path !== path);
            // Backend parity: the last remaining file becomes active.
            if (state.activeFile === path) {
                state.activeFile = state.openFiles[state.openFiles.length - 1]?.path ?? null;
            }
            emitProjectState();
            return null;
        },
        close_all_files: () => {
            state.openFiles = [];
            state.activeFile = null;
            emitProjectState();
            return null;
        },
        set_active_file: (args) => {
            state.activeFile = typeof args.path === "string" ? args.path : null;
            emitProjectState();
            return null;
        },
        pin_file: () => null,
        mark_file_dirty: (args) => {
            const open = state.openFiles.find((f) => f.path === String(args.path ?? ""));
            if (open) {
                open.is_dirty = args.dirty === true;
                emitProjectState();
            }
            return null;
        },
        reorder_files: () => null,
        close_to_right: () => null,
        close_saved: () => null,
        create_file: (args) => {
            const path = String(args.path ?? "");
            if (path) {
                state.files[path] ??= "";
                addDirEntry(path, false);
            }
            return null;
        },
        create_dir: (args) => {
            const path = String(args.path ?? "");
            if (path) {
                state.dirs[path] ??= [];
                addDirEntry(path, true);
            }
            return null;
        },
        delete_path: (args) => {
            removePath(String(args.path ?? ""));
            return null;
        },
        trash_path: (args) => {
            removePath(String(args.path ?? ""));
            return null;
        },
        rename_path: (args) => {
            relocatePath(String(args.oldPath ?? ""), String(args.newPath ?? ""), false);
            return null;
        },
        copy_path: (args) => {
            relocatePath(String(args.oldPath ?? ""), String(args.newPath ?? ""), true);
            return null;
        },
        reveal_path: () => null,
        open_in_app: () => null,
        open_url_external: () => null,
        ensure_path_within: () => null,
        get_rust_deps: () => [],

        // ── git ──────────────────────────────────────────────────────────
        git_discover_repos: () => [{ path: PREVIEW_PROJECT_PATH, name: "bettershape-demo", isBare: false }],
        git_resolve_repo_for_file: () => PREVIEW_PROJECT_PATH,
        // Status codes match the Rust backend (single letters, e.g.
        // "M"/"A"/"C"); the Git UI keys colors and glyphs off them.
        git_status: () => state.gitChanges.map((c) => ({ ...c })),
        git_stage: (args) => {
            const change = state.gitChanges.find((c) => c.path === String(args.filePath ?? ""));
            if (change) change.staged = true;
            return null;
        },
        git_unstage: (args) => {
            const change = state.gitChanges.find((c) => c.path === String(args.filePath ?? ""));
            if (change) change.staged = false;
            return null;
        },
        git_stage_all: () => {
            for (const change of state.gitChanges) change.staged = true;
            return null;
        },
        git_unstage_all: () => {
            for (const change of state.gitChanges) change.staged = false;
            return null;
        },
        git_discard_changes: (args) => {
            state.gitChanges = state.gitChanges.filter((c) => c.path !== String(args.filePath ?? ""));
            return null;
        },
        git_commit: (args) => {
            recordCommit(String(args.message ?? ""));
            return null;
        },
        git_commit_amend: (args) => {
            recordAmend(String(args.message ?? ""));
            return null;
        },
        git_branches: () => [...state.branches],
        git_current_branch: () => state.branch,
        git_create_branch: (args) => {
            const name = String(args.branchName ?? "");
            if (name && !state.branches.includes(name)) state.branches.push(name);
            return null;
        },
        git_switch_branch: (args) => {
            const name = String(args.branchName ?? "");
            if (name) {
                if (!state.branches.includes(name)) state.branches.push(name);
                state.branch = name;
            }
            return null;
        },
        git_branch_details: () => state.branches.map((name, i) => ({
            name,
            author: "Preview Fixture",
            authorEmail: "preview@example.invalid",
            date: new Date().toISOString(),
            ahead: i,
            behind: 0,
        })),
        git_remote_branches: () => [],
        git_list_remotes: () => [],
        git_has_remote: () => false,
        git_remote_url: () => null,
        git_sync_status: () => ({ ahead: 0, behind: 0 }),
        git_log: () => state.logEntries.map((e) => ({ ...e, refs: [...e.refs] })),
        // Stateful paging: every page must advance, or the graph appends
        // duplicate commits with duplicate row keys.
        // The Rust backend keys streamers by callerId (STREAMERS map), so
        // offsets are per-caller: interleaved streams page independently.
        git_log_stream_start: (args) => {
            state.logStreamOffsets.set(String(args.callerId ?? ""), 0);
            return null;
        },
        git_log_stream_next: (args) => {
            const key = String(args.callerId ?? "");
            const entries = state.logEntries;
            const limit = typeof args.limit === "number" ? args.limit : entries.length;
            const offset = state.logStreamOffsets.get(key) ?? 0;
            const page = entries.slice(offset, offset + limit);
            state.logStreamOffsets.set(key, offset + page.length);
            return page;
        },
        git_log_stream_stop: (args) => {
            state.logStreamOffsets.delete(String(args.callerId ?? ""));
            return null;
        },
        git_branch_graph: () => ({
            nodes: [{
                name: state.branch, commit: "preview000300000000000000000000000000", author: "Preview Fixture",
                date: String(Math.floor(Date.now() / 1000)), ahead: 0, x: 0, y: 0, parents: [], isCurrent: true, isRemote: false,
            }],
            width: 1, height: 1, currentBranch: state.branch, total: 1, truncated: false,
        }),
        git_diff: () => "diff --git a/src/App.tsx b/src/App.tsx\n+// preview fixture change\n",
        // Diff panes read file contents through this command; serve the
        // seeded HEAD body for staged reads and the worktree body for
        // unstaged reads so the two sides are not blank or identical.
        git_get_item_content: (args) => itemContent(args),
        git_file_diff: () => "diff --git a/src/App.tsx b/src/App.tsx\n+// preview fixture change\n",
        git_list_hunks: (args) => ({ path: String(args.path ?? ""), staged: false, hunks: [] }),
        git_stash_list: () => [],
        git_list_tags: () => [],
        git_in_progress: () => null,
        git_activity_timeline: () => [],

        // ── chat / AI ────────────────────────────────────────────────────
        get_conversations: (args) => {
            // Backend parity: no project open means no conversations at
            // all, and a query for another project must not leak this
            // project's seeded conversation. Gate on live state, not on
            // the boot seed: set_project_path can open the fake project
            // inside a welcome-seeded page.
            if (state.projectPath !== PREVIEW_PROJECT_PATH) return [];
            const requested = args.projectPath;
            if (typeof requested === "string" && requested !== PREVIEW_PROJECT_PATH) return [];
            return [{
            id: "preview-conversation",
            title: "Preview fixture chat",
            project_path: PREVIEW_PROJECT_PATH,
            timestamp: Date.now(),
            history: PREVIEW_MESSAGES,
            }];
        },
        get_conversation_messages: (args) => {
            // Backend parity: messages exist only for the seeded
            // conversation; any other ID has no history to leak into.
            if (typeof args.id === "string" && args.id !== "preview-conversation") return [];
            return PREVIEW_MESSAGES;
        },
        get_chat_history: () => [],
        get_chat_title: () => "Preview fixture chat",
        // Only while the fake project is open: the seeded conversation
        // does not exist in the welcome state (backend calls expect null).
        get_current_conversation_id: () =>
            state.projectPath === PREVIEW_PROJECT_PATH ? "preview-conversation" : null,
        get_ai_config: () => ({
            providers: [],
            defaultModel: "auto",
            embeddingModel: "",
            embeddingProvider: "",
            search: { provider: "", apiKey: "" },
            composio: { apiKey: "", userId: "" },
        }),
        ai_provider_status: () => [],
        ai_load_keys: () => ({}),
        ai_vault_supported: () => false,
        get_chat_generation_state: () => ({
            isGenerating: false,
            turnId: null,
            conversationId: null,
            partialContent: null,
            activityLabel: null,
        }),
        get_compaction_state: () => null,

        // ── GitHub / MCP / misc services ─────────────────────────────────
        github_auth_status: () => ({ loggedIn: false, username: null, avatarUrl: null, provider: "none" }),
        get_mcp_status: () => [],
        get_mcp_tools: () => [],
        get_mcp_config_path: () => `${PREVIEW_PROJECT_PATH}/.preview/mcp.json`,
        ensure_mcp_config: () => `${PREVIEW_PROJECT_PATH}/.preview/mcp.json`,
        sync_mcp_servers: () => [],
        set_ai_config: () => null,
        read_mcp_config: () => "{}",
        get_index_status: () => ({ state: "idle", indexed_files: 0, total_files: 0 }),
        get_project_stats: () => null,
        discover_tests: () => ({ tests: [], framework: null }),
        search_project_files: () => [],
        search_content: () => [],
        search_codebase: () => [],
        browser_tabs: () => ({ tabs: [], activeId: null }),
        browser_history: () => [],
        pty_available_shells: () => [],
        // PackageInfo contract: dependencies arrays must exist.
        get_package_info: () => ({
            name: "bettershape-demo",
            version: "0.0.0-preview",
            dependencies: [],
            dev_dependencies: [],
        }),
        get_outline: () => null,
    };


    /** Deliver a plugin event emission to tracked listeners. */
    const handleEventEmit = (args: Record<string, unknown>): unknown => {
        const event = typeof args.event === "string" ? args.event : null;
        if (event) {
            emit(event, args.payload);
        }
        return null;
    };

    /** Answer plugin commands that have no stateful preview handler. */
    /**
     * What a native open dialog returns in the preview: the demo project
     * for folder picks, a seeded file for file picks. Returning the project
     * keeps the welcome screen's Browse flow usable without a real dialog.
     */
    const dialogOpenResult = (args: Record<string, unknown>): string => {
        const options = (args.options ?? {}) as { directory?: boolean };
        return options.directory ? PREVIEW_PROJECT_PATH : `${PREVIEW_PROJECT_PATH}/README.md`;
    };

    /** Plugin-command fallback: modeled plugin results, else the null default. */
    const pluginFallback = (cmd: string, args: Record<string, unknown>): unknown => {
        if (cmd === "plugin:dialog|open") return dialogOpenResult(args);
        // Event plugin: `listen` never reaches here, handle() returns the
        // tracked subscription id first. `emit` goes through the tracked
        // listeners so delivery matches listen/unlisten bookkeeping.
        if (cmd === "plugin:event|emit") return handleEventEmit(args);
        if (cmd in PLUGIN_RESULTS) return PLUGIN_RESULTS[cmd];
        // Any other plugin command (incl. unmodeled plugin:event|*) gets
        // the null safe default; unknown tracking flags it separately.
        return null;
    };

    const PLURAL_GETTER = /^(get|list|load|search|discover|fetch)_.+s$/;
    const BOOLEAN_GETTER = /^(is|has|can)_/;

    /** Safe fallback for any command without an explicit handler. */
    const fallback = (cmd: string, args: Record<string, unknown>): unknown => {
        if (cmd.startsWith("plugin:")) return pluginFallback(cmd, args);
        // Plural getters/listers return collections; singular getters fall
        // back to null (returning [] for a string/object-typed command
        // crashes callers, e.g. `title.trim()`).
        if (PLURAL_GETTER.test(cmd)) return [];
        return BOOLEAN_GETTER.test(cmd) ? false : null;
    };

    /** Register one plugin event subscription; returns its subscription id. */
    const registerListener = (event: string, handlerId: unknown): number | undefined => {
        if (typeof handlerId !== "number") return undefined;
        const subscriptionId = nextEventId++;
        subscriptionCallbacks.set(subscriptionId, handlerId);
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)?.add(handlerId);
        return subscriptionId;
    };

    /** Remove plugin event subscriptions named by any numeric id spelling. */
    const untrackListener = (args: Record<string, unknown>) => {
        const eventName = args.event as string;
        // Real client sends { event, eventId } where eventId is the
        // subscription id returned by listen; translate it back to the
        // callback id; accept other numeric spellings too.
        const ids = new Set(
            ["eventId", "handler", "id", "event_id"]
                .map((key) => args[key])
                .filter((v): v is number => typeof v === "number"),
        );
        ids.forEach((value) => {
            const callbackId = subscriptionCallbacks.get(value) ?? value;
            subscriptionCallbacks.delete(value);
            listeners.get(eventName)?.delete(callbackId);
        });
    };

    /** Record plugin event subscriptions and removals for later delivery. */
    const trackListener = (cmd: string, args?: Record<string, unknown>): number | undefined => {
        if (typeof args?.event !== "string") return undefined;
        const eventArgs = args as Record<string, unknown>;
        if (cmd === "plugin:event|listen") return registerListener(eventArgs.event as string, eventArgs.handler);
        if (cmd === "plugin:event|unlisten") untrackListener(eventArgs);
        return undefined;
    };

    /** Whether tracking produced the subscription id a listen call must return. */
    const isListenResult = (cmd: string, tracked: number | undefined): tracked is number =>
        cmd === "plugin:event|listen" && typeof tracked === "number";

    /** Dispatch one invoke to its modeled handler or safe fallback. */
    const handle = (cmd: string, args?: Record<string, unknown>): unknown => {
        const tracked = trackListener(cmd, args);
        if (isListenResult(cmd, tracked)) return tracked;
        const handler = handlers[cmd];
        return handler ? handler(args ?? {}) : fallback(cmd, args ?? {});
    };

    // `commands` (the handler keys) lets the installer flag unknown invokes
    // for QA reports without a hand-maintained mirror list that can drift.
    return { handle, projectState, emit, commands: Object.keys(handlers) };
};

/**
 * Install the mocked Tauri IPC bridge in the current page. See the module
 * header for the two safety gates. Returns true when mocks were installed.
 */
export const installBrowserPreviewMocks = (): boolean => {
    if (typeof window === "undefined") return false;
    if (process.env.NEXT_PUBLIC_BROWSER_PREVIEW !== "1") return false;
    if ("__TAURI_INTERNALS__" in window) return false;
    if (window.__BETTERSHAPE_PREVIEW__) return false;

    const seed = resolveSeedMode();
    const { handle, commands } = createPreviewInvokeHandler(seed);
    const known = new Set([...commands, ...MODELED_PLUGIN_COMMANDS]);
    /** Whether a command has a modeled preview handler. */
    const isKnownInvoke = (cmd: string): boolean => known.has(cmd);
    const invokes: PreviewInvokeRecord[] = [];
    const unknownCommandSet = new Set<string>();

    // Synchronous install: this module is only imported from
    // `instrumentation-client.ts`, which runs before the app becomes
    // interactive, so the bridge exists before the first `invoke()` /
    // `listen()` call. (`@tauri-apps/api/mocks` ships in the client bundle
    // but stays inert unless the build-time flag above is set.)
    mockWindows("main");
    mockConvertFileSrc("windows");
    // NOTE: events are handled inside the invoke callback (tracked
    // listeners + emit()), not via shouldMockEvents, that option would
    // intercept plugin:event|listen before this handler and hand back the
    // real handler id, breaking our listener bookkeeping.
    mockIPC((cmd, args) => {
        const unknown = !isKnownInvoke(cmd);
        if (unknown) unknownCommandSet.add(cmd);
        const recordArgs = args as Record<string, unknown> | undefined;
        invokes.push({ cmd, args: recordArgs, unknown, at: Date.now() });
        if (invokes.length > 500) invokes.shift();
        return handle(cmd, recordArgs);
    });
    window.__BETTERSHAPE_PREVIEW__ = {
        seed,
        invokes,
        // Persistent set, not derived from the capped `invokes` ring:
        // past 500 calls the ring drops early records, and the audit's
        // unknown-command inventory must stay complete.
        unknownCommands: () => [...unknownCommandSet].sort((a, b) => a.localeCompare(b)),
        clearInvokes: () => {
            invokes.length = 0;
            unknownCommandSet.clear();
        },
    };
    document.documentElement.dataset.bettershapePreview = seed;
    return true;
};
