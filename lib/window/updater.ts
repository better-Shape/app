"use client";

import { commands } from "@/lib/backend";
import { HELP_LINKS } from "@/lib/errors/help-links";
import { getSettings, type UpdateChannel } from "@/lib/settings";

/**
 * The state of the one update check the app can do.
 *
 * Releases are published on GitHub and this build updates by hand, so there is
 * no download to report progress for and nothing to install: the check names
 * the version and offers its release page.
 */
export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; version: string; notes: string; url?: string }
  | { kind: "upToDate" }
  /** GitHub answered, and the repository has published no release yet. */
  | { kind: "noRelease" }
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

/** Copy for Settings / dialogs. Never claim an update was downloaded or installed. */
export function describeUpdateStatus(next: UpdateStatus): string {
  switch (next.kind) {
    case "checking":
      return "Checking for updates...";
    case "available":
      return `${next.version} is available. Open its release page to download it.`;
    case "noRelease":
      return "No releases have been published yet.";
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

/**
 * Asks GitHub for the newest release on the configured channel.
 *
 * This is the only outbound call in the update path and it only runs when a
 * surface asks for it: the app never polls on startup or on a timer, because a
 * request the user did not make is not one this app sends.
 */
export async function checkForAppUpdates(options?: {
  silent?: boolean;
  force?: boolean;
  channel?: UpdateChannel;
}): Promise<UpdateStatus> {
  const channel = options?.channel ?? getSettings().updates.channel;
  if (!options?.silent) setStatus({ kind: "checking" });
  try {
    const info = await commands.checkAppUpdate(channel);
    if (!info.published) {
      setStatus({ kind: "noRelease" });
      return status;
    }
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
export async function openUpdateDownloadPage(): Promise<void> {
  const url = (status.kind === "available" && status.url) || HELP_LINKS.changelog;
  await commands.openUrlExternal(url);
}
