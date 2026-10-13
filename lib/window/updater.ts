"use client";

import { getSettings, type UpdateChannel } from "@/lib/settings";

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; version: string; notes: string }
  | { kind: "downloading"; version: string; progress: number }
  | { kind: "ready"; version: string }
  | { kind: "upToDate" }
  | { kind: "error"; message: string };

type Listener = () => void;

let status: UpdateStatus = { kind: "idle" };
let dismissedVersion: string | null = null;
const DISMISS_KEY = "bettershape-update-dismissed-version";
const listeners = new Set<Listener>();

function loadDismissedVersion(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

function persistDismissedVersion(version: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (version) localStorage.setItem(DISMISS_KEY, version);
    else localStorage.removeItem(DISMISS_KEY);
  } catch {
    /* ignore */
  }
}

dismissedVersion = loadDismissedVersion();

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
  dismissedVersion = status.version;
  persistDismissedVersion(status.version);
  setStatus({ kind: "idle" });
}

export async function checkForAppUpdates(options?: {
  silent?: boolean;
  force?: boolean;
  channel?: UpdateChannel;
}): Promise<UpdateStatus> {
  // Self-hosted builds have no update feed: there is no BetterShape server to ask and
  // no signed artifact to install. Releases are published on GitHub, so the
  // app points people there instead of silently phoning home.
  if (!options?.silent) {
    setStatus({ kind: "upToDate" });
  }
  return status;
}

export async function downloadAndInstallUpdate(): Promise<void> {
  setStatus({
    kind: "error",
    message: "This build updates manually — download the newest release from GitHub.",
  });
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
    void (async () => {
      const next = await checkForAppUpdates({ silent: true });
      if (next.kind === "available") {
        await downloadAndInstallUpdate();
      }
    })();
  };

  run();
  const id = window.setInterval(run, 4 * 60 * 60 * 1000);
  return () => {
    window.clearInterval(id);
    autoCheckStarted = false;
  };
}
