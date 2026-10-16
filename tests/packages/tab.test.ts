import { createElement } from "react";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockInvoke } from "../helpers/tauri";

const projectState = vi.hoisted(() => ({
    current: { project_path: "/repo" as string | null },
}));

vi.mock("@/lib/backend", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/backend")>();
    return { ...actual, useProjectState: () => projectState.current };
});

import { PackagesTab } from "@/features/agent/workspace/packages-tab";
import type { PackageInfo } from "@/lib/backend";

const INFO: PackageInfo = {
    name: "bettershape",
    version: "0.4.0",
    dependencies: [{ name: "react", version: "^19.0.0", installed: "19.0.0", latest: "19.0.0", wanted: "19.0.0", is_dev: false }],
    dev_dependencies: [],
};

type Call = { cmd: string; args: Record<string, unknown> };

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

async function pause(ms: number) {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
    });
}

async function waitFor(host: HTMLElement, needle: string, timeoutMs = 4000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (host.textContent?.includes(needle)) return;
        await pause(25);
    }
    throw new Error(`Timed out waiting for "${needle}". Saw: ${host.textContent}`);
}

describe("packages tab", () => {
    let calls: Call[];
    let reads: number;
    let info: PackageInfo | string;

    beforeEach(() => {
        calls = [];
        reads = 0;
        info = INFO;
        projectState.current = { project_path: "/repo" };
        mockInvoke((cmd, args) => {
            calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
            if (cmd === "get_package_info") {
                reads += 1;
                return typeof info === "string" ? Promise.reject(info) : info;
            }
            return undefined;
        });
    });

    afterEach(() => {
        projectState.current = { project_path: null };
    });

    it("reads the manifest through get_package_info and renders what came back", async () => {
        const { host, root } = mount(createElement(PackagesTab));
        try {
            await waitFor(host, "bettershape 0.4.0");
            const read = calls.find((call) => call.cmd === "get_package_info");
            expect(read?.args.projectPath).toBe("/repo");
            expect(host.textContent).toContain("react");
            expect(host.textContent).toContain("^19.0.0");
        } finally {
            unmount(root, host);
        }
    });

    it("blocks on a missing manifest instead of rendering an empty package list", async () => {
        info = "package.json not found";
        const { host, root } = mount(createElement(PackagesTab));
        try {
            await waitFor(host, "No package manifest");
            const text = host.textContent ?? "";
            expect(text).toContain("no package.json");
            expect(text).not.toContain("No dependencies");
        } finally {
            unmount(root, host);
        }
    });

    it("reports a backend error instead of zero packages", async () => {
        info = "Serde JSON error: expected value at line 1 column 2";
        const { host, root } = mount(createElement(PackagesTab));
        try {
            await waitFor(host, "could not be read");
            const text = host.textContent ?? "";
            expect(text).toContain("expected value");
            expect(text).not.toContain("No dependencies");
        } finally {
            unmount(root, host);
        }
    });

    it("re-reads the manifest after a successful install and passes the spec and dev flag", async () => {
        const { host, root } = mount(createElement(PackagesTab));
        try {
            await waitFor(host, "bettershape 0.4.0");
            expect(reads).toBe(1);

            const input = host.querySelector<HTMLInputElement>("input[aria-label='Package to install']");
            act(() => {
                const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
                setter?.call(input, "left-pad");
                input?.dispatchEvent(new Event("input", { bubbles: true }));
            });
            const devToggle = host.querySelector<HTMLButtonElement>("button[aria-pressed]");
            act(() => devToggle?.click());
            act(() =>
                host
                    .querySelector<HTMLFormElement>("form")
                    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
            );

            await waitFor(host, "bettershape 0.4.0");
            await pause(50);
            const install = calls.find((call) => call.cmd === "npm_install");
            expect(install?.args).toEqual({
                projectPath: "/repo",
                packageName: "left-pad",
                dev: true,
                packageManager: "npm",
            });
            // The refresh must follow the mutation, so the manifest is read twice.
            expect(reads).toBe(2);
        } finally {
            unmount(root, host);
        }
    });

    it("passes the package manager through to install-all and to the read", async () => {
        const { host, root } = mount(createElement(PackagesTab));
        try {
            await waitFor(host, "bettershape 0.4.0");
            act(() =>
                host
                    .querySelector<HTMLButtonElement>("button[aria-label='Install every dependency']")
                    ?.click(),
            );
            await pause(80);
            const installAll = calls.find((call) => call.cmd === "run_install_all");
            expect(installAll?.args).toEqual({ projectPath: "/repo", packageManager: "npm" });
        } finally {
            unmount(root, host);
        }
    });

    it("keeps a failed mutation visible and does not claim the list is empty", async () => {
        const { host, root } = mount(createElement(PackagesTab));
        try {
            await waitFor(host, "bettershape 0.4.0");
            const uninstall = host.querySelector<HTMLButtonElement>("button[aria-label='Uninstall react']");
            expect(uninstall).toBeTruthy();
            mockInvoke((cmd) => {
                if (cmd === "npm_uninstall") return Promise.reject("npm ERR! code ENOENT");
                return undefined;
            });
            act(() => uninstall?.click());
            await waitFor(host, "That action did not run");
            const text = host.textContent ?? "";
            expect(text).toContain("Uninstalling react failed");
            expect(text).toContain("ENOENT");
            expect(text).not.toContain("No dependencies");
        } finally {
            unmount(root, host);
        }
    });

    it("refreshes on the toolbar refresh button", async () => {
        const { host, root } = mount(createElement(PackagesTab));
        try {
            await waitFor(host, "bettershape 0.4.0");
            expect(reads).toBe(1);
            act(() => host.querySelector<HTMLButtonElement>("button[aria-label='Refresh package list']")?.click());
            await waitFor(host, "bettershape 0.4.0");
            await pause(50);
            expect(reads).toBe(2);
        } finally {
            unmount(root, host);
        }
    });

    it("does nothing without a project open", async () => {
        projectState.current = { project_path: null };
        const { host, root } = mount(createElement(PackagesTab));
        try {
            await waitFor(host, "No project open");
            expect(calls.filter((call) => call.cmd === "get_package_info")).toHaveLength(0);
        } finally {
            unmount(root, host);
        }
    });
});