"use client";

import type { GitBranchDetail } from "@/lib/backend/types";

/** The two kinds of ref the list shows, which decide the icon and the row menu. */
export type BranchKind = "local" | "remote";

/** One row: the ref's name, plus whatever the detail query knows about its tip. */
export type BranchItem = {
    name: string;
    displayName: string;
    kind: BranchKind;
    remote?: string;
    author?: string;
    authorEmail?: string;
    date?: string;
    ahead?: number | null;
    behind?: number | null;
};

/** A remote's visible rows, with the total it was cut down from. */
export type RemoteSlice = {
    remote: string;
    items: BranchItem[];
    total: number;
};

/**
 * The most rows the list will mount at once.
 *
 * A window against a large monorepo can carry thousands of remote branches, and every row is
 * a context menu and two icons; the cap keeps a bot-heavy remote from mounting the lot. The
 * filter is the way past it, and the list says how many rows it is holding back.
 */
export const BRANCH_LIST_CAP = 400;

/** `origin/main` is the remote `origin` and the branch `main`; a bare name is the branch. */
const splitRemoteRef = (full: string) => {
    const slash = full.indexOf("/");
    if (slash < 0) return { remote: "remote", short: full };
    return { remote: full.slice(0, slash), short: full.slice(slash + 1) };
};

/** The needle a filter string narrows to: trimmed and lowercase, empty when it is blank. */
export const filterNeedle = (filter: string) => filter.trim().toLowerCase();

/**
 * The details by branch name.
 *
 * Keyed by name because every row asks for its own detail, and a scan per row would read the
 * whole array once per row on a list with hundreds of them.
 */
export const indexBranchDetails = (details: readonly GitBranchDetail[]) => {
    const byName = new Map<string, GitBranchDetail>();
    for (const detail of details) byName.set(detail.name, detail);
    return byName;
};

/**
 * The tip fields a row shows, or nothing when the query had no detail for the name.
 *
 * A missing detail is normal rather than exceptional: a remote branch that has never been
 * fetched has no tip to report, and an empty object lets the row render its name alone.
 */
const tipOf = (detail: GitBranchDetail | undefined): Partial<BranchItem> => {
    if (!detail) return {};
    return {
        author: detail.author,
        authorEmail: detail.authorEmail,
        date: detail.date,
        ahead: detail.ahead,
        behind: detail.behind,
    };
};

/** Whether a ref name passes the filter. An empty filter passes every name. */
const matchesNeedle = (name: string, needle: string) =>
    !needle || name.toLowerCase().includes(needle);

/** The detail for a remote ref, which git may report under either spelling of its name. */
const detailFor = (
    details: ReadonlyMap<string, GitBranchDetail>,
    full: string,
    short: string,
) => details.get(full) ?? details.get(short);

/** A row from a local branch name and the detail for it, when the query returned one. */
const localRow = (name: string, detail: GitBranchDetail | undefined): BranchItem => ({
    name,
    displayName: name,
    kind: "local",
    ...tipOf(detail),
});

/** A row from a remote branch name, which shows the branch and groups under the remote. */
const remoteRow = (full: string, detail: GitBranchDetail | undefined): BranchItem => {
    const { remote, short } = splitRemoteRef(full);
    return {
        name: full,
        displayName: short,
        kind: "remote",
        remote,
        ...tipOf(detail),
    };
};

/** The local rows the filter keeps, in the order git reported them. */
export const localBranchItems = ({
    names,
    details,
    needle,
}: {
    names: readonly string[];
    details: ReadonlyMap<string, GitBranchDetail>;
    needle: string;
}): BranchItem[] =>
    names
        .filter((name) => matchesNeedle(name, needle))
        .map((name) => localRow(name, details.get(name)));

/** The remote rows the filter keeps, grouped by remote and sorted by remote name. */
export const remoteBranchGroups = ({
    names,
    details,
    needle,
}: {
    names: readonly string[];
    details: ReadonlyMap<string, GitBranchDetail>;
    needle: string;
}): Array<[string, BranchItem[]]> => {
    const groups = new Map<string, BranchItem[]>();
    for (const full of names) {
        if (!matchesNeedle(full, needle)) continue;
        const { remote, short } = splitRemoteRef(full);
        // `origin/HEAD` is a symbolic ref: it points at another row and reads as a duplicate.
        if (short === "HEAD") continue;
        const rows = groups.get(remote) ?? [];
        rows.push(remoteRow(full, detailFor(details, full, short)));
        groups.set(remote, rows);
    }
    return Array.from(groups.entries()).sort(([first], [second]) => first.localeCompare(second));
};

/**
 * The groups cut down to the cap, spending it in the order the groups are listed.
 *
 * The budget is shared across remotes rather than applied per remote, so one remote with a
 * thousand branches cannot push the others out of the list entirely.
 */
export const capRemoteGroups = (
    groups: ReadonlyArray<[string, BranchItem[]]>,
    cap: number,
): RemoteSlice[] => {
    let remaining = cap;
    const slices: RemoteSlice[] = [];
    for (const [remote, items] of groups) {
        if (remaining <= 0) break;
        const visible = items.slice(0, remaining);
        remaining -= visible.length;
        slices.push({ remote, items: visible, total: items.length });
    }
    return slices;
};

/** How many remote rows exist, across every group. */
export const countRemoteRows = (groups: ReadonlyArray<[string, BranchItem[]]>) =>
    groups.reduce((total, [, items]) => total + items.length, 0);

/** How many remote rows are mounted, across the capped groups. */
export const countVisibleRows = (slices: readonly RemoteSlice[]) =>
    slices.reduce((total, slice) => total + slice.items.length, 0);

/**
 * The row a name points at, searched locally first.
 *
 * A remote branch is listed under its remote's group but also answers to its full name, so
 * both spellings have to resolve before the selection is called missing.
 */
export const findBranchItem = ({
    name,
    locals,
    groups,
}: {
    name: string | null;
    locals: readonly BranchItem[];
    groups: ReadonlyArray<[string, BranchItem[]]>;
}): BranchItem | null => {
    if (!name) return null;
    const local = locals.find((item) => item.name === name);
    if (local) return local;
    for (const [, items] of groups) {
        const hit = items.find((item) => item.name === name);
        if (hit) return hit;
    }
    return null;
};

/**
 * The branch name a ref compares as: the branch without its remote.
 *
 * Comparing `origin/main` with the checked-out `main` is a comparison with itself, so the
 * short name is what decides whether a comparison is meaningful.
 */
export const compareName = (branch: string) => splitRemoteRef(branch).short;
