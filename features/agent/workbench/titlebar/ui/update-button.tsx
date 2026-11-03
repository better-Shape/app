"use client";

import { Dismiss20Regular } from "@fluentui/react-icons/headless/svg/dismiss";
import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
    getUpdateStatus,
    subscribeUpdateStatus,
    openUpdateDownloadPage,
    dismissAvailableUpdate,
    type UpdateStatus,
} from "@/lib/window/updater";

/**
 * The label per status, for the statuses that have one.
 *
 * A table rather than a switch: the button's label, tip and action all key off the same
 * status, so a new status has to be named in one place. `null` is a status the bar stays
 * quiet about, which is what keeps a background check from showing.
 */
const QUIET_LABELS: Record<UpdateStatus["kind"], string | null> = {
    idle: null,
    checking: "Checking for updates...",
    available: "Update available",
    upToDate: null,
    noRelease: null,
    error: null,
};

/** The button's label, or nothing when there is no update to show. */
const labelFor = (status: UpdateStatus): string | null => QUIET_LABELS[status.kind];

/**
 * The hover tip: the version and where the press leads when one is waiting, and
 * the button's own label otherwise.
 */
const tipFor = (status: UpdateStatus, label: string) => {
    if (status.kind === "available") return `Update available: ${status.version}. Opens the release page.`;
    return label;
};

/**
 * Pressing the chip opens the waiting release's page. This build has no in-app
 * downloader, so there is nothing else for the press to do, and the store
 * reports a failed launch by moving to `error`, which the chip stays quiet about.
 */
const runUpdate = (status: UpdateStatus) => {
    if (status.kind !== "available") return;
    openUpdateDownloadPage().catch(() => undefined);
};

/**
 * The update affordance in the titlebar: the state that names itself, and a dismiss for the
 * one state a user has to be able to get rid of.
 *
 * Pressing it is inert while a check is already running, because the second press has
 * nothing to start; the dismiss is only offered for an available update, since that is
 * the only state a user can decline.
 */
export const TitlebarUpdateButton = () => {
    const status = useSyncExternalStore(subscribeUpdateStatus, getUpdateStatus, getUpdateStatus);
    const label = labelFor(status);
    if (!label) return null;

    const busy = status.kind === "checking";
    const canDismiss = status.kind === "available";

    /** One press, one action: what it does is a function of the status it was rendered from. */
    const handleUpdate = () => {
        runUpdate(status);
    };

    return (
        <div className="relative z-20 mx-2 flex h-7 max-w-[15rem] items-center rounded-md text-sm bg-white/10 text-text-primary">
            <button
                type="button"
                disabled={busy}
                className="flex h-full min-w-0 items-center rounded-sm px-1.5 transition-colors hover:bg-[var(--btn-hover)] disabled:opacity-70"
                title={tipFor(status, label)}
                onClick={handleUpdate}
            >
                <span className="truncate">{label}</span>
            </button>
            {canDismiss ? (
                <button
                    type="button"
                    className="flex h-full w-5 shrink-0 mr-1.5 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-[var(--btn-hover)] hover:text-text-primary"
                    title="Dismiss"
                    aria-label="Dismiss update"
                    onClick={(event) => {
                        event.stopPropagation();
                        dismissAvailableUpdate();
                    }}
                >
                    <Icon icon={Dismiss20Regular} />
                </button>
            ) : null}
        </div>
    );
};

/**
 * The dialog a build older than the backend needs: it says what was refused and offers the
 * one way forward, which is to update.
 *
 * It stands in front of the app rather than inside a surface, because nothing behind it is
 * usable at this version.
 */
export const UpgradeRequiredDialog = ({
    message,
    onUpdate,
}: {
    message: string;
    onUpdate: () => void;
}) => (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-lg">
            <h2 className="text-base font-medium text-text-primary">Update required</h2>
            <p className="mt-2 text-sm leading-relaxed text-text-muted">{message}</p>
            <div className="mt-4 flex justify-end gap-2">
                <Button type="button" onClick={onUpdate}>
                    Update now
                </Button>
            </div>
        </div>
    </div>
);
