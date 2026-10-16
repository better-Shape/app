import { createElement, type ReactElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { PackagesPanel, type PackageManagerKey } from "@/features/packages/panel";
import { buildPackageGroups, packagesState, type PackagesState } from "@/features/packages/model";
import type { PackageDep, PackageInfo } from "@/lib/backend";

function dep(overrides: Partial<PackageDep> & { name: string; version: string }): PackageDep {
    return { installed: null, wanted: null, latest: null, is_dev: false, ...overrides };
}

const INFO: PackageInfo = {
    name: "bettershape",
    version: "0.4.0",
    dependencies: [
        dep({ name: "react", version: "^19.0.0", installed: "19.0.0", wanted: "19.1.0", latest: "19.1.0" }),
        dep({ name: "zod", version: "^3.0.0" }),
    ],
    dev_dependencies: [
        dep({ name: "vitest", version: "^3.0.0", installed: "3.0.5", wanted: "3.2.0", latest: "3.2.0", is_dev: true }),
    ],
};

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

function panel(props: Partial<Parameters<typeof PackagesPanel>[0]> = {}) {
    const state: PackagesState = props.state ?? {
        kind: "ready",
        manifest: "bettershape 0.4.0",
        packageManager: "npm",
        groups: buildPackageGroups(INFO),
        visible: buildPackageGroups(INFO),
        summary: {
            dependencies: 2,
            devDependencies: 1,
            behind: 2,
            missingInstallData: 1,
            missingRegistryData: 0,
        },
        installTreeUnreadable: false,
        mutationError: null,
    };
    return createElement(PackagesPanel, {
        state,
        busy: false,
        filter: "",
        formKey: 0,
        packageManager: "npm" as PackageManagerKey,
        onFilterChange: () => {},
        onPackageManagerChange: () => {},
        onRefresh: () => {},
        onInstallAll: () => {},
        onSubmitInstall: () => {},
        onUninstall: () => {},
        onUpdate: () => {},
        ...props,
    } as Parameters<typeof PackagesPanel>[0]);
}

describe("packages panel", () => {
    it("renders every name, version and freshness label the input carries", () => {
        const { host, root } = mount(panel());
        try {
            const text = host.textContent ?? "";
            expect(text).toContain("bettershape 0.4.0");
            expect(text).toContain("react");
            expect(text).toContain("zod");
            expect(text).toContain("vitest");
            expect(text).toContain("^19.0.0");
            expect(text).toContain("19.1.0");
            expect(text).toContain("Update available");
            // zod has no installed and no latest, so neither "Up to date" nor
            // "Not installed" may be claimed for it.
            expect(text).toContain("Installed version unknown");
            expect(text).toContain("Dependencies");
            expect(text).toContain("Dev dependencies");
        } finally {
            unmount(root, host);
        }
    });

    it("keeps the section order the payload implies", () => {
        const { host, root } = mount(panel());
        try {
            const text = host.textContent ?? "";
            expect(text.indexOf("Dependencies")).toBeLessThan(text.indexOf("Dev dependencies"));
            expect(text.indexOf("react")).toBeLessThan(text.indexOf("zod"));
        } finally {
            unmount(root, host);
        }
    });

    it("says the manager reported no install tree rather than showing an empty list", () => {
        const unreadable: PackageInfo = {
            name: "x",
            version: "1.0.0",
            dependencies: [dep({ name: "react", version: "^19.0.0" })],
            dev_dependencies: [],
        };
        const state = packagesState({
            projectPath: "/repo",
            status: "loaded",
            message: null,
            info: unreadable,
            packageManager: "pnpm",
            filter: "",
            mutationError: null,
        });
        const { host, root } = mount(panel({ state, packageManager: "pnpm" }));
        try {
            const text = host.textContent ?? "";
            expect(text).toContain("pnpm reported no install tree");
            expect(text).toContain("react");
            expect(text).not.toContain("No dependencies");
        } finally {
            unmount(root, host);
        }
    });

    it("shows a failed mutation next to the list that still reads fine", () => {
        const state = packagesState({
            projectPath: "/repo",
            status: "loaded",
            message: null,
            info: INFO,
            packageManager: "npm",
            filter: "",
            mutationError: "Updating react failed. ENOTFOUND registry.npmjs.org",
        });
        const { host, root } = mount(panel({ state }));
        try {
            const text = host.textContent ?? "";
            expect(text).toContain("That action did not run");
            expect(text).toContain("ENOTFOUND registry.npmjs.org");
            expect(text).toContain("react");
        } finally {
            unmount(root, host);
        }
    });

    it("never shows an empty list when the backend failed", () => {
        const { host, root } = mount(
            panel({
                state: { kind: "failed", message: "Reading the package list failed. Serde JSON error: boom" },
            }),
        );
        try {
            const text = host.textContent ?? "";
            expect(text).toContain("The package list could not be read");
            expect(text).toContain("Serde JSON error: boom");
            expect(text).not.toContain("No dependencies");
        } finally {
            unmount(root, host);
        }
    });

    it("distinguishes a folder with no manifest from a failed read", () => {
        const { host, root } = mount(
            panel({
                state: {
                    kind: "blocked",
                    reason: "package.json not found",
                    detail: "This folder has no package.json, so there are no dependencies to manage.",
                },
            }),
        );
        try {
            const text = host.textContent ?? "";
            expect(text).toContain("No package manifest");
            expect(text).toContain("no package.json");
            expect(text).not.toContain("could not be read");
        } finally {
            unmount(root, host);
        }
    });

    it("says there is nothing to manage when the manifest really lists nothing", () => {
        const { host, root } = mount(
            panel({
                state: packagesState({
                    projectPath: "/repo",
                    status: "loaded",
                    message: null,
                    info: { name: "x", version: "1.0.0", dependencies: [], dev_dependencies: [] },
                    packageManager: "npm",
                    filter: "",
                    mutationError: null,
                }),
            }),
        );
        try {
            expect(host.textContent).toContain("No dependencies");
        } finally {
            unmount(root, host);
        }
    });

    it("reports the clicked row's package name to update and to uninstall", () => {
        const updated: string[] = [];
        const removed: string[] = [];
        const { host, root } = mount(
            panel({ onUpdate: (name: string) => updated.push(name), onUninstall: (name: string) => removed.push(name) }),
        );
        try {
            const updateButton = host.querySelector<HTMLButtonElement>("button[aria-label='Update zod']");
            const uninstallButton = host.querySelector<HTMLButtonElement>("button[aria-label='Uninstall vitest']");
            expect(updateButton).toBeTruthy();
            expect(uninstallButton).toBeTruthy();
            act(() => updateButton?.click());
            act(() => uninstallButton?.click());
            expect(updated).toEqual(["zod"]);
            expect(removed).toEqual(["vitest"]);
        } finally {
            unmount(root, host);
        }
    });

    it("blocks both row actions while a mutation is running", () => {
        const { host, root } = mount(panel({ busy: true }));
        try {
            for (const label of ["Update react", "Uninstall react", "Update vitest", "Uninstall vitest"]) {
                expect(host.querySelector<HTMLButtonElement>(`button[aria-label='${label}']`)?.disabled).toBe(true);
            }
            const installAll = host.querySelector<HTMLButtonElement>(
                "button[aria-label='Install every dependency']",
            );
            // `Button` keeps the control focusable and marks it aria-disabled.
            expect(installAll?.getAttribute("aria-disabled")).toBe("true");
            expect(installAll?.disabled).not.toBe(true);
        } finally {
            unmount(root, host);
        }
    });

    it("submits the typed spec with the dev toggle as a state, not a guess", () => {
        const installs: [string, boolean][] = [];
        const { host, root } = mount(panel({ onSubmitInstall: (spec: string, dev: boolean) => installs.push([spec, dev]) }));
        try {
            const input = host.querySelector<HTMLInputElement>("input[aria-label='Package to install']");
            expect(input).toBeTruthy();
            act(() => {
                const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
                setter?.call(input, "left-pad");
                input?.dispatchEvent(new Event("input", { bubbles: true }));
            });
            const submit = host.querySelector<HTMLFormElement>("form");
            act(() => submit?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
            expect(installs).toEqual([["left-pad", false]]);

            const devToggle = host.querySelector<HTMLButtonElement>("button[aria-pressed]");
            expect(devToggle?.getAttribute("aria-pressed")).toBe("false");
            act(() => devToggle?.click());
            expect(devToggle?.getAttribute("aria-pressed")).toBe("true");
            act(() => submit?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
            expect(installs[1]).toEqual(["left-pad", true]);
        } finally {
            unmount(root, host);
        }
    });

    it("will not submit a blank or multi-word spec", () => {
        const installs: string[] = [];
        const { host, root } = mount(panel({ onSubmitInstall: (spec: string) => installs.push(spec) }));
        try {
            const submit = host.querySelector<HTMLFormElement>("form");
            act(() => submit?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
            expect(installs).toEqual([]);
        } finally {
            unmount(root, host);
        }
    });

    it("filters the rows the user typed and says so when nothing matches", () => {
        const state = packagesState({
            projectPath: "/repo",
            status: "loaded",
            message: null,
            info: INFO,
            packageManager: "npm",
            filter: "zzzz",
            mutationError: null,
        });
        const { host, root } = mount(panel({ state, filter: "zzzz" }));
        try {
            const text = host.textContent ?? "";
            expect(text).toContain("No match");
            expect(text).not.toContain("vitest");
        } finally {
            unmount(root, host);
        }
    });
});