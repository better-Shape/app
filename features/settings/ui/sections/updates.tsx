"use client";

import React, { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
    updateSettingSection,
    type BetterShapeSettings,
} from "@/lib/settings";
import {
    checkForAppUpdates,
    describeUpdateStatus,
    getUpdateStatus,
    openUpdateDownloadPage,
    subscribeUpdateStatus,
} from "@/lib/window/updater";

import { SettingCard, SettingRow, SettingSection, SettingSelect } from "../shared/controls";

/**
 * About panel: the running version, the one update action this build has, and
 * the channel the check reads.
 *
 * Reading the version needs no network, and the check stays behind the button:
 * opening Settings is not a request to contact GitHub. The offer opens the
 * release page, because this build has no downloader to hand the press to.
 */
export function UpdatesSettings({ settings }: { settings: BetterShapeSettings }) {
    const u = settings.updates;
    const [version, setVersion] = useState("0.0.1");
    const status = React.useSyncExternalStore(subscribeUpdateStatus, getUpdateStatus, getUpdateStatus);

    // The version comes from the bundle. The check itself stays behind the
    // button: opening Settings is not a request to contact GitHub.
    useEffect(() => {
        void import("@tauri-apps/api/app")
            .then(({ getVersion }) => getVersion())
            .then(setVersion)
            .catch(() => {});
    }, []);

    // `idle` is the state before any check, so it has no result to describe.
    const statusLine = status.kind === "idle" ? "" : ` ${describeUpdateStatus(status)}`;
    const checking = status.kind === "checking";
    // The check owns its own failure: it answers with an `error` status rather
    // than throwing, so the button only has to ask and let the store report.
    const runCheck = () => void checkForAppUpdates({ force: true });

    return (
        <SettingSection id="settings-updates" title="About BetterShape">
            <SettingCard>
                <div className="flex items-center gap-3 px-3.5 py-3">
                    <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-text-primary">App</div>
                        <div className="text-xs text-text-muted">
                            Current version is v{version}.{statusLine}
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        {status.kind === "available" ? (
                            <Button
                                size="sm"
                                onClick={() => {
                                    void openUpdateDownloadPage().catch(() => undefined);
                                }}
                            >
                                Get {status.version}
                            </Button>
                        ) : null}
                        <Button
                            variant="secondary"
                            size="sm"
                            disabled={checking}
                            onClick={runCheck}
                        >
                            {checking ? "Checking..." : "Check for updates"}
                        </Button>
                    </div>
                </div>
                <div className="flex items-center gap-3 px-3.5 py-3">
                    <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-text-primary">How updates arrive</div>
                        <div className="text-xs text-text-muted">
                            Releases are published on GitHub. A check only reads the newest version; the
                            button opens the release page, where you download the installer yourself.
                        </div>
                    </div>
                </div>
            </SettingCard>
            <SettingRow
                title="Update channel"
                description="Stable reads the newest published release. Nightly also counts pre-releases."
            >
                <SettingSelect
                    value={u.channel}
                    options={[
                        { value: "stable", label: "Stable" },
                        { value: "nightly", label: "Nightly" },
                    ]}
                    onChange={(v) => {
                        const channel = v as BetterShapeSettings["updates"]["channel"];
                        updateSettingSection("updates", { channel });
                    }}
                />
            </SettingRow>
        </SettingSection>
    );
}
