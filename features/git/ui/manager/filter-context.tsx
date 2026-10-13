"use client";

import {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useState,
    useSyncExternalStore,
    type ReactNode,
} from "react";
import type { GitSectionId } from "@/features/git/types";

const PLACEHOLDERS: Record<GitSectionId, string> = {
    source: "Search changes…",
    graph: "Search commits…",
    branches: "Filter branches…",
    tags: "Filter tags…",
    "pull-requests": "Search pull requests…",
    issues: "Search issues…",
    releases: "Search releases…",
    "workflow-runs": "Search workflow runs…",
    jobs: "Search jobs…",
};

export const GIT_SECTION_TITLES: Record<GitSectionId, string> = {
    source: "Source Control",
    graph: "Git Graph",
    branches: "Branches",
    tags: "Tags",
    "pull-requests": "Pull requests",
    issues: "Issues",
    releases: "Releases",
    "workflow-runs": "Workflow runs",
    jobs: "Jobs",
};

const SECTION_STORAGE_KEY = "bettershape-git-manager-section";
const SECTION_CHANGED_EVENT = "bettershape-git-section-changed";

function subscribeStoredSection(onChange: () => void): () => void {
    window.addEventListener("storage", onChange);
    window.addEventListener(SECTION_CHANGED_EVENT, onChange);
    return () => {
        window.removeEventListener("storage", onChange);
        window.removeEventListener(SECTION_CHANGED_EVENT, onChange);
    };
}

const KNOWN_SECTIONS = new Set<string>(Object.keys(PLACEHOLDERS));

const LEGACY_SECTIONS: Record<string, GitSectionId> = {
    "workflow-definitions": "workflow-runs",
    steps: "jobs",
    "live-status": "workflow-runs",
    logs: "jobs",
    artifacts: "workflow-runs",
    "check-runs": "workflow-runs",
    "check-suites": "workflow-runs",
    "commit-statuses": "graph",
    deployments: "workflow-runs",
    "deployment-statuses": "workflow-runs",
};

export function coerceGitSection(value: string | null | undefined): GitSectionId | null {
    if (!value) return null;
    if (KNOWN_SECTIONS.has(value)) return value as GitSectionId;
    return LEGACY_SECTIONS[value] ?? null;
}

export function isGitSectionId(value: string | null | undefined): value is GitSectionId {
    return !!value && KNOWN_SECTIONS.has(value);
}

export function readStoredGitSection(): GitSectionId | null {
    if (typeof window === "undefined") return null;
    try {
        const fromQuery = new URLSearchParams(window.location.search).get("section");
        const fromQueryMapped = coerceGitSection(fromQuery);
        if (fromQueryMapped) return fromQueryMapped;
        const stored = localStorage.getItem(SECTION_STORAGE_KEY);
        return coerceGitSection(stored);
    } catch {
        /* ignore */
    }
    return null;
}

export function persistGitSection(id: GitSectionId) {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(SECTION_STORAGE_KEY, id);
    } catch {
        /* ignore */
    }
    try {
        const url = new URL(window.location.href);
        if (url.searchParams.get("section") !== id) {
            url.searchParams.set("section", id);
            window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
        }
    } catch {
        /* ignore */
    }
    // Same-tab listeners do not get a `storage` event, so notify them explicitly.
    window.dispatchEvent(new Event(SECTION_CHANGED_EVENT));
}

type FilterContextValue = {
    query: string;
    setQuery: (value: string) => void;
    section: GitSectionId;
    setSection: (id: GitSectionId) => void;
    placeholder: string;
    sectionTitle: string;
    searchEnabled: boolean;
};

const FilterContext = createContext<FilterContextValue | null>(null);

export function FilterProvider({
    children,
    initialSection = "source",
}: {
    children: ReactNode;
    initialSection?: GitSectionId;
}) {
    const [query, setQueryState] = useState("");
    // The stored section is read after hydration (server snapshot = null, so SSR matches).
    const storedSection = useSyncExternalStore(subscribeStoredSection, readStoredGitSection, () => null);
    // A section picked here wins only until the stored value changes again.
    const [picked, setPicked] = useState<{ value: GitSectionId; basedOn: GitSectionId | null } | null>(null);
    const section: GitSectionId =
        picked && picked.basedOn === storedSection
            ? picked.value
            : (storedSection ?? initialSection);
    const setSectionState = useCallback(
        (id: GitSectionId) => setPicked({ value: id, basedOn: storedSection }),
        [storedSection],
    );

    const setQuery = useCallback((value: string) => {
        setQueryState(value);
    }, []);

    const setSection = useCallback(
        (id: GitSectionId) => {
            setSectionState(id);
            persistGitSection(id);
            setQueryState("");
        },
        [setSectionState],
    );

    const value = useMemo<FilterContextValue>(
        () => ({
            query,
            setQuery,
            section,
            setSection,
            placeholder: PLACEHOLDERS[section],
            sectionTitle: GIT_SECTION_TITLES[section],
            searchEnabled: true,
        }),
        [query, section, setQuery, setSection],
    );

    return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useOptionalFilter() {
    return useContext(FilterContext);
}

export function useFilter() {
    const ctx = useContext(FilterContext);
    if (!ctx) {
        throw new Error("useFilter must be used within FilterProvider");
    }
    return ctx;
}
