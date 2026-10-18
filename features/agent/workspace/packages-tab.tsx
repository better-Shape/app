"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { commands, useProjectState, type PackageInfo } from "@/lib/backend";
import { resolvePackageManager } from "@/lib/workspace/package-manager";
import { PackagesPanel, type PackageManagerKey } from "@/features/packages/panel";
import { describeMutationFailure, packagesState } from "@/features/packages/model";
import { notify } from "@/features/notifications";

const SIDEBAR_SURFACE = {
    "--panel": "var(--sidebar)",
    "--color-panel": "var(--sidebar)",
    "--editor": "var(--sidebar)",
    "--color-editor": "var(--sidebar)",
} as CSSProperties;

export function PackagesTab() {
    const { project_path } = useProjectState();
    const [override, setOverride] = useState<PackageManagerKey | null>(null);
    const [info, setInfo] = useState<PackageInfo | null>(null);
    const [status, setStatus] = useState<"loading" | "loaded" | "failed">("loading");
    const [message, setMessage] = useState<string | null>(null);
    const [mutationError, setMutationError] = useState<string | null>(null);
    const [filter, setFilter] = useState("");
    const [formKey, setFormKey] = useState(0);
    const [rerunToken, setRerunToken] = useState(0);
    const [busy, setBusy] = useState(false);

    /**
     * Every load takes a ticket. `get_package_info` runs two package manager
     * processes, so a slow read for the old package manager can land after a
     * newer one has and overwrite it with the wrong tree.
     */
    const ticket = useRef(0);
    const inFlight = useRef(false);

    const packageManager: PackageManagerKey = override ?? resolvePackageManager(project_path);

    /**
     * The pending reset runs while rendering, not in an effect, so `status` reads
     * `loading` on the same commit the new request starts. An effect left the
     * previous manager's tree on screen for one frame under the new manager's name.
     */
    const [loadedFor, setLoadedFor] = useState({ project_path, packageManager, rerunToken });
    if (
        loadedFor.project_path !== project_path ||
        loadedFor.packageManager !== packageManager ||
        loadedFor.rerunToken !== rerunToken
    ) {
        setLoadedFor({ project_path, packageManager, rerunToken });
        setStatus("loading");
        setMessage(null);
    }

    useEffect(() => {
        if (!project_path) return;
        const id = ++ticket.current;
        let cancelled = false;
        void commands
            .getPackageInfo(project_path, packageManager)
            .then((result) => {
                if (cancelled || id !== ticket.current) return;
                setInfo(result ?? null);
                setStatus("loaded");
            })
            .catch((error: unknown) => {
                if (cancelled || id !== ticket.current) return;
                setInfo(null);
                setMessage(describeMutationFailure("Reading the package list", error));
                setStatus("failed");
            });
        return () => {
            cancelled = true;
        };
    }, [project_path, packageManager, rerunToken]);

    /**
     * One mutation at a time. The buttons disable on the next render, which is
     * too late for two clicks inside one tick, so the ref is what actually
     * stops the second install from racing the first one's refresh.
     */
    const runMutation = useCallback(async (action: string, run: () => Promise<void>) => {
        if (inFlight.current) return;
        inFlight.current = true;
        setBusy(true);
        setMutationError(null);
        try {
            await run();
            setRerunToken((token) => token + 1);
        } catch (error) {
            const failure = describeMutationFailure(action, error);
            setMutationError(failure);
            notify.error(action, failure);
        } finally {
            inFlight.current = false;
            setBusy(false);
        }
    }, []);

    const onInstallAll = useCallback(() => {
        if (!project_path) return;
        void runMutation("Installing every dependency", async () => {
            await commands.runInstallAll(project_path, packageManager);
        });
    }, [project_path, packageManager, runMutation]);

    const onSubmitInstall = useCallback(
        (spec: string, dev: boolean) => {
            if (!project_path) return;
            void runMutation(`Installing ${spec}`, async () => {
                await commands.npmInstall(project_path, spec, dev, packageManager);
                setFormKey((key) => key + 1);
            });
        },
        [project_path, packageManager, runMutation],
    );

    const onUninstall = useCallback(
        (name: string) => {
            if (!project_path) return;
            void runMutation(`Uninstalling ${name}`, async () => {
                await commands.npmUninstall(project_path, name, packageManager);
            });
        },
        [project_path, packageManager, runMutation],
    );

    const onUpdate = useCallback(
        (name: string) => {
            if (!project_path) return;
            void runMutation(`Updating ${name}`, async () => {
                await commands.npmUpdate(project_path, name, packageManager);
            });
        },
        [project_path, packageManager, runMutation],
    );

    const onRefresh = useCallback(() => setRerunToken((token) => token + 1), []);

    const state = useMemo(
        () =>
            packagesState({
                projectPath: project_path,
                status,
                message,
                info,
                packageManager,
                filter,
                mutationError,
            }),
        [project_path, status, message, info, packageManager, filter, mutationError],
    );

    return (
        <div
            role="region"
            aria-label="Packages"
            className="h-full min-h-0 bg-sidebar"
            style={SIDEBAR_SURFACE}
        >
            <PackagesPanel
                state={state}
                busy={busy}
                filter={filter}
                formKey={formKey}
                packageManager={packageManager}
                onFilterChange={setFilter}
                onPackageManagerChange={setOverride}
                onRefresh={onRefresh}
                onInstallAll={onInstallAll}
                onSubmitInstall={onSubmitInstall}
                onUninstall={onUninstall}
                onUpdate={onUpdate}
            />
        </div>
    );
}