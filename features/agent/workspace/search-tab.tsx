"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { SearchPanel, type ReplaceScope } from "@/features/git/ui/search/panel";
import {
    defaultSearchSettings,
    deriveSearchState,
    describeError,
    groupMatches,
    pluralFiles,
    pluralMatches,
    searchBlockedReason,
    setSearchPattern,
    summarizeReplace,
    summarizeSearch,
    toggleSearchFlag,
    toSearchOptions,
    type ReplaceSummary,
    type SearchFileGroup,
    type SearchHit,
    type SearchOutcome,
    type SearchOptionKey,
    type SearchSettings,
} from "@/features/git/ui/search/model";
import { openDiagnostic } from "@/features/git/ui/problems/reveal";
import { Button } from "@/components/ui/button";
import {
    AlertDialog,
    AlertDialogBody,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { notify } from "@/features/notifications";
import { commands, useProjectState } from "@/lib/backend";

/**
 * `search_content` shells out to ripgrep over the whole project and walks up to
 * 3000 matches before it stops, so one invoke is a real scan and not a filter
 * over something already in memory. Typing a 12-character query at a normal
 * cadence would otherwise queue a dozen of them. 250 ms is the floor that keeps
 * a burst of keystrokes to a single scan while staying under the ~300 ms at
 * which a result feels like it is lagging behind the keyboard.
 */
const SEARCH_DEBOUNCE_MS = 250;

const SIDEBAR_SURFACE = {
    "--panel": "var(--sidebar)",
    "--color-panel": "var(--sidebar)",
    "--editor": "var(--sidebar)",
    "--color-editor": "var(--sidebar)",
} as CSSProperties;

function scopeHeading(scope: ReplaceScope, ready: SearchFileGroup[] | null): string {
    if (scope.kind === "all") {
        const summary = summarizeSearch(ready ?? []);
        return `Replace ${pluralMatches(summary.matches)} in ${pluralFiles(summary.files)}`;
    }
    if (scope.kind === "file") return `Replace all ${pluralMatches(scope.count)} in ${scope.label}`;
    return `Replace the match in ${scope.label} at ${scope.line}:${scope.column}`;
}

export function SearchTab() {
    const { project_path, open_files } = useProjectState();
    const [query, setQuery] = useState("");
    const [replacement, setReplacement] = useState("");
    const [settings, setSettings] = useState<SearchSettings>(defaultSearchSettings);
    const [outcome, setOutcome] = useState<SearchOutcome>({ status: "idle" });
    const [lastResults, setLastResults] = useState<ReturnType<typeof groupMatches> | null>(null);
    const [rerunToken, setRerunToken] = useState(0);
    const [replaceOutcome, setReplaceOutcome] = useState<ReplaceSummary | null>(null);
    const [replaceError, setReplaceError] = useState<string | null>(null);
    const [pending, setPending] = useState<ReplaceScope | null>(null);
    const [replacing, setReplacing] = useState(false);

    /**
     * Every run takes a ticket. A slow search that answers after a newer one has
     * already landed must not overwrite it — the sequence number is what makes
     * "last one wins" true regardless of how the two resolves interleave.
     */
    const ticket = useRef(0);

    /**
     * Which field a shortcut asked us to land in. Reset to null on the next tick so a
     * second press of the same shortcut is a null -> field change again and re-focuses,
     * which a stable field value would not.
     */
    const [autoFocusField, setAutoFocusField] = useState<"query" | "replacement" | null>(null);
    useEffect(() => {
        const onFocusField = (e: Event) => {
            const which = (e as CustomEvent<"search" | "replace">).detail;
            if (which !== "search" && which !== "replace") return;
            setAutoFocusField(which === "replace" ? "replacement" : "query");
        };
        window.addEventListener("bettershape-focus-search-field", onFocusField as EventListener);
        return () => window.removeEventListener("bettershape-focus-search-field", onFocusField as EventListener);
    }, []);
    useEffect(() => {
        if (autoFocusField === null) return;
        const id = window.setTimeout(() => setAutoFocusField(null), 0);
        return () => window.clearTimeout(id);
    }, [autoFocusField]);

    useEffect(() => {
        if (!project_path || searchBlockedReason(query, settings)) {
            setOutcome({ status: "idle" });
            return;
        }
        const id = ++ticket.current;
        let cancelled = false;
        setOutcome({ status: "loading" });
        const timer = setTimeout(() => {
            commands
                .searchContent(query, toSearchOptions(settings))
                .then((results) => {
                    if (cancelled || id !== ticket.current) return;
                    const list = Array.isArray(results) ? results : [];
                    setLastResults(groupMatches(list));
                    setOutcome({ status: "done", results: list });
                })
                .catch((error) => {
                    if (cancelled || id !== ticket.current) return;
                    setOutcome({ status: "failed", message: describeError(error) });
                });
        }, SEARCH_DEBOUNCE_MS);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [project_path, query, settings, rerunToken]);

    const state = useMemo(
        () => deriveSearchState(query, settings, lastResults, outcome),
        [query, settings, lastResults, outcome],
    );

    const onToggleFlag = useCallback((key: SearchOptionKey) => {
        setSettings((current) => toggleSearchFlag(current, key));
    }, []);

    const onPatternChange = useCallback((which: "include" | "exclude", value: string) => {
        setSettings((current) => setSearchPattern(current, which, value));
    }, []);

    const onOpen = useCallback((hit: SearchHit) => {
        openDiagnostic(hit.path, hit.line, hit.column);
    }, []);

    const onOpenFile = useCallback((group: SearchFileGroup) => {
        openDiagnostic(group.path, 1, 1);
    }, []);

    const dirtyLabels = useMemo(() => {
        const dirty = new Set(open_files.filter((file) => file.is_dirty).map((file) => file.path));
        if (!pending) return [];
        if (pending.kind === "match") return dirty.has(pending.path) ? [pending.label] : [];
        if (pending.kind === "file") return dirty.has(pending.path) ? [pending.label] : [];
        const groups = state.kind === "ready" ? state.groups : [];
        return groups.filter((group) => dirty.has(group.path)).map((group) => group.label);
    }, [open_files, pending, state]);

    const runReplace = useCallback(async () => {
        const scope = pending;
        if (!scope || !project_path) return;
        setPending(null);
        setReplacing(true);
        setReplaceError(null);
        try {
            const result = await commands.replaceContent(
                query,
                replacement,
                toSearchOptions(settings),
                scope.kind === "match" ? scope.match : null,
                scope.kind === "all" ? null : scope.path,
            );
            const summary = summarizeReplace(result);
            setReplaceOutcome(summary);
            if (summary?.kind === "partial") {
                notify.error("Some files could not be replaced", summary.errors[0]);
            } else if (summary?.kind === "nothing") {
                notify.warning("Nothing was replaced", "The files no longer hold that text.");
            }
            // `replace_content` re-searches internally, so the list on screen is stale.
            setRerunToken((token) => token + 1);
        } catch (error) {
            const message = describeError(error);
            setReplaceOutcome(null);
            setReplaceError(message);
            notify.error("Replace didn't run", message);
        } finally {
            setReplacing(false);
        }
    }, [pending, project_path, query, replacement, settings]);

    return (
        <div
            role="region"
            aria-label="Search"
            className="h-full min-h-0 bg-sidebar"
            style={SIDEBAR_SURFACE}
        >
            <SearchPanel
                query={query}
                replacement={replacement}
                autoFocusField={autoFocusField}
                settings={settings}
                state={state}
                replace={replaceOutcome}
                replaceError={replaceError}
                searching={outcome.status === "loading"}
                replacing={replacing}
                onQueryChange={setQuery}
                onReplacementChange={setReplacement}
                onToggleFlag={onToggleFlag}
                onPatternChange={onPatternChange}
                onRerun={() => setRerunToken((token) => token + 1)}
                onOpen={onOpen}
                onOpenFile={onOpenFile}
                onRequestReplace={setPending}
            />

            <AlertDialog
                open={pending !== null}
                onOpenChange={(open) => {
                    if (!open) setPending(null);
                }}
            >
                <AlertDialogContent sizeClassName="max-w-[480px]">
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {pending ? scopeHeading(pending, lastResults) : "Replace"}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            This writes to disk straight away. There is no undo here — the editor
                            reloads the file from disk afterwards.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogBody>
                        <dl className="flex flex-col gap-1 text-xs">
                            <div className="flex gap-2">
                                <dt className="shrink-0 text-text-muted">Find</dt>
                                <dd className="min-w-0 flex-1 truncate font-mono text-text-primary">
                                    {query}
                                </dd>
                            </div>
                            <div className="flex gap-2">
                                <dt className="shrink-0 text-text-muted">Replace</dt>
                                <dd className="min-w-0 flex-1 truncate font-mono text-text-primary">
                                    {replacement || <span className="text-text-muted">(empty)</span>}
                                </dd>
                            </div>
                        </dl>
                        {dirtyLabels.length > 0 ? (
                            <p className="mt-2 text-xs text-warning">
                                Unsaved editor changes in {dirtyLabels.join(", ")} will be replaced by
                                what&apos;s on disk.
                            </p>
                        ) : null}
                    </AlertDialogBody>
                    <AlertDialogFooter>
                        <Button variant="ghost" size="sm" onClick={() => setPending(null)}>
                            Cancel
                        </Button>
                        <Button variant="default" size="sm" onClick={() => void runReplace()}>
                            Replace
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
