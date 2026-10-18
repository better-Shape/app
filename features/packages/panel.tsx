"use client";

import { useState, type FormEvent } from "react";
import { ArrowSync20Regular } from "@fluentui/react-icons/headless/svg/arrow-sync";
import { ArrowUp20Regular } from "@fluentui/react-icons/headless/svg/arrow-up";
import { Checkmark20Regular } from "@fluentui/react-icons/headless/svg/checkmark";
import { CheckmarkCircle20Regular } from "@fluentui/react-icons/headless/svg/checkmark-circle";
import { Delete20Regular } from "@fluentui/react-icons/headless/svg/delete";
import { QuestionCircle20Regular } from "@fluentui/react-icons/headless/svg/question-circle";

import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import { Icon, type IconGlyph } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search";
import { cn } from "@/lib/utils";
import {
    FRESHNESS_LABEL,
    normalizeInstallSpec,
    pluralPackages,
    type PackageFreshness,
    type PackageRow,
    type PackagesState,
} from "./model";

const PACKAGE_MANAGERS = ["npm", "yarn", "pnpm", "bun"] as const;
export type PackageManagerKey = (typeof PACKAGE_MANAGERS)[number];

const FRESHNESS_GLYPH: Record<PackageFreshness, IconGlyph> = {
    "no-install-data": QuestionCircle20Regular,
    "no-registry-data": QuestionCircle20Regular,
    current: CheckmarkCircle20Regular,
    behind: ArrowUp20Regular,
};

/** The word beside the glyph carries the state too, so the hue is never the only cue. */
const FRESHNESS_CLASS: Record<PackageFreshness, string> = {
    "no-install-data": "text-text-muted",
    "no-registry-data": "text-text-muted",
    current: "text-success",
    behind: "text-warning",
};

function StateMessage({ title, detail }: { title: string; detail?: string }) {
    return (
        <div className="flex flex-col gap-1 px-3 py-4">
            <p className="text-sm text-text-primary">{title}</p>
            {detail ? <p className="text-xs text-text-muted">{detail}</p> : null}
        </div>
    );
}

function FreshnessBadge({ row }: { row: PackageRow }) {
    // "Update available" with no version beside it cannot be acted on: the user has
    // nothing to weigh the upgrade against. `latest` is the version the badge is
    // derived from, so it is the one to print.
    const target = row.freshness === "behind" ? row.latest : null;
    return (
        <span className={cn("flex shrink-0 items-center gap-1 text-xs", FRESHNESS_CLASS[row.freshness])}>
            <Icon icon={FRESHNESS_GLYPH[row.freshness]} className="icon-sm" />
            <span className="whitespace-nowrap">{FRESHNESS_LABEL[row.freshness]}</span>
            {target ? <span className="ml-1 whitespace-nowrap font-mono text-2xs">{target}</span> : null}
        </span>
    );
}

function VersionCell({ value, fallback }: { value: string | null; fallback: string }) {
    return (
        <span className="shrink-0 font-mono text-2xs text-text-secondary" title={value ?? fallback}>
            {value ?? fallback}
        </span>
    );
}

function PackageRowView({
    row,
    busy,
    onUninstall,
    onUpdate,
}: {
    row: PackageRow;
    busy: boolean;
    onUninstall: (name: string) => void;
    onUpdate: (name: string) => void;
}) {
    return (
        <li className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-[var(--row-hover)]">
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary" title={row.name}>
                {row.name}
            </span>
            <VersionCell value={row.declared} fallback="no range" />
            <VersionCell value={row.installed} fallback="unknown" />
            <FreshnessBadge row={row} />
            <button
                type="button"
                onClick={() => onUpdate(row.name)}
                disabled={busy}
                aria-label={`Update ${row.name}`}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-[var(--btn-hover)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus-ring disabled:cursor-not-allowed disabled:opacity-40"
            >
                <Icon icon={ArrowUp20Regular} className="icon-sm" />
            </button>
            <button
                type="button"
                onClick={() => onUninstall(row.name)}
                disabled={busy}
                aria-label={`Uninstall ${row.name}`}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-[var(--btn-hover)] hover:text-error focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus-ring disabled:cursor-not-allowed disabled:opacity-40"
            >
                <Icon icon={Delete20Regular} className="icon-sm" />
            </button>
        </li>
    );
}

function Section({
    title,
    rows,
    busy,
    onUninstall,
    onUpdate,
}: {
    title: string;
    rows: PackageRow[];
    busy: boolean;
    onUninstall: (name: string) => void;
    onUpdate: (name: string) => void;
}) {
    return (
        <section className="pb-1">
            <div className="flex items-center gap-2 px-2 pb-1 pt-3">
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary">{title}</span>
                <span className="shrink-0 text-xs text-text-muted">{rows.length}</span>
            </div>
            <ul className="flex flex-col">
                {rows.map((row) => (
                    <PackageRowView
                        key={`${row.isDev ? "dev" : "prod"}:${row.name}`}
                        row={row}
                        busy={busy}
                        onUninstall={onUninstall}
                        onUpdate={onUpdate}
                    />
                ))}
            </ul>
        </section>
    );
}

function PackageManagerMenu({
    value,
    onChange,
    disabled,
}: {
    value: PackageManagerKey;
    onChange: (next: PackageManagerKey) => void;
    disabled: boolean;
}) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    disabled={disabled}
                    aria-label={`Package manager: ${value}`}
                    className="shrink-0 rounded-md px-2 py-1 text-xs text-text-secondary hover:bg-[var(--row-hover)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus-ring disabled:cursor-not-allowed disabled:opacity-40"
                >
                    {value}
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuLabel>Package manager</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                    value={value}
                    onValueChange={(next) => onChange(next as PackageManagerKey)}
                >
                    {PACKAGE_MANAGERS.map((pm) => (
                        <DropdownMenuRadioItem key={pm} value={pm}>
                            {pm}
                        </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function InstallForm({
    disabled,
    formKey,
    onSubmitInstall,
}: {
    disabled: boolean;
    formKey: number;
    onSubmitInstall: (spec: string, dev: boolean) => void;
}) {
    const [spec, setSpec] = useState("");
    const [dev, setDev] = useState(false);
    // The tab bumps `formKey` after a successful install, which clears the field
    // without this component having to learn what success means. Resetting while
    // rendering is the documented alternative to a reset effect, and it drops the
    // stale keystroke a frame earlier than an effect would.
    const [clearedAt, setClearedAt] = useState(formKey);
    if (formKey !== clearedAt) {
        setClearedAt(formKey);
        setSpec("");
    }

    const trimmed = spec.trim();
    const usable = normalizeInstallSpec(trimmed) !== null;

    return (
        <form
            className="flex items-center gap-1.5 border-b border-border-subtle px-2 py-1.5"
            onSubmit={(event: FormEvent) => {
                event.preventDefault();
                if (disabled || !usable) return;
                onSubmitInstall(trimmed, dev);
            }}
        >
            <Input
                value={spec}
                onChange={(event) => setSpec(event.target.value)}
                disabled={disabled}
                placeholder="Package to install"
                aria-label="Package to install"
                aria-invalid={trimmed.length > 0 && !usable}
                className="h-7 min-h-7 text-xs"
            />
            <button
                type="button"
                onClick={() => setDev((value) => !value)}
                disabled={disabled}
                aria-pressed={dev}
                className={cn(
                    "flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs",
                    dev
                        ? "bg-[var(--btn-open)] text-text-primary hover:bg-[var(--btn-open-hover)]"
                        : "text-text-secondary hover:bg-[var(--btn-hover)] hover:text-text-primary",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus-ring",
                    "disabled:cursor-not-allowed disabled:opacity-40",
                )}
            >
                {dev ? <Icon icon={Checkmark20Regular} className="icon-sm" /> : null}
                Dev
            </button>
            <Button type="submit" size="xs" variant="secondary" disabled={disabled || !usable} loading={disabled}>
                Install
            </Button>
        </form>
    );
}

export function PackagesPanel({
    state,
    busy,
    filter,
    formKey,
    packageManager,
    onFilterChange,
    onPackageManagerChange,
    onRefresh,
    onInstallAll,
    onSubmitInstall,
    onUninstall,
    onUpdate,
}: {
    state: PackagesState;
    busy: boolean;
    filter: string;
    formKey: number;
    packageManager: PackageManagerKey;
    onFilterChange: (next: string) => void;
    onPackageManagerChange: (next: PackageManagerKey) => void;
    onRefresh: () => void;
    onInstallAll: () => void;
    onSubmitInstall: (spec: string, dev: boolean) => void;
    onUninstall: (name: string) => void;
    onUpdate: (name: string) => void;
}) {
    const ready = state.kind === "ready" ? state : null;
    const summary = ready?.summary ?? null;
    const declaredTotal = ready ? ready.groups.dependencies.length + ready.groups.devDependencies.length : 0;
    const visibleTotal = ready ? ready.visible.dependencies.length + ready.visible.devDependencies.length : 0;

    return (
        <div className="flex h-full min-h-0 flex-col bg-panel">
            <div className="flex shrink-0 items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">Packages</span>
                {ready?.manifest ? (
                    <span className="shrink-0 font-mono text-xs text-text-muted" title={ready.manifest}>
                        {ready.manifest}
                    </span>
                ) : null}
                {summary ? <span className="shrink-0 text-xs text-text-muted">{pluralPackages(declaredTotal)}</span> : null}
                <Button
                    size="xs"
                    variant="secondary"
                    onClick={onInstallAll}
                    disabled={busy || !ready}
                    aria-label="Install every dependency"
                >
                    Install all
                </Button>
                <PackageManagerMenu value={packageManager} onChange={onPackageManagerChange} disabled={busy} />
                <button
                    type="button"
                    aria-label="Refresh package list"
                    onClick={onRefresh}
                    disabled={busy}
                    className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-[var(--btn-hover)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus-ring disabled:cursor-not-allowed disabled:opacity-40"
                >
                    <Icon
                        icon={ArrowSync20Regular}
                        className={cn(busy && "animate-spin motion-reduce:animate-none")}
                    />
                </button>
            </div>

            <InstallForm disabled={busy || !ready} formKey={formKey} onSubmitInstall={onSubmitInstall} />

            {ready && declaredTotal > 0 ? (
                <div className="shrink-0 border-b border-border-subtle px-2 py-1.5">
                    <SearchInput
                        value={filter}
                        onChange={(event) => onFilterChange(event.target.value)}
                        placeholder="Filter packages"
                        aria-label="Filter packages"
                    />
                </div>
            ) : null}

            {ready?.mutationError ? (
                <div className="shrink-0 border-b border-border-subtle px-3 py-2">
                    <p className="text-xs font-medium text-error">That action did not run</p>
                    <p className="mt-0.5 break-words text-xs text-text-muted">{ready.mutationError}</p>
                </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {state.kind === "no-project" ? (
                    <StateMessage
                        title="No project open"
                        detail="Open a folder with a package.json to manage its dependencies."
                    />
                ) : state.kind === "blocked" ? (
                    <StateMessage title="No package manifest" detail={state.detail ?? state.reason} />
                ) : state.kind === "loading" ? (
                    <StateMessage title="Reading package.json..." />
                ) : state.kind === "failed" ? (
                    <StateMessage title="The package list could not be read" detail={state.message} />
                ) : ready && visibleTotal === 0 && filter.trim() ? (
                    <StateMessage title="No match" detail="No package name contains that text." />
                ) : ready && declaredTotal === 0 ? (
                    <StateMessage
                        title="No dependencies"
                        detail="package.json lists none, so there is nothing to install here."
                    />
                ) : ready ? (
                    <div className="pb-2">
                        {ready.visible.dependencies.length > 0 ? (
                            <Section
                                title="Dependencies"
                                rows={ready.visible.dependencies}
                                busy={busy}
                                onUninstall={onUninstall}
                                onUpdate={onUpdate}
                            />
                        ) : null}
                        {ready.visible.devDependencies.length > 0 ? (
                            <Section
                                title="Dev dependencies"
                                rows={ready.visible.devDependencies}
                                busy={busy}
                                onUninstall={onUninstall}
                                onUpdate={onUpdate}
                            />
                        ) : null}
                    </div>
                ) : null}
            </div>

            {summary ? (
                <div className="shrink-0 border-t border-border-subtle px-3 py-1.5 text-xs text-text-muted">
                    {packageManager} · {summary.dependencies} dependencies · {summary.devDependencies} dev
                    dependencies
                    {summary.behind > 0 ? ` · ${summary.behind} with an update available` : ""}
                    {summary.missingRegistryData > 0
                        ? ` · ${summary.missingRegistryData} without registry data`
                        : ""}
                    {ready?.installTreeUnreadable ? ` · ${packageManager} reported no install tree` : ""}
                </div>
            ) : null}
        </div>
    );
}