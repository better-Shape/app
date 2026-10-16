import { describeError } from "@/features/git/ui/search/model";
import type { PackageDep, PackageInfo } from "@/lib/backend";

/**
 * What the panel can honestly say about one package's installed version.
 *
 * `get_package_info` shells out to `<pm> ls` and `<pm> outdated`
 * (src-tauri/src/commands/packages/mod.rs). Neither result is an error when the
 * call fails: `parse_json` falls back to an empty object, so a package simply
 * comes back with nulls. "No data" therefore has to be a first-class state,
 * because rendering it as "up to date" or "not installed" would be a guess.
 */
export type PackageFreshness =
    /** `ls` did not report a version for this package. */
    | "no-install-data"
    /** `outdated` did not report a version for this package. */
    | "no-registry-data"
    | "current"
    | "behind";

export const FRESHNESS_LABEL: Record<PackageFreshness, string> = {
    "no-install-data": "Installed version unknown",
    "no-registry-data": "Registry data unavailable",
    current: "Up to date",
    behind: "Update available",
};

export type PackageRow = {
    name: string;
    /** The range or pin package.json declares. */
    declared: string;
    /** Version the install tree reports, or null when it reported none. */
    installed: string | null;
    /** Highest version satisfying `declared`, or null when the registry call failed. */
    wanted: string | null;
    /** Highest published version, or null when the registry call failed. */
    latest: string | null;
    isDev: boolean;
    freshness: PackageFreshness;
};

export type PackageGroups = {
    dependencies: PackageRow[];
    devDependencies: PackageRow[];
};

export type PackageSummary = {
    dependencies: number;
    devDependencies: number;
    behind: number;
    missingInstallData: number;
    missingRegistryData: number;
};

export type PackagesState =
    | { kind: "no-project" }
    /** The request is understood and cannot succeed as it stands. Retrying changes nothing. */
    | { kind: "blocked"; reason: string; detail?: string }
    | { kind: "loading" }
    | { kind: "failed"; message: string }
    | {
          kind: "ready";
          manifest: string | null;
          packageManager: string;
          groups: PackageGroups;
          visible: PackageGroups;
          summary: PackageSummary;
          /** True when every row is missing `installed`, which means `ls` never parsed. */
          installTreeUnreadable: boolean;
          /** A mutation that failed while the list itself still reads fine. */
          mutationError: string | null;
      };

const UNKNOWN_NAME = "unnamed package";
const UNDECLARED_VERSION = "no range declared";

/** The backend already sorts each list by name, but the panel owns its own order. */
export function comparePackageNames(a: string, b: string): number {
    const left = a.toLowerCase();
    const right = b.toLowerCase();
    if (left !== right) return left < right ? -1 : 1;
    if (a === b) return 0;
    return a < b ? -1 : 1;
}

export function safePackageName(raw: unknown): string {
    if (typeof raw !== "string") return UNKNOWN_NAME;
    const trimmed = raw.trim();
    return trimmed ? trimmed : UNKNOWN_NAME;
}

export function safePackageVersion(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
}

export function freshnessOf(installed: string | null, latest: string | null): PackageFreshness {
    if (installed === null) return "no-install-data";
    if (latest === null) return "no-registry-data";
    return installed === latest ? "current" : "behind";
}

export function toPackageRow(dep: PackageDep | null | undefined, isDev: boolean): PackageRow {
    const declared = safePackageVersion(dep?.version) ?? UNDECLARED_VERSION;
    const installed = safePackageVersion(dep?.installed);
    const wanted = safePackageVersion(dep?.wanted);
    const latest = safePackageVersion(dep?.latest);
    return {
        name: safePackageName(dep?.name),
        declared,
        installed,
        wanted,
        latest,
        isDev,
        freshness: freshnessOf(installed, latest),
    };
}

function toRows(deps: PackageDep[] | null | undefined, isDev: boolean): PackageRow[] {
    const rows = (Array.isArray(deps) ? deps : []).map((dep) => toPackageRow(dep, isDev));
    return rows.sort((a, b) => comparePackageNames(a.name, b.name));
}

/**
 * A name in both manifest sections is a malformed package.json that npm itself
 * rejects, so the production entry wins and the row is not duplicated. Without
 * this a bad manifest would show two rows for one package, each offering an
 * action that rewrites the same key.
 */
export function buildPackageGroups(info: PackageInfo | null | undefined): PackageGroups {
    const dependencies = toRows(info?.dependencies, false);
    const seen = new Set(dependencies.map((row) => row.name));
    const devDependencies = toRows(info?.dev_dependencies, true).filter(
        (row) => !seen.has(row.name),
    );
    return { dependencies, devDependencies };
}

export function filterPackageRows(rows: PackageRow[], query: string): PackageRow[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return [...rows];
    return rows.filter((row) => row.name.toLowerCase().includes(needle));
}

export function filterPackageGroups(groups: PackageGroups, query: string): PackageGroups {
    return {
        dependencies: filterPackageRows(groups.dependencies, query),
        devDependencies: filterPackageRows(groups.devDependencies, query),
    };
}

export function summarizePackages(groups: PackageGroups): PackageSummary {
    const rows = [...groups.dependencies, ...groups.devDependencies];
    return {
        dependencies: groups.dependencies.length,
        devDependencies: groups.devDependencies.length,
        behind: rows.filter((row) => row.freshness === "behind").length,
        missingInstallData: rows.filter((row) => row.freshness === "no-install-data").length,
        missingRegistryData: rows.filter((row) => row.freshness === "no-registry-data").length,
    };
}

/**
 * A null `installed` on its own is ambiguous: it can mean the package is not
 * installed, or that `<pm> ls` never produced a tree. Every row missing it means
 * the second, because a partly installed tree still reports the packages it has.
 */
export function installTreeUnreadable(groups: PackageGroups): boolean {
    const rows = [...groups.dependencies, ...groups.devDependencies];
    return rows.length > 0 && rows.every((row) => row.installed === null);
}

export function describePackageManifest(info: PackageInfo | null | undefined): string | null {
    const name = safePackageVersion(info?.name);
    const version = safePackageVersion(info?.version);
    if (name && version) return `${name} ${version}`;
    if (name) return name;
    if (version) return version;
    return null;
}

export function pluralPackages(count: number): string {
    return `${count} ${count === 1 ? "package" : "packages"}`;
}

/** `npm install <spec>` and friends take a bare name or a `name@range` spec; only blank is unusable. */
export function normalizeInstallSpec(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return /\s/.test(trimmed) ? null : trimmed;
}

/**
 * `get_package_info` answers `AppError::Message("package.json not found")` when
 * the folder has no manifest (src-tauri/src/commands/packages/mod.rs, the
 * `!pkg_path.exists()` branch). Nothing about the request was malformed, so the
 * panel calls it blocked rather than failed and never offers a retry that cannot
 * work. A message that does not match this shape falls through to `failed`.
 */
export function isMissingManifest(message: string): boolean {
    return /package\.json not found/i.test(message);
}

/**
 * The one place a raw load result becomes what the panel renders. A load that
 * never answered, a folder with no manifest and a backend error are three
 * different things, and only the first two may look empty.
 */
export function packagesState(input: {
    projectPath: string | null;
    status: "loading" | "loaded" | "failed";
    message: string | null;
    info: PackageInfo | null;
    packageManager: string;
    filter: string;
    mutationError: string | null;
}): PackagesState {
    if (!input.projectPath) return { kind: "no-project" };
    if (input.status === "loading") return { kind: "loading" };
    if (input.status === "failed") {
        const message = input.message?.trim() || "The backend gave no reason.";
        if (isMissingManifest(message)) {
            return {
                kind: "blocked",
                reason: "package.json not found",
                detail: "This folder has no package.json, so there are no dependencies to manage.",
            };
        }
        return { kind: "failed", message };
    }
    if (!input.info) {
        // A load that resolved without a body is not a list with nothing in it.
        return { kind: "failed", message: "The backend returned no package list." };
    }
    const groups = buildPackageGroups(input.info);
    return {
        kind: "ready",
        manifest: describePackageManifest(input.info),
        packageManager: input.packageManager,
        groups,
        visible: filterPackageGroups(groups, input.filter),
        summary: summarizePackages(groups),
        installTreeUnreadable: installTreeUnreadable(groups),
        mutationError: input.mutationError,
    };
}

/** The backend returns the raw failure text, which is often a whole npm log. Keep the panel readable. */
export function describeMutationFailure(action: string, error: unknown): string {
    const text = describeError(error);
    const firstLine = text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? text;
    return `${action} failed. ${firstLine}`;
}