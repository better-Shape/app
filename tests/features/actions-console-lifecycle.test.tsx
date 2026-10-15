import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WorkflowJob, WorkflowRun } from "@/features/git/ui/actions/types";

const mocks = vi.hoisted(() => ({ project: "alpha", resolve: vi.fn(), api: vi.fn(), logs: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/backend", () => ({ commands: { githubActionsLogs: mocks.logs }, useProjectState: () => ({ project_path: mocks.project }) }));
vi.mock("@/lib/github/store", () => ({ useGitHubAuth: () => ({ loggedIn: true }), loginGitHub: vi.fn() }));
vi.mock("@/features/git/ui/manager/filter-context", () => ({ useFilter: () => ({ query: "" }) }));
vi.mock("@/features/notifications", () => ({ notify: { error: mocks.error } }));
vi.mock("@/features/git/ui/actions/utils", async original => ({
    ...await original<typeof import("@/features/git/ui/actions/utils")>(), resolveOwnerRepo: mocks.resolve, parseApi: mocks.api,
}));
vi.mock("@/features/panels", () => ({ Panel: ({ panes }: { panes: Array<{ id: string; children: ReactNode }> }) => <>{panes.map(pane => <div key={pane.id}>{pane.children}</div>)}</> }));
vi.mock("@/features/git/ui/shared/motion", () => ({ GitOverlayEnter: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/features/git/ui/actions/header", () => ({ Header: ({ repoSlug }: { repoSlug: string | null }) => <div data-repository>{repoSlug}</div> }));
vi.mock("@/features/git/ui/actions/runs-list", () => ({ RunsList: ({ runs, onSelect }: { runs: WorkflowRun[]; onSelect: (id: number) => void }) => <>{runs.map(run => <button key={run.id} data-run={run.id} onClick={() => onSelect(run.id)}>{run.name}</button>)}</> }));
vi.mock("@/features/git/ui/actions/jobs-panel", () => ({ JobsPanel: ({ jobs }: { jobs: WorkflowJob[] }) => <div data-jobs>{jobs.map(job => job.name).join(",")}</div> }));
vi.mock("@/features/git/ui/actions/logs-panel", () => ({ LogsPanel: ({ logs }: { logs: string }) => <pre data-logs>{logs}</pre> }));
vi.mock("@/features/git/ui/actions/dispatch-dialog", () => ({ DispatchDialog: () => null }));
import { ActionsConsole } from "@/features/git/ui/actions/console";

let host: HTMLDivElement;
let root: Root | null;
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function run(id: number): WorkflowRun { return { id, name: `Run ${id}`, status: "completed", conclusion: "success", html_url: "https://example.invalid" }; }
function jobs(id: number) { return { jobs: [{ id: id * 10, name: `Job ${id}`, status: "completed", conclusion: "success" }] }; }
function api(path: string): unknown {
    if (path.includes("/jobs?")) return jobs(Number(path.match(/runs\/(\d+)\//)?.[1]));
    if (path.includes("/artifacts?")) return { artifacts: [] };
    if (path.includes("/workflows?")) return { workflows: [] };
    return { workflow_runs: [run(1), run(2)] };
}
beforeEach(() => {
    mocks.project = "alpha"; mocks.error.mockReset();
    mocks.resolve.mockReset().mockImplementation(async (project: string) => ({ owner: "owner", repo: project }));
    mocks.api.mockReset().mockImplementation(async (path: string) => api(path));
    mocks.logs.mockReset().mockImplementation(async (_repo: string, id: number) => `Logs ${id}`);
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root?.unmount()); host.remove(); });
async function render() { await act(async () => root?.render(<ActionsConsole focus="jobs" />)); }
async function select(id: number) {
    const button = host.querySelector<HTMLButtonElement>(`[data-run="${id}"]`);
    if (!button) throw new Error(`Run ${id} missing`);
    await act(async () => button.click());
}
it("ignores repository resolution from a previous project", async () => {
    const old = deferred<{ owner: string; repo: string }>();
    mocks.resolve.mockImplementationOnce(() => old.promise);
    await render(); mocks.project = "beta"; await render();
    expect(host.querySelector("[data-repository]")?.textContent).toBe("owner/beta");
    await act(async () => old.resolve({ owner: "owner", repo: "alpha" }));
    expect(host.querySelector("[data-repository]")?.textContent).toBe("owner/beta");
    expect(mocks.api.mock.calls.every(([path]) => !String(path).includes("/alpha/"))).toBe(true);
});
it("does not apply an obsolete run's delayed jobs to the selected run", async () => {
    const old = deferred<unknown>();
    mocks.api.mockImplementation(async (path: string) => path.includes("/runs/1/jobs?") ? old.promise : api(path));
    await render(); await select(2);
    expect(host.querySelector("[data-jobs]")?.textContent).toBe("Job 2");
    await act(async () => old.resolve(jobs(1)));
    expect(host.querySelector("[data-jobs]")?.textContent).toBe("Job 2");
    expect(host.querySelector("[data-logs]")?.textContent).toBe("Logs 2");
});
it("does not replace the current logs with a late response for the old run", async () => {
    const old = deferred<string>();
    mocks.logs.mockImplementation(async (_repo: string, id: number) => id === 1 ? old.promise : `Logs ${id}`);
    await render(); await select(2);
    expect(host.querySelector("[data-logs]")?.textContent).toBe("Logs 2");
    await act(async () => old.resolve("obsolete logs"));
    expect(host.querySelector("[data-logs]")?.textContent).toBe("Logs 2");
});
it("does not publish stale errors after unmount", async () => {
    const old = deferred<unknown>();
    mocks.api.mockImplementation(async (path: string) => path.includes("/runs/1/jobs?") ? old.promise : api(path));
    await render(); await act(async () => root?.unmount()); root = null;
    await act(async () => old.reject(new Error("obsolete failure")));
    expect(mocks.error).not.toHaveBeenCalled();
});
