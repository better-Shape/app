"use client";

import { ArrowSync20Regular } from "@fluentui/react-icons/headless/svg/arrow-sync";
import { ErrorCircle20Regular } from "@fluentui/react-icons/headless/svg/error-circle";
import { Info20Regular } from "@fluentui/react-icons/headless/svg/info";
import { Options20Regular } from "@fluentui/react-icons/headless/svg/options";
import { useEffect, useRef } from "react";
import type { ContentMatch } from "@/lib/backend";

import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import { FileIcon } from "@/components/ui/file-icon";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search";
import { cn } from "@/lib/utils";
import {
    limitGroups,
    pluralFiles,
    pluralMatches,
    SEARCH_OPTION_LABEL,
    type ReplaceSummary,
    type SearchFileGroup,
    type SearchHit,
    type SearchOptionKey,
    type SearchSettings,
    type SearchState,
} from "./model";

export type ReplaceScope =
    | { kind: "all" }
    | { kind: "file"; path: string; label: string; count: number }
    | { kind: "match"; path: string; label: string; line: number; column: number; match: ContentMatch };

const MATCH_GROUP_LABEL = "Matching";
const SCOPE_GROUP_LABEL = "Scope";

function StateMessage({ title, detail }: { title: string; detail?: string }) {
    return (
        <div className="flex flex-col gap-1 px-3 py-4">
            <p className="text-sm text-text-primary">{title}</p>
            {detail ? <p className="text-xs text-text-muted">{detail}</p> : null}
        </div>
    );
}

function MatchRow({
    hit,
    onOpen,
    onReplace,
}: {
    hit: SearchHit;
    onOpen: (hit: SearchHit) => void;
    onReplace: (hit: SearchHit) => void;
}) {
    const position = `${hit.line}:${hit.column}`;
    const before = hit.lineText.slice(0, hit.start);
    const matched = hit.lineText.slice(hit.start, hit.end);
    const after = hit.lineText.slice(hit.end);
    return (
        <li className="group flex items-start gap-1">
            <button
                type="button"
                onClick={() => onOpen(hit)}
                aria-label={`${hit.label} line ${hit.line}: ${hit.lineText.trim()}`}
                className="flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-1 text-left hover:bg-panel-hover focus-visible:bg-panel-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus-ring"
            >
                <span className="shrink-0 text-2xs tabular-nums text-text-muted">{position}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-2xs text-text-primary">
                    {before}
                    {hit.end > hit.start ? (
                        <mark className="rounded-sm bg-accent-text-bg text-accent-text">{matched}</mark>
                    ) : null}
                    {after}
                </span>
            </button>
            <button
                type="button"
                onClick={() => onReplace(hit)}
                aria-label={`Replace this match in ${hit.label} at ${position}`}
                className="shrink-0 rounded-md px-1.5 py-1 text-2xs text-text-muted opacity-0 hover:bg-panel-hover hover:text-text-primary focus-visible:bg-panel-hover focus-visible:text-text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus-ring group-hover:opacity-100"
            >
                Replace
            </button>
        </li>
    );
}

function GroupHeading({
    group,
    onOpenFile,
    onReplaceFile,
}: {
    group: SearchFileGroup;
    onOpenFile: (group: SearchFileGroup) => void;
    onReplaceFile: (group: SearchFileGroup) => void;
}) {
    return (
        <div className="flex items-center gap-2 px-2 pb-1 pt-3">
            <FileIcon name={group.label} className="size-4" />
            <button
                type="button"
                onClick={() => onOpenFile(group)}
                aria-label={`Open ${group.label} at line 1`}
                className="min-w-0 flex-1 truncate text-left text-xs font-medium text-text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus-ring"
            >
                {group.label}
            </button>
            <span className="shrink-0 text-xs tabular-nums text-text-muted">
                {pluralMatches(group.hits.length)}
            </span>
            <button
                type="button"
                onClick={() => onReplaceFile(group)}
                aria-label={`Replace all ${pluralMatches(group.hits.length)} in ${group.label}`}
                className="shrink-0 rounded-md px-1.5 py-0.5 text-2xs text-text-muted hover:bg-panel-hover hover:text-text-primary focus-visible:bg-panel-hover focus-visible:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus-ring"
            >
                Replace all
            </button>
        </div>
    );
}

function Results({
    groups,
    onOpen,
    onOpenFile,
    onReplaceMatch,
    onReplaceFile,
}: {
    groups: SearchFileGroup[];
    onOpen: (hit: SearchHit) => void;
    onOpenFile: (group: SearchFileGroup) => void;
    onReplaceMatch: (hit: SearchHit) => void;
    onReplaceFile: (group: SearchFileGroup) => void;
}) {
    return (
        <div>
            {groups.map((group) => (
                <section key={group.label}>
                    <GroupHeading group={group} onOpenFile={onOpenFile} onReplaceFile={onReplaceFile} />
                    <ul className="flex flex-col">
                        {group.hits.map((hit) => (
                            <MatchRow
                                key={`${group.label}:${hit.line}:${hit.start}`}
                                hit={hit}
                                onOpen={onOpen}
                                onReplace={onReplaceMatch}
                            />
                        ))}
                    </ul>
                </section>
            ))}
        </div>
    );
}

function ReplaceReport({ summary, error }: { summary: ReplaceSummary | null; error: string | null }) {
    if (error) {
        return (
            <div className="mx-2 mb-2 flex flex-col gap-1 rounded-md border border-border-subtle px-2 py-1.5">
                <p className="flex items-start gap-1.5 text-xs text-text-primary">
                    <Icon icon={ErrorCircle20Regular} className="mt-px shrink-0 text-error" />
                    Replace didn&apos;t run
                </p>
                <p className="text-2xs text-text-muted">{error}</p>
            </div>
        );
    }
    if (!summary) return null;
    if (summary.kind === "partial") {
        return (
            <div className="mx-2 mb-2 flex flex-col gap-1 rounded-md border border-border-subtle px-2 py-1.5">
                <p className="flex items-start gap-1.5 text-xs text-text-primary">
                    <Icon icon={ErrorCircle20Regular} className="mt-px shrink-0 text-error" />
                    <span>
                        Replaced {pluralMatches(summary.replacements)} in {pluralFiles(summary.files)}, but{" "}
                        {summary.errors.length === 1 ? "1 file failed" : `${summary.errors.length} files failed`}.
                    </span>
                </p>
                <ul className="flex flex-col gap-0.5">
                    {summary.errors.map((failure) => (
                        <li key={failure} className="truncate text-2xs text-text-muted">
                            {failure}
                        </li>
                    ))}
                </ul>
            </div>
        );
    }
    if (summary.kind === "nothing") {
        return (
            <p className="mx-2 mb-2 text-xs text-text-muted">
                Nothing was replaced — the files no longer hold that text.
            </p>
        );
    }
    return (
        <p className="mx-2 mb-2 text-xs text-text-muted">
            Replaced {pluralMatches(summary.replacements)} in {pluralFiles(summary.files)}.
        </p>
    );
}

function OptionsMenu({
    settings,
    onToggle,
}: {
    settings: SearchSettings;
    onToggle: (key: SearchOptionKey) => void;
}) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label="Search options"
                    className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-panel-hover hover:text-text-primary data-[state=open]:bg-panel-hover data-[state=open]:text-text-primary"
                >
                    <Icon icon={Options20Regular} />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel>{MATCH_GROUP_LABEL}</DropdownMenuLabel>
                {(["case_sensitive", "whole_word", "is_regex"] as const).map((key) => (
                    <DropdownMenuCheckboxItem
                        key={key}
                        checked={settings.flags[key]}
                        onCheckedChange={() => onToggle(key)}
                    >
                        {SEARCH_OPTION_LABEL[key]}
                    </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{SCOPE_GROUP_LABEL}</DropdownMenuLabel>
                {(
                    [
                        "respect_gitignore",
                        "include_hidden",
                        "follow_symlinks",
                        "exclude_tests",
                        "exclude_docs",
                        "exclude_build",
                        "exclude_assets",
                        "only_source",
                    ] as const
                ).map((key) => (
                    <DropdownMenuCheckboxItem
                        key={key}
                        checked={settings.flags[key]}
                        onCheckedChange={() => onToggle(key)}
                    >
                        {SEARCH_OPTION_LABEL[key]}
                    </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function statusLine(state: SearchState): string {
    switch (state.kind) {
        case "ready":
            return `${pluralMatches(state.summary.matches)} in ${pluralFiles(state.summary.files)}`;
        case "loading":
            return state.previous ? "Searching — showing the previous results" : "Searching the project…";
        case "failed":
            return "Search didn't run";
        case "blocked":
            return "Search not started";
        default:
            return "Not searched yet";
    }
}

export function SearchPanel({
    query,
    replacement,
    settings,
    state,
    replace,
    replaceError,
    searching,
    replacing,
    onQueryChange,
    onReplacementChange,
    onToggleFlag,
    onPatternChange,
    onRerun,
    onOpen,
    onOpenFile,
    autoFocusField,
    onRequestReplace,
}: {
    query: string;
    replacement: string;
    settings: SearchSettings;
    state: SearchState;
    replace: ReplaceSummary | null;
    replaceError: string | null;
    searching: boolean;
    replacing: boolean;
    onQueryChange: (value: string) => void;
    onReplacementChange: (value: string) => void;
    onToggleFlag: (key: SearchOptionKey) => void;
    onPatternChange: (which: "include" | "exclude", value: string) => void;
    onRerun: () => void;
    onOpen: (hit: SearchHit) => void;
    onOpenFile: (group: SearchFileGroup) => void;
    /** Which field the shortcut that opened this tab should land in. Null focuses nothing. */
    autoFocusField: "query" | "replacement" | null;
    onRequestReplace: (scope: ReplaceScope) => void;
}) {
    const queryRef = useRef<HTMLInputElement>(null);
    const replacementRef = useRef<HTMLInputElement>(null);

    // Runs again when the target changes, so a second Replace in Files press re-focuses
    // even though the tab and the field are both unchanged.
    useEffect(() => {
        if (autoFocusField === "query") queryRef.current?.focus();
        else if (autoFocusField === "replacement") replacementRef.current?.focus();
    }, [autoFocusField]);

    const ready = state.kind === "ready" ? state : null;
    const shown = ready ? limitGroups(ready.groups) : null;
    const canReplaceAll = !!ready && ready.summary.matches > 0 && !replacing && !!query.trim();

    const requestMatch = (hit: SearchHit) =>
        onRequestReplace({
            kind: "match",
            path: hit.path,
            label: hit.label,
            line: hit.line,
            column: hit.column,
            match: hit.raw,
        });
    const requestFile = (group: SearchFileGroup) =>
        onRequestReplace({ kind: "file", path: group.path, label: group.label, count: group.hits.length });

    return (
        <div className="flex h-full min-h-0 flex-col bg-panel">
            <div className="flex shrink-0 items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">Search</span>
                <button
                    type="button"
                    aria-label="Search again"
                    onClick={onRerun}
                    className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-panel-hover hover:text-text-primary"
                >
                    <Icon icon={ArrowSync20Regular} className={cn(searching && "animate-spin motion-reduce:animate-none")} />
                </button>
            </div>

            <div className="flex shrink-0 items-center gap-1 px-3">
                <div className="min-w-0 flex-1">
                    <SearchInput
                        ref={queryRef}
                        value={query}
                        onChange={(e) => onQueryChange(e.target.value)}
                        isLoading={searching}
                        aria-label="Search in files"
                        placeholder="Search in files"
                    />
                </div>
                <OptionsMenu settings={settings} onToggle={onToggleFlag} />
            </div>

            <div className="flex shrink-0 items-end gap-1 px-3">
                <label className="flex min-w-0 flex-1 flex-col gap-1 pb-1">
                    <span className="text-2xs text-text-muted">Replace with</span>
                    <Input
                        ref={replacementRef}
                        value={replacement}
                        onChange={(e) => onReplacementChange(e.target.value)}
                        aria-label="Replace with"
                        placeholder="Replace with"
                        className="h-chrome text-sm"
                        disabled={replacing}
                    />
                </label>
                <Button
                    type="button"
                    variant="default"
                    size="sm"
                    className="mb-1 h-chrome"
                    disabled={!canReplaceAll}
                    onClick={() => onRequestReplace({ kind: "all" })}
                >
                    Replace all
                </Button>
            </div>

            <div className="grid shrink-0 grid-cols-2 gap-2 px-3 pb-2">
                <label className="flex min-w-0 flex-col gap-1">
                    <span className="text-2xs text-text-muted">Include files matching</span>
                    <Input
                        value={settings.includePattern}
                        onChange={(e) => onPatternChange("include", e.target.value)}
                        aria-label="Include files matching"
                        placeholder="*.ts, src/**"
                        className="h-7 text-xs"
                        disabled={searching}
                    />
                </label>
                <label className="flex min-w-0 flex-col gap-1">
                    <span className="text-2xs text-text-muted">Exclude files matching</span>
                    <Input
                        value={settings.excludePattern}
                        onChange={(e) => onPatternChange("exclude", e.target.value)}
                        aria-label="Exclude files matching"
                        placeholder="*.snap, dist/**"
                        className="h-7 text-xs"
                        disabled={searching}
                    />
                </label>
            </div>

            <div className="flex shrink-0 items-center gap-1.5 border-t border-border-subtle px-3 py-1.5">
                <span aria-live="polite" className="min-w-0 flex-1 truncate text-2xs text-text-muted">
                    {statusLine(state)}
                </span>
                {ready?.mayBeTruncated ? (
                    <span className="flex shrink-0 items-center gap-1 text-2xs text-text-muted">
                        <Icon icon={Info20Regular} />
                        May be cut off
                    </span>
                ) : null}
            </div>

            {replace || replaceError ? <ReplaceReport summary={replace} error={replaceError} /> : null}

            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-busy={searching || undefined}>
                {state.kind === "idle" ? (
                    <StateMessage
                        title="Nothing searched yet"
                        detail="Type in the box above to search every file in the project."
                    />
                ) : state.kind === "blocked" ? (
                    <StateMessage title="Search not started" detail={state.reason} />
                ) : state.kind === "failed" ? (
                    <div className="flex flex-col gap-1 px-3 py-4">
                        <p className="flex items-center gap-1.5 text-sm text-text-primary">
                            <Icon icon={ErrorCircle20Regular} className="shrink-0 text-error" />
                            Search didn&apos;t run
                        </p>
                        <p className="text-xs text-text-muted">{state.message}</p>
                    </div>
                ) : state.kind === "loading" ? (
                    state.previous && state.previous.length > 0 ? (
                        <Results
                            groups={state.previous}
                            onOpen={onOpen}
                            onOpenFile={onOpenFile}
                            onReplaceMatch={requestMatch}
                            onReplaceFile={requestFile}
                        />
                    ) : (
                        <StateMessage title="Searching the project…" detail="This reads every file ripgrep is allowed to see." />
                    )
                ) : ready && ready.groups.length === 0 ? (
                    <StateMessage
                        title={`No results for “${query.trim()}”`}
                        detail="The search ran across the project and matched nothing. Loosen the options if that seems wrong."
                    />
                ) : shown ? (
                    <>
                        {shown.hidden > 0 ? (
                            <p className="flex items-start gap-1.5 px-1 pb-1 pt-2 text-2xs leading-snug text-text-muted">
                                <Icon icon={Info20Regular} className="mt-px shrink-0" />
                                <span>
                                    Showing the first {pluralMatches(ready!.summary.matches - shown.hidden)} of{" "}
                                    {pluralMatches(ready!.summary.matches)}. Narrow the search to see the rest.
                                </span>
                            </p>
                        ) : null}
                        <Results
                            groups={shown.groups}
                            onOpen={onOpen}
                            onOpenFile={onOpenFile}
                            onReplaceMatch={requestMatch}
                            onReplaceFile={requestFile}
                        />
                    </>
                ) : null}
            </div>
        </div>
    );
}

