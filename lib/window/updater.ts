"use client";

import { commands } from "@/lib/backend";
import { HELP_LINKS } from "@/lib/errors/help-links";
import { getSettings, type UpdateChannel } from "@/lib/settings";

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; version: string; notes: string; url?: string }
  | { kind: "downloading"; version: string; progress: number }
  | { kind: "ready"; version: string }
  | { kind: "upToDate" }
  | { kind: "error"; message: string };

type Listener = () => void;

let status: UpdateStatus = { kind: "idle" };
const DISMISS_KEY = "bettershape-update-dismissed-version";
const listeners = new Set<Listener>();

function persistDismissedVersion(version: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (version) localStorage.setItem(DISMISS_KEY, version);
    else localStorage.removeItem(DISMISS_KEY);
  } catch {
    /* ignore */
  }
}

function dismissedVersion(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

function emit() {
  for (const l of listeners) l();
}

function setStatus(next: UpdateStatus) {
  status = next;
  emit();
}

export function getUpdateStatus(): UpdateStatus {
  return status;
}

/** Copy for Settings / dialogs. Never call an undownloaded update "ready to install". */
export function describeUpdateStatus(next: UpdateStatus): string {
  switch (next.kind) {
    case "checking":
      return "Checking…";
    case "available":
      return `${next.version} is available. Install it, then restart.`;
    case "downloading":
      return `Downloading ${next.version}… ${next.progress}%`;
    case "ready":
      return `${next.version} is downloaded. Restart BetterShape to finish.`;
    case "upToDate":
    case "idle":
      return "You're on the latest version.";
    case "error":
      return next.message;
  }
}

export function subscribeUpdateStatus(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Hide the titlebar chip until a newer version is published. */
export function dismissAvailableUpdate(): void {
  if (status.kind !== "available") return;
  persistDismissedVersion(status.version);
  setStatus({ kind: "idle" });
}

export async function checkForAppUpdates(options?: {
  silent?: boolean;
  force?: boolean;
  channel?: UpdateChannel;
}): Promise<UpdateStatus> {
  // Releases are published on GitHub and this build updates manually: the check
  // asks GitHub for the newest tag and the update is offered as a link, so no
  // server of ours is involved and nothing is installed silently.
  if (!options?.silent) setStatus({ kind: "checking" });
  try {
    const info = await commands.checkAppUpdate();
    if (!info.newer) {
      setStatus({ kind: "upToDate" });
      return status;
    }
    if (!options?.force && dismissedVersion() === info.latest) {
      setStatus({ kind: "idle" });
      return status;
    }
    setStatus({ kind: "available", version: info.latest, notes: info.notes, url: info.url });
  } catch (error) {
    setStatus({
      kind: "error",
      message:
        error instanceof Error
          ? `Could not check for updates: ${error.message}`
          : "Could not check for updates.",
    });
  }
  return status;
}

/** Opens the release page for the waiting version, or the releases index. */
export async function downloadAndInstallUpdate(): Promise<void> {
  const url = (status.kind === "available" && status.url) || HELP_LINKS.changelog;
  await commands.openUrlExternal(url);
}

export async function relaunchToApplyUpdate(): Promise<void> {
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

export async function installUpdateAndRelaunch(): Promise<void> {
  await downloadAndInstallUpdate();
}

let autoCheckStarted = false;

/** Start background update checks (call once from the main workbench). */
export function startAutoUpdateChecks(): () => void {
  if (autoCheckStarted || typeof window === "undefined") return () => {};
  autoCheckStarted = true;

  const run = () => {
    const settings = getSettings().updates;
    if (!settings.autoUpdate) return;
    // Only looks: the chip is the affordance, and opening a browser on a timer
    // the user never asked for would be a different kind of surprise.
    void checkForAppUpdates({ silent: true });
  };

  run();
  const id = window.setInterval(run, 4 * 60 * 60 * 1000);
  return () => {
    window.clearInterval(id);
    autoCheckStarted = false;
  };
}
