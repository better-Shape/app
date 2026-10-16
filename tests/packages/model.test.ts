import { describe, expect, it } from "vitest";
import { iconFor, type TabKind } from "@/features/agent/workspace/model";
import {
    buildPackageGroups,
    comparePackageNames,
    describeMutationFailure,
    describePackageManifest,
    filterPackageGroups,
    freshnessOf,
    installTreeUnreadable,
    isMissingManifest,
    normalizeInstallSpec,
    packagesState,
    safePackageVersion,
    summarizePackages,
    toPackageRow,
} from "@/features/packages/model";
import type { PackageDep, PackageInfo } from "@/lib/backend";

/** The shape `collect_deps` in src-tauri/src/commands/packages/mod.rs builds. */
function dep(overrides: Partial<PackageDep> & { name: string; version: string }): PackageDep {
    return { installed: null, wanted: null, latest: null, is_dev: false, ...overrides };
}

const INFO: PackageInfo = {
    name: "bettershape",
    version: "0.4.0",
    dependencies: [
        dep({ name: "react", version: "^19.0.0", installed: "19.0.0", wanted: "19.1.0", latest: "19.1.0" }),
        dep({ name: "@tauri-apps/api", version: "^2.0.0", installed: "2.0.1", wanted: "2.0.1", latest: "2.0.1" }),
        dep({ name: "zod", version: "^3.0.0" }),
    ],
    dev_dependencies: [
        dep({ name: "vitest", version: "^3.0.0", installed: "3.0.5", wanted: "3.2.0", latest: "3.2.0", is_dev: true }),
        dep({ name: "eslint", version: "^9.0.0", installed: "9.0.0", wanted: "9.0.0", latest: "9.0.0", is_dev: true }),
        // Same name in both manifest sections. npm rejects this, so the panel
        // must not show two rows that each rewrite the same key.
        dep({ name: "react", version: "^19.0.0", installed: "19.0.0", is_dev: true }),
    ],
};

function ready(overrides: Partial<Parameters<typeof packagesState>[0]> = {}) {
    return packagesState({
        projectPath: "/repo",
        status: "loaded",
        message: null,
        info: INFO,
        packageManager: "npm",
        filter: "",
        mutationError: null,
        ...overrides,
    });
}

describe("package version normalisation", () => {
    it("keeps a real version and drops a blank one to null rather than an empty cell", () => {
        expect(safePackageVersion("  19.1.0 ")).toBe("19.1.0");
        expect(safePackageVersion("")).toBeNull();
        expect(safePackageVersion("   ")).toBeNull();
        expect(safePackageVersion(undefined)).toBeNull();
        expect(safePackageVersion(19)).toBeNull();
    });

    it("never renders a row with no declared range as an empty cell", () => {
        const row = toPackageRow({ name: "react", version: "" } as PackageDep, false);
        expect(row.declared.length).toBeGreaterThan(0);
        expect(row.name).toBe("react");
    });

    it("falls back to a placeholder name so a nameless package is still a row", () => {
        expect(toPackageRow({ name: "  ", version: "^1.0.0" } as PackageDep, false).name.length).toBeGreaterThan(0);
        expect(toPackageRow(null, false).name.length).toBeGreaterThan(0);
    });
});

describe("package freshness", () => {
    it("calls an update available only when both sides of the comparison exist", () => {
        expect(freshnessOf("1.0.0", "1.1.0")).toBe("behind");
        expect(freshnessOf("1.1.0", "1.1.0")).toBe("current");
    });

    it("reports missing data instead of claiming the package is current", () => {
        // A null latest means `<pm> outdated` produced nothing, which is not the
        // same statement as "there is no newer version".
        expect(freshnessOf("1.0.0", null)).toBe("no-registry-data");
        expect(freshnessOf(null, "1.0.0")).toBe("no-install-data");
        expect(freshnessOf(null, null)).toBe("no-install-data");
    });

    it("labels each freshness with words so the colour is not the only cue", () => {
        const rows = buildPackageGroups(INFO);
        const react = rows.dependencies.find((row) => row.name === "react");
        const zod = rows.dependencies.find((row) => row.name === "zod");
        expect(react?.freshness).toBe("behind");
        expect(zod?.freshness).toBe("no-install-data");
    });
});

describe("package grouping and ordering", () => {
    it("orders each section by name, case-insensitively", () => {
        const groups = buildPackageGroups(INFO);
        expect(groups.dependencies.map((row) => row.name)).toEqual(["@tauri-apps/api", "react", "zod"]);
        expect(groups.devDependencies.map((row) => row.name)).toEqual(["eslint", "vitest"]);
    });

    it("sorts the same way for names that differ only in case", () => {
        expect(comparePackageNames("Zod", "axios")).toBeGreaterThan(0);
        expect(comparePackageNames("axios", "Zod")).toBeLessThan(0);
        expect(comparePackageNames("Zod", "zod")).toBeLessThan(0);
        expect(comparePackageNames("zod", "zod")).toBe(0);
    });

    it("keeps a package listed in both manifest sections to one row", () => {
        const groups = buildPackageGroups(INFO);
        const all = [...groups.dependencies, ...groups.devDependencies].filter((row) => row.name === "react");
        expect(all).toHaveLength(1);
        expect(all[0].isDev).toBe(false);
    });

    it("survives a payload with no dependency arrays at all", () => {
        const groups = buildPackageGroups({ name: "x", version: "1.0.0" } as PackageInfo);
        expect(groups).toEqual({ dependencies: [], devDependencies: [] });
        expect(buildPackageGroups(null).dependencies).toEqual([]);
    });

    it("treats a resolved load with no body as a failure, not an empty list", () => {
        const state = ready({ info: null });
        expect(state.kind).toBe("failed");
        if (state.kind !== "failed") throw new Error("expected failed");
        expect(state.message).toBe("The backend returned no package list.");
    });
});

describe("package filtering and counting", () => {
    it("filters both sections on a case-insensitive substring of the name", () => {
        const filtered = filterPackageGroups(buildPackageGroups(INFO), "  REA ");
        expect(filtered.dependencies.map((row) => row.name)).toEqual(["react"]);
        expect(filtered.devDependencies).toEqual([]);
    });

    it("returns every row for a blank query", () => {
        const groups = buildPackageGroups(INFO);
        expect(filterPackageGroups(groups, "   ")).toEqual(groups);
    });

    it("counts updates and rows with no registry data separately", () => {
        const summary = summarizePackages(buildPackageGroups(INFO));
        expect(summary.dependencies).toBe(3);
        expect(summary.devDependencies).toBe(2);
        expect(summary.behind).toBe(2);
        expect(summary.missingInstallData).toBe(1);
        expect(summary.missingRegistryData).toBe(0);
    });

    it("treats a manifest with no versions anywhere as an unread install tree, not an empty install", () => {
        const empty: PackageInfo = {
            name: "x",
            version: "1.0.0",
            dependencies: [dep({ name: "react", version: "^19.0.0" })],
            dev_dependencies: [dep({ name: "vitest", version: "^3.0.0", is_dev: true })],
        };
        expect(installTreeUnreadable(buildPackageGroups(empty))).toBe(true);
    });

    it("does not claim an unread tree when only one package is missing its version", () => {
        expect(installTreeUnreadable(buildPackageGroups(INFO))).toBe(false);
    });

    it("does not claim an unread tree for a manifest that lists nothing", () => {
        expect(installTreeUnreadable(buildPackageGroups({ dependencies: [], dev_dependencies: [] }))).toBe(false);
    });
});

describe("install specs and manifests", () => {
    it("accepts a bare name and a name with a range, and rejects a blank or multi-word value", () => {
        expect(normalizeInstallSpec("  react ")).toBe("react");
        expect(normalizeInstallSpec("react@19.0.0")).toBe("react@19.0.0");
        expect(normalizeInstallSpec("   ")).toBeNull();
        expect(normalizeInstallSpec("two words")).toBeNull();
    });

    it("describes the manifest from the name and version the backend returned", () => {
        expect(describePackageManifest(INFO)).toBe("bettershape 0.4.0");
        expect(describePackageManifest({ dependencies: [], dev_dependencies: [], name: "solo" })).toBe("solo");
        expect(describePackageManifest({ dependencies: [], dev_dependencies: [] })).toBeNull();
    });
});

describe("packages state", () => {
    it("has no state at all without a project", () => {
        expect(ready({ projectPath: null }).kind).toBe("no-project");
    });

    it("loads rather than reporting an empty list while the first read is in flight", () => {
        const state = ready({ status: "loading", info: null });
        expect(state.kind).toBe("loading");
    });

    it("blocks on a missing manifest instead of showing zero dependencies", () => {
        const state = ready({
            status: "failed",
            info: null,
            message: "Reading the package list failed. package.json not found",
        });
        expect(state.kind).toBe("blocked");
        if (state.kind !== "blocked") throw new Error("expected blocked");
        expect(state.reason).toBe("package.json not found");
        expect(state.detail).toContain("no package.json");
    });

    it("fails, and keeps the reason, when the backend errored on something else", () => {
        const state = ready({
            status: "failed",
            info: null,
            message: "Reading the package list failed. Serde JSON error: expected value at line 1",
        });
        expect(state.kind).toBe("failed");
        if (state.kind !== "failed") throw new Error("expected failed");
        expect(state.message).toContain("expected value");
    });

    it("matches the missing-manifest reason case-insensitively and only on that text", () => {
        expect(isMissingManifest("Package.json not found")).toBe(true);
        expect(isMissingManifest("npm ERR! 404 package.json not found in registry")).toBe(true);
        expect(isMissingManifest("Invalid package.json: expected value")).toBe(false);
    });

    it("carries a failed mutation alongside a list that still reads fine", () => {
        const state = ready({ mutationError: "Updating react failed. ENOTFOUND registry.npmjs.org" });
        expect(state.kind).toBe("ready");
        if (state.kind !== "ready") throw new Error("expected ready");
        expect(state.mutationError).toContain("ENOTFOUND");
        expect(state.groups.dependencies).toHaveLength(3);
    });

    it("filters the visible rows without dropping the ones behind the filter", () => {
        const state = ready({ filter: "vitest" });
        if (state.kind !== "ready") throw new Error("expected ready");
        expect(state.visible.dependencies).toEqual([]);
        expect(state.visible.devDependencies.map((row) => row.name)).toEqual(["vitest"]);
        expect(state.summary.dependencies).toBe(3);
    });
});

describe("workspace tab kinds added for these two tabs", () => {
    it("gives every tab kind a glyph, including the two new ones", () => {
        const kinds: TabKind[] = [
            "graph",
            "agents",
            "plan",
            "file",
            "diff",
            "files",
            "prs",
            "browser",
            "problems",
            "search",
            "packages",
            "blame",
        ];
        for (const kind of kinds) {
            expect(iconFor(kind)).toBeTruthy();
        }
    });

    it("does not give a new tab the glyph of an existing one, which would make the tab unreadable", () => {
        expect(iconFor("packages")).not.toBe(iconFor("files"));
        expect(iconFor("blame")).not.toBe(iconFor("packages"));
        expect(iconFor("blame")).not.toBe(iconFor("graph"));
        expect(iconFor("packages")).not.toBe(iconFor("problems"));
    });
});

describe("mutation failure text", () => {
    it("leads with the action and keeps the first line of the backend log", () => {
        const failure = describeMutationFailure("Installing left-pad", "npm ERR! code E404\nnpm ERR! 404 Not Found");
        expect(failure).toBe("Installing left-pad failed. npm ERR! code E404");
    });

    it("still says something when the backend returned nothing", () => {
        expect(describeMutationFailure("Installing left-pad", "")).toContain("Installing left-pad failed");
    });
});