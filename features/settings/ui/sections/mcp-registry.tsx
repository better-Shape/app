"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SETTING_CONTROL_BTN } from "../shared/controls";
import { commands } from "@/lib/backend";
import type { McpRegistryEntry, McpStatusEntry } from "@/lib/backend/types";
import { notify } from "@/features/notifications";
import {
    registryDisplayName,
    registryInstallable,
    registrySubtitle,
    registryTarget,
} from "@/lib/mcp/registry-catalog";

/**
 * Browse the official MCP registry and install an entry.
 *
 * This is the same registry the agent searches and the same write path it uses
 * (`mcp_registry_install` → `admin::upsert`), so an install from here and an
 * install from chat produce the same `mcp.json` entry.
 */
export function RegistryInstallPanel({
    existingIds,
    onInstalled,
}: {
    existingIds: Set<string>;
    onInstalled: () => void;
}) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<McpRegistryEntry[] | null>(null);
    const [searching, setSearching] = useState(false);
    const [installing, setInstalling] = useState<string | null>(null);
    const [error, setError] = useState("");

    const search = useCallback(async () => {
        setSearching(true);
        setError("");
        try {
            const found = await commands.mcpRegistrySearch(query);
            setResults(found);
        } catch (err) {
            setResults(null);
            setError(err instanceof Error ? err.message : "Could not reach the registry.");
        } finally {
            setSearching(false);
        }
    }, [query]);

    const install = useCallback(
        async (entry: McpRegistryEntry) => {
            const key = registryDisplayName(entry);
            setInstalling(key);
            setError("");
            try {
                const result = await commands.mcpRegistryInstall(entry);
                const status: McpStatusEntry = result.status;
                if (status.status === "needs_auth" && result.server.url) {
                    try {
                        await commands.mcpStartOAuth(result.server.id);
                    } catch (err) {
                        notify.error(
                            err instanceof Error
                                ? err.message
                                : `${result.server.name} was added, but sign-in did not finish.`,
                        );
                    }
                }
                notify.success(`${result.server.name} added.`);
                onInstalled();
            } catch (err) {
                setError(err instanceof Error ? err.message : "Could not install that server.");
            } finally {
                setInstalling(null);
            }
        },
        [onInstalled],
    );

    return (
        <div className="flex flex-col gap-3">
            <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                    event.preventDefault();
                    void search();
                }}
            >
                <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search the registry, e.g. playwright, sentry, postgres"
                    className="h-9"
                />
                <Button type="submit" size="sm" variant="secondary" className={cn("shrink-0")} disabled={searching}>
                    {searching ? "Searching…" : "Search"}
                </Button>
            </form>

            {error ? <p className="text-sm text-error">{error}</p> : null}

            {results === null && !searching && !error ? (
                <p className="text-sm text-text-muted">
                    Search the official MCP registry. Anything you install is written to{" "}
                    <span className="font-mono">mcp.json</span>, and you can edit or remove it like any
                    other server.
                </p>
            ) : null}

            {results !== null && results.length === 0 ? (
                <p className="text-sm text-text-muted">
                    Nothing matched. Try the package or product name, or add the server by hand.
                </p>
            ) : null}

            {results !== null && results.length > 0 ? (
                <div className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
                    {results.map((entry) => {
                        const installable = registryInstallable(entry);
                        const busy = installing === registryDisplayName(entry);
                        const already = entry.id ? existingIds.has(entry.id) : false;
                        return (
                            <div
                                key={entry.name}
                                className="flex items-start justify-between gap-3 squircle-2xl bg-surface-3 p-3"
                            >
                                <div className="min-w-0">
                                    <div className="truncate text-md font-medium text-text-primary">
                                        {registryDisplayName(entry)}
                                    </div>
                                    {registrySubtitle(entry) ? (
                                        <div className="mt-0.5 truncate text-xs text-text-muted">
                                            {registrySubtitle(entry)}
                                        </div>
                                    ) : null}
                                    {entry.description ? (
                                        <div className="mt-1 line-clamp-2 text-sm text-text-muted">
                                            {entry.description}
                                        </div>
                                    ) : null}
                                    <div className="mt-1 truncate font-mono text-xs text-text-muted">
                                        {registryTarget(entry)}
                                    </div>
                                    {!installable.ok ? (
                                        <div className="mt-1 text-xs text-text-muted">{installable.reason}</div>
                                    ) : null}
                                </div>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    className={cn("shrink-0", SETTING_CONTROL_BTN)}
                                    disabled={!installable.ok || busy || already}
                                    onClick={() => void install(entry)}
                                >
                                    {already ? "Added" : busy ? "Installing…" : "Install"}
                                </Button>
                            </div>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}
